import { NextRequest, NextResponse } from "next/server"
import { requirePlatformAdmin } from "@/lib/platformAuth"
import { createPlatformDocumentSignedUrl } from "@/lib/platformDocuments"
import {
  getLatestPlatformCheckoutSessionsByPaymentId,
  mergeLatestCheckoutSessionFields,
} from "@/lib/platformServer"

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
        receipt_name,
        company_name,
        contact_email,
        billing_email,
        google_email,
        address,
        billing_address,
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

  const receipt_signed_url = await createPlatformDocumentSignedUrl(
    typeof payment.receipt_pdf_path === "string" ? payment.receipt_pdf_path : null
  )
  const checkoutSessionsByPaymentId = await getLatestPlatformCheckoutSessionsByPaymentId(auth.admin, [id])

  return NextResponse.json({
    ok: true,
    payment: {
      ...mergeLatestCheckoutSessionFields(payment as Record<string, unknown>, checkoutSessionsByPaymentId.get(id) ?? null),
      receipt_signed_url,
    },
  })
}
