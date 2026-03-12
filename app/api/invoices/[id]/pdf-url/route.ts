import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"
import { createSupabaseAdmin } from "@/lib/supabaseAdmin"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const BUCKET = "invoices"

async function ensureAuth(req: NextRequest): Promise<{ orgId: string } | NextResponse> {
  const authHeader = req.headers.get("Authorization")
  const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7).trim() : null
  if (!token) {
    return NextResponse.json({ error: "Authorization Bearer token required" }, { status: 401 })
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !anonKey) {
    return NextResponse.json({ error: "Server configuration error" }, { status: 500 })
  }
  const supabase = createClient(url, anonKey)
  const { data: { user }, error: userError } = await supabase.auth.getUser(token)
  if (userError || !user) {
    return NextResponse.json({ error: "Invalid or expired token" }, { status: 401 })
  }

  const admin = createSupabaseAdmin()
  const { data: appUser, error: appError } = await admin
    .from("app_users")
    .select("org_id, role")
    .eq("user_id", user.id)
    .maybeSingle()
  if (appError || !appUser) {
    return NextResponse.json({ error: "User org/role not found" }, { status: 403 })
  }
  const role = (appUser as { role?: string }).role
  const orgId = (appUser as { org_id?: string }).org_id
  if (role !== "owner" && role !== "executive_assistant" || !orgId) {
    return NextResponse.json({ error: "Forbidden: owner or executive_assistant only" }, { status: 403 })
  }
  return { orgId }
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authResult = await ensureAuth(req)
  if (authResult instanceof NextResponse) return authResult
  const { orgId } = authResult
  const { id: invoiceId } = await params
  if (!invoiceId) {
    return NextResponse.json({ error: "Invoice ID required" }, { status: 400 })
  }

  const admin = createSupabaseAdmin()
  const { data: invoice, error: invError } = await admin
    .from("invoices")
    .select("pdf_path")
    .eq("id", invoiceId)
    .eq("org_id", orgId)
    .maybeSingle()
  if (invError || !invoice) {
    return NextResponse.json({ error: "Invoice not found or access denied" }, { status: 404 })
  }

  const pdfPath = (invoice as { pdf_path?: string | null }).pdf_path
  if (!pdfPath) {
    return NextResponse.json({ error: "PDF not generated yet" }, { status: 404 })
  }

  const { data, error } = await admin.storage.from(BUCKET).createSignedUrl(pdfPath, 600)
  if (error) {
    return NextResponse.json({ error: `Signed URL failed: ${error.message}` }, { status: 500 })
  }
  return NextResponse.json({ url: data?.signedUrl ?? null })
}
