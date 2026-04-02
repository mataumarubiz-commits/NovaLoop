import { NextRequest, NextResponse } from "next/server"
import { requirePlatformUser } from "@/lib/platformAuth"
import { createSupabaseAdmin } from "@/lib/supabaseAdmin"
import { renderPlatformInvoiceHtml } from "@/lib/platform"
import { uploadPlatformInvoicePdf, createPlatformDocumentSignedUrl } from "@/lib/platformDocuments"
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
    const issueDate = String(payment.issued_at ?? purchase.issued_at ?? new Date().toISOString()).slice(0, 10)
    const dueDate = String(payment.due_date ?? purchase.due_date ?? issueDate)
    const invoiceMonth = issueDate.slice(0, 7)
    const invoiceHtml = renderPlatformInvoiceHtml({
      settings,
      requestNumber: String(payment.request_number),
      invoiceNumber: String(payment.invoice_number),
      invoiceMonth,
      issueDate,
      dueDate,
      recipientName: String(purchase.full_name ?? ""),
      companyName: typeof purchase.company_name === "string" ? purchase.company_name : null,
      transferReference: String(payment.transfer_reference ?? ""),
      amountJpy: Number(payment.amount_jpy ?? settings.license_price_jpy),
    })

    const invoicePdfPath = await uploadPlatformInvoicePdf(String(payment.request_number), invoiceHtml)
    const now = new Date().toISOString()

    const [paymentUpdate, purchaseUpdate] = await Promise.all([
      admin
        .from("platform_payment_requests")
        .update({
          invoice_pdf_path: invoicePdfPath,
          invoice_document_status: "ready",
          updated_at: now,
        })
        .eq("id", id),
      admin
        .from("entitlement_purchase_requests")
        .update({
          invoice_pdf_path: invoicePdfPath,
          invoice_document_status: "ready",
          updated_at: now,
        })
        .eq("id", payment.purchase_request_id),
    ])

    if (paymentUpdate.error) {
      throw new Error(paymentUpdate.error.message)
    }
    if (purchaseUpdate.error) {
      throw new Error(purchaseUpdate.error.message)
    }

    const signedUrl = await createPlatformDocumentSignedUrl(invoicePdfPath)
    return NextResponse.json({ ok: true, pdf_path: invoicePdfPath, signed_url: signedUrl })
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "failed to regenerate invoice pdf" },
      { status: 500 }
    )
  }
}
