import { NextRequest, NextResponse } from "next/server"
import { createSupabaseAdmin } from "@/lib/supabaseAdmin"
import { getOrgRole, getUserIdFromToken } from "@/lib/apiAuth"
import {
  hasClientSubmissionSignal,
  isContentClientOverdue,
  isContentEditorOverdue,
} from "@/lib/contentWorkflow"
import type { NotificationType } from "@/lib/notifications"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const COMPLETED_STATUSES = new Set(["delivered", "published", "canceled", "cancelled"])

function toYmd(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, "0")
  const day = String(d.getDate()).padStart(2, "0")
  return `${y}-${m}-${day}`
}

function toDayStartIso(ymd: string): string {
  return `${ymd}T00:00:00.000Z`
}

function toYm(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, "0")
  return `${y}-${m}`
}

export async function POST(req: NextRequest) {
  try {
    const userId = await getUserIdFromToken(req)
    if (!userId) {
      return NextResponse.json({ ok: false, message: "Unauthorized" }, { status: 401 })
    }

    const body = await req.json().catch(() => null)
    const orgId = typeof body?.orgId === "string" ? body.orgId.trim() : ""
    if (!orgId) {
      return NextResponse.json({ ok: false, message: "orgId is required" }, { status: 400 })
    }

    const admin = createSupabaseAdmin()
    const role = await getOrgRole(admin, userId, orgId)
    if (!role) {
      return NextResponse.json({ ok: false, message: "Forbidden" }, { status: 403 })
    }

    const today = new Date()
    const todayYmd = toYmd(today)
    const tomorrow = new Date(today)
    tomorrow.setDate(today.getDate() + 1)
    const tomorrowYmd = toYmd(tomorrow)
    const targetMonth = toYm(today)
    const dayStartIso = toDayStartIso(todayYmd)

    const contentsPromise = admin
      .from("contents")
      .select("due_client_at, due_editor_at, status, editor_submitted_at, client_submitted_at, delivery_month, billable_flag, invoice_id")
      .eq("org_id", orgId)

    const membersPromise = admin
      .from("app_users")
      .select("user_id, role")
      .eq("org_id", orgId)

    const vendorInvoicesPromise = admin
      .from("vendor_invoices")
      .select("status, billing_month")
      .eq("org_id", orgId)
      .eq("billing_month", targetMonth)

    const [contentsRes, membersRes, vendorInvoicesRes] = await Promise.all([
      contentsPromise,
      membersPromise,
      vendorInvoicesPromise,
    ])

    if (contentsRes.error) {
      return NextResponse.json({ ok: false, message: contentsRes.error.message }, { status: 500 })
    }
    if (membersRes.error) {
      return NextResponse.json({ ok: false, message: membersRes.error.message }, { status: 500 })
    }
    if (vendorInvoicesRes.error) {
      return NextResponse.json({ ok: false, message: vendorInvoicesRes.error.message }, { status: 500 })
    }

    const contents = contentsRes.data ?? []
    const members = (membersRes.data ?? []) as Array<{ user_id: string; role: string }>
    const vendorInvoices = (vendorInvoicesRes.data ?? []) as Array<{ status: string; billing_month: string }>

    if (members.length === 0) {
      return NextResponse.json({ ok: true, created: 0, summary: {} })
    }

    const allRecipients = [...new Set(members.map((m) => m.user_id))]
    const adminRecipients = members
      .filter((m) => m.role === "owner" || m.role === "executive_assistant")
      .map((m) => m.user_id)

    const incomplete = contents.filter((row) => !COMPLETED_STATUSES.has(String(row.status ?? "")))
    const pendingClientSubmitRows = incomplete.filter(
      (row) =>
        !hasClientSubmissionSignal(
          String(row.status ?? ""),
          typeof row.client_submitted_at === "string" ? row.client_submitted_at : null
        )
    )
    const clientOverdueCount = incomplete.filter((row) =>
      isContentClientOverdue(
        String(row.status ?? ""),
        String(row.due_client_at ?? ""),
        todayYmd,
        typeof row.client_submitted_at === "string" ? row.client_submitted_at : null
      )
    ).length
    const editorOverdueCount = incomplete.filter((row) =>
      isContentEditorOverdue(
        String(row.status ?? ""),
        String(row.due_editor_at ?? ""),
        todayYmd,
        typeof row.editor_submitted_at === "string" ? row.editor_submitted_at : null
      )
    ).length

    const invoicePendingCount = contents.filter((row) => {
      const delivered = String(row.delivery_month ?? "") === targetMonth
      const billable = Boolean(row.billable_flag)
      const completed = COMPLETED_STATUSES.has(String(row.status ?? ""))
      const unlinked = !row.invoice_id
      return delivered && billable && completed && unlinked
    }).length

    const payoutPendingCount = vendorInvoices.filter(
      (row) => row.billing_month === targetMonth && (row.status === "submitted" || row.status === "approved")
    ).length

    type Candidate = {
      recipient_user_id: string
      type: NotificationType
      payload: Record<string, unknown>
    }

    const candidates: Candidate[] = []
    if (clientOverdueCount > 0) {
      for (const recipientUserId of allRecipients) {
        candidates.push({
          recipient_user_id: recipientUserId,
          type: "contents.client_due_overdue",
          payload: {
            org_id: orgId,
            ymd: todayYmd,
            count: clientOverdueCount,
            client_overdue_count: clientOverdueCount,
            today_count: pendingClientSubmitRows.filter((row) => row.due_client_at === todayYmd).length,
            tomorrow_count: pendingClientSubmitRows.filter((row) => row.due_client_at === tomorrowYmd).length,
          },
        })
      }
    }

    if (editorOverdueCount > 0) {
      for (const recipientUserId of allRecipients) {
        candidates.push({
          recipient_user_id: recipientUserId,
          type: "contents.editor_due_overdue",
          payload: {
            org_id: orgId,
            ymd: todayYmd,
            count: editorOverdueCount,
            editor_overdue_count: editorOverdueCount,
          },
        })
      }
    }

    if (invoicePendingCount > 0) {
      for (const recipientUserId of adminRecipients) {
        candidates.push({
          recipient_user_id: recipientUserId,
          type: "billing.month_close_ready",
          payload: {
            org_id: orgId,
            ymd: todayYmd,
            target_month: targetMonth,
            count: invoicePendingCount,
            pending_invoice_count: invoicePendingCount,
          },
        })
      }
    }

    if (payoutPendingCount > 0) {
      for (const recipientUserId of adminRecipients) {
        candidates.push({
          recipient_user_id: recipientUserId,
          type: "payouts.pending_action",
          payload: {
            org_id: orgId,
            ymd: todayYmd,
            target_month: targetMonth,
            count: payoutPendingCount,
            pending_payout_count: payoutPendingCount,
          },
        })
      }
    }

    if (candidates.length === 0) {
      return NextResponse.json({
        ok: true,
        created: 0,
        summary: {
          client_overdue_count: clientOverdueCount,
          editor_overdue_count: editorOverdueCount,
          pending_invoice_count: invoicePendingCount,
          pending_payout_count: payoutPendingCount,
        },
      })
    }

    const recipientIds = [...new Set(candidates.map((c) => c.recipient_user_id))]
    const typeList = [...new Set(candidates.map((c) => c.type))]
    const { data: existing, error: existingErr } = await admin
      .from("notifications")
      .select("recipient_user_id, type")
      .eq("org_id", orgId)
      .gte("created_at", dayStartIso)
      .in("recipient_user_id", recipientIds)
      .in("type", typeList)

    if (existingErr) {
      return NextResponse.json({ ok: false, message: existingErr.message }, { status: 500 })
    }

    const existingKey = new Set(
      (existing ?? []).map((row) => `${String(row.recipient_user_id)}|${String(row.type)}`)
    )

    const insertRows = candidates
      .filter((c) => !existingKey.has(`${c.recipient_user_id}|${c.type}`))
      .map((c) => ({
        org_id: orgId,
        recipient_user_id: c.recipient_user_id,
        type: c.type,
        payload: c.payload,
      }))

    if (insertRows.length === 0) {
      return NextResponse.json({
        ok: true,
        created: 0,
        summary: {
          client_overdue_count: clientOverdueCount,
          editor_overdue_count: editorOverdueCount,
          pending_invoice_count: invoicePendingCount,
          pending_payout_count: payoutPendingCount,
        },
      })
    }

    const { error: insertErr } = await admin.from("notifications").insert(insertRows)
    if (insertErr) {
      return NextResponse.json({ ok: false, message: insertErr.message }, { status: 500 })
    }

    return NextResponse.json({
      ok: true,
      created: insertRows.length,
      summary: {
        client_overdue_count: clientOverdueCount,
        editor_overdue_count: editorOverdueCount,
        pending_invoice_count: invoicePendingCount,
        pending_payout_count: payoutPendingCount,
      },
    })
  } catch (e) {
    return NextResponse.json(
      { ok: false, message: e instanceof Error ? e.message : "Server error" },
      { status: 500 }
    )
  }
}
