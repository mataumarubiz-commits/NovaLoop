/**
 * GET  /api/receipts  - 領収書一覧
 * POST /api/receipts  - 領収書発行（入金確認後のみ）
 */
import { NextRequest, NextResponse } from "next/server"
import { createSupabaseAdmin } from "@/lib/supabaseAdmin"
import { requireAdminAuth } from "@/lib/apiAuth"
import { writeAuditLog } from "@/lib/auditLog"
import { renderReceiptHtml } from "@/lib/pdf/renderReceiptHtml"
import type { TaxBreakdownItem, IssuerSnapshot, ReceiptLineForPdf } from "@/lib/pdf/renderReceiptHtml"
import { renderPdfBuffer } from "@/lib/platformDocuments"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const RECEIPT_BUCKET = "invoices"

// ────────────────────────────────────────────────────────────────────────────
// GET: 一覧
// ────────────────────────────────────────────────────────────────────────────
export async function GET(req: NextRequest) {
  const auth = await requireAdminAuth(req)
  if (auth instanceof NextResponse) return auth
  const { orgId } = auth

  const url = new URL(req.url)
  const status = url.searchParams.get("status")
  const invoiceId = url.searchParams.get("invoice_id")
  const limit = Math.min(Number(url.searchParams.get("limit") ?? "50"), 200)
  const offset = Number(url.searchParams.get("offset") ?? "0")

  const admin = createSupabaseAdmin()
  let query = admin
    .from("receipts")
    .select(
      "id, receipt_number, title, issue_date, paid_at, payment_method, recipient_name, total_amount, tax_mode, status, is_reissue, invoice_id, pdf_path, created_at"
    )
    .eq("org_id", orgId)
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1)

  if (status) query = query.eq("status", status)
  if (invoiceId) query = query.eq("invoice_id", invoiceId)

  const { data, error } = await query
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ receipts: data ?? [] })
}

// ────────────────────────────────────────────────────────────────────────────
// POST: 発行
// ────────────────────────────────────────────────────────────────────────────
type CreateReceiptBody = {
  invoice_id: string
  issue_date?: string           // 省略時: today
  note?: string | null
  title?: string | null         // 但し書き override
}

export async function POST(req: NextRequest) {
  const auth = await requireAdminAuth(req)
  if (auth instanceof NextResponse) return auth
  const { userId, orgId } = auth

  let body: CreateReceiptBody
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  if (!body.invoice_id) {
    return NextResponse.json({ error: "invoice_id は必須です" }, { status: 400 })
  }

  const admin = createSupabaseAdmin()

  // ── 請求書取得 ──────────────────────────────────────────────────────
  const { data: invoice, error: invErr } = await admin
    .from("invoices")
    .select(
      "id, org_id, status, payment_status, paid_at, paid_amount, payment_method, payment_memo, total, subtotal, tax_mode, tax_rate, tax_amount, invoice_no, invoice_title, invoice_month, guest_client_name, guest_company_name, issuer_snapshot, clients(name)"
    )
    .eq("id", body.invoice_id)
    .eq("org_id", orgId)
    .maybeSingle()

  if (invErr || !invoice) {
    return NextResponse.json(
      { error: "請求書が見つからないか、アクセス権がありません" },
      { status: 404 }
    )
  }

  const inv = invoice as Record<string, unknown> & {
    clients?: { name?: string } | null
  }

  // ── 入金チェック（最重要ガード）─────────────────────────────────────
  if (inv.payment_status === "unpaid") {
    return NextResponse.json(
      { error: "まだ入金が記録されていないため領収書を発行できません。先に「入金を記録」を行ってください" },
      { status: 422 }
    )
  }
  if (inv.payment_status === "partial") {
    return NextResponse.json(
      { error: "一部入金のため、全額入金が確認されるまで領収書を発行できません" },
      { status: 422 }
    )
  }
  if (inv.status === "draft") {
    return NextResponse.json(
      { error: "下書き状態の請求書には領収書を発行できません" },
      { status: 422 }
    )
  }
  if (inv.status === "void") {
    return NextResponse.json(
      { error: "無効化された請求書には領収書を発行できません" },
      { status: 422 }
    )
  }

  // ── 重複チェック（同一請求書に対してvoid以外の領収書が既に存在するか）──
  const { data: existingReceipts } = await admin
    .from("receipts")
    .select("id, receipt_number, status")
    .eq("invoice_id", body.invoice_id)
    .eq("org_id", orgId)
    .neq("status", "void")

  if (existingReceipts && existingReceipts.length > 0) {
    const existing = existingReceipts[0] as { id: string; receipt_number: string }
    return NextResponse.json(
      {
        error: `この請求書にはすでに領収書（${existing.receipt_number}）が発行されています。修正が必要な場合は既存の領収書を取消してから再発行してください`,
        existing_receipt_id: existing.id,
      },
      { status: 409 }
    )
  }

  // ── 請求明細取得 ──────────────────────────────────────────────────
  const { data: invoiceLines } = await admin
    .from("invoice_lines")
    .select("id, description, quantity, unit_price, amount, sort_order")
    .eq("invoice_id", body.invoice_id)
    .order("sort_order", { ascending: true })

  const lines = (invoiceLines ?? []) as {
    id: string
    description: string | null
    quantity: number
    unit_price: number
    amount: number
    sort_order: number
  }[]

  // ── org_settings 取得（発行者情報・税区分）───────────────────────
  const { data: orgSettings } = await admin
    .from("org_settings")
    .select(
      "issuer_name, issuer_address, issuer_zip, issuer_phone, issuer_email, issuer_registration_number, tax_mode"
    )
    .eq("org_id", orgId)
    .maybeSingle()

  const settings = (orgSettings ?? {}) as {
    issuer_name?: string | null
    issuer_address?: string | null
    issuer_zip?: string | null
    issuer_phone?: string | null
    issuer_email?: string | null
    issuer_registration_number?: string | null
    tax_mode?: string | null
  }

  // issuer_snapshot: 請求書側スナップショット優先、なければ org_settings
  const invIssuer = (inv.issuer_snapshot as Record<string, unknown>) ?? {}
  const issuerSnapshot: IssuerSnapshot = {
    issuer_name: (invIssuer.issuer_name as string) || settings.issuer_name || null,
    issuer_address: (invIssuer.issuer_address as string) || settings.issuer_address || null,
    issuer_zip: (invIssuer.issuer_zip as string) || settings.issuer_zip || null,
    issuer_phone: (invIssuer.issuer_phone as string) || settings.issuer_phone || null,
    issuer_email: (invIssuer.issuer_email as string) || settings.issuer_email || null,
    issuer_registration_number:
      (invIssuer.issuer_registration_number as string) ||
      settings.issuer_registration_number ||
      null,
    tax_mode: settings.tax_mode ?? "exempt",
  }

  // ── 税モード決定 ──────────────────────────────────────────────────
  // org_settings.tax_mode が registered_taxable かつ登録番号あり → 適格
  // それ以外は一律 exempt
  const orgTaxMode = settings.tax_mode ?? "exempt"
  const receiptTaxMode =
    orgTaxMode === "registered_taxable" && !!issuerSnapshot.issuer_registration_number
      ? "registered_taxable"
      : "exempt"

  // ── 税内訳計算 ────────────────────────────────────────────────────
  const subtotalAmount = Number(inv.subtotal ?? 0)
  const taxAmount = Number(inv.tax_amount ?? 0)
  const totalAmount = Number(inv.total ?? subtotalAmount)

  let taxBreakdown: TaxBreakdownItem[] = []
  if (receiptTaxMode === "registered_taxable" && taxAmount > 0) {
    const taxRate = Number(inv.tax_rate ?? 0)
    if (taxRate > 0) {
      taxBreakdown = [
        {
          tax_rate: taxRate / 100,
          subtotal: subtotalAmount,
          tax_amount: taxAmount,
        },
      ]
    }
  }

  // ── 宛名解決 ─────────────────────────────────────────────────────
  const recipientName =
    (inv.guest_company_name as string)?.trim() ||
    (inv.guest_client_name as string)?.trim() ||
    inv.clients?.name?.trim() ||
    "（宛名未設定）"

  // ── 領収書番号採番（DB トランザクション内） ──────────────────────
  const { data: receiptNumberData, error: seqErr } = await admin.rpc(
    "allocate_receipt_number",
    { p_org_id: orgId }
  )
  if (seqErr || !receiptNumberData) {
    return NextResponse.json(
      { error: `領収書番号の採番に失敗しました: ${seqErr?.message ?? "unknown"}` },
      { status: 500 }
    )
  }
  const receiptNumber = receiptNumberData as string

  const issueDate = body.issue_date ?? new Date().toISOString().slice(0, 10)
  const paidAt = (inv.paid_at as string) ?? issueDate
  const invoiceNo = (inv.invoice_no as string) ?? null

  // ── receipt_lines 構築 ───────────────────────────────────────────
  const receiptLinesData: ReceiptLineForPdf[] = lines.map((l, i) => ({
    description: l.description ?? "-",
    quantity: Number(l.quantity),
    unit_price: Number(l.unit_price),
    amount: Number(l.amount),
    sort_order: l.sort_order ?? i + 1,
  }))

  // ── PDF レンダリング ──────────────────────────────────────────────
  const html = renderReceiptHtml({
    receipt_number: receiptNumber,
    issue_date: issueDate,
    paid_at: paidAt,
    payment_method: (inv.payment_method as string) ?? "bank_transfer",
    payer_note: (inv.payment_memo as string) ?? null,
    recipient_name: recipientName,
    subtotal_amount: subtotalAmount,
    tax_amount: taxAmount,
    total_amount: totalAmount,
    tax_breakdown_json: taxBreakdown,
    tax_mode: receiptTaxMode,
    issuer_snapshot: issuerSnapshot,
    note: body.note ?? null,
    is_reissue: false,
    invoice_no: invoiceNo,
    title: body.title ?? null,
    lines: receiptLinesData,
  })

  // ── 仮 receipt ID を生成して PDF パス決定 ─────────────────────────
  const tempReceiptId = crypto.randomUUID()
  const pdfMonth = issueDate.slice(0, 7)           // YYYY-MM
  const pdfPath = `receipts/${orgId}/${pdfMonth}/${tempReceiptId}.pdf`

  let pdfBuffer: Uint8Array
  try {
    pdfBuffer = await renderPdfBuffer(html)
  } catch (e) {
    return NextResponse.json(
      { error: `PDF生成に失敗しました: ${e instanceof Error ? e.message : String(e)}` },
      { status: 500 }
    )
  }

  const { error: uploadErr } = await admin.storage
    .from(RECEIPT_BUCKET)
    .upload(pdfPath, pdfBuffer, { upsert: true, contentType: "application/pdf" })

  if (uploadErr) {
    return NextResponse.json(
      { error: `PDF保存に失敗しました: ${uploadErr.message}` },
      { status: 500 }
    )
  }

  // ── receipts 行挿入 ──────────────────────────────────────────────
  const { data: receiptRow, error: insertErr } = await admin
    .from("receipts")
    .insert({
      id: tempReceiptId,
      org_id: orgId,
      invoice_id: body.invoice_id,
      receipt_number: receiptNumber,
      title: body.title ?? "",
      issue_date: issueDate,
      paid_at: paidAt,
      payment_method: (inv.payment_method as string) ?? "bank_transfer",
      payer_note: (inv.payment_memo as string) ?? null,
      recipient_name: recipientName,
      subtotal_amount: subtotalAmount,
      tax_amount: taxAmount,
      total_amount: totalAmount,
      tax_breakdown_json: taxBreakdown,
      tax_mode: receiptTaxMode,
      issuer_snapshot: issuerSnapshot,
      note: body.note ?? null,
      pdf_path: pdfPath,
      status: "issued",
      is_reissue: false,
      created_by_user_id: userId,
    })
    .select("id, receipt_number, status, pdf_path")
    .single()

  if (insertErr || !receiptRow) {
    // ロールバック: アップロードしたPDFを削除
    await admin.storage.from(RECEIPT_BUCKET).remove([pdfPath]).catch(() => {})
    return NextResponse.json(
      { error: `領収書の保存に失敗しました: ${insertErr?.message ?? "unknown"}` },
      { status: 500 }
    )
  }

  // ── invoices.latest_receipt_id を更新 ───────────────────────────
  await admin
    .from("invoices")
    .update({ latest_receipt_id: tempReceiptId })
    .eq("id", body.invoice_id)
    .eq("org_id", orgId)

  // ── 監査ログ ─────────────────────────────────────────────────────
  await writeAuditLog(admin, {
    org_id: orgId,
    user_id: userId,
    action: "receipt.created",
    resource_type: "receipt",
    resource_id: tempReceiptId,
    meta: {
      receipt_number: receiptNumber,
      invoice_id: body.invoice_id,
      invoice_no: invoiceNo,
      total_amount: totalAmount,
      tax_mode: receiptTaxMode,
    },
  })
  await writeAuditLog(admin, {
    org_id: orgId,
    user_id: userId,
    action: "receipt.issued",
    resource_type: "receipt",
    resource_id: tempReceiptId,
    meta: { receipt_number: receiptNumber },
  })

  return NextResponse.json(
    {
      ok: true,
      receipt: receiptRow,
    },
    { status: 201 }
  )
}
