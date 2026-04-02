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
  const registrationRow = params.settings.invoice_registration_number
    ? `<tr><td style="padding:6px 0;color:#6b7280;font-size:12px">適格請求書番号</td><td style="padding:6px 0;font-size:12px">${escapeHtml(params.settings.invoice_registration_number)}</td></tr>`
    : ""

  const payerNoteRow = params.payerNote?.trim()
    ? `<tr><td style="padding:8px 12px;color:#6b7280;font-size:13px;white-space:nowrap">振込名義メモ</td><td style="padding:8px 12px;font-size:13px">${escapeHtml(params.payerNote.trim())}</td></tr>`
    : ""

  return `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="utf-8" />
  <title>領収書 ${escapeHtml(params.receiptNumber)}</title>
  <style>
    * { box-sizing: border-box; }
    body {
      font-family: "Hiragino Kaku Gothic ProN", "Hiragino Sans", "Yu Gothic", sans-serif;
      color: #1a1a1a;
      margin: 0;
      padding: 40px 48px;
      background: #fff;
      font-size: 14px;
      line-height: 1.6;
    }
    .header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      margin-bottom: 32px;
    }
    .seller-name {
      font-size: 20px;
      font-weight: 700;
      color: #111;
      letter-spacing: 0.02em;
    }
    .doc-title {
      font-size: 36px;
      font-weight: 300;
      color: #555;
      letter-spacing: 0.08em;
    }
    .info-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 0;
      border: 1px solid #d1d5db;
      border-radius: 4px;
      overflow: hidden;
      margin-bottom: 32px;
    }
    .info-cell {
      padding: 10px 16px;
      border-bottom: 1px solid #d1d5db;
    }
    .info-cell:nth-child(odd) { border-right: 1px solid #d1d5db; }
    .info-cell:nth-last-child(-n+2) { border-bottom: none; }
    .info-cell-label {
      font-size: 11px;
      color: #6b7280;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      margin-bottom: 2px;
    }
    .info-cell-value {
      font-size: 14px;
      font-weight: 500;
      color: #111;
    }
    .info-cell-value.amount {
      font-size: 22px;
      font-weight: 700;
      color: #111;
      letter-spacing: -0.01em;
    }
    .items-table {
      width: 100%;
      border-collapse: collapse;
      margin-bottom: 0;
    }
    .items-table thead tr {
      background: #f3f4f6;
    }
    .items-table th {
      padding: 10px 16px;
      text-align: left;
      font-size: 12px;
      font-weight: 600;
      color: #6b7280;
      letter-spacing: 0.04em;
      border-bottom: 1px solid #d1d5db;
    }
    .items-table th:last-child { text-align: right; }
    .items-table td {
      padding: 14px 16px;
      font-size: 14px;
      color: #111;
      border-bottom: 1px solid #e5e7eb;
      vertical-align: middle;
    }
    .items-table td:last-child { text-align: right; font-weight: 500; }
    .items-table .item-sub {
      font-size: 12px;
      color: #6b7280;
      margin-top: 2px;
    }
    .total-row {
      display: flex;
      justify-content: flex-end;
      align-items: center;
      gap: 32px;
      padding: 14px 16px;
      background: #f9fafb;
      border-top: 2px solid #d1d5db;
      border-bottom: 1px solid #d1d5db;
    }
    .total-label { font-size: 14px; color: #6b7280; font-weight: 600; }
    .total-amount { font-size: 22px; font-weight: 700; color: #111; letter-spacing: -0.01em; }
    .seller-section {
      margin-top: 40px;
      padding-top: 24px;
      border-top: 1px solid #e5e7eb;
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 24px;
    }
    .seller-section table td { padding: 6px 0; font-size: 13px; vertical-align: top; }
    .seller-section table td:first-child { color: #6b7280; white-space: nowrap; padding-right: 16px; }
    .stamp-area {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      border: 1px dashed #d1d5db;
      border-radius: 4px;
      color: #9ca3af;
      font-size: 12px;
      padding: 16px;
      min-height: 80px;
    }
  </style>
</head>
<body>
  <div class="header">
    <div class="seller-name">${escapeHtml(params.settings.seller_name)}</div>
    <div class="doc-title">領収書</div>
  </div>

  <div class="info-grid">
    <div class="info-cell">
      <div class="info-cell-label">領収書番号</div>
      <div class="info-cell-value">${escapeHtml(params.receiptNumber)}</div>
    </div>
    <div class="info-cell">
      <div class="info-cell-label">請求先</div>
      <div class="info-cell-value">${escapeHtml(params.recipientName)} 様</div>
    </div>
    <div class="info-cell">
      <div class="info-cell-label">発行日</div>
      <div class="info-cell-value">${escapeHtml(params.issueDate)}</div>
    </div>
    <div class="info-cell">
      <div class="info-cell-label">合計</div>
      <div class="info-cell-value amount">${escapeHtml(formatJpy(params.amountJpy))}</div>
    </div>
    <div class="info-cell">
      <div class="info-cell-label">入金日</div>
      <div class="info-cell-value">${escapeHtml(params.paidAt)}</div>
    </div>
    <div class="info-cell">
      <div class="info-cell-label">支払方法</div>
      <div class="info-cell-value">銀行振込</div>
    </div>
    <div class="info-cell" style="border-bottom:none">
      <div class="info-cell-label">請求書番号</div>
      <div class="info-cell-value">${escapeHtml(params.invoiceNumber)}</div>
    </div>
    <div class="info-cell" style="border-bottom:none">
      <div class="info-cell-label">但し書き</div>
      <div class="info-cell-value">新規組織作成ライセンス代として</div>
    </div>
  </div>

  <table class="items-table">
    <thead>
      <tr>
        <th>品目</th>
        <th>種類</th>
        <th>金額</th>
      </tr>
    </thead>
    <tbody>
      <tr>
        <td>
          新規組織作成ライセンス
          <div class="item-sub">NovaLoop</div>
        </td>
        <td style="color:#6b7280">ライセンス購入</td>
        <td>${escapeHtml(formatJpy(params.amountJpy))}</td>
      </tr>
      ${payerNoteRow}
    </tbody>
  </table>
  <div class="total-row">
    <span class="total-label">合計</span>
    <span class="total-amount">${escapeHtml(formatJpy(params.amountJpy))}</span>
  </div>

  <div class="seller-section">
    <table>
      <tbody>
        <tr><td>発行者名</td><td>${escapeHtml(params.settings.seller_name)}</td></tr>
        <tr><td>住所</td><td>${escapeHtml(params.settings.seller_address)}</td></tr>
        <tr><td>電話番号</td><td>${escapeHtml(params.settings.seller_phone)}</td></tr>
        <tr><td>メール</td><td>${escapeHtml(params.settings.seller_email)}</td></tr>
        ${registrationRow}
      </tbody>
    </table>
    <div class="stamp-area">印</div>
  </div>
</body>
</html>`
}
