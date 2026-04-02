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

  // ─── Reissue banner ─────────────────────────────────────────────
  const reissueBanner = receipt.is_reissue
    ? `<div style="background:#fef3c7;border:1px solid #f59e0b;border-radius:4px;padding:6px 12px;margin-bottom:16px;font-size:12px;color:#92400e;font-weight:600;">
        再発行書類 ― この領収書は再発行されたものです。旧領収書は無効となります。
      </div>`
    : ""

  // ─── Line rows ───────────────────────────────────────────────────
  const lineRows = sortedLines
    .map(
      (l) => `<tr>
        <td style="padding:9px 12px;border-bottom:1px solid #eee;color:#1a1a1a;vertical-align:top">${esc(l.description)}</td>
        <td style="padding:9px 12px;border-bottom:1px solid #eee;color:#1a1a1a;text-align:right;white-space:nowrap">${fmtNum(l.quantity)}</td>
        <td style="padding:9px 12px;border-bottom:1px solid #eee;color:#1a1a1a;text-align:right;white-space:nowrap">${fmtNum(l.unit_price)}</td>
        <td style="padding:9px 12px;border-bottom:1px solid #eee;color:#1a1a1a;text-align:right;white-space:nowrap;font-weight:500">${fmtNum(l.amount)}</td>
        ${isRegistered && l.tax_rate != null
          ? `<td style="padding:9px 12px;border-bottom:1px solid #eee;color:#666;text-align:center;white-space:nowrap">${Math.round(l.tax_rate * 100)}%</td>`
          : isRegistered
          ? `<td style="padding:9px 12px;border-bottom:1px solid #eee;color:#999;text-align:center">—</td>`
          : ""}
      </tr>`
    )
    .join("")

  // ─── Tax header cell ─────────────────────────────────────────────
  const taxHeaderCell = isRegistered
    ? `<th style="padding:9px 12px;background:#f5f5f5;border-bottom:2px solid #ddd;color:#555;font-size:12px;font-weight:600;text-align:center">税率</th>`
    : ""

  // ─── Tax breakdown section ────────────────────────────────────────
  const taxBreakdownSection =
    isRegistered && receipt.tax_breakdown_json.length > 0
      ? `<div style="margin-top:10px;padding:10px 12px;background:#f9f9f9;border:1px solid #e5e5e5;border-radius:4px;font-size:12px;color:#555">
          <div style="font-weight:600;margin-bottom:6px;color:#333">消費税内訳</div>
          ${receipt.tax_breakdown_json
            .map(
              (t) =>
                `<div style="display:flex;justify-content:space-between;padding:2px 0">
                  <span>${Math.round(t.tax_rate * 100)}% 対象（小計 ${fmtCur(t.subtotal)}）</span>
                  <span>消費税 ${fmtCur(t.tax_amount)}</span>
                </div>`
            )
            .join("")}
          <div style="display:flex;justify-content:space-between;border-top:1px solid #ddd;margin-top:6px;padding-top:6px;font-weight:600;color:#333">
            <span>消費税合計</span>
            <span>${fmtCur(receipt.tax_amount)}</span>
          </div>
        </div>`
      : receipt.tax_mode === "exempt"
      ? `<div style="margin-top:8px;font-size:11px;color:#888;text-align:right">消費税：免税のため表示していません</div>`
      : ""

  // ─── Registration number row ─────────────────────────────────────
  const registrationRow = isRegistered
    ? `<div style="font-size:11px;color:#555;margin-top:4px">登録番号: ${esc(issuer.issuer_registration_number)}</div>`
    : receipt.tax_mode === "exempt"
    ? `<div style="font-size:11px;color:#888;margin-top:4px">※ 適格請求書発行事業者ではありません</div>`
    : ""

  // ─── Payer note row ───────────────────────────────────────────────
  const payerNoteRow = receipt.payer_note?.trim()
    ? `<tr>
        <td style="padding:4px 0;color:#666;white-space:nowrap;font-size:12px;vertical-align:top">振込名義</td>
        <td style="padding:4px 0;font-size:12px">${esc(receipt.payer_note)}</td>
      </tr>`
    : ""

  // ─── Invoice reference row ────────────────────────────────────────
  const invoiceRefRow = receipt.invoice_no?.trim()
    ? `<tr>
        <td style="padding:4px 0;color:#666;white-space:nowrap;font-size:12px;vertical-align:top">対象請求書</td>
        <td style="padding:4px 0;font-size:12px">${esc(receipt.invoice_no)}</td>
      </tr>`
    : ""

  // ─── Note section ─────────────────────────────────────────────────
  const noteSection = receipt.note?.trim()
    ? `<div style="margin-top:16px;padding:10px 14px;background:#f9f9f9;border-left:3px solid #d1d5db;border-radius:0 4px 4px 0;font-size:12px;color:#555;line-height:1.7">
        <div style="font-weight:600;color:#333;margin-bottom:4px">備考</div>
        ${esc(receipt.note)}
      </div>`
    : ""

  return `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8" />
  <title>領収書 ${esc(receipt.receipt_number)}</title>
  <style>
    @media print {
      body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: "Hiragino Kaku Gothic ProN", "Hiragino Sans", "Yu Gothic Medium",
                   "Yu Gothic", "Meiryo", "MS PGothic", sans-serif;
      font-size: 13px;
      color: #1a1a1a;
      background: #ffffff;
      padding: 28px 36px 32px;
      line-height: 1.6;
    }
  </style>
</head>
<body>

  ${reissueBanner}

  <!-- ============================================================
       HEADER: タイトルと発行メタ情報
  ============================================================ -->
  <div style="display:flex;justify-content:space-between;align-items:flex-end;
              padding-bottom:12px;border-bottom:3px solid #1a1a1a;margin-bottom:24px">
    <div>
      <div style="font-size:34px;font-weight:700;letter-spacing:0.12em;color:#1a1a1a;line-height:1">
        領収書
      </div>
      ${receipt.is_reissue
        ? `<div style="font-size:12px;color:#b45309;font-weight:600;margin-top:4px;letter-spacing:0.04em">再発行</div>`
        : ""}
    </div>
    <div style="text-align:right;font-size:12px;color:#444;line-height:1.9">
      <div><span style="color:#888">No. </span><strong>${esc(receipt.receipt_number)}</strong></div>
      <div><span style="color:#888">発行日: </span>${esc(receipt.issue_date)}</div>
      <div><span style="color:#888">入金日: </span>${esc(receipt.paid_at)}</div>
    </div>
  </div>

  <!-- ============================================================
       AMOUNT BOX: 受領金額・宛名・但し書き
  ============================================================ -->
  <div style="border:2px solid #1a1a1a;border-radius:6px;padding:20px 24px;margin-bottom:24px">
    <!-- 宛名 -->
    <div style="font-size:20px;font-weight:700;padding-bottom:12px;
                border-bottom:1px solid #d1d5db;margin-bottom:16px;letter-spacing:0.02em">
      ${esc(receipt.recipient_name)}&ensp;御中
    </div>

    <!-- 金額 -->
    <div style="display:flex;align-items:baseline;gap:6px;margin-bottom:14px">
      <span style="font-size:15px;font-weight:700;color:#1a1a1a">金額</span>
      <span style="font-size:36px;font-weight:700;letter-spacing:-0.01em;color:#1a1a1a;line-height:1">
        ${fmtCur(receipt.total_amount)}
      </span>
      <span style="font-size:15px;color:#555;font-weight:600">（税込）</span>
    </div>

    <!-- 但し書き -->
    <div style="font-size:13px;color:#333;padding-top:12px;border-top:1px solid #e5e5e5;margin-bottom:10px">
      但し、<strong>${esc(description)}</strong>として
    </div>

    <!-- 確認文 -->
    <div style="font-size:13px;color:#555">上記の金額を正に領収いたしました。</div>
  </div>

  <!-- ============================================================
       INFO GRID: 支払情報 + 発行者情報
  ============================================================ -->
  <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:24px">

    <!-- 支払情報 -->
    <div style="padding:16px;border:1px solid #e5e7eb;border-radius:6px">
      <div style="font-size:11px;font-weight:700;color:#888;letter-spacing:0.06em;
                  text-transform:uppercase;margin-bottom:10px">支払情報</div>
      <table style="width:100%;border-collapse:collapse">
        <tbody>
          <tr>
            <td style="padding:4px 0;color:#666;white-space:nowrap;font-size:12px;vertical-align:top;padding-right:14px">支払方法</td>
            <td style="padding:4px 0;font-size:12px">${esc(paymentMethodLabel(receipt.payment_method))}</td>
          </tr>
          ${payerNoteRow}
          ${invoiceRefRow}
        </tbody>
      </table>
    </div>

    <!-- 発行者情報 -->
    <div style="padding:16px;border:1px solid #e5e7eb;border-radius:6px;position:relative">
      <div style="font-size:11px;font-weight:700;color:#888;letter-spacing:0.06em;
                  text-transform:uppercase;margin-bottom:10px">発行者</div>
      <div style="display:flex;justify-content:space-between;align-items:flex-start">
        <div>
          <div style="font-size:16px;font-weight:700;margin-bottom:4px">${esc(issuer.issuer_name)}</div>
          <div style="font-size:12px;color:#555;line-height:1.8">
            ${issuer.issuer_zip ? `〒${esc(issuer.issuer_zip)}<br/>` : ""}
            ${esc(issuer.issuer_address)}<br/>
            ${issuer.issuer_phone ? `TEL: ${esc(issuer.issuer_phone)}<br/>` : ""}
            ${issuer.issuer_email ? esc(issuer.issuer_email) : ""}
          </div>
          ${registrationRow}
        </div>
        <!-- 印鑑スペース -->
        <div style="width:60px;height:60px;border:1px dashed #ccc;border-radius:50%;
                    display:flex;align-items:center;justify-content:center;
                    color:#ccc;font-size:11px;flex-shrink:0;margin-left:10px">印</div>
      </div>
    </div>
  </div>

  <!-- ============================================================
       DETAIL TABLE: 明細
  ============================================================ -->
  <div style="margin-bottom:4px;font-size:11px;font-weight:700;color:#888;
              letter-spacing:0.06em;text-transform:uppercase;
              border-bottom:2px solid #e5e5e5;padding-bottom:6px">明細</div>

  <table style="width:100%;border-collapse:collapse;font-size:13px">
    <thead>
      <tr style="background:#f5f5f5">
        <th style="padding:9px 12px;background:#f5f5f5;border-bottom:2px solid #ddd;
                   color:#555;font-size:12px;font-weight:600;text-align:left">品目</th>
        <th style="padding:9px 12px;background:#f5f5f5;border-bottom:2px solid #ddd;
                   color:#555;font-size:12px;font-weight:600;text-align:right">数量</th>
        <th style="padding:9px 12px;background:#f5f5f5;border-bottom:2px solid #ddd;
                   color:#555;font-size:12px;font-weight:600;text-align:right">単価</th>
        <th style="padding:9px 12px;background:#f5f5f5;border-bottom:2px solid #ddd;
                   color:#555;font-size:12px;font-weight:600;text-align:right">金額</th>
        ${taxHeaderCell}
      </tr>
    </thead>
    <tbody>
      ${lineRows}
    </tbody>
  </table>

  <!-- 合計 -->
  <div style="border-top:2px solid #1a1a1a;padding:10px 12px 0;margin-bottom:4px">
    ${receipt.tax_amount > 0
      ? `<div style="display:flex;justify-content:flex-end;gap:24px;font-size:13px;color:#555;margin-bottom:4px">
          <span>小計</span><span>${fmtCur(receipt.subtotal_amount)}</span>
        </div>
        <div style="display:flex;justify-content:flex-end;gap:24px;font-size:13px;color:#555;margin-bottom:6px">
          <span>消費税</span><span>${fmtCur(receipt.tax_amount)}</span>
        </div>`
      : ""}
    <div style="display:flex;justify-content:flex-end;gap:24px;font-size:16px;font-weight:700;color:#1a1a1a">
      <span>合計（税込）</span><span>${fmtCur(receipt.total_amount)}</span>
    </div>
  </div>

  ${taxBreakdownSection}
  ${noteSection}

  <!-- ============================================================
       FOOTER
  ============================================================ -->
  <div style="margin-top:24px;padding-top:10px;border-top:1px solid #e5e5e5;
              display:flex;justify-content:space-between;
              font-size:11px;color:#aaa">
    <span>${esc(receipt.receipt_number)} | ${esc(receipt.issue_date)} 発行</span>
    <span>このPDFは受領証憑として有効です。</span>
  </div>

</body>
</html>`
}
