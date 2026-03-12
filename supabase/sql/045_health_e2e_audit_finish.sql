-- 045_health_e2e_audit_finish.sql
-- Health / E2E / audit 仕上げ用の最小補完

-- vendor_invoices に rejected を追加
ALTER TABLE public.vendor_invoices
  DROP CONSTRAINT IF EXISTS vendor_invoices_status_check;

ALTER TABLE public.vendor_invoices
  ADD CONSTRAINT vendor_invoices_status_check
  CHECK (status IN ('draft', 'submitted', 'approved', 'rejected', 'paid'));

-- app_users.role 更新時の監査
CREATE OR REPLACE FUNCTION public.audit_app_user_role_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF NEW.role IS DISTINCT FROM OLD.role THEN
    INSERT INTO public.audit_logs (org_id, user_id, action, resource_type, resource_id, meta)
    VALUES (
      NEW.org_id,
      COALESCE(auth.uid(), NEW.user_id),
      'role.update',
      'member',
      NEW.user_id,
      jsonb_build_object(
        'previous_role', OLD.role,
        'next_role', NEW.role
      )
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_audit_app_user_role_update ON public.app_users;
CREATE TRIGGER trg_audit_app_user_role_update
AFTER UPDATE OF role ON public.app_users
FOR EACH ROW
EXECUTE FUNCTION public.audit_app_user_role_update();

-- vendor_invoices.status 更新時の監査
CREATE OR REPLACE FUNCTION public.audit_vendor_invoice_create()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  INSERT INTO public.audit_logs (org_id, user_id, action, resource_type, resource_id, meta)
  VALUES (
    NEW.org_id,
    COALESCE(auth.uid(), NEW.vendor_id),
    'vendor_invoice.create',
    'vendor_invoice',
    NEW.id,
    jsonb_build_object(
      'vendor_id', NEW.vendor_id,
      'billing_month', NEW.billing_month,
      'status', NEW.status,
      'total', NEW.total
    )
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_audit_vendor_invoice_create ON public.vendor_invoices;
CREATE TRIGGER trg_audit_vendor_invoice_create
AFTER INSERT ON public.vendor_invoices
FOR EACH ROW
EXECUTE FUNCTION public.audit_vendor_invoice_create();

CREATE OR REPLACE FUNCTION public.audit_vendor_invoice_status_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  action_name text;
BEGIN
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;

  IF NEW.status = 'approved' THEN
    action_name := 'vendor_invoice.approve';
  ELSIF NEW.status = 'rejected' THEN
    action_name := 'vendor_invoice.reject';
  ELSE
    RETURN NEW;
  END IF;

  INSERT INTO public.audit_logs (org_id, user_id, action, resource_type, resource_id, meta)
  VALUES (
    NEW.org_id,
    COALESCE(auth.uid(), NEW.vendor_id),
    action_name,
    'vendor_invoice',
    NEW.id,
    jsonb_build_object(
      'previous_status', OLD.status,
      'next_status', NEW.status
    )
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_audit_vendor_invoice_status_change ON public.vendor_invoices;
CREATE TRIGGER trg_audit_vendor_invoice_status_change
AFTER UPDATE OF status ON public.vendor_invoices
FOR EACH ROW
EXECUTE FUNCTION public.audit_vendor_invoice_status_change();

-- payout 作成/支払済み更新時の監査
CREATE OR REPLACE FUNCTION public.audit_payout_changes()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.audit_logs (org_id, user_id, action, resource_type, resource_id, meta)
    VALUES (
      NEW.org_id,
      COALESCE(auth.uid(), NEW.vendor_id),
      'payout.generate',
      'payout',
      NEW.id,
      jsonb_build_object(
        'vendor_invoice_id', NEW.vendor_invoice_id,
        'amount', NEW.amount,
        'pay_date', NEW.pay_date
      )
    );
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' AND NEW.status = 'paid' AND NEW.status IS DISTINCT FROM OLD.status THEN
    INSERT INTO public.audit_logs (org_id, user_id, action, resource_type, resource_id, meta)
    VALUES (
      NEW.org_id,
      COALESCE(auth.uid(), NEW.vendor_id),
      'payout.mark_paid',
      'payout',
      NEW.id,
      jsonb_build_object(
        'vendor_invoice_id', NEW.vendor_invoice_id,
        'previous_status', OLD.status,
        'next_status', NEW.status,
        'paid_at', NEW.paid_at
      )
    );
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_audit_payout_insert ON public.payouts;
CREATE TRIGGER trg_audit_payout_insert
AFTER INSERT ON public.payouts
FOR EACH ROW
EXECUTE FUNCTION public.audit_payout_changes();

DROP TRIGGER IF EXISTS trg_audit_payout_update ON public.payouts;
CREATE TRIGGER trg_audit_payout_update
AFTER UPDATE OF status ON public.payouts
FOR EACH ROW
EXECUTE FUNCTION public.audit_payout_changes();
