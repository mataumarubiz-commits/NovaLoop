export const PLATFORM_PRICE_JPY = 300_000
export const PLATFORM_DOCUMENT_BUCKET = "platform-documents"
export const PLATFORM_DOCUMENT_URL_EXPIRES_SECONDS = 60 * 10

export const PLATFORM_NOTIFICATION_TYPES = [
  "platform.payment_pending",
  "platform.license_activated",
  "platform.transfer_completed",
] as const

export type PlatformNotificationType = (typeof PLATFORM_NOTIFICATION_TYPES)[number]

export type CreatorEntitlementStatus = "pending_payment" | "active" | "transferred" | "revoked"
export type CreatorEntitlementGrantType = "paid" | "manual_test" | "manual_grant" | "transferred"
export type PurchaseRequestStatus = "pending_invoice" | "invoice_issued" | "paid" | "canceled"
export type PaymentRequestStatus = "issued" | "paid"
export type TransferRequestStatus = "pending" | "rejected" | "completed"

export type PlatformBillingSettings = {
  seller_name: string
  seller_address: string
  seller_phone: string
  seller_email: string
  bank_name: string
  bank_branch_name: string
  bank_branch_code: string
  bank_account_type: string
  bank_account_number: string
  bank_account_holder: string
  transfer_fee_note: string
  invoice_registration_number: string | null
  license_price_jpy: number
}

export const DEFAULT_PLATFORM_BILLING_SETTINGS: PlatformBillingSettings = {
  seller_name: "松丸煌明",
  seller_address: "埼玉県深谷市上柴町東5-11-16",
  seller_phone: "07076184470",
  seller_email: "mataumaru.biz@gmail.com",
  bank_name: "GMOあおぞらネット銀行",
  bank_branch_name: "ビジネス第二支店",
  bank_branch_code: "202",
  bank_account_type: "普通",
  bank_account_number: "1103468",
  bank_account_holder: "マツマル　コウメイ",
  transfer_fee_note: "振込手数料はお客様負担です。",
  invoice_registration_number: null,
  license_price_jpy: PLATFORM_PRICE_JPY,
}

export function formatJpy(value: number) {
  return new Intl.NumberFormat("ja-JP", {
    style: "currency",
    currency: "JPY",
    maximumFractionDigits: 0,
  }).format(value)
}

export function formatDate(date: Date | string) {
  const value = typeof date === "string" ? new Date(date) : date
  const year = value.getFullYear()
  const month = String(value.getMonth() + 1).padStart(2, "0")
  const day = String(value.getDate()).padStart(2, "0")
  return `${year}-${month}-${day}`
}

export function buildSoftDueDate(issueDate: Date | string) {
  const base = typeof issueDate === "string" ? new Date(issueDate) : new Date(issueDate)
  const due = new Date(base)
  due.setDate(due.getDate() + 7)
  return formatDate(due)
}

export function safeFileSegment(value: string) {
  return value
    .trim()
    .replace(/[/\\:*?"<>|\s]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "")
}

export function buildInvoicePdfFileName(params: {
  invoiceMonth: string
  recipientName: string
  invoiceTitle: string
}) {
  const invoiceMonth = safeFileSegment(params.invoiceMonth) || "YYYY-MM"
  const recipient = safeFileSegment(params.recipientName) || "請求先"
  const title = safeFileSegment(params.invoiceTitle) || "請求"
  return `【御請求書】${invoiceMonth}_${recipient}_${title}.pdf`
}

export function buildPlatformInvoicePath(requestNumber: string) {
  return `invoices/${requestNumber}.pdf`
}

export function buildPlatformReceiptPath(requestNumber: string) {
  return `receipts/${requestNumber}.pdf`
}

export function licenseAccessState(status: CreatorEntitlementStatus | null | undefined) {
  if (status === "active") return "can_create_org"
  if (status === "pending_payment") return "pending_payment"
  return "purchase_required"
}

export function ensureNonEmpty(value: unknown, fieldName: string) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${fieldName} is required`)
  }
  return value.trim()
}

export function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
}

export function renderPlatformInvoiceHtml(params: {
  settings: PlatformBillingSettings
  requestNumber: string
  invoiceNumber: string
  invoiceMonth: string
  issueDate: string
  dueDate: string
  recipientName: string
  companyName?: string | null
  transferReference: string
  amountJpy: number
}) {
  const companyRow = params.companyName?.trim()
    ? `<div style="display:flex;gap:12px"><dt style="min-width:120px;color:#64748b">請求先会社名</dt><dd style="margin:0">${escapeHtml(params.companyName.trim())}</dd></div>`
    : ""

  return `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(params.invoiceNumber)}</title>
  <style>
    body { font-family: sans-serif; color: #111827; margin: 0; padding: 24px; }
    .card { border: 1px solid #e5e7eb; border-radius: 16px; padding: 28px; }
    .muted { color: #64748b; }
    table { width: 100%; border-collapse: collapse; margin-top: 20px; }
    th, td { border-bottom: 1px solid #e5e7eb; padding: 10px 8px; text-align: left; }
    th:last-child, td:last-child { text-align: right; }
  </style>
</head>
<body>
  <div class="card">
    <h1 style="margin:0 0 8px;font-size:24px">請求書</h1>
    <p class="muted" style="margin:0 0 20px">${escapeHtml(params.invoiceNumber)}</p>

    <dl style="display:grid;gap:8px;margin:0 0 24px">
      <div style="display:flex;gap:12px"><dt style="min-width:120px;color:#64748b">請求書番号</dt><dd style="margin:0">${escapeHtml(params.invoiceNumber)}</dd></div>
      <div style="display:flex;gap:12px"><dt style="min-width:120px;color:#64748b">発行日</dt><dd style="margin:0">${escapeHtml(params.issueDate)}</dd></div>
      <div style="display:flex;gap:12px"><dt style="min-width:120px;color:#64748b">支払目安日</dt><dd style="margin:0">${escapeHtml(params.dueDate)}</dd></div>
      <div style="display:flex;gap:12px"><dt style="min-width:120px;color:#64748b">請求先氏名</dt><dd style="margin:0">${escapeHtml(params.recipientName)}</dd></div>
      ${companyRow}
      <div style="display:flex;gap:12px"><dt style="min-width:120px;color:#64748b">件名</dt><dd style="margin:0">新規組織作成ライセンス購入</dd></div>
    </dl>

    <table>
      <thead>
        <tr>
          <th>項目</th>
          <th>金額</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>新規組織作成ライセンス購入</td>
          <td>${escapeHtml(formatJpy(params.amountJpy))}</td>
        </tr>
      </tbody>
    </table>

    <div style="display:flex;justify-content:flex-end;gap:16px;align-items:center;margin-top:18px;font-size:18px;font-weight:700">
      <span>合計</span>
      <span>${escapeHtml(formatJpy(params.amountJpy))}</span>
    </div>

    <section style="margin-top:28px;display:grid;gap:8px">
      <h2 style="margin:0;font-size:16px">お振込先</h2>
      <div class="muted">支払方法: 銀行振込</div>
      <div>銀行名: ${escapeHtml(params.settings.bank_name)}</div>
      <div>支店名: ${escapeHtml(params.settings.bank_branch_name)}（${escapeHtml(params.settings.bank_branch_code)}）</div>
      <div>口座種別: ${escapeHtml(params.settings.bank_account_type)}</div>
      <div>口座番号: ${escapeHtml(params.settings.bank_account_number)}</div>
      <div>口座名義: ${escapeHtml(params.settings.bank_account_holder)}</div>
      <div>振込識別子: ${escapeHtml(params.transferReference)}</div>
      <div>${escapeHtml(params.settings.transfer_fee_note)}</div>
      <div>入金確認後に新規組織作成権が有効化されます。</div>
    </section>

    <section style="margin-top:28px;display:grid;gap:8px">
      <h2 style="margin:0;font-size:16px">発行者情報</h2>
      <div>発行者名: ${escapeHtml(params.settings.seller_name)}</div>
      <div>住所: ${escapeHtml(params.settings.seller_address)}</div>
      <div>電話番号: ${escapeHtml(params.settings.seller_phone)}</div>
      <div>メール: ${escapeHtml(params.settings.seller_email)}</div>
      <div>適格請求書発行事業者番号: ${escapeHtml(params.settings.invoice_registration_number ?? "なし")}</div>
    </section>
  </div>
</body>
</html>`
}

export function renderPlatformReceiptHtml(params: {
  settings: PlatformBillingSettings
  receiptNumber: string
  invoiceNumber: string
  issueDate: string
  paidAt: string
  recipientName: string
  amountJpy: number
  payerNote?: string | null
}) {
  const payerNoteRow = params.payerNote?.trim()
    ? `<div>振込名義メモ: ${escapeHtml(params.payerNote.trim())}</div>`
    : ""

  return `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(params.receiptNumber)}</title>
  <style>
    body { font-family: sans-serif; color: #111827; margin: 0; padding: 24px; }
    .card { border: 1px solid #e5e7eb; border-radius: 16px; padding: 28px; }
    .muted { color: #64748b; }
  </style>
</head>
<body>
  <div class="card">
    <h1 style="margin:0 0 8px;font-size:24px">領収書</h1>
    <p class="muted" style="margin:0 0 20px">${escapeHtml(params.receiptNumber)}</p>

    <div style="display:grid;gap:8px">
      <div>領収書番号: ${escapeHtml(params.receiptNumber)}</div>
      <div>発行日: ${escapeHtml(params.issueDate)}</div>
      <div>請求書番号: ${escapeHtml(params.invoiceNumber)}</div>
      <div>入金日: ${escapeHtml(params.paidAt)}</div>
      <div>宛名: ${escapeHtml(params.recipientName)}</div>
      <div>金額: ${escapeHtml(formatJpy(params.amountJpy))}</div>
      <div>但し書き: 新規組織作成ライセンス代として</div>
      <div>支払方法: 銀行振込</div>
      ${payerNoteRow}
    </div>

    <section style="margin-top:28px;display:grid;gap:8px">
      <h2 style="margin:0;font-size:16px">発行者情報</h2>
      <div>発行者名: ${escapeHtml(params.settings.seller_name)}</div>
      <div>住所: ${escapeHtml(params.settings.seller_address)}</div>
      <div>電話番号: ${escapeHtml(params.settings.seller_phone)}</div>
      <div>メール: ${escapeHtml(params.settings.seller_email)}</div>
      <div>適格請求書発行事業者番号: ${escapeHtml(params.settings.invoice_registration_number ?? "なし")}</div>
    </section>
  </div>
</body>
</html>`
}
