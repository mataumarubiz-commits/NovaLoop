export type InvoiceForPdf = {
  id: string
  org_id: string
  invoice_title: string | null
  invoice_name?: string | null
  invoice_no?: string | null
  invoice_month: string
  issue_date: string
  due_date: string
  subtotal: number
  total?: number | null
  tax_mode?: string | null
  tax_rate?: number | null
  tax_amount?: number | null
  withholding_enabled?: boolean | null
  withholding_amount?: number | null
  issuer_snapshot?: Record<string, unknown> | null
  bank_snapshot?: Record<string, unknown> | null
  notes?: string | null
  public_token?: string | null
}

export type ClientForPdf = {
  name: string
  billing_name?: string | null
  contact_name?: string | null
}

export type InvoiceLineForPdf = {
  id: string
  quantity: number
  unit_price: number
  amount: number
  description: string | null
  project_name?: string | null
  title?: string | null
  sort_order?: number
}

export type OrgForPdf = {
  name?: string | null
}

function esc(value: string | number | null | undefined): string {
  if (value == null) return ""
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
}

function fmtNum(value: number): string {
  return new Intl.NumberFormat("ja-JP", { maximumFractionDigits: 0 }).format(value)
}

function fmtCur(value: number): string {
  return new Intl.NumberFormat("ja-JP", {
    style: "currency",
    currency: "JPY",
    maximumFractionDigits: 0,
  }).format(value)
}

function fmtDate(value: string): string {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!match) return value
  return `${match[1]}年${Number(match[2])}月${Number(match[3])}日`
}

function compactLine(parts: Array<string | null | undefined>): string {
  return parts.filter(Boolean).join(" ")
}

export function renderInvoiceHtml(params: {
  invoice: InvoiceForPdf
  client: ClientForPdf
  org?: OrgForPdf | null
  lines: InvoiceLineForPdf[]
  appUrl?: string | null
}): string {
  const { invoice, client, lines, appUrl } = params
  const recipientCompany = client.billing_name?.trim() || client.name?.trim() || "請求先"
  const recipientContact = client.contact_name?.trim() || null

  const issuer = (invoice.issuer_snapshot ?? {}) as Record<string, unknown>
  const issuerName = String(issuer.issuer_name ?? "")
  const issuerZip = issuer.issuer_zip ? String(issuer.issuer_zip) : ""
  const issuerAddress = String(issuer.issuer_address ?? "")
  const issuerPhone = issuer.issuer_phone ? String(issuer.issuer_phone) : ""
  const issuerEmail = issuer.issuer_email ? String(issuer.issuer_email) : ""
  const issuerRegistrationNumber = issuer.issuer_registration_number
    ? String(issuer.issuer_registration_number)
    : ""

  const bank = (invoice.bank_snapshot ?? {}) as Record<string, unknown>
  const bankName = String(bank.bank_name ?? "")
  const branchName = String(bank.branch_name ?? "")
  const accountType = String(bank.account_type ?? "")
  const accountNumber = String(bank.account_number ?? "")
  const accountHolder = String(bank.account_holder ?? "")
  const depositorCode = String(bank.depositor_code ?? "")
  const hasBankInfo = Boolean(bankName || branchName || accountType || accountNumber || accountHolder)

  const subtotal = Number(invoice.subtotal ?? 0)
  const total = Number(invoice.total ?? subtotal)
  const withholdingAmount = Number(invoice.withholding_amount ?? 0)
  const withholdingEnabled = Boolean(invoice.withholding_enabled && withholdingAmount > 0)

  const sortedLines = [...lines].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
  const lineItems = sortedLines.length > 0
    ? sortedLines
    : [{ id: "empty", quantity: 0, unit_price: 0, amount: 0, description: "明細はありません", sort_order: 0 }]

  const lineRows = lineItems
    .map((line) => {
      const itemLabel = line.project_name?.trim() || line.description?.trim() || "-"
      const detailLabel = line.title?.trim() || line.description?.trim() || "-"
      const isEmpty = line.id === "empty"
      return `
        <tr>
          <td class="cell item">${esc(itemLabel)}</td>
          <td class="cell detail">${esc(detailLabel)}</td>
          <td class="cell num">${isEmpty ? "-" : esc(fmtNum(Number(line.quantity ?? 0)))}</td>
          <td class="cell num">${isEmpty ? "-" : esc(fmtCur(Number(line.unit_price ?? 0)))}</td>
          <td class="cell num amount">${isEmpty ? "-" : esc(fmtCur(Number(line.amount ?? 0)))}</td>
        </tr>
      `
    })
    .join("")

  const notifyUrl =
    invoice.public_token && appUrl
      ? `${appUrl.replace(/\/$/, "")}/pay/${invoice.public_token}`
      : ""

  const amountNotes = [
    "消費税: 免税",
    withholdingEnabled ? `源泉徴収: ${fmtCur(withholdingAmount)}` : null,
  ]
    .filter(Boolean)
    .join(" / ")

  const recipientBlock = compactLine([
    `${recipientCompany} 御中`,
    recipientContact ? `${recipientContact} 様` : null,
  ])

  const issuerAddressLine = compactLine([
    issuerZip ? `〒${issuerZip}` : null,
    issuerAddress || null,
  ])

  const bankAccountLine = compactLine([
    bankName || null,
    branchName || null,
  ])

  const bankNumberLine = compactLine([
    accountType || null,
    accountNumber || null,
  ])

  return `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8" />
  <title>請求書 ${esc(invoice.invoice_no ?? invoice.invoice_month)}</title>
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
    * {
      box-sizing: border-box;
    }
    html, body {
      margin: 0;
      padding: 0;
      background: #ffffff;
      color: #111827;
      font-family: "SF Pro Display", "SF Pro Text", -apple-system, BlinkMacSystemFont, "Hiragino Sans", "Yu Gothic", sans-serif;
    }
    body {
      padding: 22mm 18mm 18mm;
      line-height: 1.6;
      font-size: 12px;
    }
    .page {
      display: grid;
      gap: 18px;
    }
    .header {
      display: grid;
      grid-template-columns: 1.1fr 0.9fr;
      gap: 28px;
      align-items: start;
    }
    .eyebrow {
      margin: 0 0 8px;
      font-size: 10px;
      letter-spacing: 0.24em;
      text-transform: uppercase;
      color: #6b7280;
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
    .recipient {
      margin-top: 22px;
      padding-top: 16px;
      border-top: 1px solid #d1d5db;
    }
    .recipient-label {
      margin: 0 0 6px;
      font-size: 10px;
      letter-spacing: 0.16em;
      color: #9ca3af;
      text-transform: uppercase;
      font-weight: 700;
    }
    .recipient-name {
      margin: 0;
      font-size: 21px;
      line-height: 1.35;
      font-weight: 600;
      color: #111827;
    }
    .recipient-contact {
      margin-top: 8px;
      color: #4b5563;
    }
    .meta-card {
      border: 1px solid #dbe2ea;
      border-radius: 18px;
      padding: 18px 18px 16px;
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
    .hero-amount {
      text-align: right;
    }
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
    .section {
      display: grid;
      gap: 10px;
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
    .detail-table {
      width: 100%;
      border-collapse: collapse;
      border-spacing: 0;
      overflow: hidden;
      border-radius: 16px;
      border: 1px solid #e5e7eb;
    }
    .detail-table thead th {
      background: #f8fafc;
      color: #475569;
      font-size: 11px;
      font-weight: 700;
      padding: 12px 14px;
      text-align: left;
      border-bottom: 1px solid #e5e7eb;
    }
    .detail-table thead th.num {
      text-align: right;
    }
    .cell {
      padding: 13px 14px;
      border-bottom: 1px solid #edf2f7;
      vertical-align: top;
      color: #111827;
      background: #ffffff;
    }
    .detail-table tbody tr:last-child .cell {
      border-bottom: none;
    }
    .cell.item {
      width: 28%;
      font-weight: 600;
    }
    .cell.detail {
      width: 34%;
      color: #334155;
    }
    .cell.num {
      text-align: right;
      white-space: nowrap;
    }
    .cell.amount {
      font-weight: 700;
    }
    .bottom-grid {
      display: grid;
      grid-template-columns: minmax(0, 1.1fr) minmax(280px, 0.9fr);
      gap: 18px;
      align-items: start;
    }
    .panel {
      border: 1px solid #e5e7eb;
      border-radius: 18px;
      padding: 16px 18px;
      background: #ffffff;
    }
    .panel.soft {
      background: #f8fafc;
    }
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
    .bank-grid, .issuer-grid {
      display: grid;
      gap: 8px;
    }
    .kv {
      display: grid;
      grid-template-columns: 108px 1fr;
      gap: 8px;
      align-items: start;
    }
    .kv-label {
      color: #64748b;
      font-size: 11px;
    }
    .kv-value {
      color: #0f172a;
      font-weight: 600;
      word-break: break-word;
    }
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
    .status-chip {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 6px 10px;
      border-radius: 999px;
      background: #eef2f7;
      color: #334155;
      font-size: 11px;
      font-weight: 700;
    }
    .notify-card {
      border: 1px solid #cbd5e1;
      border-radius: 20px;
      padding: 18px;
      background: linear-gradient(135deg, #f8fbff 0%, #edf5ff 100%);
    }
    .notify-steps {
      margin: 14px 0 0;
      padding: 0;
      list-style: none;
      display: grid;
      gap: 10px;
    }
    .notify-step {
      display: grid;
      grid-template-columns: 26px 1fr;
      gap: 10px;
      align-items: start;
    }
    .notify-index {
      width: 26px;
      height: 26px;
      border-radius: 50%;
      background: #0f172a;
      color: #ffffff;
      font-size: 11px;
      font-weight: 700;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .notify-step-title {
      margin: 0;
      font-size: 12px;
      font-weight: 700;
      color: #0f172a;
    }
    .notify-step-copy {
      margin: 2px 0 0;
      font-size: 11.5px;
      color: #475569;
    }
    .notify-url {
      margin-top: 14px;
      padding: 12px 14px;
      border-radius: 14px;
      background: rgba(255, 255, 255, 0.82);
      border: 1px solid #dbeafe;
      color: #1d4ed8;
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      font-size: 11px;
      word-break: break-all;
    }
    .notes {
      margin-top: 2px;
      padding: 14px 16px;
      border-radius: 16px;
      background: #f8fafc;
      border: 1px solid #e5e7eb;
      color: #334155;
      white-space: pre-wrap;
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
    <section class="header">
      <div>
        <p class="eyebrow">Invoice</p>
        <h1 class="doc-title">請求書</h1>
        <div class="recipient">
          <p class="recipient-label">Bill To</p>
          <p class="recipient-name">${esc(recipientBlock)}</p>
          <p class="recipient-contact">平素よりお世話になっております。下記の通りご請求申し上げます。</p>
        </div>
      </div>
      <div class="meta-card">
        <div class="meta-grid">
          <div>
            <p class="meta-label">Invoice No.</p>
            <p class="meta-value">${esc(invoice.invoice_no ?? "-")}</p>
          </div>
          <div>
            <p class="meta-label">Issue Date</p>
            <p class="meta-value">${esc(fmtDate(invoice.issue_date))}</p>
          </div>
          <div>
            <p class="meta-label">Due Date</p>
            <p class="meta-value">${esc(fmtDate(invoice.due_date))}</p>
          </div>
          <div>
            <p class="meta-label">Billing Month</p>
            <p class="meta-value">${esc(invoice.invoice_month)}</p>
          </div>
          <div style="grid-column: 1 / -1;">
            <p class="meta-label">Title</p>
            <p class="meta-value">${esc(invoice.invoice_title ?? invoice.invoice_name ?? "請求")}</p>
          </div>
        </div>
      </div>
    </section>

    <section class="hero">
      <div>
        <p class="hero-label">Amount Due</p>
        <p class="hero-title">${esc(invoice.invoice_title ?? "ご請求内容")}</p>
        <p class="hero-subtitle">お支払期日: ${esc(fmtDate(invoice.due_date))}</p>
      </div>
      <div class="hero-amount">
        <p class="hero-amount-value">${esc(fmtCur(total))}</p>
        <p class="hero-amount-note">${esc(amountNotes)}</p>
      </div>
    </section>

    <section class="section">
      <h2 class="section-title">Details</h2>
      <table class="detail-table">
        <thead>
          <tr>
            <th>案件 / 区分</th>
            <th>内容</th>
            <th class="num">数量</th>
            <th class="num">単価</th>
            <th class="num">金額</th>
          </tr>
        </thead>
        <tbody>
          ${lineRows}
        </tbody>
      </table>
    </section>

    <section class="bottom-grid">
      <div class="section">
        <div class="panel">
          <h3 class="panel-title">お支払い情報</h3>
          ${
            hasBankInfo
              ? `
                <div class="bank-grid">
                  <div class="kv">
                    <div class="kv-label">金融機関</div>
                    <div class="kv-value">${esc(bankAccountLine || "-")}</div>
                  </div>
                  <div class="kv">
                    <div class="kv-label">口座種別 / 番号</div>
                    <div class="kv-value">${esc(bankNumberLine || "-")}</div>
                  </div>
                  <div class="kv">
                    <div class="kv-label">口座名義</div>
                    <div class="kv-value">${esc(accountHolder || "-")}</div>
                  </div>
                  ${
                    depositorCode
                      ? `
                        <div class="kv">
                          <div class="kv-label">振込人名義</div>
                          <div class="kv-value">${esc(depositorCode)}</div>
                        </div>
                      `
                      : ""
                  }
                </div>
              `
              : `<p class="panel-copy">振込先情報は未設定です。発行元までご確認ください。</p>`
          }
        </div>

        ${
          notifyUrl
            ? `
              <div class="notify-card">
                <h3 class="panel-title">お振込後のご連絡</h3>
                <p class="panel-copy">お振込後は、下記の案内ページから支払完了をご連絡ください。確認後、担当者が入金確認と領収書発行を進めます。</p>
                <ul class="notify-steps">
                  <li class="notify-step">
                    <div class="notify-index">1</div>
                    <div>
                      <p class="notify-step-title">請求書PDFを保存</p>
                      <p class="notify-step-copy">このPDFは振込内容の確認用として保存してください。</p>
                    </div>
                  </li>
                  <li class="notify-step">
                    <div class="notify-index">2</div>
                    <div>
                      <p class="notify-step-title">銀行振込を実施</p>
                      <p class="notify-step-copy">お支払金額 ${esc(fmtCur(total))} を ${esc(fmtDate(invoice.due_date))} までにお振込みください。</p>
                    </div>
                  </li>
                  <li class="notify-step">
                    <div class="notify-index">3</div>
                    <div>
                      <p class="notify-step-title">支払完了を通知</p>
                      <p class="notify-step-copy">振込日・振込金額・振込名義をご入力ください。</p>
                    </div>
                  </li>
                </ul>
                <div class="notify-url">${esc(notifyUrl)}</div>
              </div>
            `
            : ""
        }

        ${
          invoice.notes?.trim()
            ? `
              <div class="panel soft">
                <h3 class="panel-title">備考</h3>
                <div class="notes">${esc(invoice.notes)}</div>
              </div>
            `
            : ""
        }
      </div>

      <div class="section">
        <div class="panel">
          <h3 class="panel-title">ご請求金額</h3>
          <div class="totals">
            <div class="total-row">
              <span>小計</span>
              <strong>${esc(fmtCur(subtotal))}</strong>
            </div>
            ${
              withholdingEnabled
                ? `
                  <div class="total-row">
                    <span>源泉徴収額</span>
                    <strong>-${esc(fmtCur(withholdingAmount))}</strong>
                  </div>
                `
                : ""
            }
            <div class="total-row">
              <span>消費税</span>
              <strong>免税</strong>
            </div>
            <div class="total-row final">
              <span>合計請求額</span>
              <strong>${esc(fmtCur(total))}</strong>
            </div>
          </div>
        </div>

        <div class="panel soft">
          <h3 class="panel-title">発行元</h3>
          <div class="issuer-grid">
            <div class="status-chip">Invoice Issuer</div>
            <div class="kv">
              <div class="kv-label">会社名</div>
              <div class="kv-value">${esc(issuerName || "-")}</div>
            </div>
            <div class="kv">
              <div class="kv-label">所在地</div>
              <div class="kv-value">${esc(issuerAddressLine || "-")}</div>
            </div>
            <div class="kv">
              <div class="kv-label">連絡先</div>
              <div class="kv-value">${esc(compactLine([issuerPhone || null, issuerEmail || null]) || "-")}</div>
            </div>
            ${
              issuerRegistrationNumber
                ? `
                  <div class="kv">
                    <div class="kv-label">登録番号</div>
                    <div class="kv-value">${esc(issuerRegistrationNumber)}</div>
                  </div>
                `
                : ""
            }
          </div>
        </div>
      </div>
    </section>

    <footer class="footer">
      <span>${esc(invoice.invoice_no ?? invoice.invoice_month)}</span>
      <span>お支払期日 ${esc(fmtDate(invoice.due_date))}</span>
    </footer>
  </div>
</body>
</html>`
}
