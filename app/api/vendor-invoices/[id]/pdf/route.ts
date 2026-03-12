import { NextRequest, NextResponse } from "next/server"
import { createSupabaseAdmin } from "@/lib/supabaseAdmin"
import { getUserIdFromRequest } from "@/lib/vendorPortal"
import { generateVendorInvoicePdf } from "@/lib/vendorInvoicePdf"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const BUCKET = "invoices"
const SIGNED_URL_EXPIRES = 60 * 10

async function ensureInvoiceAccess(req: NextRequest, invoiceId: string) {
  const userId = await getUserIdFromRequest(req)
  if (!userId) return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) }

  const admin = createSupabaseAdmin()
  const { data: profile } = await admin.from("user_profiles").select("active_org_id").eq("user_id", userId).maybeSingle()
  const activeOrgId = (profile as { active_org_id?: string | null } | null)?.active_org_id ?? null

  if (activeOrgId) {
    const { data: appUser } = await admin
      .from("app_users")
      .select("role")
      .eq("user_id", userId)
      .eq("org_id", activeOrgId)
      .maybeSingle()
    const role = (appUser as { role?: string } | null)?.role ?? null
    if (role === "owner" || role === "executive_assistant") {
      const { data: invoice } = await admin
        .from("vendor_invoices")
        .select("id, org_id, vendor_id, pdf_path")
        .eq("id", invoiceId)
        .eq("org_id", activeOrgId)
        .maybeSingle()
      if (invoice) return { admin, invoice: invoice as { id: string; org_id: string; vendor_id: string; pdf_path?: string | null } }
    }
  }

  const { data: vendorUser } = await admin.from("vendor_users").select("org_id, vendor_id").eq("user_id", userId).maybeSingle()
  const vendorActor = vendorUser as { org_id?: string; vendor_id?: string } | null
  if (!vendorActor?.org_id || !vendorActor.vendor_id) {
    return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) }
  }

  const { data: invoice } = await admin
    .from("vendor_invoices")
    .select("id, org_id, vendor_id, pdf_path")
    .eq("id", invoiceId)
    .eq("org_id", vendorActor.org_id)
    .eq("vendor_id", vendorActor.vendor_id)
    .maybeSingle()

  if (!invoice) return { error: NextResponse.json({ error: "Not found" }, { status: 404 }) }
  return { admin, invoice: invoice as { id: string; org_id: string; vendor_id: string; pdf_path?: string | null } }
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  if (!id) return NextResponse.json({ error: "ID required" }, { status: 400 })

  const access = await ensureInvoiceAccess(req, id)
  if ("error" in access) return access.error

  const pdfPath = access.invoice.pdf_path ?? null
  if (!pdfPath) return NextResponse.json({ error: "PDF not generated yet" }, { status: 404 })

  const { data, error } = await access.admin.storage.from(BUCKET).createSignedUrl(pdfPath, SIGNED_URL_EXPIRES)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ signed_url: data?.signedUrl ?? null })
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  if (!id) return NextResponse.json({ error: "ID required" }, { status: 400 })

  const access = await ensureInvoiceAccess(req, id)
  if ("error" in access) return access.error

  try {
    const result = await generateVendorInvoicePdf({ orgId: access.invoice.org_id, invoiceId: id })
    return NextResponse.json({ pdf_path: result.pdfPath, signed_url: result.signedUrl })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "PDF generation failed" },
      { status: 500 }
    )
  }
}
