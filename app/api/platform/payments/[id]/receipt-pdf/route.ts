import { NextRequest, NextResponse } from "next/server"
import { requirePlatformUser } from "@/lib/platformAuth"
import { createSupabaseAdmin } from "@/lib/supabaseAdmin"
import { renderPlatformReceiptHtml, formatDate } from "@/lib/platform"
import { uploadPlatformReceiptPdf, createPlatformDocumentSignedUrl } from "@/lib/platformDocuments"
import { getPlatformBillingSettings } from "@/lib/platformServer"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requirePlatformUser(req)
  if ("error" in auth) return auth.error

  const { id } = await params
  if (!id) {
    return NextResponse.json({ ok: false, error: "payment id is required" }, { status: 400 })
  }

  const admin = createSupabaseAdmin()
  const { data: payment, error } = await admin
    .from("platform_payment_requests")
    .select("*")
    .eq("id", id)
    .eq("user_id", auth.user.id)
    .maybeSingle()

  if (error || !payment) {
    return NextResponse.json({ ok: false, error: "payment request not found" }, { status: 404 })
  }
  if (payment.status !== "paid") {
    return NextResponse.json({ ok: false, error: "receipt is available after payment confirmation" }, { status: 422 })
  }
  if (!payment.receipt_number) {
    return NextResponse.json({ ok: false, error: "receipt number is not assigned yet" }, { status: 422 })
  }

  const { data: purchase } = await admin
    .from("entitlement_purchase_requests")
    .select("*")
    .eq("id", payment.purchase_request_id)
    .maybeSingle()

  if (!purchase) {
    return NextResponse.json({ ok: false, error: "purchase request not found" }, { status: 404 })
  }

  try {
    const settings = await getPlatformBillingSettings()
    const receiptHtml = renderPlatformReceiptHtml({
      settings,
      receiptNumber: String(payment.receipt_number),
      invoiceNumber: String(payment.invoice_number),
      issueDate: formatDate(new Date()),
      paidAt: formatDate(String(payment.paid_at ?? new Date().toISOString())),
      recipientName: String(purchase.company_name ?? purchase.full_name ?? "license_holder"),
      amountJpy: Number(payment.amount_jpy ?? settings.license_price_jpy),
      payerNote:
        (typeof payment.client_transfer_name === "string" && payment.client_transfer_name.trim()) ||
        (typeof payment.paid_note === "string" && payment.paid_note.trim()) ||
        null,
    })

    const receiptPdfPath = await uploadPlatformReceiptPdf(String(payment.request_number), receiptHtml)
    const now = new Date().toISOString()
    const [paymentUpdate, purchaseUpdate] = await Promise.all([
      admin
        .from("platform_payment_requests")
        .update({
          receipt_pdf_path: receiptPdfPath,
          receipt_document_status: "ready",
          updated_at: now,
        })
        .eq("id", id),
      admin
        .from("entitlement_purchase_requests")
        .update({
          receipt_pdf_path: receiptPdfPath,
          receipt_document_status: "ready",
          updated_at: now,
        })
        .eq("id", payment.purchase_request_id),
    ])

    if (paymentUpdate.error) throw new Error(paymentUpdate.error.message)
    if (purchaseUpdate.error) throw new Error(purchaseUpdate.error.message)

    const signedUrl = await createPlatformDocumentSignedUrl(receiptPdfPath)
    return NextResponse.json({ ok: true, pdf_path: receiptPdfPath, signed_url: signedUrl })
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "failed to regenerate receipt pdf" },
      { status: 500 }
    )
  }
}
