/**
 * GET  /api/receipts/:id/pdf  - 既存PDFの署名URL取得
 * POST /api/receipts/:id/pdf  - PDF再生成（PDF破損時リカバリ用）
 */
import { NextRequest, NextResponse } from "next/server"
import { createSupabaseAdmin } from "@/lib/supabaseAdmin"
import { requireAdminAuth } from "@/lib/apiAuth"
import { writeAuditLog } from "@/lib/auditLog"
import { renderReceiptHtml } from "@/lib/pdf/renderReceiptHtml"
import type { ReceiptLineForPdf, TaxBreakdownItem, IssuerSnapshot } from "@/lib/pdf/renderReceiptHtml"
import { renderPdfBuffer } from "@/lib/platformDocuments"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const RECEIPT_BUCKET = "invoices"
const SIGNED_URL_EXPIRES = 60 * 10  // 10分

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAdminAuth(req)
  if (auth instanceof NextResponse) return auth
  const { userId, orgId } = auth

  const { id: receiptId } = await params
  const admin = createSupabaseAdmin()

  const { data: receipt, error } = await admin
    .from("receipts")
    .select("id, receipt_number, pdf_path, status, org_id")
    .eq("id", receiptId)
    .eq("org_id", orgId)
    .maybeSingle()

  if (error || !receipt) {
    return NextResponse.json({ error: "領収書が見つかりません" }, { status: 404 })
  }

  const r = receipt as { id: string; receipt_number: string; pdf_path: string | null; status: string }

  if (!r.pdf_path) {
    return NextResponse.json({ error: "PDF がまだ生成されていません" }, { status: 404 })
  }

  const { data: signed, error: signErr } = await admin.storage
    .from(RECEIPT_BUCKET)
    .createSignedUrl(r.pdf_path, SIGNED_URL_EXPIRES, {
      download: `領収書_${r.receipt_number}.pdf`,
    })

  if (signErr || !signed?.signedUrl) {
    return NextResponse.json({ error: "署名URLの生成に失敗しました" }, { status: 500 })
  }

  // 監査ログ
  await writeAuditLog(admin, {
    org_id: orgId,
    user_id: userId,
    action: "receipt.downloaded",
    resource_type: "receipt",
    resource_id: receiptId,
    meta: { receipt_number: r.receipt_number },
  })

  return NextResponse.json({ signed_url: signed.signedUrl })
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAdminAuth(req)
  if (auth instanceof NextResponse) return auth
  const { userId, orgId } = auth

  const { id: receiptId } = await params
  const admin = createSupabaseAdmin()

  const { data: receiptRaw, error } = await admin
    .from("receipts")
    .select("*, receipt_lines(id, description, quantity, unit_price, amount, tax_rate, sort_order)")
    .eq("id", receiptId)
    .eq("org_id", orgId)
    .maybeSingle()

  if (error || !receiptRaw) {
    return NextResponse.json({ error: "領収書が見つかりません" }, { status: 404 })
  }

  const r = receiptRaw as Record<string, unknown> & {
    receipt_lines?: ReceiptLineForPdf[]
  }

  if (r.status === "void") {
    return NextResponse.json({ error: "取消済みの領収書は再生成できません" }, { status: 422 })
  }

  const lines: ReceiptLineForPdf[] = ((r.receipt_lines ?? []) as Record<string, unknown>[]).map(
    (l) => ({
      description: String(l.description ?? "-"),
      quantity: Number(l.quantity ?? 1),
      unit_price: Number(l.unit_price ?? 0),
      amount: Number(l.amount ?? 0),
      tax_rate: l.tax_rate != null ? Number(l.tax_rate) : null,
      sort_order: Number(l.sort_order ?? 1),
    })
  )

  const html = renderReceiptHtml({
    receipt_number: String(r.receipt_number),
    issue_date: String(r.issue_date),
    paid_at: String(r.paid_at),
    payment_method: String(r.payment_method ?? "bank_transfer"),
    payer_note: r.payer_note as string | null,
    recipient_name: String(r.recipient_name ?? ""),
    subtotal_amount: Number(r.subtotal_amount ?? 0),
    tax_amount: Number(r.tax_amount ?? 0),
    total_amount: Number(r.total_amount ?? 0),
    tax_breakdown_json: (r.tax_breakdown_json as TaxBreakdownItem[]) ?? [],
    tax_mode: String(r.tax_mode ?? "exempt"),
    issuer_snapshot: (r.issuer_snapshot as IssuerSnapshot) ?? {},
    note: r.note as string | null,
    is_reissue: Boolean(r.is_reissue),
    invoice_no: null,  // 再生成時は invoice_no を別途取得しない（既存 PDF と同等）
    title: r.title as string | null,
    lines,
  })

  const pdfPath = r.pdf_path as string | null
  const storagePath =
    pdfPath ??
    `receipts/${orgId}/${String(r.issue_date).slice(0, 7)}/${receiptId}.pdf`

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
    .upload(storagePath, pdfBuffer, { upsert: true, contentType: "application/pdf" })

  if (uploadErr) {
    return NextResponse.json({ error: `PDF保存に失敗しました: ${uploadErr.message}` }, { status: 500 })
  }

  if (!pdfPath) {
    await admin.from("receipts").update({ pdf_path: storagePath }).eq("id", receiptId)
  }

  const { data: signed } = await admin.storage
    .from(RECEIPT_BUCKET)
    .createSignedUrl(storagePath, SIGNED_URL_EXPIRES, {
      download: `領収書_${r.receipt_number}.pdf`,
    })

  await writeAuditLog(admin, {
    org_id: orgId,
    user_id: userId,
    action: "receipt.pdf_generate",
    resource_type: "receipt",
    resource_id: receiptId,
    meta: { receipt_number: r.receipt_number, pdf_path: storagePath },
  })

  return NextResponse.json({ pdf_path: storagePath, signed_url: signed?.signedUrl ?? null })
}
