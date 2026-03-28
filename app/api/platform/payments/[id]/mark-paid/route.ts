import { NextRequest, NextResponse } from "next/server"
import { requirePlatformAdmin } from "@/lib/platformAuth"
import { formatDate, renderPlatformReceiptHtml } from "@/lib/platform"
import { uploadPlatformReceiptPdf } from "@/lib/platformDocuments"
import { createPlatformNotification, getPlatformBillingSettings, writePlatformAudit } from "@/lib/platformServer"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requirePlatformAdmin(req)
  if ("error" in auth) return auth.error

  const { id } = await params
  const paymentId = id?.trim()
  if (!paymentId) {
    return NextResponse.json({ ok: false, error: "payment id is required" }, { status: 400 })
  }

  try {
    const body = await req.json().catch(() => ({}))
    const paidNote = typeof body?.paid_note === "string" ? body.paid_note.trim() : ""
    const admin = auth.admin

    const { data: payment } = await admin.from("platform_payment_requests").select("*").eq("id", paymentId).maybeSingle()
    if (!payment) {
      return NextResponse.json({ ok: false, error: "payment not found" }, { status: 404 })
    }

    const [{ data: purchase }, { data: entitlement }] = await Promise.all([
      admin.from("entitlement_purchase_requests").select("*").eq("id", payment.purchase_request_id).maybeSingle(),
      admin.from("creator_entitlements").select("*").eq("id", payment.entitlement_id).maybeSingle(),
    ])

    if (!purchase || !entitlement) {
      return NextResponse.json({ ok: false, error: "payment relations are missing" }, { status: 500 })
    }

    let receiptNumber = typeof payment.receipt_number === "string" ? payment.receipt_number : null
    if (!receiptNumber) {
      const receiptRpc = await admin.rpc("allocate_platform_receipt_number")
      receiptNumber = typeof receiptRpc.data === "string" ? receiptRpc.data : null
    }
    if (!receiptNumber) {
      return NextResponse.json({ ok: false, error: "failed to allocate receipt number" }, { status: 500 })
    }

    const paidAt = payment.paid_at ? new Date(payment.paid_at) : new Date()
    const paidAtIso = paidAt.toISOString()
    const activatedAt = entitlement.activated_at ?? paidAtIso
    const firstActivation = payment.status !== "paid" || entitlement.status !== "active"

    if (firstActivation) {
      const now = new Date().toISOString()
      const [paymentUpdate, purchaseUpdate, entitlementUpdate] = await Promise.all([
        admin
          .from("platform_payment_requests")
          .update({
            status: "paid",
            paid_at: paidAtIso,
            paid_note: paidNote || payment.paid_note,
            receipt_number: receiptNumber,
            receipt_document_status: "pending_generation",
            updated_at: now,
          })
          .eq("id", paymentId),
        admin
          .from("entitlement_purchase_requests")
          .update({
            status: "paid",
            receipt_document_status: "pending_generation",
            updated_at: now,
          })
          .eq("id", purchase.id),
        admin
          .from("creator_entitlements")
          .update({
            status: "active",
            grant_type: entitlement.grant_type ?? "paid",
            amount_total_jpy: Number(entitlement.amount_total_jpy ?? payment.amount_jpy ?? 300000),
            activated_at: activatedAt,
            updated_at: now,
          })
          .eq("id", entitlement.id),
      ])

      if (paymentUpdate.error) {
        throw new Error(`Failed to update payment request: ${paymentUpdate.error.message}`)
      }
      if (purchaseUpdate.error) {
        throw new Error(`Failed to update purchase request: ${purchaseUpdate.error.message}`)
      }
      if (entitlementUpdate.error) {
        throw new Error(`Failed to activate entitlement: ${entitlementUpdate.error.message}`)
      }
    }

    let receiptPdfPath = typeof payment.receipt_pdf_path === "string" ? payment.receipt_pdf_path : null
    if (!receiptPdfPath) {
      const settings = await getPlatformBillingSettings()
      const recipientName = (purchase.company_name || purchase.full_name || "").trim() || "license_holder"
      const receiptHtml = renderPlatformReceiptHtml({
        settings,
        receiptNumber,
        invoiceNumber: payment.invoice_number,
        issueDate: formatDate(new Date()),
        paidAt: formatDate(paidAt),
        recipientName,
        amountJpy: Number(payment.amount_jpy ?? settings.license_price_jpy),
        payerNote: paidNote || payment.paid_note,
      })

      try {
        receiptPdfPath = await uploadPlatformReceiptPdf(payment.request_number, receiptHtml)
      } catch (error) {
        const now = new Date().toISOString()
        await Promise.allSettled([
          admin
            .from("platform_payment_requests")
            .update({
              receipt_number: receiptNumber,
              receipt_document_status: "generation_failed",
              updated_at: now,
            })
            .eq("id", paymentId),
          admin
            .from("entitlement_purchase_requests")
            .update({
              receipt_document_status: "generation_failed",
              updated_at: now,
            })
            .eq("id", purchase.id),
        ])

        return NextResponse.json(
          {
            ok: false,
            error: error instanceof Error ? error.message : "Failed to generate receipt PDF",
            retryable: true,
            request_number: payment.request_number,
            receipt_number: receiptNumber,
          },
          { status: 503 }
        )
      }

      const now = new Date().toISOString()
      const [paymentReceiptUpdate, purchaseReceiptUpdate] = await Promise.all([
        admin
          .from("platform_payment_requests")
          .update({
            receipt_number: receiptNumber,
            receipt_pdf_path: receiptPdfPath,
            receipt_document_status: "ready",
            updated_at: now,
          })
          .eq("id", paymentId),
        admin
          .from("entitlement_purchase_requests")
          .update({
            receipt_pdf_path: receiptPdfPath,
            receipt_document_status: "ready",
            updated_at: now,
          })
          .eq("id", purchase.id),
      ])

      if (paymentReceiptUpdate.error) {
        throw new Error(`Failed to store receipt on payment request: ${paymentReceiptUpdate.error.message}`)
      }
      if (purchaseReceiptUpdate.error) {
        throw new Error(`Failed to store receipt on purchase request: ${purchaseReceiptUpdate.error.message}`)
      }
    }

    if (firstActivation) {
      await Promise.allSettled([
        createPlatformNotification({
          recipientUserId: payment.user_id,
          type: "platform.license_activated",
          payload: {
            request_number: payment.request_number,
            invoice_number: payment.invoice_number,
            receipt_number: receiptNumber,
            activated_at: activatedAt,
          },
        }),
        writePlatformAudit({
          userId: auth.user.id,
          action: "platform.payment.mark_paid",
          resourceType: "platform_payment_request",
          resourceId: paymentId,
          meta: {
            request_number: payment.request_number,
            receipt_number: receiptNumber,
          },
        }),
      ])
    }

    return NextResponse.json({
      ok: true,
      idempotent: !firstActivation,
      request_number: payment.request_number,
      receipt_number: receiptNumber,
      receipt_pdf_path: receiptPdfPath,
    })
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Failed to mark payment paid" },
      { status: 500 }
    )
  }
}
