import { NextRequest, NextResponse } from "next/server"
import { createSupabaseAdmin } from "@/lib/supabaseAdmin"
import { getOrgRole, getUserIdFromToken, isOrgAdmin } from "@/lib/apiAuth"
import { writeAuditLog } from "@/lib/auditLog"
import { selectWithColumnFallback, writeWithColumnFallback } from "@/lib/postgrestCompat"

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
    const { data: invoice } = await selectWithColumnFallback<Record<string, unknown>>({
      table: "vendor_invoices",
      columns: ["id", "vendor_id", "status", "total", "pay_date", "billing_month", "return_count"],
      execute: async (columnsCsv) => {
        const result = await admin
          .from("vendor_invoices")
          .select(columnsCsv)
          .eq("id", invoiceId)
          .eq("org_id", orgId)
          .maybeSingle()
        return {
          data: (result.data ?? null) as Record<string, unknown> | null,
          error: result.error,
        }
      },
    })

    if (!invoice) {
      return NextResponse.json({ ok: false, error: "請求が見つかりません" }, { status: 404 })
    }

    const invoiceRow = invoice as {
      vendor_id?: string
      status?: string
      total?: number
      pay_date?: string | null
      billing_month?: string | null
      return_count?: number
    }

    if (invoiceRow.status !== "submitted") {
      return NextResponse.json(
        { ok: false, error: `現在のステータス（${invoiceRow.status ?? "-"}）では${action === "approve" ? "承認" : "差し戻し"}できません` },
        { status: 400 }
      )
    }

    const now = new Date().toISOString()

    if (action === "approve") {
      try {
        await writeWithColumnFallback({
          table: "vendor_invoices",
          payload: {
            status: "approved",
            approved_at: now,
            updated_at: now,
          },
          execute: async (safePayload) => {
            const result = await admin.from("vendor_invoices").update(safePayload).eq("id", invoiceId)
            return { data: null, error: result.error }
          },
        })
      } catch (error) {
        return NextResponse.json(
          { ok: false, error: error instanceof Error ? error.message : "承認処理に失敗しました。" },
          { status: 500 }
        )
      }

      // Auto-create payout record
      const payoutId = crypto.randomUUID()
      await admin.from("payouts").insert({
        id: payoutId,
        org_id: orgId,
        vendor_id: invoiceRow.vendor_id ?? null,
        vendor_invoice_id: invoiceId,
        pay_date: invoiceRow.pay_date || now.slice(0, 10),
        amount: Number(invoiceRow.total ?? 0),
        status: "scheduled",
      })

      await writeAuditLog(admin, {
        org_id: orgId,
        user_id: userId,
        action: "vendor_invoice.approve",
        resource_type: "vendor_invoice",
        resource_id: invoiceId,
        meta: { source: "submission_review", amount: Number(invoiceRow.total ?? 0) },
      })

      return NextResponse.json({ ok: true, status: "approved", payoutId })
    }

    // Reject
    const returnCount = invoiceRow.return_count
    try {
      await writeWithColumnFallback({
        table: "vendor_invoices",
        payload: {
          status: "rejected",
          rejected_reason: reason || null,
          returned_at: now,
          return_count: (typeof returnCount === "number" ? returnCount : 0) + 1,
          updated_at: now,
        },
        execute: async (safePayload) => {
          const result = await admin.from("vendor_invoices").update(safePayload).eq("id", invoiceId)
          return { data: null, error: result.error }
        },
      })
    } catch (error) {
      return NextResponse.json(
        { ok: false, error: error instanceof Error ? error.message : "差し戻し処理に失敗しました。" },
        { status: 500 }
      )
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
