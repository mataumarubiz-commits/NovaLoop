import { NextRequest, NextResponse } from "next/server"
import { createUserClient, getBearerToken } from "@/lib/userClient"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

async function getAuth(req: NextRequest) {
  const token = getBearerToken(req)
  if (!token) return { error: NextResponse.json({ ok: false, message: "認証が必要です" }, { status: 401 }) }
  const supabase = createUserClient(token)
  if (!supabase) {
    return { error: NextResponse.json({ ok: false, message: "Supabase 設定が不足しています" }, { status: 500 }) }
  }
  const { data } = await supabase.auth.getUser(token)
  const userId = data.user?.id ?? null
  if (!userId) return { error: NextResponse.json({ ok: false, message: "認証が必要です" }, { status: 401 }) }
  const { data: profile } = await supabase
    .from("user_profiles")
    .select("active_org_id")
    .eq("user_id", userId)
    .maybeSingle()
  const orgId = (profile as { active_org_id?: string | null } | null)?.active_org_id ?? null
  if (!orgId) return { error: NextResponse.json({ ok: false, message: "ワークスペースを選択してください" }, { status: 400 }) }
  const { data: appUser } = await supabase
    .from("app_users")
    .select("role")
    .eq("user_id", userId)
    .eq("org_id", orgId)
    .maybeSingle()
  const role = (appUser as { role?: string } | null)?.role ?? null
  if (role !== "owner" && role !== "executive_assistant") {
    return { error: NextResponse.json({ ok: false, message: "権限がありません" }, { status: 403 }) }
  }
  return { supabase, orgId }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await getAuth(req)
    if ("error" in auth) return auth.error
    const { supabase, orgId } = auth
    const { id } = await params
    if (!id) return NextResponse.json({ ok: false, message: "id が必要です" }, { status: 400 })

    const [{ data: invoice }, { data: lines }] = await Promise.all([
      supabase.from("invoices").select("*").eq("id", id).eq("org_id", orgId).maybeSingle(),
      supabase.from("invoice_lines").select("*").eq("invoice_id", id).order("sort_order", { ascending: true }),
    ])
    if (!invoice) {
      return NextResponse.json({ ok: false, message: "請求書が見つかりません" }, { status: 404 })
    }

    const today = new Date().toISOString().slice(0, 10)
    const newId = crypto.randomUUID()

    const nextInvoice = {
      ...invoice,
      id: newId,
      status: "draft",
      invoice_no: null,
      issue_date: today,
      issued_at: null,
      pdf_path: null,
      pdf_generated_at: null,
      send_prepared_at: null,
      send_prepared_by: null,
      payment_status: "unpaid",
      paid_at: null,
      paid_amount: null,
      payment_method: null,
      payment_memo: null,
      payment_note: null,
      latest_receipt_id: null,
      public_token: null,
      client_notified_at: null,
      client_paid_at_claimed: null,
      client_paid_amount_claimed: null,
      client_transfer_name: null,
      client_notify_note: null,
      copied_from_invoice_id: id,
      source_type: "copy",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }
    const { error: invoiceError } = await supabase.from("invoices").insert(nextInvoice)
    if (invoiceError) return NextResponse.json({ ok: false, message: invoiceError.message }, { status: 500 })

    const lineRows = ((lines ?? []) as Record<string, unknown>[]).map((line, index) => ({
      ...line,
      id: crypto.randomUUID(),
      invoice_id: newId,
      sort_order: index + 1,
      content_id: null,
    }))
    if (lineRows.length > 0) {
      const { error: lineError } = await supabase.from("invoice_lines").insert(lineRows)
      if (lineError) {
        await supabase.from("invoices").delete().eq("id", newId).eq("org_id", orgId)
        return NextResponse.json({ ok: false, message: lineError.message }, { status: 500 })
      }
    }

    return NextResponse.json({ ok: true, invoiceId: newId }, { status: 200 })
  } catch (e) {
    console.error("[api/invoices/[id]/copy]", e)
    return NextResponse.json({ ok: false, message: "コピー新規に失敗しました" }, { status: 500 })
  }
}
