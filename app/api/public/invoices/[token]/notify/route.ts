/**
 * POST /api/public/invoices/[token]/notify
 *
 * 認証不要の公開エンドポイント。
 * 請求書受取人が「振込完了」を通知するために使う。
 * - public_token で請求書を特定（UUID なので推測不可）
 * - issued 状態の請求書のみ受付
 * - 既に通知済みの場合は上書き（再通知可能）
 * - 通知内容: paid_at, paid_amount, transfer_name, note
 *
 * レート制限: Supabase/Vercel の標準インフラに依存。
 * DoS 対策として paid_amount / transfer_name にバリデーションを入れる。
 */
import { NextRequest, NextResponse } from "next/server"
import { createSupabaseAdmin } from "@/lib/supabaseAdmin"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

// CORS: 公開ページから呼ばれるので同一オリジンのみ許可
const ALLOWED_ORIGIN = process.env.NEXT_PUBLIC_APP_URL ?? ""

type NotifyBody = {
  paid_at: string                // YYYY-MM-DD
  paid_amount: number
  transfer_name?: string | null  // 振込名義
  note?: string | null           // 備考
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params

  // ── UUID 形式チェック ────────────────────────────────────────────
  const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  if (!token || !uuidRe.test(token)) {
    return NextResponse.json({ error: "無効なURLです" }, { status: 400 })
  }

  let body: NotifyBody
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "リクエストの形式が正しくありません" }, { status: 400 })
  }

  // ── バリデーション ────────────────────────────────────────────────
  if (!body.paid_at || !/^\d{4}-\d{2}-\d{2}$/.test(body.paid_at)) {
    return NextResponse.json({ error: "振込日を正しく入力してください（例: 2026-04-02）" }, { status: 400 })
  }
  if (typeof body.paid_amount !== "number" || body.paid_amount <= 0 || body.paid_amount > 100_000_000) {
    return NextResponse.json({ error: "振込金額を正しく入力してください" }, { status: 400 })
  }
  if (body.transfer_name && body.transfer_name.length > 100) {
    return NextResponse.json({ error: "振込名義は100文字以内で入力してください" }, { status: 400 })
  }
  if (body.note && body.note.length > 500) {
    return NextResponse.json({ error: "備考は500文字以内で入力してください" }, { status: 400 })
  }

  const admin = createSupabaseAdmin()

  // ── 請求書取得（public_token で特定）───────────────────────────
  const { data: invoice, error: invErr } = await admin
    .from("invoices")
    .select("id, org_id, status, total, subtotal, invoice_no, due_date, client_notified_at")
    .eq("public_token", token)
    .maybeSingle()

  if (invErr || !invoice) {
    // セキュリティ上、存在しないトークンも同じメッセージ
    return NextResponse.json(
      { error: "請求書が見つかりません。URLをご確認ください" },
      { status: 404 }
    )
  }

  const inv = invoice as {
    id: string
    org_id: string
    status: string
    total: number | null
    subtotal: number
    invoice_no: string | null
    due_date: string
    client_notified_at: string | null
  }

  // ── ステータスチェック ────────────────────────────────────────────
  if (inv.status === "void") {
    return NextResponse.json(
      { error: "この請求書は無効です。担当者にご確認ください" },
      { status: 422 }
    )
  }
  if (inv.status === "draft") {
    return NextResponse.json(
      { error: "この請求書はまだ発行されていません。担当者にご確認ください" },
      { status: 422 }
    )
  }

  // ── 支払通知を記録 ────────────────────────────────────────────────
  const { error: updateErr } = await admin
    .from("invoices")
    .update({
      client_notified_at: new Date().toISOString(),
      client_paid_at_claimed: body.paid_at,
      client_paid_amount_claimed: body.paid_amount,
      client_transfer_name: body.transfer_name?.trim() || null,
      client_notify_note: body.note?.trim() || null,
    })
    .eq("id", inv.id)

  if (updateErr) {
    return NextResponse.json(
      { error: "送信に失敗しました。しばらく経ってから再度お試しください" },
      { status: 500 }
    )
  }

  return NextResponse.json({
    ok: true,
    message: "お支払い完了のご連絡を受け付けました。担当者が確認の上、領収書をお送りいたします。",
    invoice_no: inv.invoice_no,
  })
}

// ── GET: トークンから請求書サマリーを返す（公開ページの初期表示用）──────
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params

  const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  if (!token || !uuidRe.test(token)) {
    return NextResponse.json({ error: "無効なURLです" }, { status: 400 })
  }

  const admin = createSupabaseAdmin()

  const { data: invoice, error } = await admin
    .from("invoices")
    .select(
      "id, invoice_no, invoice_title, invoice_month, due_date, total, subtotal, status, issuer_snapshot, client_notified_at, client_paid_at_claimed, client_paid_amount_claimed"
    )
    .eq("public_token", token)
    .maybeSingle()

  if (error || !invoice) {
    return NextResponse.json({ error: "請求書が見つかりません" }, { status: 404 })
  }

  const inv = invoice as Record<string, unknown>

  // 必要最小限の情報のみ返す（センシティブ情報は除外）
  const issuer = (inv.issuer_snapshot as Record<string, unknown>) ?? {}
  return NextResponse.json({
    invoice_no: inv.invoice_no,
    invoice_title: inv.invoice_title,
    invoice_month: inv.invoice_month,
    due_date: inv.due_date,
    total: Number(inv.total ?? inv.subtotal),
    status: inv.status,
    issuer_name: issuer.issuer_name ?? null,
    already_notified: !!inv.client_notified_at,
    client_paid_at_claimed: inv.client_paid_at_claimed ?? null,
    client_paid_amount_claimed: inv.client_paid_amount_claimed ?? null,
  })
}
