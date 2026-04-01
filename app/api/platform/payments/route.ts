import { NextRequest, NextResponse } from "next/server"
import { requirePlatformAdmin } from "@/lib/platformAuth"
import { createPlatformDocumentSignedUrl } from "@/lib/platformDocuments"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(req: NextRequest) {
  const auth = await requirePlatformAdmin(req)
  if ("error" in auth) return auth.error

  const query = req.nextUrl.searchParams.get("q")?.trim() ?? ""
  const admin = auth.admin

  let matchingPurchaseIds: string[] = []
  if (query) {
    const { data: purchases } = await admin
      .from("entitlement_purchase_requests")
      .select("id")
      .or(`request_number.ilike.%${query}%,invoice_number.ilike.%${query}%,contact_email.ilike.%${query}%,google_email.ilike.%${query}%,full_name.ilike.%${query}%,company_name.ilike.%${query}%`)
      .limit(100)
    matchingPurchaseIds = (purchases ?? []).map((p) => String(p.id))
  }

  let paymentQuery = admin
    .from("platform_payment_requests")
    .select(`
      *,
      purchase:entitlement_purchase_requests(full_name, company_name, contact_email)
    `)
    .order("created_at", { ascending: false })

  if (query) {
    if (matchingPurchaseIds.length > 0) {
      paymentQuery = paymentQuery.or(`request_number.ilike.%${query}%,invoice_number.ilike.%${query}%,transfer_reference.ilike.%${query}%,purchase_request_id.in.(${matchingPurchaseIds.join(",")})`)
    } else {
      paymentQuery = paymentQuery.or(`request_number.ilike.%${query}%,invoice_number.ilike.%${query}%,transfer_reference.ilike.%${query}%`)
    }
  }

  const { data, error } = await paymentQuery

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
  }

  const rows = await Promise.all(
    (data ?? []).map(async (row: Record<string, unknown>) => ({
      ...row,
      invoice_signed_url: await createPlatformDocumentSignedUrl(typeof row.invoice_pdf_path === "string" ? row.invoice_pdf_path : null),
      receipt_signed_url: await createPlatformDocumentSignedUrl(typeof row.receipt_pdf_path === "string" ? row.receipt_pdf_path : null),
    }))
  )

  return NextResponse.json({ ok: true, payments: rows })
}
