import { NextRequest, NextResponse } from "next/server"
import { requirePlatformAdmin } from "@/lib/platformAuth"
import { createPlatformDocumentSignedUrl } from "@/lib/platformDocuments"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requirePlatformAdmin(req)
  if ("error" in auth) return auth.error

  const { id } = await params

  const { data: payment, error } = await auth.admin
    .from("platform_payment_requests")
    .select(`
      *,
      purchase:entitlement_purchase_requests(
        full_name,
        company_name,
        contact_email,
        google_email,
        address,
        phone,
        note
      ),
      entitlement:creator_entitlements(
        status,
        grant_type,
        activated_at
      )
    `)
    .eq("id", id)
    .maybeSingle()

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
  }
  if (!payment) {
    return NextResponse.json({ ok: false, error: "Payment request not found" }, { status: 404 })
  }

  const invoice_signed_url = await createPlatformDocumentSignedUrl(
    typeof payment.invoice_pdf_path === "string" ? payment.invoice_pdf_path : null
  )
  const receipt_signed_url = await createPlatformDocumentSignedUrl(
    typeof payment.receipt_pdf_path === "string" ? payment.receipt_pdf_path : null
  )

  return NextResponse.json({
    ok: true,
    payment: {
      ...payment,
      invoice_signed_url,
      receipt_signed_url,
    },
  })
}
