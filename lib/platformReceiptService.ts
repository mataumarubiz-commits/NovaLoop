import { writeAuditLog } from "@/lib/auditLog"
import { PLATFORM_THANKS_PATH } from "@/lib/platformFlow"
import {
  buildPlatformReceiptPayload,
  renderPlatformReceiptHtmlFromPayload,
  type PlatformReceiptDocumentPayload,
} from "@/lib/platformReceipts"
import { uploadPlatformReceiptPdf, createPlatformDocumentSignedUrl } from "@/lib/platformDocuments"
import { getPlatformBillingSettings, createPlatformNotification, writePlatformAudit } from "@/lib/platformServer"
import { createSupabaseAdmin } from "@/lib/supabaseAdmin"

type AdminClient = ReturnType<typeof createSupabaseAdmin>

type PaymentContext = {
  payment: Record<string, unknown>
  purchase: Record<string, unknown>
  entitlement: Record<string, unknown>
}

type EnsureReceiptParams = {
  admin: AdminClient
  context: PaymentContext
  issuedAtIso: string
  paidAtIso: string
  providerPayload?: Record<string, unknown> | null
}

type ProcessSuccessParams = {
  admin: AdminClient
  paymentId: string
  actorUserId?: string | null
  paidAtIso?: string
  paidNote?: string | null
  providerPayload?: Record<string, unknown> | null
  notifyUser?: boolean
}

export async function fetchPlatformPaymentContext(
  admin: AdminClient,
  paymentId: string
): Promise<PaymentContext | null> {
  const { data: payment } = await admin
    .from("platform_payment_requests")
    .select("*")
    .eq("id", paymentId)
    .maybeSingle()
  if (!payment) return null

  const paymentRow = payment as Record<string, unknown>
  const [{ data: purchase }, { data: entitlement }] = await Promise.all([
    admin
      .from("entitlement_purchase_requests")
      .select("*")
      .eq("id", String(paymentRow.purchase_request_id ?? ""))
      .maybeSingle(),
    admin
      .from("creator_entitlements")
      .select("*")
      .eq("id", String(paymentRow.entitlement_id ?? ""))
      .maybeSingle(),
  ])

  if (!purchase || !entitlement) return null
  return {
    payment: paymentRow,
    purchase: purchase as Record<string, unknown>,
    entitlement: entitlement as Record<string, unknown>,
  }
}

export async function processPlatformPaymentSuccess(params: ProcessSuccessParams) {
  const context = await fetchPlatformPaymentContext(params.admin, params.paymentId)
  if (!context) throw new Error("payment relations are missing")

  const { payment, purchase, entitlement } = context
  let receiptNumber = stringOrNull(payment.receipt_number)
  if (!receiptNumber) {
    const receiptRpc = await params.admin.rpc("allocate_platform_receipt_number")
    receiptNumber = typeof receiptRpc.data === "string" ? receiptRpc.data : null
  }
  if (!receiptNumber) throw new Error("failed to allocate receipt number")

  const paidAtIso =
    params.paidAtIso ??
    (stringOrNull(payment.client_paid_at_claimed)
      ? new Date(`${String(payment.client_paid_at_claimed)}T00:00:00+09:00`).toISOString()
      : stringOrNull(payment.paid_at) ?? new Date().toISOString())
  const firstActivation = payment.status !== "paid" || entitlement.status !== "active"

  if (firstActivation) {
    const now = new Date().toISOString()
    const [paymentUpdate, purchaseUpdate, entitlementUpdate] = await Promise.all([
      params.admin
        .from("platform_payment_requests")
        .update({
          status: "paid",
          paid_at: paidAtIso,
          paid_note:
            stringOrNull(params.paidNote) ??
            stringOrNull(payment.paid_note) ??
            stringOrNull(payment.client_notify_note) ??
            stringOrNull(payment.client_transfer_name),
          receipt_number: receiptNumber,
          receipt_document_status: "pending_generation",
          updated_at: now,
        })
        .eq("id", params.paymentId),
      params.admin
        .from("entitlement_purchase_requests")
        .update({
          status: "paid",
          receipt_document_status: "pending_generation",
          updated_at: now,
        })
        .eq("id", String(purchase.id)),
      params.admin
        .from("creator_entitlements")
        .update({
          status: "active",
          grant_type: entitlement.grant_type ?? "paid",
          amount_total_jpy: Number(entitlement.amount_total_jpy ?? payment.amount_jpy ?? 300000),
          activated_at: stringOrNull(entitlement.activated_at) ?? paidAtIso,
          updated_at: now,
        })
        .eq("id", String(entitlement.id)),
    ])

    if (paymentUpdate.error) throw new Error(`Failed to update payment request: ${paymentUpdate.error.message}`)
    if (purchaseUpdate.error) throw new Error(`Failed to update purchase request: ${purchaseUpdate.error.message}`)
    if (entitlementUpdate.error) throw new Error(`Failed to activate entitlement: ${entitlementUpdate.error.message}`)

    payment.status = "paid"
    payment.paid_at = paidAtIso
    payment.receipt_number = receiptNumber
    entitlement.status = "active"
  }

  const receipt = await ensurePlatformPurchaseReceipt({
    admin: params.admin,
    context: {
      payment: { ...payment, receipt_number: receiptNumber },
      purchase,
      entitlement,
    },
    issuedAtIso: new Date().toISOString(),
    paidAtIso,
    providerPayload: params.providerPayload,
  })

  if (firstActivation && params.notifyUser !== false) {
    const tasks: Array<Promise<unknown>> = [
      createPlatformNotification({
        recipientUserId: String(payment.user_id),
        type: "platform.license_activated",
        payload: {
          request_number: payment.request_number,
          invoice_number: payment.invoice_number,
          receipt_number: receipt.receipt_number,
          activated_at: paidAtIso,
          action_href: `${PLATFORM_THANKS_PATH}?from=notification`,
        },
      }),
    ]

    if (stringOrNull(params.actorUserId)) {
      tasks.push(
        writePlatformAudit({
          userId: String(params.actorUserId),
          action: "platform.payment.mark_paid",
          resourceType: "platform_payment_request",
          resourceId: params.paymentId,
          meta: {
            request_number: payment.request_number,
            receipt_number: receipt.receipt_number,
          },
        })
      )
    }

    await Promise.allSettled(tasks)
  }

  return {
    context,
    receipt,
    idempotent: !firstActivation,
  }
}

export async function getPlatformReceiptDownload(params: {
  admin: AdminClient
  paymentId: string
}) {
  const context = await fetchPlatformPaymentContext(params.admin, params.paymentId)
  if (!context) throw new Error("payment request not found")
  if (context.payment.status !== "paid") throw new Error("receipt is available after payment confirmation")

  const receipt = await ensurePlatformPurchaseReceipt({
    admin: params.admin,
    context,
    issuedAtIso: new Date().toISOString(),
    paidAtIso: stringOrNull(context.payment.paid_at) ?? new Date().toISOString(),
  })
  const signedUrl = await createPlatformDocumentSignedUrl(stringOrNull(receipt.pdf_path))
  return { receipt, signedUrl }
}

async function ensurePlatformPurchaseReceipt(params: EnsureReceiptParams) {
  const { admin, context, paidAtIso } = params
  const { payment, purchase } = context
  const settings = await getPlatformBillingSettings()

  const { data: existingReceipt } = await admin
    .from("purchase_receipts")
    .select("*")
    .eq("payment_request_id", String(payment.id))
    .eq("status", "issued")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle()

  const issuedAtIso = stringOrNull(existingReceipt?.issued_at) ?? params.issuedAtIso
  const receiptNumber =
    stringOrNull(existingReceipt?.receipt_number) ??
    stringOrNull(payment.receipt_number) ??
    (() => {
      throw new Error("receipt number is missing")
    })()

  const payload = buildReceiptPayload({
    payment,
    purchase,
    settings,
    receiptNumber,
    issuedAtIso,
    paidAtIso,
    payerNote:
      stringOrNull(payment.client_transfer_name) ??
      stringOrNull(payment.paid_note) ??
      stringOrNull(payment.client_notify_note),
    existingPayload:
      isNonEmptyRecord(existingReceipt?.document_payload_json)
        ? (existingReceipt?.document_payload_json as Record<string, unknown>)
        : null,
  })

  const html = renderPlatformReceiptHtmlFromPayload(payload, settings)

  let pdfPath: string
  try {
    pdfPath = await uploadPlatformReceiptPdf(payload.receipt_number, payload.issued_at.slice(0, 7), html)
  } catch (error) {
    const now = new Date().toISOString()
    await Promise.allSettled([
      admin
        .from("platform_payment_requests")
        .update({ receipt_document_status: "generation_failed", updated_at: now })
        .eq("id", String(payment.id)),
      admin
        .from("entitlement_purchase_requests")
        .update({ receipt_document_status: "generation_failed", updated_at: now })
        .eq("id", String(purchase.id)),
    ])
    throw error
  }

  const now = new Date().toISOString()
  const receiptInsert = {
    payment_request_id: String(payment.id),
    purchase_request_id: stringOrNull(purchase.id),
    user_id: String(payment.user_id),
    receipt_number: payload.receipt_number,
    purchaser_company_name: payload.purchaser_company_name,
    purchaser_name: payload.purchaser_name,
    purchaser_email: payload.purchaser_email,
    purchaser_address: payload.purchaser_address,
    currency: payload.currency,
    subtotal_amount: payload.subtotal_amount,
    tax_amount: payload.tax_amount,
    total_amount: payload.total_amount,
    tax_rate_breakdown_json: payload.tax_rate_breakdown_json,
    paid_at: payload.paid_at,
    issued_at: payload.issued_at,
    pdf_path: pdfPath,
    document_payload_json: payload,
    provider_payload_json: params.providerPayload ?? {},
    status: "issued",
    updated_at: now,
  }

  let receiptRow: Record<string, unknown> | null = null
  if (existingReceipt) {
    const { data: updated, error } = await admin
      .from("purchase_receipts")
      .update({
        ...receiptInsert,
        reissued_from_receipt_id: null,
      })
      .eq("id", String(existingReceipt.id))
      .select("*")
      .maybeSingle()
    if (error) throw new Error(`Failed to update purchase receipt: ${error.message}`)
    receiptRow = (updated ?? null) as Record<string, unknown> | null
  } else {
    const { data: inserted, error } = await admin
      .from("purchase_receipts")
      .insert({
        ...receiptInsert,
        created_at: now,
      })
      .select("*")
      .maybeSingle()
    if (error) throw new Error(`Failed to create purchase receipt: ${error.message}`)
    receiptRow = (inserted ?? null) as Record<string, unknown> | null
  }

  if (!receiptRow) throw new Error("Failed to persist purchase receipt")

  await Promise.all([
    admin
      .from("platform_payment_requests")
      .update({
        receipt_number: payload.receipt_number,
        receipt_pdf_path: pdfPath,
        receipt_document_status: "ready",
        updated_at: now,
      })
      .eq("id", String(payment.id)),
    admin
      .from("entitlement_purchase_requests")
      .update({
        receipt_pdf_path: pdfPath,
        receipt_document_status: "ready",
        updated_at: now,
      })
      .eq("id", String(purchase.id)),
  ])

  await writeAuditLog(params.admin as never, {
    org_id: null,
    user_id: String(payment.user_id),
    action: existingReceipt ? "receipt.pdf_generate" : "receipt.issued",
    resource_type: "purchase_receipt",
    resource_id: String(receiptRow.id),
    meta: {
      receipt_number: payload.receipt_number,
      payment_request_id: payment.id,
    },
  })

  return receiptRow
}

function buildReceiptPayload(params: {
  payment: Record<string, unknown>
  purchase: Record<string, unknown>
  settings: Awaited<ReturnType<typeof getPlatformBillingSettings>>
  receiptNumber: string
  issuedAtIso: string
  paidAtIso: string
  payerNote?: string | null
  existingPayload?: Record<string, unknown> | null
}): PlatformReceiptDocumentPayload {
  if (params.existingPayload && isPlatformReceiptPayload(params.existingPayload)) {
    return {
      ...params.existingPayload,
      receipt_number: params.receiptNumber,
      issued_at: params.existingPayload.issued_at,
      paid_at: params.existingPayload.paid_at,
    }
  }

  return buildPlatformReceiptPayload({
    settings: params.settings,
    payment: params.payment,
    purchase: params.purchase,
    receiptNumber: params.receiptNumber,
    issuedAt: params.issuedAtIso,
    paidAt: params.paidAtIso,
    payerNote: params.payerNote,
  })
}

function isPlatformReceiptPayload(value: Record<string, unknown>): value is PlatformReceiptDocumentPayload {
  return typeof value.receipt_number === "string" && typeof value.purchaser_name === "string"
}

function isNonEmptyRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value))
}

function stringOrNull(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null
}
