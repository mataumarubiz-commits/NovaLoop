import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"
import { createSupabaseAdmin } from "@/lib/supabaseAdmin"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

async function getAuth(req: NextRequest): Promise<{ userId: string; orgId: string } | NextResponse> {
  const authHeader = req.headers.get("Authorization")
  const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7).trim() : null
  if (!token) {
    return NextResponse.json({ ok: false, message: "認証が必要です。" }, { status: 401 })
  }
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !anonKey) {
    return NextResponse.json({ ok: false, message: "サーバー設定エラー" }, { status: 500 })
  }
  const supabase = createClient(url, anonKey, { auth: { persistSession: false } })
  const { data: { user }, error: userError } = await supabase.auth.getUser(token)
  if (userError || !user) {
    return NextResponse.json({ ok: false, message: "トークンが無効です。" }, { status: 401 })
  }
  const admin = createSupabaseAdmin()
  const { data: profile } = await admin
    .from("user_profiles")
    .select("active_org_id")
    .eq("user_id", user.id)
    .maybeSingle()
  const orgId = (profile as { active_org_id?: string | null } | null)?.active_org_id ?? null
  if (!orgId) {
    return NextResponse.json({ ok: false, message: "ワークスペースを選択してください。" }, { status: 400 })
  }
  const { data: appUser } = await admin
    .from("app_users")
    .select("role")
    .eq("user_id", user.id)
    .eq("org_id", orgId)
    .maybeSingle()
  const role = (appUser as { role?: string } | null)?.role
  if (role !== "owner" && role !== "executive_assistant") {
    return NextResponse.json({ ok: false, message: "権限がありません。" }, { status: 403 })
  }
  return { userId: user.id, orgId }
}

/** 対象月の翌月末日 (YYYY-MM-DD)。例: 2025-02 → 2025-03-31 */
function nextMonthEndFromMonth(ym: string): string {
  const [y, month1] = ym.split("-").map(Number)
  const nextMonth1 = month1 === 12 ? 1 : month1 + 1
  const nextY = month1 === 12 ? y + 1 : y
  const d = new Date(nextY, nextMonth1, 0)
  return d.toISOString().slice(0, 10)
}

/**
 * POST /api/billing/bulk-create
 * Body: { billing_month: "YYYY-MM", invoice_title_default?: string }
 * 対象月・billable かつ未請求の contents を client 単位で集計し、1 client = 1 invoice を issued で作成。
 * invoice_lines に project_name, title を保存。contents.invoice_id を更新。
 * Returns: { ok: true, invoice_ids: string[] }
 */
export async function POST(req: NextRequest) {
  const authResult = await getAuth(req)
  if (authResult instanceof NextResponse) return authResult
  const { orgId } = authResult

  let body: { billing_month?: string; invoice_title_default?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ ok: false, message: "JSON を解析できませんでした。" }, { status: 400 })
  }
  const billingMonth = typeof body.billing_month === "string" && /^\d{4}-\d{2}$/.test(body.billing_month)
    ? body.billing_month
    : null
  if (!billingMonth) {
    return NextResponse.json({ ok: false, message: "billing_month は YYYY-MM で指定してください。" }, { status: 400 })
  }
  const invoiceTitleDefault = typeof body.invoice_title_default === "string"
    ? (body.invoice_title_default.trim() || "SNS運用代行")
    : "SNS運用代行"

  const admin = createSupabaseAdmin()
  const today = new Date().toISOString().slice(0, 10)
  const dueDate = nextMonthEndFromMonth(billingMonth)

  const { data: contents, error: contentsError } = await admin
    .from("contents")
    .select("id, client_id, project_name, title, unit_price")
    .eq("org_id", orgId)
    .eq("delivery_month", billingMonth)
    .eq("billable_flag", true)
    .is("invoice_id", null)
  if (contentsError) {
    console.error("[billing/bulk-create] contents fetch", contentsError)
    return NextResponse.json({ ok: false, message: "請求対象の取得に失敗しました。" }, { status: 500 })
  }
  const rows = (contents ?? []) as { id: string; client_id: string; project_name: string; title: string; unit_price: number }[]
  if (rows.length === 0) {
    return NextResponse.json({ ok: true, invoice_ids: [] })
  }

  const byClient = new Map<string, typeof rows>()
  for (const r of rows) {
    const list = byClient.get(r.client_id) ?? []
    list.push(r)
    byClient.set(r.client_id, list)
  }

  const { data: clients } = await admin
    .from("clients")
    .select("id, name")
    .in("id", [...byClient.keys()])
  const clientMap = new Map<string, string>()
  for (const c of (clients ?? []) as { id: string; name: string }[]) {
    clientMap.set(c.id, c.name ?? "")
  }

  const invoiceIds: string[] = []
  for (const [clientId, items] of byClient.entries()) {
    const clientName = clientMap.get(clientId) ?? "不明"
    const invoiceId = crypto.randomUUID()
    const subtotal = items.reduce((s, r) => s + Number(r.unit_price), 0)

    const now = new Date().toISOString()
    const { error: invErr } = await admin.from("invoices").insert({
      id: invoiceId,
      org_id: orgId,
      client_id: clientId,
      invoice_month: billingMonth,
      invoice_title: invoiceTitleDefault,
      issue_date: today,
      due_date: dueDate,
      status: "issued",
      subtotal,
      total: subtotal,
      updated_at: now,
      issued_at: now,
    })
    if (invErr) {
      console.error("[billing/bulk-create] invoice insert", invErr)
      return NextResponse.json({ ok: false, message: `請求書の作成に失敗しました: ${clientName}` }, { status: 500 })
    }

    const lines = items.map((r, i) => ({
      id: crypto.randomUUID(),
      invoice_id: invoiceId,
      content_id: r.id,
      project_name: r.project_name ?? null,
      title: r.title ?? null,
      quantity: 1,
      unit_price: Number(r.unit_price),
      amount: Number(r.unit_price),
      description: (r.title || r.project_name || "").slice(0, 500),
      sort_order: i + 1,
    }))
    const { error: linesErr } = await admin.from("invoice_lines").insert(lines)
    if (linesErr) {
      await admin.from("invoices").delete().eq("id", invoiceId)
      console.error("[billing/bulk-create] invoice_lines insert", linesErr)
      return NextResponse.json({ ok: false, message: `明細の作成に失敗しました: ${clientName}` }, { status: 500 })
    }

    const { error: updErr } = await admin
      .from("contents")
      .update({ invoice_id: invoiceId })
      .in("id", items.map((r) => r.id))
    if (updErr) {
      await admin.from("invoice_lines").delete().eq("invoice_id", invoiceId)
      await admin.from("invoices").delete().eq("id", invoiceId)
      console.error("[billing/bulk-create] contents update", updErr)
      return NextResponse.json({ ok: false, message: `コンテンツの紐付けに失敗しました: ${clientName}` }, { status: 500 })
    }
    invoiceIds.push(invoiceId)
  }

  return NextResponse.json({ ok: true, invoice_ids: invoiceIds })
}
