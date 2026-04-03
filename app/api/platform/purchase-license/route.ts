import { NextRequest, NextResponse } from "next/server"
import { createSupabaseAdmin } from "@/lib/supabaseAdmin"
import { requirePlatformUser } from "@/lib/platformAuth"
import { ensureNonEmpty, isManualPlatformPaymentEnabled } from "@/lib/platform"
import {
  createPlatformNotification,
  getMyLicenseSnapshot,
  writePlatformAudit,
} from "@/lib/platformServer"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

type PurchaseRpcResult = {
  entitlement_id: string
  purchase_request_id: string
  payment_request_id: string
  request_number: string
  invoice_number: string
  transfer_reference: string
  issued_at: string
  due_date: string
  reused_existing: boolean
}

export async function POST(req: NextRequest) {
  const auth = await requirePlatformUser(req)
  if ("error" in auth) return auth.error

  try {
    const body = await req.json().catch(() => ({}))
    const fullName = ensureNonEmpty(body?.full_name, "full_name")
    const receiptName = ensureNonEmpty(body?.receipt_name, "receipt_name")
    const companyName = typeof body?.company_name === "string" ? body.company_name.trim() : ""
    const address = ensureNonEmpty(body?.address, "address")
    const phone = ensureNonEmpty(body?.phone, "phone")
    const contactEmail = ensureNonEmpty(body?.contact_email, "contact_email")
    const billingEmail = ensureNonEmpty(body?.billing_email, "billing_email")
    const billingAddress = typeof body?.billing_address === "string" ? body.billing_address.trim() : ""
    const note = typeof body?.note === "string" ? body.note.trim() : ""
    const requestedPaymentMode =
      body?.payment_mode === "manual_bank_transfer" ? "manual_bank_transfer" : "stripe_checkout"
    const paymentMode =
      requestedPaymentMode === "manual_bank_transfer" && isManualPlatformPaymentEnabled()
        ? "manual_bank_transfer"
        : "stripe_checkout"

    const rpc = await auth.userClient.rpc("create_platform_purchase_request", {
      p_full_name: fullName,
      p_company_name: companyName,
      p_address: address,
      p_phone: phone,
      p_contact_email: contactEmail,
      p_note: note,
      p_receipt_name: receiptName,
      p_billing_email: billingEmail,
      p_billing_address: billingAddress || null,
    })

    if (rpc.error || !Array.isArray(rpc.data) || rpc.data.length === 0) {
      const message = rpc.error?.message ?? "Failed to create purchase request"
      const status = message.includes("Active entitlement") ? 409 : 400
      return NextResponse.json({ ok: false, error: message }, { status })
    }

    const result = rpc.data[0] as PurchaseRpcResult
    const admin = createSupabaseAdmin()
    const now = new Date().toISOString()
    const paymentProvider = paymentMode === "manual_bank_transfer" ? "manual" : "stripe"
    const paymentChannel = paymentMode === "manual_bank_transfer" ? "bank_transfer" : "checkout"
    const paymentMethod = paymentMode === "manual_bank_transfer" ? "bank_transfer" : "card"
    const purchaseStatus = paymentMode === "manual_bank_transfer" ? "invoice_issued" : "pending_invoice"

    const [purchaseUpdate, paymentUpdate] = await Promise.all([
      admin
        .from("entitlement_purchase_requests")
        .update({
          status: purchaseStatus,
          issued_at: result.issued_at,
          due_date: result.due_date,
          updated_at: now,
        })
        .eq("id", result.purchase_request_id),
      admin
        .from("platform_payment_requests")
        .update({
          payment_provider: paymentProvider,
          payment_channel: paymentChannel,
          payment_method: paymentMethod,
          updated_at: now,
        })
        .eq("id", result.payment_request_id),
    ])

    if (purchaseUpdate.error) {
      throw new Error(`Failed to persist purchase request: ${purchaseUpdate.error.message}`)
    }
    if (paymentUpdate.error) {
      throw new Error(`Failed to persist payment request: ${paymentUpdate.error.message}`)
    }

    if (!result.reused_existing && paymentMode === "manual_bank_transfer") {
      await Promise.allSettled([
        createPlatformNotification({
          recipientUserId: auth.user.id,
          type: "platform.payment_pending",
          payload: {
            request_number: result.request_number,
            invoice_number: result.invoice_number,
            due_date: result.due_date,
            transfer_reference: result.transfer_reference,
            action_href: "/pending-payment",
          },
        }),
      ])
    }

    await writePlatformAudit({
      userId: auth.user.id,
      action: "platform.purchase.request",
      resourceType: "platform_purchase_request",
      resourceId: result.purchase_request_id,
      meta: {
        request_number: result.request_number,
        invoice_number: result.invoice_number,
        reused_existing: result.reused_existing,
        payment_provider: paymentProvider,
        payment_channel: paymentChannel,
      },
    })

    const snapshot = await getMyLicenseSnapshot(auth.user.id)
    return NextResponse.json({
      ok: true,
      payment_mode: paymentMode,
      payment_request_id: result.payment_request_id,
      reused_existing: result.reused_existing,
      request_number: result.request_number,
      invoice_number: result.invoice_number,
      transfer_reference: result.transfer_reference,
      due_date: result.due_date,
      my_license: snapshot,
    })
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Failed to purchase license" },
      { status: 500 }
    )
  }
}
