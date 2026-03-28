import { NextRequest, NextResponse } from "next/server"
import { createSupabaseAdmin } from "@/lib/supabaseAdmin"
import { getOrgRole, getUserIdFromToken, isOrgAdmin } from "@/lib/apiAuth"
import { writeAuditLog } from "@/lib/auditLog"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * POST /api/vendor-submissions/review
 * 社内管理者: 提出された請求を承認/差し戻し
 */
export async function POST(req: NextRequest) {
  try {
    const userId = await getUserIdFromToken(req)
    if (!userId) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 })
    }

    const body = await req.json().catch(() => ({}))
    const orgId = typeof body?.orgId === "string" ? body.orgId.trim() : null
    const invoiceId = typeof body?.invoiceId === "string" ? body.invoiceId.trim() : null
    const action = typeof body?.action === "string" ? body.action.trim() : null
    const reason = typeof body?.reason === "string" ? body.reason.trim() : null

    if (!orgId || !invoiceId || !action) {
      return NextResponse.json(
        { ok: false, error: "orgId, invoiceId, action は必須です" },
        { status: 400 }
      )
    }

    if (action !== "approve" && action !== "reject") {
      return NextResponse.json(
        { ok: false, error: "action は approve または reject のみ有効です" },
        { status: 400 }
      )
    }

    const admin = createSupabaseAdmin()
    const role = await getOrgRole(admin, userId, orgId)
    if (!isOrgAdmin(role)) {
      return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 })
    }

    // Fetch invoice
    const { data: invoice } = await admin
      .from("vendor_invoices")
      .select("id, vendor_id, status, total, pay_date, billing_month")
      .eq("id", invoiceId)
      .eq("org_id", orgId)
      .maybeSingle()

    if (!invoice) {
      return NextResponse.json({ ok: false, error: "請求が見つかりません" }, { status: 404 })
    }

    if (invoice.status !== "submitted") {
      return NextResponse.json(
        { ok: false, error: `現在のステータス（${invoice.status}）では${action === "approve" ? "承認" : "差し戻し"}できません` },
        { status: 400 }
      )
    }

    const now = new Date().toISOString()

    if (action === "approve") {
      const { error } = await admin
        .from("vendor_invoices")
        .update({
          status: "approved",
          approved_at: now,
          updated_at: now,
        })
        .eq("id", invoiceId)

      if (error) {
        return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
      }

      // Auto-create payout record
      const payoutId = crypto.randomUUID()
      await admin.from("payouts").insert({
        id: payoutId,
        org_id: orgId,
        vendor_id: invoice.vendor_id,
        vendor_invoice_id: invoiceId,
        pay_date: invoice.pay_date || now.slice(0, 10),
        amount: invoice.total,
        status: "scheduled",
      })

      await writeAuditLog(admin, {
        org_id: orgId,
        user_id: userId,
        action: "vendor_invoice.approve",
        resource_type: "vendor_invoice",
        resource_id: invoiceId,
        meta: { source: "submission_review", amount: invoice.total },
      })

      return NextResponse.json({ ok: true, status: "approved", payoutId })
    }

    // Reject
    const returnCount = (invoice as Record<string, unknown>).return_count
    const { error } = await admin
      .from("vendor_invoices")
      .update({
        status: "rejected",
        rejected_reason: reason || null,
        returned_at: now,
        return_count: (typeof returnCount === "number" ? returnCount : 0) + 1,
        updated_at: now,
      })
      .eq("id", invoiceId)

    if (error) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
    }

    await writeAuditLog(admin, {
      org_id: orgId,
      user_id: userId,
      action: "vendor_invoice.reject",
      resource_type: "vendor_invoice",
      resource_id: invoiceId,
      meta: { source: "submission_review", reason },
    })

    return NextResponse.json({ ok: true, status: "rejected" })
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Server error" },
      { status: 500 }
    )
  }
}
