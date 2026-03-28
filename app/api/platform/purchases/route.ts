import { NextRequest, NextResponse } from "next/server"
import { requirePlatformAdmin } from "@/lib/platformAuth"
import { createPlatformDocumentSignedUrl } from "@/lib/platformDocuments"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(req: NextRequest) {
  const auth = await requirePlatformAdmin(req)
  if ("error" in auth) return auth.error

  const { data, error } = await auth.admin
    .from("entitlement_purchase_requests")
    .select("*")
    .order("created_at", { ascending: false })

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

  return NextResponse.json({ ok: true, purchases: rows })
}
