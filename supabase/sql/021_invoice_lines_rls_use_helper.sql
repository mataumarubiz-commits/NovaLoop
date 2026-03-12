-- 021_invoice_lines_rls_use_helper.sql (idempotent)
-- invoice_lines の RLS を app_users 直接参照から user_role_in_org に変更。
-- 018 適用後も明細の作成が確実に通るようにする（「明細の作成に失敗しました: クライアント名」等の誤表示を防ぐ）。

-- 018 で user_role_in_org が定義されている必要あり。

DROP POLICY IF EXISTS invoice_lines_admin_select ON public.invoice_lines;
DROP POLICY IF EXISTS invoice_lines_admin_write ON public.invoice_lines;

CREATE POLICY invoice_lines_admin_select ON public.invoice_lines
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.invoices i
      WHERE i.id = invoice_lines.invoice_id
        AND public.user_role_in_org(i.org_id) IN ('owner', 'executive_assistant')
    )
  );

CREATE POLICY invoice_lines_admin_write ON public.invoice_lines
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.invoices i
      WHERE i.id = invoice_lines.invoice_id
        AND public.user_role_in_org(i.org_id) IN ('owner', 'executive_assistant')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.invoices i
      WHERE i.id = invoice_lines.invoice_id
        AND public.user_role_in_org(i.org_id) IN ('owner', 'executive_assistant')
    )
  );
