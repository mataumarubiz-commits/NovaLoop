import { NextRequest, NextResponse } from "next/server"
import { createSupabaseAdmin } from "@/lib/supabaseAdmin"
import { createUserClient, getBearerToken } from "@/lib/userClient"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

type RequestPayload = {
  client_id?: string | null
  guest_name?: string
  guest_company_name?: string
  recipient_email?: string
  requested_title?: string
  requested_description?: string
  due_date?: string
  request_deadline?: string
  reminder_enabled?: boolean
  reminder_lead_days?: number
  reminder_message?: string
  request_type?: "invoice_request" | "vendor_request"
}

type InvoiceRequestRow = {
  id: string
  client_id: string | null
  guest_name: string | null
  guest_company_name: string | null
  recipient_email: string | null
  requested_title: string | null
  requested_description: string | null
  due_date: string | null
  request_deadline: string | null
  status: string
  request_type: string | null
  reminder_enabled: boolean | null
  reminder_lead_days: number | null
  reminder_count: number | null
  reminder_message: string | null
  last_reminded_at: string | null
  last_sent_at: string | null
  issued_invoice_id: string | null
  created_at: string
}

type ReminderLogRow = {
  id: string
  invoice_request_id: string | null
  reminder_type: string
  recipient_label: string | null
  recipient_email: string | null
  message: string | null
  created_at: string
}

function isYmd(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)
}

async function getAuth(req: NextRequest) {
  const token = getBearerToken(req)
  if (!token) {
    return {
      error: NextResponse.json({ ok: false, message: "ログインが必要です" }, { status: 401 }),
    }
  }

  const supabase = createUserClient(token)
  if (!supabase) {
    return {
      error: NextResponse.json({ ok: false, message: "Supabase 設定を確認してください" }, { status: 500 }),
    }
  }

  const { data } = await supabase.auth.getUser(token)
  const userId = data.user?.id ?? null
  if (!userId) {
    return {
      error: NextResponse.json({ ok: false, message: "ログインが必要です" }, { status: 401 }),
    }
  }

  const [{ data: profile }, { data: appUsers }] = await Promise.all([
    supabase.from("user_profiles").select("active_org_id").eq("user_id", userId).maybeSingle(),
    supabase.from("app_users").select("org_id, role").eq("user_id", userId),
  ])

  const orgId = (profile as { active_org_id?: string | null } | null)?.active_org_id ?? null
  const role =
    ((appUsers ?? []) as Array<{ org_id: string; role: string }>).find((row) => row.org_id === orgId)?.role ?? null

  if (!orgId || (role !== "owner" && role !== "executive_assistant")) {
    return {
      error: NextResponse.json({ ok: false, message: "この操作を実行する権限がありません" }, { status: 403 }),
    }
  }

  return { supabase, orgId, userId }
}

export async function GET(req: NextRequest) {
  const auth = await getAuth(req)
  if ("error" in auth) return auth.error

  const { supabase, orgId } = auth
  const { searchParams } = new URL(req.url)
  const limit = Math.min(Math.max(Number(searchParams.get("limit") ?? 50), 1), 100)

  const { data, error } = await supabase
    .from("invoice_requests")
    .select(
      "id, client_id, guest_name, guest_company_name, recipient_email, requested_title, requested_description, due_date, request_deadline, status, request_type, reminder_enabled, reminder_lead_days, reminder_count, reminder_message, last_reminded_at, last_sent_at, issued_invoice_id, created_at"
    )
    .eq("org_id", orgId)
    .order("created_at", { ascending: false })
    .limit(limit)

  if (error) {
    return NextResponse.json({ ok: false, message: error.message }, { status: 500 })
  }

  const requests = (data ?? []) as InvoiceRequestRow[]
  const requestIds = requests.map((row) => row.id)

  const { data: logs, error: logsError } =
    requestIds.length > 0
      ? await supabase
          .from("invoice_reminder_logs")
          .select("id, invoice_request_id, reminder_type, recipient_label, recipient_email, message, created_at")
          .eq("org_id", orgId)
          .in("invoice_request_id", requestIds)
          .order("created_at", { ascending: false })
          .limit(200)
      : { data: [], error: null }

  if (logsError) {
    return NextResponse.json({ ok: false, message: logsError.message }, { status: 500 })
  }

  const logsByRequest = new Map<string, ReminderLogRow[]>()
  for (const log of (logs ?? []) as ReminderLogRow[]) {
    if (!log.invoice_request_id) continue
    const list = logsByRequest.get(log.invoice_request_id) ?? []
    list.push(log)
    logsByRequest.set(log.invoice_request_id, list)
  }

  const enriched = requests.map((row) => ({
    ...row,
    reminder_logs: (logsByRequest.get(row.id) ?? []).slice(0, 5),
  }))

  return NextResponse.json({ ok: true, requests: enriched }, { status: 200 })
}

export async function POST(req: NextRequest) {
  try {
    const auth = await getAuth(req)
    if ("error" in auth) return auth.error

    const { supabase, orgId, userId } = auth
    const body = (await req.json().catch(() => ({}))) as { requests?: RequestPayload[] }
    const requests = Array.isArray(body.requests) ? body.requests : []

    if (requests.length === 0) {
      return NextResponse.json({ ok: false, message: "請求依頼の入力内容がありません" }, { status: 400 })
    }

    const rows = requests
      .map((item) => {
        const dueDate = isYmd(item.due_date) ? item.due_date : new Date().toISOString().slice(0, 10)
        const requestDeadline = isYmd(item.request_deadline) ? item.request_deadline : dueDate
        return {
          org_id: orgId,
          client_id: item.client_id ?? null,
          guest_name: item.client_id ? null : item.guest_name?.trim() || null,
          guest_company_name: item.client_id ? null : item.guest_company_name?.trim() || null,
          recipient_email: item.recipient_email?.trim() || null,
          requested_title: item.requested_title?.trim() || "請求書のご提出依頼",
          requested_description: item.requested_description?.trim() || "",
          due_date: dueDate,
          request_deadline: requestDeadline,
          request_type: item.request_type === "vendor_request" ? "vendor_request" : "invoice_request",
          reminder_enabled: item.reminder_enabled ?? true,
          reminder_lead_days: Math.min(Math.max(Number(item.reminder_lead_days ?? 3), 0), 30),
          reminder_message: item.reminder_message?.trim() || null,
          status: "sent",
          last_sent_at: new Date().toISOString(),
          created_by: userId,
          updated_at: new Date().toISOString(),
        }
      })
      .filter((item) => item.client_id || item.guest_name)

    if (rows.length === 0) {
      return NextResponse.json({ ok: false, message: "宛先名または取引先を指定してください" }, { status: 400 })
    }

    const { data: inserted, error } = await supabase
      .from("invoice_requests")
      .insert(rows)
      .select("id, client_id, guest_name, guest_company_name, recipient_email")

    if (error) {
      return NextResponse.json({ ok: false, message: error.message }, { status: 500 })
    }

    try {
      const admin = createSupabaseAdmin()
      const { data: admins } = await supabase
        .from("app_users")
        .select("user_id")
        .eq("org_id", orgId)
        .in("role", ["owner", "executive_assistant"])

      const adminIds = Array.from(new Set(((admins ?? []) as Array<{ user_id: string }>).map((row) => row.user_id)))
      const notifications = adminIds.flatMap((recipientUserId) =>
        ((inserted ?? []) as Array<{
          id: string
          client_id: string | null
          guest_name: string | null
          guest_company_name: string | null
          recipient_email: string | null
        }>).map((row) => ({
          recipient_user_id: recipientUserId,
          org_id: orgId,
          type: "billing.request_sent",
          payload: {
            invoice_request_id: row.id,
            client_id: row.client_id,
            guest_name: row.guest_name,
            guest_company_name: row.guest_company_name,
            recipient_email: row.recipient_email,
          },
        }))
      )

      if (notifications.length > 0) {
        await admin.from("notifications").insert(notifications)
      }
    } catch {
      // service-role 未設定でも依頼作成自体は継続する
    }

    return NextResponse.json({ ok: true, count: rows.length }, { status: 200 })
  } catch (error) {
    console.error("[api/invoice-requests]", error)
    return NextResponse.json({ ok: false, message: "請求依頼の登録に失敗しました" }, { status: 500 })
  }
}
