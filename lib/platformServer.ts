import { createSupabaseAdmin } from "@/lib/supabaseAdmin"
import type { AuditAction } from "@/lib/auditLog"
import {
  DEFAULT_PLATFORM_BILLING_SETTINGS,
  type PlatformBillingSettings,
  type PlatformNotificationType,
} from "@/lib/platform"
import { createPlatformDocumentSignedUrl } from "@/lib/platformDocuments"
import { writeAuditLog } from "@/lib/auditLog"

type PaymentLikeRow = Record<string, unknown> & {
  id?: string
}

type CheckoutSessionLikeRow = Record<string, unknown> & {
  payment_request_id?: string
}

export async function getPlatformBillingSettings(): Promise<PlatformBillingSettings> {
  const admin = createSupabaseAdmin()
  const { data } = await admin.from("platform_billing_settings").select("*").eq("id", true).maybeSingle()
  if (!data) return DEFAULT_PLATFORM_BILLING_SETTINGS

  return {
    seller_name: String(data.seller_name ?? DEFAULT_PLATFORM_BILLING_SETTINGS.seller_name),
    seller_address: String(data.seller_address ?? DEFAULT_PLATFORM_BILLING_SETTINGS.seller_address),
    seller_phone: String(data.seller_phone ?? DEFAULT_PLATFORM_BILLING_SETTINGS.seller_phone),
    seller_email: String(data.seller_email ?? DEFAULT_PLATFORM_BILLING_SETTINGS.seller_email),
    bank_name: String(data.bank_name ?? DEFAULT_PLATFORM_BILLING_SETTINGS.bank_name),
    bank_branch_name: String(data.bank_branch_name ?? DEFAULT_PLATFORM_BILLING_SETTINGS.bank_branch_name),
    bank_branch_code: String(data.bank_branch_code ?? DEFAULT_PLATFORM_BILLING_SETTINGS.bank_branch_code),
    bank_account_type: String(data.bank_account_type ?? DEFAULT_PLATFORM_BILLING_SETTINGS.bank_account_type),
    bank_account_number: String(data.bank_account_number ?? DEFAULT_PLATFORM_BILLING_SETTINGS.bank_account_number),
    bank_account_holder: String(data.bank_account_holder ?? DEFAULT_PLATFORM_BILLING_SETTINGS.bank_account_holder),
    transfer_fee_note: String(data.transfer_fee_note ?? DEFAULT_PLATFORM_BILLING_SETTINGS.transfer_fee_note),
    qualified_invoice_enabled: Boolean(
      data.qualified_invoice_enabled ?? DEFAULT_PLATFORM_BILLING_SETTINGS.qualified_invoice_enabled
    ),
    invoice_registration_number:
      typeof data.invoice_registration_number === "string" ? data.invoice_registration_number : null,
    default_tax_mode: DEFAULT_PLATFORM_BILLING_SETTINGS.default_tax_mode,
    license_price_jpy: Number(data.license_price_jpy ?? DEFAULT_PLATFORM_BILLING_SETTINGS.license_price_jpy),
  }
}

export async function createPlatformNotification(input: {
  recipientUserId: string
  type: PlatformNotificationType
  payload: Record<string, unknown>
}) {
  const admin = createSupabaseAdmin()
  await admin.from("notifications").insert({
    org_id: null,
    recipient_user_id: input.recipientUserId,
    type: input.type,
    payload: input.payload,
  })
}

export async function writePlatformAudit(input: {
  userId: string
  action: AuditAction
  resourceType: string
  resourceId?: string | null
  meta?: Record<string, unknown>
}) {
  const admin = createSupabaseAdmin()
  await writeAuditLog(admin, {
    org_id: null,
    user_id: input.userId,
    action: input.action,
    resource_type: input.resourceType,
    resource_id: input.resourceId ?? null,
    meta: input.meta ?? {},
  })
}

export async function getMyLicenseSnapshot(userId: string) {
  const admin = createSupabaseAdmin()
  const { data: entitlement } = await admin.from("creator_entitlements").select("*").eq("user_id", userId).maybeSingle()

  const [profileRes, transferRes, purchasesRes, paymentsRes] = await Promise.all([
    admin.from("creator_profiles").select("*").eq("user_id", userId).maybeSingle(),
    admin
      .from("entitlement_transfer_requests")
      .select("*")
      .eq("target_user_id", userId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    entitlement
      ? admin
          .from("entitlement_purchase_requests")
          .select("*")
          .eq("entitlement_id", entitlement.id)
          .order("created_at", { ascending: false })
      : Promise.resolve({ data: [], error: null }),
    entitlement
      ? admin
          .from("platform_payment_requests")
          .select("*")
          .eq("entitlement_id", entitlement.id)
          .order("created_at", { ascending: false })
      : Promise.resolve({ data: [], error: null }),
  ])

  const paymentRows = (paymentsRes.data ?? []) as PaymentLikeRow[]
  const checkoutSessionsByPaymentId = await getLatestPlatformCheckoutSessionsByPaymentId(
    admin,
    paymentRows.map((row) => String(row.id ?? "")).filter(Boolean)
  )

  const paymentRequests = await Promise.all(
    paymentRows.map(async (row) => ({
      ...mergeLatestCheckoutSessionFields(row, checkoutSessionsByPaymentId.get(String(row.id ?? "")) ?? null),
      receipt_signed_url: await createPlatformDocumentSignedUrl(
        typeof row.receipt_pdf_path === "string" ? row.receipt_pdf_path : null
      ),
    }))
  )

  const receiptsRes = entitlement
    ? await admin.from("purchase_receipts").select("*").eq("user_id", userId).order("created_at", { ascending: false })
    : { data: [], error: null }

  const receipts = await Promise.all(
    ((receiptsRes.data ?? []) as Array<Record<string, unknown>>).map(async (row) => ({
      ...row,
      receipt_signed_url: await createPlatformDocumentSignedUrl(
        typeof row.pdf_path === "string" ? row.pdf_path : null
      ),
    }))
  )

  const purchaseRequests = await Promise.all(
    (purchasesRes.data ?? []).map(async (row) => ({
      ...row,
      receipt_signed_url: await createPlatformDocumentSignedUrl(row.receipt_pdf_path),
    }))
  )

  return {
    entitlement,
    creatorProfile: profileRes.data ?? null,
    purchaseRequests,
    paymentRequests,
    receipts,
    latestTransferRequest: transferRes.data ?? null,
  }
}

export async function getLatestPlatformCheckoutSessionsByPaymentId(
  admin: ReturnType<typeof createSupabaseAdmin>,
  paymentRequestIds: string[]
) {
  const ids = Array.from(new Set(paymentRequestIds.filter(Boolean)))
  if (ids.length === 0) {
    return new Map<string, CheckoutSessionLikeRow>()
  }

  const { data } = await admin
    .from("platform_checkout_sessions")
    .select("*")
    .in("payment_request_id", ids)
    .order("created_at", { ascending: false })

  const latestByPaymentId = new Map<string, CheckoutSessionLikeRow>()
  for (const row of (data ?? []) as CheckoutSessionLikeRow[]) {
    const paymentRequestId = typeof row.payment_request_id === "string" ? row.payment_request_id : null
    if (!paymentRequestId || latestByPaymentId.has(paymentRequestId)) continue
    latestByPaymentId.set(paymentRequestId, row)
  }

  return latestByPaymentId
}

export function mergeLatestCheckoutSessionFields(
  payment: PaymentLikeRow,
  checkoutSession: CheckoutSessionLikeRow | null
) {
  if (!checkoutSession) return payment

  return {
    ...payment,
    latest_checkout_session_id:
      typeof checkoutSession.checkout_session_id === "string" ? checkoutSession.checkout_session_id : null,
    latest_checkout_status: typeof checkoutSession.status === "string" ? checkoutSession.status : null,
    latest_checkout_payment_intent_id:
      typeof checkoutSession.payment_intent_id === "string" ? checkoutSession.payment_intent_id : null,
  }
}
