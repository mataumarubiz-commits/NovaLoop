import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"
import { createSupabaseAdmin } from "@/lib/supabaseAdmin"
import { buildInvoiceLineDescription, buildInvoiceTitle, loadBillingPreview, nextMonthEndFromBillingMonth } from "@/lib/monthlyBilling"

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
    return NextResponse.json({ ok: false, message: "Supabase 設定が不足しています。" }, { status: 500 })
  }
  const supabase = createClient(url, anonKey, { auth: { persistSession: false } })
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser(token)
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

export async function POST(req: NextRequest) {
  const authResult = await getAuth(req)
  if (authResult instanceof NextResponse) return authResult
  const { orgId } = authResult

  let body: { billing_month?: string; invoice_title_default?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ ok: false, message: "JSON を解釈できませんでした。" }, { status: 400 })
  }
  const billingMonth =
    typeof body.billing_month === "string" && /^\d{4}-\d{2}$/.test(body.billing_month)
      ? body.billing_month
      : null
  if (!billingMonth) {
    return NextResponse.json({ ok: false, message: "billing_month は YYYY-MM 形式で指定してください。" }, { status: 400 })
  }

  const admin = createSupabaseAdmin()
  const preview = await loadBillingPreview({
    admin,
    orgId,
    billingMonth,
  })

  if (preview.clients.length === 0) {
    return NextResponse.json({ ok: true, invoice_ids: [] })
  }

  const issueDate = new Date().toISOString().slice(0, 10)
  const dueDate = nextMonthEndFromBillingMonth(billingMonth)
  const invoiceTitleDefault =
    typeof body.invoice_title_default === "string" && body.invoice_title_default.trim()
      ? body.invoice_title_default.trim()
      : buildInvoiceTitle(billingMonth)

  const invoiceIds: string[] = []
  for (const client of preview.clients) {
    if (client.contents.length === 0) continue

    const invoiceId = crypto.randomUUID()
    const subtotal = client.contents.reduce((sum, row) => sum + Number(row.amount), 0)
    const now = new Date().toISOString()

    const { error: invErr } = await admin.from("invoices").insert({
      id: invoiceId,
      org_id: orgId,
      client_id: client.client_id,
      invoice_month: billingMonth,
      invoice_title: invoiceTitleDefault,
      issue_date: issueDate,
      due_date: dueDate,
      status: "issued",
      subtotal,
      total: subtotal,
      tax_mode: "exempt",
      tax_rate: 0,
      tax_amount: 0,
      withholding_enabled: false,
      withholding_amount: 0,
      updated_at: now,
      issued_at: now,
    })
    if (invErr) {
      return NextResponse.json(
        { ok: false, message: `請求書の作成に失敗しました: ${client.client_name}` },
        { status: 500 }
      )
    }

    const lines = client.contents.map((row, index) => ({
      id: crypto.randomUUID(),
      invoice_id: invoiceId,
      content_id: row.id,
      project_name: row.project_name ?? null,
      title: row.title ?? null,
      quantity: row.quantity,
      unit_price: Number(row.unit_price),
      amount: Number(row.amount),
      description: buildInvoiceLineDescription(row),
      sort_order: index + 1,
    }))
    const { error: linesErr } = await admin.from("invoice_lines").insert(lines)
    if (linesErr) {
      await admin.from("invoices").delete().eq("id", invoiceId)
      return NextResponse.json(
        { ok: false, message: `請求明細の作成に失敗しました: ${client.client_name}` },
        { status: 500 }
      )
    }

    const { error: updErr } = await admin
      .from("contents")
      .update({ invoice_id: invoiceId })
      .in("id", client.contents.map((row) => row.id))
    if (updErr) {
      await admin.from("invoice_lines").delete().eq("invoice_id", invoiceId)
      await admin.from("invoices").delete().eq("id", invoiceId)
      return NextResponse.json(
        { ok: false, message: `work item の請求紐付けに失敗しました: ${client.client_name}` },
        { status: 500 }
      )
    }
    invoiceIds.push(invoiceId)
  }

  return NextResponse.json({ ok: true, invoice_ids: invoiceIds })
}
