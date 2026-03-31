import { NextRequest, NextResponse } from "next/server"
import { requireOrgAdmin } from "@/lib/adminApi"
import { fanOutExternalMessage } from "@/lib/externalChannels"
import { notifyAdminRoles, notifyVendorUser } from "@/lib/opsNotifications"
import { loadOrgIntegrationSettings } from "@/lib/orgIntegrationSettings"
import { createSupabaseAdmin } from "@/lib/supabaseAdmin"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

type Scope = "all" | "invoice_requests" | "vendor_invoices"

function isScope(value: unknown): value is Scope {
  return value === "all" || value === "invoice_requests" || value === "vendor_invoices"
}

function diffInDays(fromYmd: string, toYmd: string) {
  const from = new Date(`${fromYmd}T00:00:00`)
  const to = new Date(`${toYmd}T00:00:00`)
  return Math.round((to.getTime() - from.getTime()) / 86400000)
}

function uniqueIds(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return Array.from(
    new Set(
      value
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.trim())
        .filter(Boolean)
    )
  )
}

function hasCronAccess(req: NextRequest) {
  const secret = process.env.INVOICE_REMINDER_CRON_SECRET || process.env.CRON_SECRET
  if (!secret) return false
  const bearer = req.headers.get("authorization")
  if (bearer === `Bearer ${secret}`) return true
  return req.headers.get("x-reminder-cron-secret") === secret
}

type ReminderBody = Record<string, unknown>

type ReminderSummary = {
  invoiceRequests: number
  vendorInvoices: number
  createdLogs: number
}

type ReminderExecutionInput = {
  admin: ReturnType<typeof createSupabaseAdmin>
  orgId: string
  userId: string
  body: ReminderBody
  externalDelivery: boolean
}

function buildReminderMessage(orgName: string, today: string, summary: ReminderSummary) {
  return [
    `【リマインド実行】${orgName}`,
    `対象日: ${today}`,
    `請求依頼フォロー: ${summary.invoiceRequests}件`,
    `外注請求フォロー: ${summary.vendorInvoices}件`,
    `記録追加: ${summary.createdLogs}件`,
  ].join("\n")
}

async function executeRemindersForOrg(input: ReminderExecutionInput) {
  const { admin, orgId, userId, body, externalDelivery } = input
  const scope = isScope(body.scope) ? body.scope : "all"
  const dryRun = Boolean(body.dryRun)
  const manual = Boolean(body.manual)
  const invoiceRequestIds = uniqueIds(body.invoiceRequestIds)
  const vendorInvoiceIds = uniqueIds(body.vendorInvoiceIds)
  const today = new Date().toISOString().slice(0, 10)

  const summary: ReminderSummary = {
    invoiceRequests: 0,
    vendorInvoices: 0,
    createdLogs: 0,
  }

  if (scope === "all" || scope === "invoice_requests") {
    let query = admin
      .from("invoice_requests")
      .select(
        "id, client_id, guest_name, guest_company_name, recipient_email, requested_title, status, request_deadline, due_date, reminder_enabled, reminder_lead_days, reminder_count, last_reminded_at"
      )
      .eq("org_id", orgId)
      .in("status", ["sent", "viewed"])

    if (!manual) query = query.eq("reminder_enabled", true)
    if (invoiceRequestIds.length > 0) query = query.in("id", invoiceRequestIds)

    const { data: requests, error } = await query
    if (error) throw new Error(error.message)

    const candidateRequests = ((requests ?? []) as Array<Record<string, unknown>>).filter((request) => {
      const deadline = String(request.request_deadline ?? request.due_date ?? "")
      if (!deadline) return false
      if (manual && invoiceRequestIds.length > 0) return true

      const leadDays = Number(request.reminder_lead_days ?? 3)
      const days = diffInDays(today, deadline)
      const lastRemindedAt = String(request.last_reminded_at ?? "")
      const remindedToday = lastRemindedAt.startsWith(today)
      return !remindedToday && days <= leadDays
    })

    const requestIds = candidateRequests.map((request) => String(request.id))
    const { data: existingLogs } =
      requestIds.length > 0
        ? await admin
            .from("invoice_reminder_logs")
            .select("invoice_request_id, created_at")
            .eq("org_id", orgId)
            .in("invoice_request_id", requestIds)
        : { data: [] }

    const loggedToday = new Set(
      ((existingLogs ?? []) as Array<{ invoice_request_id: string | null; created_at: string }>)
        .filter((row) => row.created_at.startsWith(today))
        .map((row) => row.invoice_request_id)
        .filter(Boolean) as string[]
    )

    const dueRequests = candidateRequests.filter((request) => {
      if (manual && invoiceRequestIds.length > 0) return true
      return !loggedToday.has(String(request.id))
    })

    summary.invoiceRequests = dueRequests.length

    if (!dryRun && dueRequests.length > 0) {
      const logs = dueRequests.map((request) => {
        const deadline = String(request.request_deadline ?? request.due_date ?? "")
        const days = diffInDays(today, deadline)
        const recipientLabel = String(request.guest_company_name ?? request.guest_name ?? "請求依頼先")
        const recipientEmail = String(request.recipient_email ?? "")
        return {
          org_id: orgId,
          invoice_request_id: String(request.id),
          reminder_type: manual ? "manual" : days < 0 ? "overdue" : "deadline_soon",
          recipient_label: recipientLabel || null,
          recipient_email: recipientEmail || null,
          message: manual
            ? `請求依頼のフォローを記録しました。期限: ${deadline || "未設定"}`
            : days < 0
              ? `期限 ${deadline} を超過した請求依頼です。`
              : `期限 ${deadline} が近い請求依頼です。`,
          actor_user_id: userId,
        }
      })

      const { error: logError } = await admin.from("invoice_reminder_logs").insert(logs)
      if (logError) throw new Error(logError.message)

      for (const request of dueRequests) {
        const deadline = String(request.request_deadline ?? request.due_date ?? "")
        const days = diffInDays(today, deadline)
        await notifyAdminRoles({
          orgId,
          type: days < 0 ? "billing.request_overdue" : "billing.request_due_soon",
          payload: {
            invoice_request_id: request.id,
            recipient_email: request.recipient_email ?? null,
            guest_name: request.guest_name ?? null,
            guest_company_name: request.guest_company_name ?? null,
            request_deadline: deadline,
            manual,
          },
        })

        await admin
          .from("invoice_requests")
          .update({
            last_reminded_at: new Date().toISOString(),
            reminder_count: Number(request.reminder_count ?? 0) + 1,
          })
          .eq("org_id", orgId)
          .eq("id", String(request.id))
      }

      summary.createdLogs += dueRequests.length
    }
  }

  if (scope === "all" || scope === "vendor_invoices") {
    let query = admin
      .from("vendor_invoices")
      .select("id, vendor_id, billing_month, submit_deadline, request_sent_at, status")
      .eq("org_id", orgId)
      .in("status", ["draft", "rejected"])
      .not("request_sent_at", "is", null)

    if (vendorInvoiceIds.length > 0) query = query.in("id", vendorInvoiceIds)

    const { data: vendorRows, error } = await query
    if (error) throw new Error(error.message)

    const candidateVendorInvoices = ((vendorRows ?? []) as Array<Record<string, unknown>>).filter((row) => {
      const deadline = String(row.submit_deadline ?? "")
      if (!deadline) return false
      if (manual && vendorInvoiceIds.length > 0) return true
      return diffInDays(today, deadline) <= 3
    })

    const candidateIds = candidateVendorInvoices.map((row) => String(row.id))
    const { data: existingVendorLogs } =
      candidateIds.length > 0
        ? await admin
            .from("invoice_reminder_logs")
            .select("vendor_invoice_id, created_at")
            .eq("org_id", orgId)
            .in("vendor_invoice_id", candidateIds)
        : { data: [] }

    const loggedToday = new Set(
      ((existingVendorLogs ?? []) as Array<{ vendor_invoice_id: string | null; created_at: string }>)
        .filter((row) => row.created_at.startsWith(today))
        .map((row) => row.vendor_invoice_id)
        .filter(Boolean) as string[]
    )

    const dueVendorInvoices = candidateVendorInvoices.filter((row) => {
      if (manual && vendorInvoiceIds.length > 0) return true
      return !loggedToday.has(String(row.id))
    })

    summary.vendorInvoices = dueVendorInvoices.length

    if (!dryRun && dueVendorInvoices.length > 0) {
      const logs = dueVendorInvoices.map((row) => {
        const deadline = String(row.submit_deadline ?? "")
        const days = diffInDays(today, deadline)
        return {
          org_id: orgId,
          vendor_invoice_id: String(row.id),
          reminder_type: manual ? "manual" : days < 0 ? "overdue" : "deadline_soon",
          recipient_label: "外注請求依頼",
          recipient_email: null,
          message: manual
            ? `外注請求依頼のフォローを記録しました。期限: ${deadline || "未設定"}`
            : days < 0
              ? "外注請求依頼が期限超過です。"
              : "外注請求依頼の期限が近づいています。",
          actor_user_id: userId,
        }
      })

      const { error: logError } = await admin.from("invoice_reminder_logs").insert(logs)
      if (logError) throw new Error(logError.message)

      for (const row of dueVendorInvoices) {
        const deadline = String(row.submit_deadline ?? "")
        const days = diffInDays(today, deadline)
        await notifyVendorUser({
          orgId,
          vendorId: String(row.vendor_id),
          type: days < 0 ? "vendor_invoice.request_overdue" : "vendor_invoice.request_due_soon",
          payload: {
            vendor_invoice_id: row.id,
            billing_month: row.billing_month,
            submit_deadline: deadline,
            manual,
          },
        })
        await notifyAdminRoles({
          orgId,
          type: days < 0 ? "vendor_invoice.request_overdue" : "vendor_invoice.request_due_soon",
          payload: {
            vendor_invoice_id: row.id,
            vendor_id: row.vendor_id,
            billing_month: row.billing_month,
            submit_deadline: deadline,
            manual,
          },
        })
      }

      summary.createdLogs += dueVendorInvoices.length
    }
  }

  if (externalDelivery && !dryRun && (summary.invoiceRequests > 0 || summary.vendorInvoices > 0)) {
    const [settings, orgRes] = await Promise.all([
      loadOrgIntegrationSettings(admin, orgId),
      admin.from("organizations").select("name").eq("id", orgId).maybeSingle(),
    ])

    if (settings.auto_invoice_reminders_enabled && settings.reminder_channels.length > 0) {
      await fanOutExternalMessage({
        settings,
        channels: settings.reminder_channels,
        text: buildReminderMessage(
          (orgRes.data as { name?: string | null } | null)?.name ?? "NovaLoop",
          today,
          summary
        ),
        useDefaultChatworkRoom: true,
      })
    }
  }

  return { ok: true, dryRun, manual, orgId, summary }
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as ReminderBody
    const orgId = typeof body.orgId === "string" ? body.orgId.trim() : null
    const auth = await requireOrgAdmin(req, orgId)
    if (!auth.ok) return auth.response

    const result = await executeRemindersForOrg({
      admin: auth.admin,
      orgId: auth.orgId,
      userId: auth.userId,
      body,
      externalDelivery: false,
    })
    return NextResponse.json(result)
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "リマインド処理に失敗しました" },
      { status: 500 }
    )
  }
}

export async function GET(req: NextRequest) {
  if (!hasCronAccess(req)) {
    return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 })
  }

  try {
    const admin = createSupabaseAdmin()
    const requestedOrgId = req.nextUrl.searchParams.get("orgId")?.trim() || null
    const body: ReminderBody = {
      scope: req.nextUrl.searchParams.get("scope"),
      dryRun: req.nextUrl.searchParams.get("dryRun") === "1",
      manual: false,
    }

    const orgIds = requestedOrgId
      ? [requestedOrgId]
      : (
          (
            await admin
              .from("org_integration_settings")
              .select("org_id")
              .eq("auto_invoice_reminders_enabled", true)
          ).data ?? []
        ).map((row) => (row as { org_id: string }).org_id)

    const results = []
    for (const orgId of orgIds) {
      results.push(
        await executeRemindersForOrg({
          admin,
          orgId,
          userId: "system:invoice-reminder-cron",
          body,
          externalDelivery: true,
        })
      )
    }

    return NextResponse.json({ ok: true, results })
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "リマインド処理に失敗しました" },
      { status: 500 }
    )
  }
}
