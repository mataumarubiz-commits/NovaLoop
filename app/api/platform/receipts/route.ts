import { NextRequest, NextResponse } from "next/server"
import { requirePlatformAdmin } from "@/lib/platformAuth"
import { createPlatformDocumentSignedUrl } from "@/lib/platformDocuments"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(req: NextRequest) {
  const auth = await requirePlatformAdmin(req)
  if ("error" in auth) return auth.error

  const query = req.nextUrl.searchParams.get("q")?.trim() ?? ""
  let receiptQuery = auth.admin
    .from("purchase_receipts")
    .select(`
      *,
      payment:platform_payment_requests(request_number, invoice_number, status),
      purchase:entitlement_purchase_requests(company_name, receipt_name, full_name, billing_email)
    `)
    .order("issued_at", { ascending: false })

  if (query) {
    receiptQuery = receiptQuery.or(
      `receipt_number.ilike.%${query}%,purchaser_name.ilike.%${query}%,purchaser_company_name.ilike.%${query}%,purchaser_email.ilike.%${query}%`
    )
  }

  const { data, error } = await receiptQuery
  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
  }

  const rows = await Promise.all(
    (data ?? []).map(async (row: Record<string, unknown>) => ({
      ...row,
      signed_url: await createPlatformDocumentSignedUrl(typeof row.pdf_path === "string" ? row.pdf_path : null),
    }))
  )

  return NextResponse.json({ ok: true, receipts: rows })
}
