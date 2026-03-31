import { NextRequest, NextResponse } from "next/server"
import { createSupabaseAdmin } from "@/lib/supabaseAdmin"
import { fanOutExternalMessage } from "@/lib/externalChannels"
import { getOrgRole, getUserIdFromToken, isOrgAdmin } from "@/lib/apiAuth"
import {
  hasClientSubmissionSignal,
  isContentClientOverdue,
  isContentEditorOverdue,
} from "@/lib/contentWorkflow"
import { loadOrgIntegrationSettings } from "@/lib/orgIntegrationSettings"
import type { NotificationType } from "@/lib/notifications"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const COMPLETED_STATUSES = new Set(["delivered", "published", "canceled", "cancelled"])

function toYmd(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`
}

function toYm(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`
}

function toDayStartIso(ymd: string): string {
  return `${ymd}T00:00:00.000Z`
}

function hasCronAccess(req: NextRequest) {
  const secret = process.env.DIGEST_CRON_SECRET || process.env.CRON_SECRET
  if (!secret) return false
  const bearer = req.headers.get("authorization")
  if (bearer === `Bearer ${secret}`) return true
  return req.headers.get("x-digest-cron-secret") === secret
}

type DigestSummary = {
  client_overdue_count: number
  editor_overdue_count: number
  pending_invoice_count: number
  pending_payout_count: number
}

type DigestResult = {
  orgId: string
  created: number
  summary: DigestSummary
  external: { ok: boolean; sentChannels: string[]; skipped: boolean }
}

function buildDigestMessage(orgName: string, ymd: string, summary: DigestSummary) {
  return [
    `【日次ダイジェスト】${orgName}`,
    `対象日: ${ymd}`,
    `先方提出の遅延: ${summary.client_overdue_count}件`,
    `編集提出の遅延: ${summary.editor_overdue_count}件`,
    `請求クローズ待ち: ${summary.pending_invoice_count}件`,
    `支払アクション待ち: ${summary.pending_payout_count}件`,
  ].join("\n")
}

async function generateDigestForOrg(params: {
  admin: ReturnType<typeof createSupabaseAdmin>
  orgId: string
  externalDelivery: boolean
}): Promise<DigestResult> {
  const { admin, orgId, externalDelivery } = params
  const today = new Date()
  const todayYmd = toYmd(today)
  const tomorrow = new Date(today)
  tomorrow.setDate(today.getDate() + 1)
  const tomorrowYmd = toYmd(tomorrow)
  const targetMonth = toYm(today)
  const dayStartIso = toDayStartIso(todayYmd)

  const [contentsRes, membersRes, vendorInvoicesRes, orgRes] = await Promise.all([
    admin
      .from("contents")
      .select("due_client_at, due_editor_at, status, editor_submitted_at, client_submitted_at, delivery_month, billable_flag, invoice_id")
      .eq("org_id", orgId),
    admin.from("app_users").select("user_id, role").eq("org_id", orgId),
    admin.from("vendor_invoices").select("status, billing_month").eq("org_id", orgId).eq("billing_month", targetMonth),
    admin.from("organizations").select("name").eq("id", orgId).maybeSingle(),
  ])

  if (contentsRes.error) throw new Error(contentsRes.error.message)
  if (membersRes.error) throw new Error(membersRes.error.message)
  if (vendorInvoicesRes.error) throw new Error(vendorInvoicesRes.error.message)

  const contents = contentsRes.data ?? []
  const members = (membersRes.data ?? []) as Array<{ user_id: string; role: string }>
  const vendorInvoices = (vendorInvoicesRes.data ?? []) as Array<{ status: string; billing_month: string }>

  const summary: DigestSummary = {
    client_overdue_count: 0,
    editor_overdue_count: 0,
    pending_invoice_count: 0,
    pending_payout_count: 0,
  }

  if (members.length === 0) {
    return {
      orgId,
      created: 0,
      summary,
      external: { ok: true, sentChannels: [], skipped: true },
    }
  }

  const allRecipients = [...new Set(members.map((member) => member.user_id))]
  const adminRecipients = members
    .filter((member) => member.role === "owner" || member.role === "executive_assistant")
    .map((member) => member.user_id)

  const incomplete = contents.filter((row) => !COMPLETED_STATUSES.has(String(row.status ?? "")))
  const pendingClientSubmitRows = incomplete.filter(
    (row) =>
      !hasClientSubmissionSignal(
        String(row.status ?? ""),
        typeof row.client_submitted_at === "string" ? row.client_submitted_at : null
      )
  )

  summary.client_overdue_count = incomplete.filter((row) =>
    isContentClientOverdue(
      String(row.status ?? ""),
      String(row.due_client_at ?? ""),
      todayYmd,
      typeof row.client_submitted_at === "string" ? row.client_submitted_at : null
    )
  ).length

  summary.editor_overdue_count = incomplete.filter((row) =>
    isContentEditorOverdue(
      String(row.status ?? ""),
      String(row.due_editor_at ?? ""),
      todayYmd,
      typeof row.editor_submitted_at === "string" ? row.editor_submitted_at : null
    )
  ).length

  summary.pending_invoice_count = contents.filter((row) => {
    const delivered = String(row.delivery_month ?? "") === targetMonth
    const billable = Boolean(row.billable_flag)
    const completed = COMPLETED_STATUSES.has(String(row.status ?? ""))
    const unlinked = !row.invoice_id
    return delivered && billable && completed && unlinked
  }).length

  summary.pending_payout_count = vendorInvoices.filter(
    (row) => row.billing_month === targetMonth && (row.status === "submitted" || row.status === "approved")
  ).length

  type Candidate = {
    recipient_user_id: string
    type: NotificationType
    payload: Record<string, unknown>
  }

  const candidates: Candidate[] = []
  if (summary.client_overdue_count > 0) {
    for (const recipientUserId of allRecipients) {
      candidates.push({
        recipient_user_id: recipientUserId,
        type: "contents.client_due_overdue",
        payload: {
          org_id: orgId,
          ymd: todayYmd,
          count: summary.client_overdue_count,
          client_overdue_count: summary.client_overdue_count,
          today_count: pendingClientSubmitRows.filter((row) => row.due_client_at === todayYmd).length,
          tomorrow_count: pendingClientSubmitRows.filter((row) => row.due_client_at === tomorrowYmd).length,
        },
      })
    }
  }

  if (summary.editor_overdue_count > 0) {
    for (const recipientUserId of allRecipients) {
      candidates.push({
        recipient_user_id: recipientUserId,
        type: "contents.editor_due_overdue",
        payload: {
          org_id: orgId,
          ymd: todayYmd,
          count: summary.editor_overdue_count,
          editor_overdue_count: summary.editor_overdue_count,
        },
      })
    }
  }

  if (summary.pending_invoice_count > 0) {
    for (const recipientUserId of adminRecipients) {
      candidates.push({
        recipient_user_id: recipientUserId,
        type: "billing.month_close_ready",
        payload: {
          org_id: orgId,
          ymd: todayYmd,
          target_month: targetMonth,
          count: summary.pending_invoice_count,
          pending_invoice_count: summary.pending_invoice_count,
        },
      })
    }
  }

  if (summary.pending_payout_count > 0) {
    for (const recipientUserId of adminRecipients) {
      candidates.push({
        recipient_user_id: recipientUserId,
        type: "payouts.pending_action",
        payload: {
          org_id: orgId,
          ymd: todayYmd,
          target_month: targetMonth,
          count: summary.pending_payout_count,
          pending_payout_count: summary.pending_payout_count,
        },
      })
    }
  }

  let created = 0
  if (candidates.length > 0) {
    const recipientIds = [...new Set(candidates.map((candidate) => candidate.recipient_user_id))]
    const typeList = [...new Set(candidates.map((candidate) => candidate.type))]
    const { data: existing, error: existingError } = await admin
      .from("notifications")
      .select("recipient_user_id, type")
      .eq("org_id", orgId)
      .gte("created_at", dayStartIso)
      .in("recipient_user_id", recipientIds)
      .in("type", typeList)

    if (existingError) throw new Error(existingError.message)

    const existingKey = new Set(
      (existing ?? []).map((row) => `${String(row.recipient_user_id)}|${String(row.type)}`)
    )

    const insertRows = candidates
      .filter((candidate) => !existingKey.has(`${candidate.recipient_user_id}|${candidate.type}`))
      .map((candidate) => ({
        org_id: orgId,
        recipient_user_id: candidate.recipient_user_id,
        type: candidate.type,
        payload: candidate.payload,
      }))

    if (insertRows.length > 0) {
      const { error: insertError } = await admin.from("notifications").insert(insertRows)
      if (insertError) throw new Error(insertError.message)
      created = insertRows.length
    }
  }

  const shouldDeliverExternal =
    externalDelivery &&
    (summary.client_overdue_count > 0 ||
      summary.editor_overdue_count > 0 ||
      summary.pending_invoice_count > 0 ||
      summary.pending_payout_count > 0)

  if (!shouldDeliverExternal) {
    return {
      orgId,
      created,
      summary,
      external: { ok: true, sentChannels: [], skipped: true },
    }
  }

  const settings = await loadOrgIntegrationSettings(admin, orgId)
  if (!settings.auto_digest_enabled || settings.digest_channels.length === 0) {
    return {
      orgId,
      created,
      summary,
      external: { ok: true, sentChannels: [], skipped: true },
    }
  }

  const orgName = (orgRes.data as { name?: string | null } | null)?.name ?? "NovaLoop"
  const results = await fanOutExternalMessage({
    settings,
    channels: settings.digest_channels,
    text: buildDigestMessage(orgName, todayYmd, summary),
    useDefaultChatworkRoom: true,
  })

  return {
    orgId,
    created,
    summary,
    external: {
      ok: results.every((result) => result.ok),
      sentChannels: results.filter((result) => result.ok).map((result) => result.channel),
      skipped: false,
    },
  }
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

    const result = await generateDigestForOrg({
      admin,
      orgId,
      externalDelivery: false,
    })

    return NextResponse.json({ ok: true, ...result }, { status: 200 })
  } catch (error) {
    return NextResponse.json(
      { ok: false, message: error instanceof Error ? error.message : "Server error" },
      { status: 500 }
    )
  }
}

export async function GET(req: NextRequest) {
  if (!hasCronAccess(req)) {
    return NextResponse.json({ ok: false, message: "Forbidden" }, { status: 403 })
  }

  try {
    const admin = createSupabaseAdmin()
    const requestedOrgId = req.nextUrl.searchParams.get("orgId")?.trim() || null
    const orgIds = requestedOrgId
      ? [requestedOrgId]
      : (
          (
            await admin
              .from("org_integration_settings")
              .select("org_id")
              .eq("auto_digest_enabled", true)
          ).data ?? []
        ).map((row) => (row as { org_id: string }).org_id)

    const results: DigestResult[] = []
    for (const orgId of orgIds) {
      const role = requestedOrgId ? "owner" : null
      if (requestedOrgId && !isOrgAdmin(role)) continue
      results.push(
        await generateDigestForOrg({
          admin,
          orgId,
          externalDelivery: true,
        })
      )
    }

    return NextResponse.json({ ok: true, results }, { status: 200 })
  } catch (error) {
    return NextResponse.json(
      { ok: false, message: error instanceof Error ? error.message : "Server error" },
      { status: 500 }
    )
  }
}
