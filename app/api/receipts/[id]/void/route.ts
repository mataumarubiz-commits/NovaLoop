/**
 * POST /api/receipts/:id/void
 *
 * 発行済み領収書を取消にする。
 * - issued → void のみ許可（draft は通常存在しないが保険として許可）
 * - void 済みは不可
 * - 取消後は invoices.latest_receipt_id をクリア
 * - 監査ログ: receipt.voided
 *
 * 再発行するには POST /api/receipts を再度呼ぶ。
 */
import { NextRequest, NextResponse } from "next/server"
import { createSupabaseAdmin } from "@/lib/supabaseAdmin"
import { requireAdminAuth } from "@/lib/apiAuth"
import { writeAuditLog } from "@/lib/auditLog"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

type VoidBody = {
  void_reason?: string | null
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAdminAuth(req)
  if (auth instanceof NextResponse) return auth
  const { userId, orgId } = auth

  const { id: receiptId } = await params
  if (!receiptId) {
    return NextResponse.json({ error: "Receipt ID required" }, { status: 400 })
  }

  let body: VoidBody = {}
  try {
    body = await req.json()
  } catch {
    // void_reason は任意なので JSON パース失敗でも続行
  }

  const admin = createSupabaseAdmin()

  const { data: receipt, error: fetchErr } = await admin
    .from("receipts")
    .select("id, org_id, status, receipt_number, invoice_id")
    .eq("id", receiptId)
    .eq("org_id", orgId)
    .maybeSingle()

  if (fetchErr || !receipt) {
    return NextResponse.json(
      { error: "領収書が見つからないか、アクセス権がありません" },
      { status: 404 }
    )
  }

  const r = receipt as {
    id: string
    org_id: string
    status: string
    receipt_number: string
    invoice_id: string | null
  }

  if (r.status === "void") {
    return NextResponse.json(
      { error: "この領収書はすでに取消済みです" },
      { status: 409 }
    )
  }

  // ── void に更新 ──────────────────────────────────────────────────
  const { error: updateErr } = await admin
    .from("receipts")
    .update({
      status: "void",
      void_reason: body.void_reason?.trim() || null,
      voided_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", receiptId)
    .eq("org_id", orgId)

  if (updateErr) {
    return NextResponse.json(
      { error: `取消処理に失敗しました: ${updateErr.message}` },
      { status: 500 }
    )
  }

  // ── invoices.latest_receipt_id をクリア（同一請求書の場合）─────
  if (r.invoice_id) {
    await admin
      .from("invoices")
      .update({ latest_receipt_id: null })
      .eq("id", r.invoice_id)
      .eq("latest_receipt_id", receiptId)
      .eq("org_id", orgId)
  }

  // ── 監査ログ ──────────────────────────────────────────────────────
  await writeAuditLog(admin, {
    org_id: orgId,
    user_id: userId,
    action: "receipt.voided",
    resource_type: "receipt",
    resource_id: receiptId,
    meta: {
      receipt_number: r.receipt_number,
      void_reason: body.void_reason ?? null,
      invoice_id: r.invoice_id,
    },
  })

  return NextResponse.json({
    ok: true,
    message: `領収書 ${r.receipt_number} を取消しました。再発行が必要な場合は新しい領収書を発行してください。`,
  })
}
