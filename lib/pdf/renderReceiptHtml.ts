/**
 * Server-only. Renders a 領収書 (receipt) as HTML for PDF via Puppeteer.
 *
 * Design principles:
 * - A4 portrait, print-safe (no webfonts, exact colors)
 * - "一目で受領済み証憑" とわかるレイアウト
 * - 振込先・支払期限は表示しない（領収書に不要）
 * - 免税事業者と適格請求書発行事業者を厳密に区別
 */

export type ReceiptLineForPdf = {
  description: string
  quantity: number
  unit_price: number
  amount: number
  tax_rate?: number | null
  sort_order?: number
}

export type TaxBreakdownItem = {
  tax_rate: number      // e.g. 0.10
  subtotal: number
  tax_amount: number
}

export type IssuerSnapshot = {
  issuer_name?: string | null
  issuer_address?: string | null
  issuer_zip?: string | null
  issuer_phone?: string | null
  issuer_email?: string | null
  issuer_registration_number?: string | null
  tax_mode?: string | null
}

export type ReceiptForPdf = {
  receipt_number: string
  issue_date: string
  paid_at: string
  payment_method: string
  payer_note?: string | null
  recipient_name: string
  subtotal_amount: number
  tax_amount: number
  total_amount: number
  tax_breakdown_json: TaxBreakdownItem[]
  tax_mode: string               // 'exempt' | 'registered_taxable'
  issuer_snapshot: IssuerSnapshot
  note?: string | null
  is_reissue?: boolean
  invoice_no?: string | null
  title?: string | null
  lines: ReceiptLineForPdf[]
}

function esc(s: string | null | undefined): string {
  if (!s) return ""
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
}

function fmtNum(n: number): string {
  return new Intl.NumberFormat("ja-JP", { maximumFractionDigits: 0 }).format(n)
}

function fmtCur(n: number): string {
  return new Intl.NumberFormat("ja-JP", {
    style: "currency",
    currency: "JPY",
    maximumFractionDigits: 0,
  }).format(n)
}

function fmtDate(value: string): string {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!match) return value
  return `${match[1]}年${Number(match[2])}月${Number(match[3])}日`
}

function compactLine(parts: Array<string | null | undefined>): string {
  return parts.filter(Boolean).join(" ")
}

function paymentMethodLabel(method: string): string {
  const map: Record<string, string> = {
    bank_transfer: "銀行振込",
    cash: "現金",
    card: "クレジットカード",
    other: "その他",
  }
  return map[method] ?? method
}

function buildDescription(title: string | null | undefined, lines: ReceiptLineForPdf[]): string {
  if (title?.trim()) return title.trim()
  if (lines.length === 1 && lines[0].description.trim()) {
    return `${lines[0].description.trim()} 代`
  }
  return "ご利用料金"
}

export function renderReceiptHtml(receipt: ReceiptForPdf): string {
  const issuer = receipt.issuer_snapshot
  const isRegistered =
    receipt.tax_mode === "registered_taxable" &&
    !!issuer.issuer_registration_number?.trim()

  const sortedLines = [...receipt.lines].sort(
    (a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0)
  )

  const description = buildDescription(receipt.title, sortedLines)
  const issuerAddressLine = compactLine([
    issuer.issuer_zip?.trim() ? `〒${issuer.issuer_zip.trim()}` : null,
    issuer.issuer_address?.trim() ?? null,
  ])

  const reissueBanner = receipt.is_reissue
    ? `<div class="reissue-banner">
        再発行書類: この領収書は再発行分です。旧領収書は無効としてお取り扱いください。
      </div>`
    : ""

  const lineRows = sortedLines
    .map(
      (l) => `<tr>
        <td class="cell item">${esc(l.description)}</td>
        <td class="cell num">${fmtNum(l.quantity)}</td>
        <td class="cell num">${fmtCur(l.unit_price)}</td>
        <td class="cell num amount">${fmtCur(l.amount)}</td>
        ${isRegistered && l.tax_rate != null
          ? `<td class="cell tax">${Math.round(l.tax_rate * 100)}%</td>`
          : isRegistered
          ? `<td class="cell tax">—</td>`
          : ""}
      </tr>`
    )
    .join("")

  const taxHeaderCell = isRegistered
    ? `<th class="num tax">税率</th>`
    : ""

  const taxBreakdownSection =
    isRegistered && receipt.tax_breakdown_json.length > 0
      ? `<div class="panel soft">
          <h3 class="panel-title">消費税内訳</h3>
          <div class="tax-breakdown">
          ${receipt.tax_breakdown_json
            .map(
              (t) =>
                `<div class="tax-row">
                  <span>${Math.round(t.tax_rate * 100)}% 対象（小計 ${fmtCur(t.subtotal)}）</span>
                  <span>消費税 ${fmtCur(t.tax_amount)}</span>
                </div>`
            )
            .join("")}
          <div class="tax-row total">
            <span>消費税合計</span>
            <span>${fmtCur(receipt.tax_amount)}</span>
          </div>
          </div>
        </div>`
      : receipt.tax_mode === "exempt"
      ? `<div class="tax-note">消費税: 免税のため表示していません</div>`
      : ""

  const registrationRow = isRegistered
    ? `<div class="issuer-note">登録番号: ${esc(issuer.issuer_registration_number)}</div>`
    : receipt.tax_mode === "exempt"
    ? `<div class="issuer-note muted">※ 適格請求書発行事業者ではありません</div>`
    : ""

  const payerNoteRow = receipt.payer_note?.trim()
    ? `<div class="kv"><div class="kv-label">振込名義</div><div class="kv-value">${esc(receipt.payer_note)}</div></div>`
    : ""

  const invoiceRefRow = receipt.invoice_no?.trim()
    ? `<div class="kv"><div class="kv-label">対象請求書</div><div class="kv-value">${esc(receipt.invoice_no)}</div></div>`
    : ""

  const noteSection = receipt.note?.trim()
    ? `<div class="panel soft">
        <h3 class="panel-title">備考</h3>
        <div class="notes">${esc(receipt.note)}</div>
      </div>`
    : ""

  return `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8" />
  <title>領収書 ${esc(receipt.receipt_number)}</title>
  <style>
    @page {
      size: A4;
      margin: 0;
    }
    @media print {
      body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    }
    * { box-sizing: border-box; }
    html, body { margin: 0; padding: 0; background: #ffffff; color: #1a1a1a; }
    body {
      font-family: "SF Pro Display", "SF Pro Text", -apple-system, BlinkMacSystemFont, "Hiragino Sans", "Yu Gothic", sans-serif;
      font-size: 12px;
      padding: 22mm 18mm 18mm;
      line-height: 1.6;
    }
    .page { display: grid; gap: 18px; }
    .reissue-banner {
      border: 1px solid #f59e0b;
      border-radius: 14px;
      padding: 10px 14px;
      background: #fffbeb;
      color: #9a3412;
      font-size: 12px;
      font-weight: 700;
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
      letter-spacing: 0.2em;
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
      font-weight: 700;
    }
    .recipient-name {
      margin: 0;
      font-size: 21px;
      line-height: 1.35;
      font-weight: 600;
      color: #111827;
    }
    .recipient-copy {
      margin: 8px 0 0;
      color: #4b5563;
      font-size: 12px;
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
    .section { display: grid; gap: 10px; }
    .section-title {
      margin: 0;
      padding-bottom: 8px;
      border-bottom: 1px solid #dbe2ea;
      font-size: 11px;
      letter-spacing: 0.18em;
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
    .detail-table thead th.num { text-align: right; }
    .cell {
      padding: 13px 14px;
      border-bottom: 1px solid #edf2f7;
      vertical-align: top;
      color: #111827;
      background: #ffffff;
    }
    .detail-table tbody tr:last-child .cell { border-bottom: none; }
    .cell.item { width: 44%; font-weight: 600; }
    .cell.num { text-align: right; white-space: nowrap; }
    .cell.amount { font-weight: 700; }
    .cell.tax { text-align: center; color: #475569; }
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
      grid-template-columns: 108px 1fr;
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
    .issuer-note {
      margin-top: 8px;
      color: #475569;
      font-size: 11px;
    }
    .issuer-note.muted { color: #64748b; }
    .tax-breakdown { display: grid; gap: 6px; }
    .tax-row {
      display: flex;
      justify-content: space-between;
      gap: 12px;
      color: #475569;
      font-size: 12px;
    }
    .tax-row.total {
      margin-top: 4px;
      padding-top: 8px;
      border-top: 1px solid #d1d5db;
      color: #0f172a;
      font-weight: 700;
    }
    .tax-note {
      text-align: right;
      color: #64748b;
      font-size: 11px;
    }
    .notes {
      color: #334155;
      white-space: pre-wrap;
      font-size: 12px;
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
    ${reissueBanner}

    <section class="header">
      <div>
        <p class="eyebrow">入金受領証</p>
        <h1 class="doc-title">領収書</h1>
        <div class="recipient">
          <p class="recipient-label">宛先</p>
          <p class="recipient-name">${esc(receipt.recipient_name)} 御中</p>
          <p class="recipient-copy">下記の金額を、${esc(description)}として正に領収いたしました。</p>
        </div>
      </div>
      <div class="meta-card">
        <div class="meta-grid">
          <div>
            <p class="meta-label">領収書番号</p>
            <p class="meta-value">${esc(receipt.receipt_number)}</p>
          </div>
          <div>
            <p class="meta-label">発行日</p>
            <p class="meta-value">${esc(fmtDate(receipt.issue_date))}</p>
          </div>
          <div>
            <p class="meta-label">入金日</p>
            <p class="meta-value">${esc(fmtDate(receipt.paid_at))}</p>
          </div>
          <div>
            <p class="meta-label">支払方法</p>
            <p class="meta-value">${esc(paymentMethodLabel(receipt.payment_method))}</p>
          </div>
        </div>
      </div>
    </section>

    <section class="hero">
      <div>
        <p class="hero-label">受領金額</p>
        <p class="hero-title">${esc(description)}</p>
        <p class="hero-subtitle">消費税: ${isRegistered ? "内訳を明記" : "免税"}</p>
      </div>
      <div class="hero-amount">
        <p class="hero-amount-value">${fmtCur(receipt.total_amount)}</p>
        <p class="hero-amount-note">領収対象日: ${esc(fmtDate(receipt.paid_at))}</p>
      </div>
    </section>

    <section class="section">
      <h2 class="section-title">受領明細</h2>
      <table class="detail-table">
        <thead>
          <tr>
            <th>品目</th>
            <th class="num">数量</th>
            <th class="num">単価</th>
            <th class="num">金額</th>
            ${taxHeaderCell}
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
          <h3 class="panel-title">受領情報</h3>
          <div class="kv"><div class="kv-label">但し書き</div><div class="kv-value">${esc(description)}</div></div>
          <div class="kv"><div class="kv-label">受領日</div><div class="kv-value">${esc(fmtDate(receipt.paid_at))}</div></div>
          <div class="kv"><div class="kv-label">支払方法</div><div class="kv-value">${esc(paymentMethodLabel(receipt.payment_method))}</div></div>
          ${payerNoteRow}
          ${invoiceRefRow}
        </div>

        ${taxBreakdownSection}
        ${noteSection}
      </div>

      <div class="section">
        <div class="panel">
          <h3 class="panel-title">受領金額</h3>
          <div class="totals">
            <div class="total-row">
              <span>小計</span>
              <strong>${fmtCur(receipt.subtotal_amount)}</strong>
            </div>
            <div class="total-row">
              <span>消費税</span>
              <strong>${receipt.tax_amount > 0 ? fmtCur(receipt.tax_amount) : "免税"}</strong>
            </div>
            <div class="total-row final">
              <span>合計受領額</span>
              <strong>${fmtCur(receipt.total_amount)}</strong>
            </div>
          </div>
        </div>

        <div class="panel soft">
          <h3 class="panel-title">発行元</h3>
          <div class="kv"><div class="kv-label">会社名</div><div class="kv-value">${esc(issuer.issuer_name || "-")}</div></div>
          <div class="kv"><div class="kv-label">所在地</div><div class="kv-value">${esc(issuerAddressLine || "-")}</div></div>
          <div class="kv"><div class="kv-label">連絡先</div><div class="kv-value">${esc(compactLine([issuer.issuer_phone ? `TEL: ${issuer.issuer_phone}` : null, issuer.issuer_email ?? null]) || "-")}</div></div>
          ${registrationRow}
        </div>
      </div>
    </section>

    <footer class="footer">
      <span>${esc(receipt.receipt_number)}</span>
      <span>${esc(fmtDate(receipt.issue_date))} 発行</span>
    </footer>
  </div>
</body>
</html>`
}
