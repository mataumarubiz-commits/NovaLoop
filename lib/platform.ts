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
  qualified_invoice_enabled: boolean
  invoice_registration_number: string | null
  default_tax_mode: "exempt" | "registered_taxable"
  license_price_jpy: number
}

export const DEFAULT_PLATFORM_BILLING_SETTINGS: PlatformBillingSettings = {
  seller_name: "合同会社MataUmaru",
  seller_address: "東京都渋谷区道玄坂5-11-16",
  seller_phone: "07076184470",
  seller_email: "mataumaru.biz@gmail.com",
  bank_name: "GMOあおぞらネット銀行",
  bank_branch_name: "ビジネス支店",
  bank_branch_code: "202",
  bank_account_type: "普通",
  bank_account_number: "1103468",
  bank_account_holder: "マタウマル コウメイ",
  transfer_fee_note: "振込手数料はご負担ください。",
  qualified_invoice_enabled: false,
  invoice_registration_number: null,
  default_tax_mode: "exempt",
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

function formatJapaneseDate(date: Date | string) {
  const value = typeof date === "string" ? new Date(date) : date
  if (Number.isNaN(value.getTime())) return typeof date === "string" ? date : formatDate(value)
  return `${value.getFullYear()}年${value.getMonth() + 1}月${value.getDate()}日`
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

export function buildPlatformReceiptPath(receiptNumber: string, issueMonth?: string) {
  const month = issueMonth && /^\d{4}-\d{2}$/.test(issueMonth)
    ? issueMonth
    : (() => {
        const match = receiptNumber.match(/(\d{4})(\d{2})/)
        return match ? `${match[1]}-${match[2]}` : "unknown-month"
      })()
  return `receipts/${month}/${receiptNumber}.pdf`
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

function renderDocBase(params: { title: string; body: string }) {
  return `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(params.title)}</title>
  <style>
    @page {
      size: A4;
      margin: 0;
    }
    @media print {
      body {
        -webkit-print-color-adjust: exact;
        print-color-adjust: exact;
      }
    }
    * { box-sizing: border-box; }
    html, body {
      margin: 0;
      padding: 0;
      background: #fff;
      color: #0f172a;
      font-family: "SF Pro Display", "SF Pro Text", -apple-system, BlinkMacSystemFont, "Hiragino Sans", "Yu Gothic", sans-serif;
    }
    body {
      padding: 20mm 18mm 18mm;
      font-size: 12px;
      line-height: 1.6;
    }
    .page { display: grid; gap: 18px; }
    .eyebrow {
      margin: 0 0 8px;
      font-size: 10px;
      letter-spacing: 0.24em;
      text-transform: uppercase;
      color: #64748b;
      font-weight: 700;
    }
    .doc-title {
      margin: 0;
      font-size: 34px;
      line-height: 1.1;
      letter-spacing: -0.04em;
      font-weight: 700;
      color: #0f172a;
    }
    .meta-card {
      border: 1px solid #dbe2ea;
      border-radius: 20px;
      padding: 18px;
      background: linear-gradient(180deg, #fbfdff 0%, #f5f7fa 100%);
    }
    .meta-grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 14px 18px;
    }
    .meta-label {
      margin: 0 0 4px;
      font-size: 10px;
      letter-spacing: 0.14em;
      color: #94a3b8;
      text-transform: uppercase;
      font-weight: 700;
    }
    .meta-value {
      margin: 0;
      font-size: 13px;
      color: #0f172a;
      font-weight: 600;
    }
    .hero {
      border: 1px solid #dbe2ea;
      border-radius: 22px;
      padding: 18px 22px;
      background: linear-gradient(135deg, #ffffff 0%, #f7f9fc 55%, #eef3f8 100%);
      display: grid;
      grid-template-columns: 1fr auto;
      gap: 16px;
      align-items: end;
    }
    .hero-label {
      margin: 0 0 6px;
      font-size: 10px;
      letter-spacing: 0.18em;
      text-transform: uppercase;
      color: #64748b;
      font-weight: 700;
    }
    .hero-title {
      margin: 0;
      font-size: 15px;
      color: #0f172a;
      font-weight: 600;
    }
    .hero-subtitle {
      margin: 6px 0 0;
      color: #475569;
      font-size: 12px;
    }
    .hero-amount { text-align: right; }
    .hero-amount-value {
      margin: 0;
      font-size: 34px;
      line-height: 1;
      letter-spacing: -0.04em;
      font-weight: 700;
      color: #0f172a;
      white-space: nowrap;
    }
    .hero-amount-note {
      margin: 8px 0 0;
      color: #64748b;
      font-size: 11px;
    }
    .section-title {
      margin: 0;
      padding-bottom: 8px;
      border-bottom: 1px solid #dbe2ea;
      font-size: 11px;
      letter-spacing: 0.18em;
      text-transform: uppercase;
      color: #64748b;
      font-weight: 700;
    }
    .table {
      width: 100%;
      border-collapse: collapse;
      border: 1px solid #e5e7eb;
      border-radius: 16px;
      overflow: hidden;
    }
    .table thead th {
      background: #f8fafc;
      color: #475569;
      font-size: 11px;
      font-weight: 700;
      padding: 12px 14px;
      text-align: left;
      border-bottom: 1px solid #e5e7eb;
    }
    .table thead th.num, .table tbody td.num { text-align: right; }
    .table tbody td {
      padding: 13px 14px;
      border-bottom: 1px solid #edf2f7;
      color: #0f172a;
      vertical-align: top;
      background: #fff;
    }
    .table tbody tr:last-child td { border-bottom: none; }
    .table tbody td.amount { font-weight: 700; white-space: nowrap; }
    .grid-2 {
      display: grid;
      grid-template-columns: minmax(0, 1.1fr) minmax(280px, 0.9fr);
      gap: 18px;
      align-items: start;
    }
    .panel {
      border: 1px solid #e5e7eb;
      border-radius: 18px;
      padding: 16px 18px;
      background: #fff;
    }
    .panel.soft { background: #f8fafc; }
    .panel-title {
      margin: 0 0 10px;
      font-size: 12px;
      font-weight: 700;
      color: #0f172a;
    }
    .panel-copy {
      margin: 0;
      color: #475569;
      font-size: 12px;
    }
    .kv {
      display: grid;
      grid-template-columns: 110px 1fr;
      gap: 8px;
      align-items: start;
      margin-top: 8px;
    }
    .kv:first-child { margin-top: 0; }
    .kv-label { color: #64748b; font-size: 11px; }
    .kv-value { color: #0f172a; font-weight: 600; word-break: break-word; }
    .totals {
      display: grid;
      gap: 10px;
    }
    .total-row {
      display: flex;
      justify-content: space-between;
      gap: 16px;
      align-items: center;
      font-size: 12px;
      color: #334155;
    }
    .total-row strong {
      color: #0f172a;
      font-size: 13px;
    }
    .total-row.final {
      margin-top: 2px;
      padding-top: 12px;
      border-top: 1px solid #dbe2ea;
      font-size: 13px;
      font-weight: 700;
    }
    .total-row.final strong {
      font-size: 24px;
      letter-spacing: -0.03em;
    }
    .footer {
      display: flex;
      justify-content: space-between;
      gap: 12px;
      align-items: center;
      padding-top: 10px;
      border-top: 1px solid #e5e7eb;
      font-size: 10.5px;
      color: #94a3b8;
    }
  </style>
</head>
<body>
  <div class="page">
    ${params.body}
  </div>
</body>
</html>`
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
  const recipientLine = params.companyName?.trim()
    ? `${params.companyName.trim()} / ${params.recipientName}`
    : params.recipientName

  const body = `
    <section style="display:grid;grid-template-columns:1.1fr 0.9fr;gap:28px;align-items:start">
      <div>
        <p class="eyebrow">ライセンス請求書</p>
        <h1 class="doc-title">請求書</h1>
        <div style="margin-top:22px;padding-top:16px;border-top:1px solid #d1d5db">
          <p style="margin:0 0 6px;font-size:10px;letter-spacing:0.16em;color:#9ca3af;font-weight:700">御請求先</p>
          <p style="margin:0;font-size:21px;line-height:1.35;font-weight:600;color:#111827">${escapeHtml(recipientLine)} 御中</p>
          <p style="margin:8px 0 0;color:#4b5563">NovaLoop 利用ライセンス購入のご請求です。下記の通りお支払いをお願いいたします。</p>
        </div>
      </div>
      <div class="meta-card">
        <div class="meta-grid">
          <div>
            <p class="meta-label">請求書番号</p>
            <p class="meta-value">${escapeHtml(params.invoiceNumber)}</p>
          </div>
          <div>
            <p class="meta-label">申請番号</p>
            <p class="meta-value">${escapeHtml(params.requestNumber)}</p>
          </div>
          <div>
            <p class="meta-label">発行日</p>
            <p class="meta-value">${escapeHtml(formatJapaneseDate(params.issueDate))}</p>
          </div>
          <div>
            <p class="meta-label">支払期日</p>
            <p class="meta-value">${escapeHtml(formatJapaneseDate(params.dueDate))}</p>
          </div>
          <div style="grid-column:1 / -1">
            <p class="meta-label">件名</p>
            <p class="meta-value">新規組織作成ライセンス購入</p>
          </div>
        </div>
      </div>
    </section>

    <section class="hero">
      <div>
        <p class="hero-label">ご請求金額</p>
        <p class="hero-title">NovaLoop 利用ライセンス</p>
        <p class="hero-subtitle">お支払期日: ${escapeHtml(formatJapaneseDate(params.dueDate))}</p>
      </div>
      <div class="hero-amount">
        <p class="hero-amount-value">${escapeHtml(formatJpy(params.amountJpy))}</p>
        <p class="hero-amount-note">一度の購入で、同一 Google アカウントから新しい組織を作成できます</p>
      </div>
    </section>

    <section>
      <h2 class="section-title">請求内容</h2>
      <table class="table">
        <thead>
          <tr>
            <th>項目</th>
            <th>内容</th>
            <th class="num">金額</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td style="font-weight:700">NovaLoop 利用ライセンス</td>
            <td>
              新規組織作成ライセンス購入
              <div style="margin-top:3px;color:#64748b;font-size:12px">申請番号: ${escapeHtml(params.requestNumber)}</div>
            </td>
            <td class="num amount">${escapeHtml(formatJpy(params.amountJpy))}</td>
          </tr>
        </tbody>
      </table>
    </section>

    <section class="grid-2">
      <div style="display:grid;gap:18px">
        <div class="panel">
          <h3 class="panel-title">お支払い情報</h3>
          <div class="kv"><div class="kv-label">金融機関</div><div class="kv-value">${escapeHtml(params.settings.bank_name)} ${escapeHtml(params.settings.bank_branch_name)}</div></div>
          <div class="kv"><div class="kv-label">支店コード</div><div class="kv-value">${escapeHtml(params.settings.bank_branch_code)}</div></div>
          <div class="kv"><div class="kv-label">口座種別 / 番号</div><div class="kv-value">${escapeHtml(params.settings.bank_account_type)} / ${escapeHtml(params.settings.bank_account_number)}</div></div>
          <div class="kv"><div class="kv-label">口座名義</div><div class="kv-value">${escapeHtml(params.settings.bank_account_holder)}</div></div>
          <div class="kv"><div class="kv-label">振込識別子</div><div class="kv-value">${escapeHtml(params.transferReference)}</div></div>
          <div style="margin-top:10px;color:#475569;font-size:12px">${escapeHtml(params.settings.transfer_fee_note)}</div>
        </div>

        <div class="panel soft">
          <h3 class="panel-title">振込後のお願い</h3>
          <p class="panel-copy">振込完了後は、振込案内ページから振込日・振込金額・振込名義をご連絡ください。入金確認後にライセンスが有効化されます。</p>
        </div>
      </div>

      <div style="display:grid;gap:18px">
        <div class="panel">
          <h3 class="panel-title">ご請求金額</h3>
          <div class="totals">
            <div class="total-row">
              <span>小計</span>
              <strong>${escapeHtml(formatJpy(params.amountJpy))}</strong>
            </div>
            <div class="total-row">
              <span>消費税</span>
              <strong>免税</strong>
            </div>
            <div class="total-row final">
              <span>合計請求額</span>
              <strong>${escapeHtml(formatJpy(params.amountJpy))}</strong>
            </div>
          </div>
        </div>

        <div class="panel soft">
          <h3 class="panel-title">発行元</h3>
          <div class="kv"><div class="kv-label">会社名</div><div class="kv-value">${escapeHtml(params.settings.seller_name)}</div></div>
          <div class="kv"><div class="kv-label">所在地</div><div class="kv-value">${escapeHtml(params.settings.seller_address)}</div></div>
          <div class="kv"><div class="kv-label">連絡先</div><div class="kv-value">${escapeHtml(params.settings.seller_phone)} / ${escapeHtml(params.settings.seller_email)}</div></div>
          <div class="kv"><div class="kv-label">登録番号</div><div class="kv-value">${escapeHtml(params.settings.invoice_registration_number ?? "なし")}</div></div>
        </div>
      </div>
    </section>

    <footer class="footer">
      <span>${escapeHtml(params.invoiceNumber)}</span>
      <span>お支払期日 ${escapeHtml(formatJapaneseDate(params.dueDate))}</span>
    </footer>
  `

  return renderDocBase({
    title: params.invoiceNumber,
    body,
  })
}

export function renderPlatformReceiptHtml(params: {
  settings: PlatformBillingSettings
  receiptNumber: string
  invoiceNumber: string
  issueDate: string
  paidAt: string
  recipientName: string
  companyName?: string | null
  billingEmail?: string | null
  billingAddress?: string | null
  amountJpy: number
  subtotalAmount?: number
  taxAmount?: number
  taxMode?: "exempt" | "registered_taxable"
  taxRateBreakdown?: Array<{
    label?: string | null
    tax_rate?: number | null
    taxable_amount?: number | null
    tax_amount?: number | null
  }>
  payerNote?: string | null
  paymentReference?: string | null
  serviceTitle?: string | null
  serviceDescription?: string | null
  qualifiedInvoiceEnabled?: boolean
  qualifiedInvoiceRegistrationNumber?: string | null
}) {
  const recipientLine = params.companyName?.trim()
    ? `${params.companyName.trim()} / ${params.recipientName}`
    : params.recipientName
  const subtotalAmount = Number(params.subtotalAmount ?? params.amountJpy)
  const taxAmount = Number(params.taxAmount ?? 0)
  const taxMode = params.taxMode ?? params.settings.default_tax_mode
  const serviceTitle = params.serviceTitle?.trim() || "NovaLoop 利用ライセンス"
  const serviceDescription = params.serviceDescription?.trim() || "新規組織作成ライセンス購入"
  const qualifiedRegistrationNumber =
    params.qualifiedInvoiceRegistrationNumber?.trim() ||
    params.settings.invoice_registration_number ||
    null
  const qualifiedEnabled =
    params.qualifiedInvoiceEnabled === true &&
    Boolean(qualifiedRegistrationNumber?.trim()) &&
    params.settings.qualified_invoice_enabled === true
  const taxBreakdown = Array.isArray(params.taxRateBreakdown) ? params.taxRateBreakdown : []

  const body = `
    <section style="display:grid;grid-template-columns:1.1fr 0.9fr;gap:28px;align-items:start">
      <div>
        <p class="eyebrow">ライセンス領収書</p>
        <h1 class="doc-title">領収書</h1>
        <div style="margin-top:22px;padding-top:16px;border-top:1px solid #d1d5db">
          <p style="margin:0 0 6px;font-size:10px;letter-spacing:0.16em;color:#9ca3af;font-weight:700">宛先</p>
          <p style="margin:0;font-size:21px;line-height:1.35;font-weight:600;color:#111827">${escapeHtml(recipientLine)} 御中</p>
          <p style="margin:8px 0 0;color:#4b5563">下記金額を ${escapeHtml(serviceTitle)}代として正に領収いたしました。</p>
        </div>
      </div>
      <div class="meta-card">
        <div class="meta-grid">
          <div>
            <p class="meta-label">領収書番号</p>
            <p class="meta-value">${escapeHtml(params.receiptNumber)}</p>
          </div>
          <div>
            <p class="meta-label">請求書番号</p>
            <p class="meta-value">${escapeHtml(params.invoiceNumber)}</p>
          </div>
          <div>
            <p class="meta-label">発行日</p>
            <p class="meta-value">${escapeHtml(formatJapaneseDate(params.issueDate))}</p>
          </div>
          <div>
            <p class="meta-label">入金日</p>
            <p class="meta-value">${escapeHtml(formatJapaneseDate(params.paidAt))}</p>
          </div>
        </div>
      </div>
    </section>

    <section class="hero">
      <div>
        <p class="hero-label">受領金額</p>
        <p class="hero-title">${escapeHtml(serviceTitle)}代</p>
        <p class="hero-subtitle">銀行振込にて受領</p>
      </div>
      <div class="hero-amount">
        <p class="hero-amount-value">${escapeHtml(formatJpy(params.amountJpy))}</p>
        <p class="hero-amount-note">${taxMode === "registered_taxable" ? "税区分: 適格請求書対応" : "税区分: 免税"}</p>
      </div>
    </section>

    <section>
      <h2 class="section-title">受領内容</h2>
      <table class="table">
        <thead>
          <tr>
            <th>項目</th>
            <th>内容</th>
            <th class="num">金額</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td style="font-weight:700">${escapeHtml(serviceTitle)}</td>
            <td>
              ${escapeHtml(serviceDescription)}
              <div style="margin-top:3px;color:#64748b;font-size:12px">請求書番号: ${escapeHtml(params.invoiceNumber)}</div>
              ${
                params.paymentReference?.trim()
                  ? `<div style="margin-top:3px;color:#64748b;font-size:12px">決済ID: ${escapeHtml(params.paymentReference.trim())}</div>`
                  : ""
              }
              ${
                params.payerNote?.trim()
                  ? `<div style="margin-top:3px;color:#64748b;font-size:12px">振込名義: ${escapeHtml(params.payerNote.trim())}</div>`
                  : ""
              }
            </td>
            <td class="num amount">${escapeHtml(formatJpy(params.amountJpy))}</td>
          </tr>
        </tbody>
      </table>
    </section>

    <section class="grid-2">
      <div style="display:grid;gap:18px">
        <div class="panel">
          <h3 class="panel-title">受領内容</h3>
          <div class="kv"><div class="kv-label">受領金額</div><div class="kv-value">${escapeHtml(formatJpy(params.amountJpy))}</div></div>
          <div class="kv"><div class="kv-label">小計</div><div class="kv-value">${escapeHtml(formatJpy(subtotalAmount))}</div></div>
          <div class="kv"><div class="kv-label">消費税</div><div class="kv-value">${taxMode === "registered_taxable" ? escapeHtml(formatJpy(taxAmount)) : "免税"}</div></div>
          <div class="kv"><div class="kv-label">受領日</div><div class="kv-value">${escapeHtml(formatJapaneseDate(params.paidAt))}</div></div>
          <div class="kv"><div class="kv-label">決済方法</div><div class="kv-value">銀行振込</div></div>
          ${
            params.billingEmail?.trim()
              ? `<div class="kv"><div class="kv-label">請求先メール</div><div class="kv-value">${escapeHtml(params.billingEmail.trim())}</div></div>`
              : ""
          }
          ${
            params.billingAddress?.trim()
              ? `<div class="kv"><div class="kv-label">請求先住所</div><div class="kv-value">${escapeHtml(params.billingAddress.trim())}</div></div>`
              : ""
          }
          ${
            params.payerNote?.trim()
              ? `<div class="kv"><div class="kv-label">振込名義</div><div class="kv-value">${escapeHtml(params.payerNote.trim())}</div></div>`
              : ""
          }
        </div>
      </div>

      <div style="display:grid;gap:18px">
        <div class="panel">
          <h3 class="panel-title">発行元</h3>
          <div class="kv"><div class="kv-label">会社名</div><div class="kv-value">${escapeHtml(params.settings.seller_name)}</div></div>
          <div class="kv"><div class="kv-label">所在地</div><div class="kv-value">${escapeHtml(params.settings.seller_address)}</div></div>
          <div class="kv"><div class="kv-label">連絡先</div><div class="kv-value">${escapeHtml(params.settings.seller_phone)} / ${escapeHtml(params.settings.seller_email)}</div></div>
          <div class="kv"><div class="kv-label">登録番号</div><div class="kv-value">${escapeHtml(qualifiedRegistrationNumber ?? "なし")}</div></div>
          ${
            qualifiedEnabled
              ? `<div style="margin-top:10px;padding:10px 12px;border-radius:12px;background:#f8fafc;border:1px solid #dbe2ea;color:#334155;font-size:12px">
                  適格請求書発行事業者設定が有効です。登録番号を記載しています。
                </div>`
              : `<div style="margin-top:10px;padding:10px 12px;border-radius:12px;background:#f8fafc;border:1px solid #dbe2ea;color:#475569;font-size:12px">
                  適格請求書発行事業者ではありません。
                </div>`
          }
        </div>

        <div class="panel soft">
          <h3 class="panel-title">摘要</h3>
          <p class="panel-copy">${escapeHtml(serviceTitle)}代として領収しました。本書は経費証憑としてご利用ください。</p>
          ${
            taxMode === "registered_taxable" && taxBreakdown.length > 0
              ? `<div style="margin-top:10px;display:grid;gap:6px">
                  ${taxBreakdown
                    .map((row) => {
                      const label = typeof row.label === "string" && row.label.trim()
                        ? row.label.trim()
                        : typeof row.tax_rate === "number"
                          ? `${Math.round(row.tax_rate * 100)}%`
                          : "-"
                      return `<div style="display:flex;justify-content:space-between;gap:12px;color:#475569;font-size:12px">
                        <span>${escapeHtml(label)} 対象額</span>
                        <span>${escapeHtml(formatJpy(Number(row.taxable_amount ?? 0)))}</span>
                      </div>
                      <div style="display:flex;justify-content:space-between;gap:12px;color:#475569;font-size:12px">
                        <span>${escapeHtml(label)} 消費税</span>
                        <span>${escapeHtml(formatJpy(Number(row.tax_amount ?? 0)))}</span>
                      </div>`
                    })
                    .join("")}
                </div>`
              : ""
          }
        </div>
      </div>
    </section>

    <footer class="footer">
      <span>${escapeHtml(params.receiptNumber)}</span>
      <span>${escapeHtml(formatJapaneseDate(params.issueDate))} 発行</span>
    </footer>
  `

  return renderDocBase({
    title: `領収書 ${params.receiptNumber}`,
    body,
  })
}
