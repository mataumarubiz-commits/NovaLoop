import { NextRequest, NextResponse } from "next/server"
import { requireOrgAdmin } from "@/lib/adminApi"
import { notifyAdminRoles, notifyVendorUser } from "@/lib/opsNotifications"
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
  const secret = process.env.INVOICE_REMINDER_CRON_SECRET
  if (!secret) return false
  return req.headers.get("x-reminder-cron-secret") === secret
}

async function executeReminders(req: NextRequest, body: Record<string, unknown>) {
  const orgId = typeof body.orgId === "string" ? body.orgId.trim() : null
  const cronMode = hasCronAccess(req)
  let auth:
    | {
        admin: ReturnType<typeof createSupabaseAdmin>
        orgId: string
        userId: string
      }
    | null = null

  if (cronMode) {
    if (!orgId) {
      return NextResponse.json({ ok: false, error: "orgId is required for cron execution" }, { status: 400 })
    }
    auth = {
      admin: createSupabaseAdmin(),
      orgId,
      userId: "system:invoice-reminder-cron",
    }
  } else {
    const adminAuth = await requireOrgAdmin(req, orgId)
    if (!adminAuth.ok) return adminAuth.response
    auth = {
      admin: adminAuth.admin,
      orgId: adminAuth.orgId,
      userId: adminAuth.userId,
    }
  }

  const scope = isScope(body.scope) ? body.scope : "all"
  const dryRun = Boolean(body.dryRun)
  const manual = Boolean(body.manual)
  const invoiceRequestIds = uniqueIds(body.invoiceRequestIds)
  const vendorInvoiceIds = uniqueIds(body.vendorInvoiceIds)
  const today = new Date().toISOString().slice(0, 10)
  const { admin, userId } = auth

  const summary = {
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
      .eq("org_id", auth.orgId)
      .in("status", ["sent", "viewed"])

    if (!manual) query = query.eq("reminder_enabled", true)
    if (invoiceRequestIds.length > 0) query = query.in("id", invoiceRequestIds)

    const { data: requests, error } = await query
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })

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
            .eq("org_id", auth.orgId)
            .in("invoice_request_id", requestIds)
        : { data: [] }

    const requestLoggedToday = new Set(
      ((existingLogs ?? []) as Array<{ invoice_request_id: string | null; created_at: string }>)
        .filter((row) => row.created_at.startsWith(today))
        .map((row) => row.invoice_request_id)
        .filter(Boolean) as string[]
    )

    const dueRequests = candidateRequests.filter((request) => {
      if (manual && invoiceRequestIds.length > 0) return true
      return !requestLoggedToday.has(String(request.id))
    })

    summary.invoiceRequests = dueRequests.length

    if (!dryRun && dueRequests.length > 0) {
      const logs = dueRequests.map((request) => {
        const deadline = String(request.request_deadline ?? request.due_date ?? "")
        const days = diffInDays(today, deadline)
        const recipientLabel = String(request.guest_company_name ?? request.guest_name ?? "請求依頼先")
        const recipientEmail = String(request.recipient_email ?? "")
        const message = manual
          ? `請求依頼のフォローを記録しました。期限: ${deadline || "未設定"}`
          : days < 0
            ? `期限 ${deadline} を超過した請求依頼です。対応確認を進めてください。`
            : `期限 ${deadline} が近い請求依頼です。フォロー対応として確認してください。`

        return {
          org_id: auth.orgId,
          invoice_request_id: String(request.id),
          reminder_type: manual ? "manual" : days < 0 ? "overdue" : "deadline_soon",
          recipient_label: recipientLabel || null,
          recipient_email: recipientEmail || null,
          message,
          actor_user_id: userId,
        }
      })

      const { error: logError } = await admin.from("invoice_reminder_logs").insert(logs)
      if (logError) return NextResponse.json({ ok: false, error: logError.message }, { status: 500 })

      for (const request of dueRequests) {
        const deadline = String(request.request_deadline ?? request.due_date ?? "")
        const days = diffInDays(today, deadline)
        await notifyAdminRoles({
          orgId: auth.orgId,
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
          .eq("org_id", auth.orgId)
          .eq("id", String(request.id))
      }

      summary.createdLogs += dueRequests.length
    }
  }

  if (scope === "all" || scope === "vendor_invoices") {
    let query = admin
      .from("vendor_invoices")
      .select("id, vendor_id, billing_month, submit_deadline, request_sent_at, status")
      .eq("org_id", auth.orgId)
      .in("status", ["draft", "rejected"])
      .not("request_sent_at", "is", null)

    if (vendorInvoiceIds.length > 0) query = query.in("id", vendorInvoiceIds)

    const { data: vendorRows, error } = await query
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })

    const candidateVendorInvoices = ((vendorRows ?? []) as Array<Record<string, unknown>>).filter((row) => {
      const deadline = String(row.submit_deadline ?? "")
      if (!deadline) return false
      if (manual && vendorInvoiceIds.length > 0) return true
      const days = diffInDays(today, deadline)
      return days <= 3
    })

    const candidateIds = candidateVendorInvoices.map((row) => String(row.id))
    const { data: existingVendorLogs } =
      candidateIds.length > 0
        ? await admin
            .from("invoice_reminder_logs")
            .select("vendor_invoice_id, created_at")
            .eq("org_id", auth.orgId)
            .in("vendor_invoice_id", candidateIds)
        : { data: [] }

    const vendorLoggedToday = new Set(
      ((existingVendorLogs ?? []) as Array<{ vendor_invoice_id: string | null; created_at: string }>)
        .filter((row) => row.created_at.startsWith(today))
        .map((row) => row.vendor_invoice_id)
        .filter(Boolean) as string[]
    )

    const dueVendorInvoices = candidateVendorInvoices.filter((row) => {
      if (manual && vendorInvoiceIds.length > 0) return true
      return !vendorLoggedToday.has(String(row.id))
    })

    summary.vendorInvoices = dueVendorInvoices.length

    if (!dryRun && dueVendorInvoices.length > 0) {
      const logs = dueVendorInvoices.map((row) => {
        const deadline = String(row.submit_deadline ?? "")
        const days = diffInDays(today, deadline)
        return {
          org_id: auth.orgId,
          vendor_invoice_id: String(row.id),
          reminder_type: manual ? "manual" : days < 0 ? "overdue" : "deadline_soon",
          recipient_label: "外注請求依頼",
          recipient_email: null,
          message: manual
            ? `外注請求依頼のフォローを記録しました。期限: ${deadline || "未設定"}`
            : days < 0
              ? "外注請求依頼が期限超過です。差し戻し理由と提出状況を確認してください。"
              : "外注請求依頼の期限が近づいています。提出状況を確認してください。",
          actor_user_id: userId,
        }
      })

      const { error: logError } = await admin.from("invoice_reminder_logs").insert(logs)
      if (logError) return NextResponse.json({ ok: false, error: logError.message }, { status: 500 })

      for (const row of dueVendorInvoices) {
        const deadline = String(row.submit_deadline ?? "")
        const days = diffInDays(today, deadline)
        await notifyVendorUser({
          orgId: auth.orgId,
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
          orgId: auth.orgId,
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

  return NextResponse.json({ ok: true, dryRun, manual, summary })
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
    return await executeReminders(req, body)
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
    const url = new URL(req.url)
    return await executeReminders(req, {
      orgId: url.searchParams.get("orgId"),
      scope: url.searchParams.get("scope"),
      dryRun: url.searchParams.get("dryRun") === "1",
      manual: false,
    })
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "リマインド処理に失敗しました" },
      { status: 500 }
    )
  }
}
