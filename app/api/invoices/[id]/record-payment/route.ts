/**
 * POST /api/invoices/:id/record-payment
 *
 * 請求書に入金情報を記録する。
 * - issued 状態の請求書にのみ記録可（draft/void は不可）
 * - 入金額が請求額と異なる場合は警告を返すが保存は許可（全額・一部・過払いを区別）
 * - 冪等: 既存入金情報がある場合は上書き（payment.updated）
 * - 監査ログ: payment.recorded / payment.updated
 */
import { NextRequest, NextResponse } from "next/server"
import { createSupabaseAdmin } from "@/lib/supabaseAdmin"
import { requireAdminAuth } from "@/lib/apiAuth"
import { writeAuditLog } from "@/lib/auditLog"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

type RecordPaymentBody = {
  paid_at: string               // ISO date e.g. "2026-04-02"
  paid_amount: number
  payment_method: "bank_transfer" | "cash" | "card" | "other"
  payment_memo?: string | null  // 振込名義メモ
  payment_note?: string | null  // 備考
}

function derivePaymentStatus(
  paidAmount: number,
  totalAmount: number
): "paid" | "partial" | "overpaid" {
  const diff = paidAmount - totalAmount
  if (Math.abs(diff) < 1) return "paid"          // 1円未満の差は全額扱い
  if (diff < 0) return "partial"
  return "overpaid"
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAdminAuth(req)
  if (auth instanceof NextResponse) return auth

  const { userId, orgId } = auth
  const { id: invoiceId } = await params
  if (!invoiceId) {
    return NextResponse.json({ error: "Invoice ID required" }, { status: 400 })
  }

  let body: RecordPaymentBody
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  // ── バリデーション ────────────────────────────────────────────────
  if (!body.paid_at || !body.payment_method || body.paid_amount == null) {
    return NextResponse.json(
      { error: "paid_at、paid_amount、payment_method は必須です" },
      { status: 400 }
    )
  }
  if (typeof body.paid_amount !== "number" || body.paid_amount <= 0) {
    return NextResponse.json(
      { error: "paid_amount は正の数値で指定してください" },
      { status: 400 }
    )
  }
  const validMethods = ["bank_transfer", "cash", "card", "other"]
  if (!validMethods.includes(body.payment_method)) {
    return NextResponse.json(
      { error: `payment_method は ${validMethods.join(" / ")} のいずれかを指定してください` },
      { status: 400 }
    )
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(body.paid_at)) {
    return NextResponse.json(
      { error: "paid_at は YYYY-MM-DD 形式で指定してください" },
      { status: 400 }
    )
  }

  const admin = createSupabaseAdmin()

  // ── 請求書取得 ─────────────────────────────────────────────────────
  const { data: invoice, error: invErr } = await admin
    .from("invoices")
    .select("id, org_id, status, total, subtotal, payment_status, invoice_no")
    .eq("id", invoiceId)
    .eq("org_id", orgId)
    .maybeSingle()

  if (invErr || !invoice) {
    return NextResponse.json(
      { error: "請求書が見つからないか、アクセス権がありません" },
      { status: 404 }
    )
  }

  const inv = invoice as {
    id: string
    org_id: string
    status: string
    total: number | null
    subtotal: number
    payment_status: string
    invoice_no: string | null
  }

  // ── ステータスチェック ────────────────────────────────────────────
  if (inv.status === "draft") {
    return NextResponse.json(
      { error: "下書き状態の請求書には入金を記録できません。先に請求書を発行してください" },
      { status: 422 }
    )
  }
  if (inv.status === "void") {
    return NextResponse.json(
      { error: "無効化された請求書には入金を記録できません" },
      { status: 422 }
    )
  }

  const totalAmount = Number(inv.total ?? inv.subtotal)
  const paymentStatus = derivePaymentStatus(body.paid_amount, totalAmount)

  // ── 既存入金があるか判定（冪等用）────────────────────────────────
  const isUpdate = inv.payment_status !== "unpaid"
  const auditAction = isUpdate ? "payment.updated" : "payment.recorded"

  // ── 入金情報を保存 ────────────────────────────────────────────────
  const { error: updateErr } = await admin
    .from("invoices")
    .update({
      payment_status: paymentStatus,
      paid_at: body.paid_at,
      paid_amount: body.paid_amount,
      payment_method: body.payment_method,
      payment_memo: body.payment_memo ?? null,
      payment_note: body.payment_note ?? null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", invoiceId)
    .eq("org_id", orgId)

  if (updateErr) {
    return NextResponse.json(
      { error: `入金情報の保存に失敗しました: ${updateErr.message}` },
      { status: 500 }
    )
  }

  // ── 監査ログ ──────────────────────────────────────────────────────
  await writeAuditLog(admin, {
    org_id: orgId,
    user_id: userId,
    action: auditAction,
    resource_type: "invoice",
    resource_id: invoiceId,
    meta: {
      invoice_no: inv.invoice_no,
      paid_at: body.paid_at,
      paid_amount: body.paid_amount,
      payment_method: body.payment_method,
      payment_status: paymentStatus,
      invoice_total: totalAmount,
    },
  })

  // ── 警告メッセージ生成 ────────────────────────────────────────────
  let warning: string | null = null
  if (paymentStatus === "partial") {
    const diff = totalAmount - body.paid_amount
    warning = `請求金額（${new Intl.NumberFormat("ja-JP", { style: "currency", currency: "JPY" }).format(totalAmount)}）より ${new Intl.NumberFormat("ja-JP", { style: "currency", currency: "JPY" }).format(diff)} 少ない金額が入金されました。一部入金として記録しました。`
  } else if (paymentStatus === "overpaid") {
    const diff = body.paid_amount - totalAmount
    warning = `請求金額（${new Intl.NumberFormat("ja-JP", { style: "currency", currency: "JPY" }).format(totalAmount)}）より ${new Intl.NumberFormat("ja-JP", { style: "currency", currency: "JPY" }).format(diff)} 多い金額が入金されました。過入金として記録しました。`
  }

  return NextResponse.json({
    ok: true,
    payment_status: paymentStatus,
    warning,
    can_issue_receipt: paymentStatus === "paid" || paymentStatus === "overpaid",
  })
}
