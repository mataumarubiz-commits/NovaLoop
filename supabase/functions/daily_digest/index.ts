// supabase/functions/daily_digest/index.ts
// 毎朝の納期・外注遅れ・支払リマインドを notifications に蓄積する Edge Function（cron 実行想定）。

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.48.0"

type SupabaseClient = ReturnType<typeof createClient>

function ymd(date: Date): string {
  return date.toISOString().slice(0, 10)
}

function addDays(base: Date, days: number): Date {
  const d = new Date(base)
  d.setDate(d.getDate() + days)
  return d
}

async function getOrgs(supabase: SupabaseClient): Promise<string[]> {
  const { data, error } = await supabase.from("organizations").select("id")
  if (error) {
    console.error("[daily_digest] organizations fetch error", error.message)
    return []
  }
  return (data ?? []).map((r) => (r as { id: string }).id)
}

async function getOrgOwners(
  supabase: SupabaseClient,
  orgId: string
): Promise<{ user_id: string; role: string }[]> {
  const { data, error } = await supabase
    .from("app_users")
    .select("user_id, role")
    .eq("org_id", orgId)
    .in("role", ["owner", "executive_assistant"])
  if (error) {
    console.error("[daily_digest] app_users fetch error", orgId, error.message)
    return []
  }
  return (data ?? []) as { user_id: string; role: string }[]
}

async function computeDeadlineAlerts(
  supabase: SupabaseClient,
  orgId: string,
  todayStr: string,
  tomorrowStr: string
): Promise<{ todayCount: number; tomorrowCount: number }> {
  const { data, error } = await supabase
    .from("contents")
    .select("due_client_at, status")
    .eq("org_id", orgId)
  if (error) {
    console.error("[daily_digest] contents deadline fetch error", orgId, error.message)
    return { todayCount: 0, tomorrowCount: 0 }
  }

  const COMPLETED = new Set(["delivered", "published", "canceled", "cancelled"])
  let todayCount = 0
  let tomorrowCount = 0
  for (const row of data ?? []) {
    const r = row as { due_client_at: string | null; status: string }
    if (!r.due_client_at || COMPLETED.has(r.status)) continue
    if (r.due_client_at === todayStr) todayCount++
    if (r.due_client_at === tomorrowStr) tomorrowCount++
  }
  return { todayCount, tomorrowCount }
}

async function computeVendorDelay(
  supabase: SupabaseClient,
  orgId: string,
  todayStr: string
): Promise<{ delayedCount: number }> {
  const { data, error } = await supabase
    .from("contents")
    .select("due_editor_at, editor_submitted_at, status")
    .eq("org_id", orgId)
  if (error) {
    console.error("[daily_digest] contents vendor delay fetch error", orgId, error.message)
    return { delayedCount: 0 }
  }

  const COMPLETED = new Set(["delivered", "published", "canceled", "cancelled"])
  let delayedCount = 0
  for (const row of data ?? []) {
    const r = row as { due_editor_at: string | null; editor_submitted_at: string | null; status: string }
    if (!r.due_editor_at || COMPLETED.has(r.status)) continue
    if (!r.editor_submitted_at && r.due_editor_at < todayStr) delayedCount++
  }
  return { delayedCount }
}

async function computePayoutDue(
  supabase: SupabaseClient,
  orgId: string,
  todayStr: string,
  withinDays: number
): Promise<{ count: number }> {
  const today = new Date(`${todayStr}T00:00:00Z`)
  const limit = addDays(today, withinDays)
  const limitStr = ymd(limit)
  const { data, error } = await supabase
    .from("vendor_invoices")
    .select("pay_date, status")
    .eq("org_id", orgId)
    .neq("status", "paid")
  if (error) {
    console.error("[daily_digest] vendor_invoices fetch error", orgId, error.message)
    return { count: 0 }
  }
  let count = 0
  for (const row of data ?? []) {
    const r = row as { pay_date: string | null; status: string }
    if (!r.pay_date) continue
    const d = r.pay_date.slice(0, 10)
    if (d >= todayStr && d <= limitStr) count++
  }
  return { count }
}

async function hasExistingNotification(
  supabase: SupabaseClient,
  orgId: string,
  recipientUserId: string,
  type: string,
  date: string
): Promise<boolean> {
  const { data, error } = await supabase
    .from("notifications")
    .select("id")
    .eq("org_id", orgId)
    .eq("recipient_user_id", recipientUserId)
    .eq("type", type)
    .eq("payload->>date", date)
    .limit(1)
  if (error) {
    console.error("[daily_digest] notifications check error", recipientUserId, type, error.message)
    return false
  }
  return (data ?? []).length > 0
}

async function insertDigestNotification(
  supabase: SupabaseClient,
  orgId: string,
  recipientUserId: string,
  type: string,
  payload: Record<string, unknown>
) {
  const { error } = await supabase
    .from("notifications")
    .insert({
      org_id: orgId,
      recipient_user_id: recipientUserId,
      type,
      payload,
    })
  if (error) {
    console.error("[daily_digest] notifications insert error", recipientUserId, type, error.message)
  }
}

async function run() {
  const url = Deno.env.get("SUPABASE_URL")
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")
  if (!url || !serviceKey) {
    console.error("[daily_digest] SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY is not set")
    return new Response("Config error", { status: 500 })
  }

  const supabase = createClient(url, serviceKey, { auth: { persistSession: false } })

  const now = new Date()
  const todayStr = ymd(now)
  const tomorrowStr = ymd(addDays(now, 1))

  const orgIds = await getOrgs(supabase)
  for (const orgId of orgIds) {
    const owners = await getOrgOwners(supabase, orgId)
    if (!owners.length) continue

    // A) 今日＆明日の先方提出（未完了）
    const { todayCount, tomorrowCount } = await computeDeadlineAlerts(supabase, orgId, todayStr, tomorrowStr)

    // B) 外注未提出（編集者遅れ）
    const { delayedCount } = await computeVendorDelay(supabase, orgId, todayStr)

    // C) 支払予定（7日以内）
    const { count: payoutCount } = await computePayoutDue(supabase, orgId, todayStr, 7)

    for (const owner of owners) {
      const userId = owner.user_id

      // deadline_alert
      if (todayCount > 0 || tomorrowCount > 0) {
        const type = "deadline_alert"
        const exists = await hasExistingNotification(supabase, orgId, userId, type, todayStr)
        if (!exists) {
          await insertDigestNotification(supabase, orgId, userId, type, {
            date: todayStr,
            today_count: todayCount,
            tomorrow_count: tomorrowCount,
          })
        }
      }

      // vendor_delay
      if (delayedCount > 0) {
        const type = "vendor_delay"
        const exists = await hasExistingNotification(supabase, orgId, userId, type, todayStr)
        if (!exists) {
          await insertDigestNotification(supabase, orgId, userId, type, {
            date: todayStr,
            delayed_count: delayedCount,
          })
        }
      }

      // payout_due
      if (payoutCount > 0) {
        const type = "payout_due"
        const exists = await hasExistingNotification(supabase, orgId, userId, type, todayStr)
        if (!exists) {
          await insertDigestNotification(supabase, orgId, userId, type, {
            date: todayStr,
            due_within_days: 7,
            count: payoutCount,
          })
        }
      }
    }
  }

  return new Response("ok", { status: 200 })
}

Deno.serve(async () => {
  try {
    return await run()
  } catch (e) {
    console.error("[daily_digest] unexpected error", e)
    return new Response("error", { status: 500 })
  }
})

