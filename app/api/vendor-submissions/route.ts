import { NextRequest, NextResponse } from "next/server"
import { createSupabaseAdmin } from "@/lib/supabaseAdmin"
import { getOrgRole, getUserIdFromToken, isOrgAdmin } from "@/lib/apiAuth"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * GET /api/vendor-submissions
 * 社内管理者: vendor_invoices のうち submission_link_id が存在するもの一覧
 */
export async function GET(req: NextRequest) {
  try {
    const userId = await getUserIdFromToken(req)
    if (!userId) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 })
    }

    const orgId = req.nextUrl.searchParams.get("orgId")
    const month = req.nextUrl.searchParams.get("month")
    const statusFilter = req.nextUrl.searchParams.get("status")

    if (!orgId) {
      return NextResponse.json({ ok: false, error: "orgId is required" }, { status: 400 })
    }

    const admin = createSupabaseAdmin()
    const role = await getOrgRole(admin, userId, orgId)
    if (!isOrgAdmin(role)) {
      return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 })
    }

    let query = admin
      .from("vendor_invoices")
      .select(`
        id,
        org_id,
        vendor_id,
        billing_month,
        status,
        total,
        submitted_at,
        submitter_name,
        submitter_email,
        submission_count,
        submission_link_id,
        submitter_bank_json,
        submitter_notes,
        created_at,
        updated_at
      `)
      .eq("org_id", orgId)
      .not("submission_link_id", "is", null)
      .order("submitted_at", { ascending: false, nullsFirst: false })

    if (month) {
      query = query.eq("billing_month", month)
    }
    if (statusFilter && statusFilter !== "all") {
      query = query.eq("status", statusFilter)
    }

    const { data: submissions, error } = await query

    if (error) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
    }

    // Fetch vendor names
    const vendorIds = [...new Set((submissions ?? []).map((s: { vendor_id: string }) => s.vendor_id))]
    let vendorMap: Map<string, string> = new Map()
    if (vendorIds.length > 0) {
      const { data: vendors } = await admin
        .from("vendors")
        .select("id, name")
        .in("id", vendorIds)
      if (vendors) {
        vendorMap = new Map(vendors.map((v: { id: string; name: string }) => [v.id, v.name]))
      }
    }

    // Check payout status
    const invoiceIds = (submissions ?? []).map((s: { id: string }) => s.id)
    let payoutMap: Map<string, string> = new Map()
    if (invoiceIds.length > 0) {
      const { data: payouts } = await admin
        .from("payouts")
        .select("vendor_invoice_id, status")
        .in("vendor_invoice_id", invoiceIds)
      if (payouts) {
        payoutMap = new Map(
          payouts.map((p: { vendor_invoice_id: string; status: string }) => [
            p.vendor_invoice_id,
            p.status,
          ])
        )
      }
    }

    const rows = (submissions ?? []).map((s: Record<string, unknown>) => ({
      ...s,
      vendor_name: vendorMap.get(s.vendor_id as string) ?? "不明",
      payout_status: payoutMap.get(s.id as string) ?? null,
    }))

    // Also fetch submission links for context
    const { data: links } = await admin
      .from("vendor_submission_links")
      .select("id, vendor_id, target_month, token, is_active, expires_at, allow_resubmission, created_at")
      .eq("org_id", orgId)
      .order("created_at", { ascending: false })

    return NextResponse.json({ ok: true, submissions: rows, links: links ?? [] })
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Server error" },
      { status: 500 }
    )
  }
}
