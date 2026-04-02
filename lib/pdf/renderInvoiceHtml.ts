/**
 * Server-only. Renders a 御請求書 as HTML for PDF (A4, Puppeteer).
 *
 * Design:
 * - 本物の日本語ビジネス請求書フォーマット
 * - 宛先（左上）、タイトル（右上）、請求金額（目立つ大表示）
 * - 明細テーブル、税/源泉徴収内訳
 * - 振込先情報
 * - 発行者情報（右下）
 * - 支払い完了通知URL（PDF末尾）
 */

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
  tax_mode?: string | null        // 'exempt' | 'exclusive' | 'inclusive'
  tax_rate?: number | null
  tax_amount?: number | null
  withholding_enabled?: boolean | null
  withholding_amount?: number | null
  issuer_snapshot?: Record<string, unknown> | null
  bank_snapshot?: Record<string, unknown> | null
  notes?: string | null
  public_token?: string | null    // 支払完了通知URL用
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

function esc(s: string | null | undefined): string {
  if (!s) return ""
  return String(s)
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

function fmtDate(d: string): string {
  // "2026-04-02" → "2026年4月2日"
  const m = d.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!m) return d
  return `${m[1]}年${parseInt(m[2])}月${parseInt(m[3])}日`
}

export function renderInvoiceHtml(params: {
  invoice: InvoiceForPdf
  client: ClientForPdf
  org?: OrgForPdf | null
  lines: InvoiceLineForPdf[]
  appUrl?: string | null   // 支払完了通知URLのベース
}): string {
  const { invoice, client, lines, appUrl } = params
  const inv = invoice

  // ── 宛名解決 ─────────────────────────────────────────────────────
  const recipientCompany = client.billing_name?.trim() || client.name?.trim() || "御中"
  const recipientContact = client.contact_name?.trim() || null

  // ── 発行者スナップショット ────────────────────────────────────────
  const issuer = (inv.issuer_snapshot ?? {}) as Record<string, unknown>
  const issuerName = String(issuer.issuer_name ?? "")
  const issuerAddress = String(issuer.issuer_address ?? "")
  const issuerZip = issuer.issuer_zip ? String(issuer.issuer_zip) : null
  const issuerPhone = issuer.issuer_phone ? String(issuer.issuer_phone) : null
  const issuerEmail = issuer.issuer_email ? String(issuer.issuer_email) : null
  const issuerRegNum = issuer.issuer_registration_number
    ? String(issuer.issuer_registration_number)
    : null

  // ── 銀行スナップショット ──────────────────────────────────────────
  const bank = (inv.bank_snapshot ?? {}) as Record<string, unknown>
  const hasBankInfo =
    bank.bank_name || bank.branch_name || bank.account_number

  // ── 金額計算 ─────────────────────────────────────────────────────
  const subtotal = Number(inv.subtotal ?? 0)
  const taxMode = inv.tax_mode ?? "exempt"
  const taxAmount = Number(inv.tax_amount ?? 0)
  const taxRate = Number(inv.tax_rate ?? 0)
  const withholdingEnabled = inv.withholding_enabled ?? false
  const withholdingAmount = Number(inv.withholding_amount ?? 0)
  const total = Number(inv.total ?? subtotal)

  // ── 明細行 ───────────────────────────────────────────────────────
  const sortedLines = [...lines].sort(
    (a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0)
  )

  const lineRows = sortedLines
    .map(
      (l) => `
      <tr>
        <td class="td-desc">${esc(l.project_name ?? l.description ?? "-")}</td>
        <td class="td-desc">${esc(l.title ?? l.description ?? "-")}</td>
        <td class="td-num">${fmtNum(Number(l.quantity))}</td>
        <td class="td-num">${fmtNum(Number(l.unit_price))}</td>
        <td class="td-num td-bold">${fmtNum(Number(l.amount))}</td>
      </tr>`
    )
    .join("")

  // ── 金額サマリー ──────────────────────────────────────────────────
  const summaryRows: string[] = []
  summaryRows.push(`
    <tr>
      <td colspan="4" class="summary-label">小計</td>
      <td class="summary-val">${fmtNum(subtotal)}</td>
    </tr>`)

  if (taxMode !== "exempt" && taxAmount > 0) {
    summaryRows.push(`
      <tr>
        <td colspan="4" class="summary-label">消費税（${taxRate}%）</td>
        <td class="summary-val">${fmtNum(taxAmount)}</td>
      </tr>`)
  }
  if (taxMode === "exempt") {
    summaryRows.push(`
      <tr>
        <td colspan="4" class="summary-label muted-text">消費税（免税）</td>
        <td class="summary-val muted-text">—</td>
      </tr>`)
  }
  if (withholdingEnabled && withholdingAmount > 0) {
    summaryRows.push(`
      <tr>
        <td colspan="4" class="summary-label">源泉徴収税額（控除）</td>
        <td class="summary-val">△ ${fmtNum(withholdingAmount)}</td>
      </tr>`)
  }

  // ── 銀行振込セクション ────────────────────────────────────────────
  const bankSection = hasBankInfo
    ? `
    <div class="bank-section">
      <div class="section-header">お振込先</div>
      <table class="bank-table">
        <tbody>
          ${bank.bank_name ? `<tr><td class="bank-label">銀行名</td><td>${esc(String(bank.bank_name))}${bank.branch_name ? `　${esc(String(bank.branch_name))}` : ""}</td></tr>` : ""}
          ${bank.account_type && bank.account_number ? `<tr><td class="bank-label">口座種別・番号</td><td>${esc(String(bank.account_type))}　${esc(String(bank.account_number))}</td></tr>` : ""}
          ${bank.account_holder ? `<tr><td class="bank-label">口座名義</td><td>${esc(String(bank.account_holder))}</td></tr>` : ""}
          ${bank.depositor_code ? `<tr><td class="bank-label">振込人コード</td><td>${esc(String(bank.depositor_code))}</td></tr>` : ""}
        </tbody>
      </table>
      <div class="bank-note">※ 振込手数料はご負担ください。</div>
    </div>`
    : ""

  // ── 支払い完了通知URL ─────────────────────────────────────────────
  const notifyUrl =
    inv.public_token && appUrl
      ? `${appUrl.replace(/\/$/, "")}/pay/${inv.public_token}`
      : null

  const notifySection = notifyUrl
    ? `
    <div class="notify-section">
      <div class="section-header">お支払い完了のご連絡</div>
      <p class="notify-text">
        お振込が完了しましたら、下記URLよりお支払い完了のご報告をお願いいたします。<br/>
        ご報告後、担当者が確認の上、領収書をお送りいたします。
      </p>
      <div class="notify-url">${esc(notifyUrl)}</div>
    </div>`
    : ""

  // ── 発行者情報（右下） ────────────────────────────────────────────
  const regNumRow = issuerRegNum
    ? `<div class="issuer-detail">登録番号: ${esc(issuerRegNum)}</div>`
    : `<div class="issuer-detail muted-text">※ 適格請求書発行事業者ではありません</div>`

  const notesSection = inv.notes?.trim()
    ? `
    <div class="notes-section">
      <div class="section-header">備考</div>
      <div class="notes-body">${esc(inv.notes)}</div>
    </div>`
    : ""

  return `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8" />
  <title>御請求書 ${esc(inv.invoice_no ?? inv.invoice_month)}</title>
  <style>
    @media print {
      body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: "Hiragino Kaku Gothic ProN", "Hiragino Sans",
                   "Yu Gothic Medium", "Yu Gothic", "Meiryo", "MS PGothic", sans-serif;
      font-size: 12.5px;
      color: #1a1a1a;
      background: #fff;
      padding: 28px 36px 32px;
      line-height: 1.65;
    }

    /* ── ヘッダー ── */
    .header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      margin-bottom: 28px;
    }
    .recipient-block { max-width: 55%; }
    .recipient-company {
      font-size: 20px;
      font-weight: 700;
      border-bottom: 2px solid #1a1a1a;
      padding-bottom: 4px;
      margin-bottom: 4px;
      display: inline-block;
    }
    .recipient-contact { font-size: 13px; color: #444; margin-top: 2px; }
    .salutation { font-size: 12px; color: #555; margin-top: 6px; }

    .doc-meta { text-align: right; }
    .doc-title {
      font-size: 28px;
      font-weight: 700;
      letter-spacing: 0.18em;
      color: #1a1a1a;
      margin-bottom: 10px;
    }
    .meta-table td { padding: 2px 0; font-size: 12px; }
    .meta-table td:first-child { color: #666; padding-right: 12px; min-width: 80px; }
    .meta-table td:last-child { font-weight: 500; }

    /* ── 請求金額ボックス ── */
    .amount-box {
      border: 2px solid #1a1a1a;
      border-radius: 6px;
      padding: 16px 24px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 24px;
    }
    .amount-label { font-size: 14px; font-weight: 600; color: #444; }
    .amount-value {
      font-size: 30px;
      font-weight: 700;
      letter-spacing: -0.01em;
      color: #1a1a1a;
    }
    .amount-note { font-size: 12px; color: #666; margin-top: 3px; }

    /* ── 本文テキスト ── */
    .body-text {
      font-size: 12.5px;
      color: #333;
      margin-bottom: 16px;
    }

    /* ── セクションヘッダー ── */
    .section-header {
      font-size: 11px;
      font-weight: 700;
      color: #666;
      letter-spacing: 0.06em;
      text-transform: uppercase;
      border-bottom: 2px solid #e5e5e5;
      padding-bottom: 5px;
      margin-bottom: 0;
    }

    /* ── 明細テーブル ── */
    .detail-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 12px;
      margin-bottom: 0;
    }
    .detail-table thead tr { background: #f5f5f5; }
    .detail-table th {
      padding: 8px 10px;
      text-align: left;
      border-bottom: 2px solid #ddd;
      color: #555;
      font-weight: 600;
      font-size: 11px;
    }
    .detail-table th.th-num { text-align: right; }
    .td-desc { padding: 9px 10px; border-bottom: 1px solid #eee; color: #1a1a1a; vertical-align: top; }
    .td-num  { padding: 9px 10px; border-bottom: 1px solid #eee; color: #1a1a1a; text-align: right; white-space: nowrap; }
    .td-bold { font-weight: 500; }

    /* ── サマリー行 ── */
    .summary-label {
      padding: 6px 10px;
      text-align: right;
      color: #555;
      font-size: 12px;
      border-bottom: 1px solid #f0f0f0;
    }
    .summary-val {
      padding: 6px 10px;
      text-align: right;
      color: #1a1a1a;
      font-size: 12px;
      border-bottom: 1px solid #f0f0f0;
      white-space: nowrap;
    }
    .muted-text { color: #aaa; }

    /* ── 合計行 ── */
    .total-row td {
      padding: 10px 10px 6px;
      border-top: 2px solid #1a1a1a;
      font-size: 15px;
      font-weight: 700;
      color: #1a1a1a;
    }
    .total-row td:first-child { text-align: right; }
    .total-row td:last-child { text-align: right; white-space: nowrap; }

    /* ── 2カラムレイアウト ── */
    .two-col {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 20px;
      margin-top: 20px;
    }

    /* ── 振込先 ── */
    .bank-section { margin-top: 0; }
    .bank-table { width: 100%; border-collapse: collapse; margin-top: 8px; font-size: 12px; }
    .bank-label { color: #666; padding: 3px 12px 3px 0; white-space: nowrap; vertical-align: top; }
    .bank-note { font-size: 11px; color: #888; margin-top: 6px; }

    /* ── 発行者 ── */
    .issuer-section { margin-top: 0; }
    .issuer-name { font-size: 16px; font-weight: 700; margin: 8px 0 4px; }
    .issuer-detail { font-size: 12px; color: #444; line-height: 1.7; }
    .issuer-stamp {
      float: right;
      width: 56px; height: 56px;
      border: 1px dashed #ccc;
      border-radius: 50%;
      display: flex; align-items: center; justify-content: center;
      color: #ccc; font-size: 11px;
      margin-left: 10px;
    }

    /* ── 支払完了通知 ── */
    .notify-section {
      margin-top: 0;
      padding: 12px 14px;
      background: #f8fafc;
      border: 1px solid #e2e8f0;
      border-radius: 6px;
    }
    .notify-text { font-size: 11.5px; color: #555; margin: 6px 0; line-height: 1.7; }
    .notify-url {
      font-size: 11px;
      color: #2563eb;
      word-break: break-all;
      margin-top: 4px;
      font-family: monospace;
    }

    /* ── 備考 ── */
    .notes-section { margin-top: 0; }
    .notes-body {
      font-size: 12px;
      color: #444;
      margin-top: 6px;
      padding: 8px 12px;
      background: #fafafa;
      border-left: 3px solid #d1d5db;
      line-height: 1.7;
    }

    /* ── フッター ── */
    .footer {
      margin-top: 24px;
      padding-top: 10px;
      border-top: 1px solid #e5e5e5;
      display: flex;
      justify-content: space-between;
      font-size: 10.5px;
      color: #aaa;
    }
  </style>
</head>
<body>

  <!-- ============================================================
       HEADER: 宛先（左）+ タイトル・メタ（右）
  ============================================================ -->
  <div class="header">
    <div class="recipient-block">
      <div class="recipient-company">${esc(recipientCompany)}&ensp;御中</div>
      ${recipientContact ? `<div class="recipient-contact">${esc(recipientContact)} 様</div>` : ""}
      <div class="salutation" style="margin-top:14px">
        下記の通りご請求申し上げます。
      </div>
    </div>
    <div class="doc-meta">
      <div class="doc-title">御請求書</div>
      <table class="meta-table">
        <tbody>
          <tr><td>請求書番号</td><td>${esc(inv.invoice_no ?? "—")}</td></tr>
          <tr><td>発行日</td><td>${fmtDate(inv.issue_date)}</td></tr>
          <tr><td>お支払期限</td><td style="font-weight:700;color:#1a1a1a">${fmtDate(inv.due_date)}</td></tr>
          <tr><td>対象月</td><td>${esc(inv.invoice_month)}</td></tr>
          ${inv.invoice_title ? `<tr><td>件名</td><td>${esc(inv.invoice_title)}</td></tr>` : ""}
        </tbody>
      </table>
    </div>
  </div>

  <!-- ============================================================
       AMOUNT BOX: ご請求金額
  ============================================================ -->
  <div class="amount-box">
    <div>
      <div class="amount-label">ご請求金額</div>
      <div class="amount-note">
        ${taxMode === "exempt" ? "消費税：免税" : `消費税（${taxRate}%）含む`}
        ${withholdingEnabled && withholdingAmount > 0 ? "　／　源泉徴収税額控除後" : ""}
      </div>
    </div>
    <div class="amount-value">${fmtCur(total)}</div>
  </div>

  <!-- ============================================================
       DETAIL TABLE: 明細
  ============================================================ -->
  <div class="section-header" style="margin-bottom:0">明細</div>
  <table class="detail-table">
    <thead>
      <tr>
        <th>案件名 / 品目</th>
        <th>内容</th>
        <th class="th-num">数量</th>
        <th class="th-num">単価</th>
        <th class="th-num">金額</th>
      </tr>
    </thead>
    <tbody>
      ${lineRows}
      ${summaryRows.join("")}
      <tr class="total-row">
        <td colspan="4">合計（税込）</td>
        <td>${fmtCur(total)}</td>
      </tr>
    </tbody>
  </table>

  <!-- ============================================================
       2カラム: 振込先 + 発行者
  ============================================================ -->
  <div class="two-col">
    <div>
      ${bankSection}
      ${notesSection}
    </div>
    <div>
      <div class="issuer-section">
        <div class="section-header">発行者</div>
        <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-top:8px">
          <div>
            <div class="issuer-name">${esc(issuerName)}</div>
            <div class="issuer-detail">
              ${issuerZip ? `〒${esc(issuerZip)}<br/>` : ""}
              ${esc(issuerAddress)}<br/>
              ${issuerPhone ? `TEL: ${esc(issuerPhone)}<br/>` : ""}
              ${issuerEmail ? esc(issuerEmail) : ""}
            </div>
            ${regNumRow}
          </div>
          <div class="issuer-stamp">印</div>
        </div>
      </div>
    </div>
  </div>

  <!-- ============================================================
       支払完了通知
  ============================================================ -->
  ${notifySection
    ? `<div style="margin-top:20px">${notifySection}</div>`
    : ""}

  <!-- ============================================================
       FOOTER
  ============================================================ -->
  <div class="footer">
    <span>${esc(inv.invoice_no ?? inv.invoice_month)} | ${fmtDate(inv.issue_date)} 発行</span>
    <span>お支払期限: ${fmtDate(inv.due_date)}</span>
  </div>

</body>
</html>`
}
