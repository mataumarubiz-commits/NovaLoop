/**
 * Server-only. Renders invoice as HTML string for PDF (A4, same content as /invoices/[id] preview).
 * Tax: exempt (no tax line in body).
 */

export type InvoiceForPdf = {
  id: string
  org_id: string
  invoice_title: string | null
  invoice_name?: string | null
  invoice_month: string
  issue_date: string
  due_date: string
  subtotal: number
}

export type ClientForPdf = {
  name: string
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

export function renderInvoiceHtml(params: {
  invoice: InvoiceForPdf
  client: ClientForPdf
  org?: OrgForPdf | null
  lines: InvoiceLineForPdf[]
}): string {
  const { invoice, client, lines } = params
  const clientName = client?.name ?? "請求先"
  const title = (invoice.invoice_title?.trim() || "SNS運用代行").replace(/[/\\?*:|"]/g, "_")
  const defaultName = `【御請求書】${invoice.invoice_month}_${clientName}_${title}`
  const displayName = (invoice.invoice_name?.trim() || defaultName).replace(/[/\\:*?"<>|\s]+/g, "_").replace(/_+/g, "_").replace(/^_|_$/g, "") || "invoice"

  const fmtNum = (n: number) => new Intl.NumberFormat("ja-JP", { maximumFractionDigits: 0 }).format(n)
  const fmtCur = (n: number) => new Intl.NumberFormat("ja-JP", { style: "currency", currency: "JPY", maximumFractionDigits: 0 }).format(n)

  const rows = (lines ?? [])
    .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
    .map(
      (line) =>
        `<tr>
          <td style="padding:8px 10px;border-bottom:1px solid #eee;color:#1a1a1a">${escapeHtml(line.project_name ?? line.description ?? "-")}</td>
          <td style="padding:8px 10px;border-bottom:1px solid #eee;color:#1a1a1a">${escapeHtml(line.title ?? line.description ?? "-")}</td>
          <td style="padding:8px 10px;border-bottom:1px solid #eee;color:#1a1a1a;text-align:right">${line.quantity}</td>
          <td style="padding:8px 10px;border-bottom:1px solid #eee;color:#1a1a1a;text-align:right">${fmtNum(Number(line.unit_price))}</td>
          <td style="padding:8px 10px;border-bottom:1px solid #eee;color:#1a1a1a;text-align:right">${fmtNum(Number(line.amount))}</td>
        </tr>`
    )
    .join("")

  return `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeHtml(displayName)}</title>
  <style>
    @media print { body { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
    body { font-family: sans-serif; font-size: 14px; color: #1a1a1a; line-height: 1.5; margin: 0; padding: 0; }
    .card { border: 1px solid #e5e5e5; border-radius: 12px; padding: 24px; max-width: 800px; margin: 0 auto; background: #fff; box-shadow: 0 2px 8px rgba(0,0,0,0.04); }
    .muted { color: #666; }
    table { width: 100%; border-collapse: collapse; font-size: 13px; margin-bottom: 24px; }
    th { text-align: left; padding: 8px 10px; border-bottom: 2px solid #e5e5e5; color: #666; font-weight: 600; }
    th:last-of-type, td:last-of-type { text-align: right; }
    th:nth-child(3), th:nth-child(4), th:nth-child(5), td:nth-child(3), td:nth-child(4), td:nth-child(5) { text-align: right; }
  </style>
</head>
<body>
  <div class="card">
    <header style="margin-bottom:24px;padding-bottom:16px;border-bottom:1px solid #e5e5e5">
      <h1 style="font-size:18px;font-weight:700;color:#1a1a1a;margin:0 0 4px 0">請求書</h1>
      <p class="muted" style="font-size:12px;margin:4px 0 0 0">${escapeHtml(displayName)}</p>
    </header>
    <dl style="display:grid;gap:8px;margin-bottom:24px;font-size:14px">
      <div style="display:flex;gap:12px;align-items:center">
        <dt class="muted" style="min-width:100px;margin:0">請求先</dt>
        <dd style="color:#1a1a1a;font-weight:600;margin:0">${escapeHtml(clientName)}</dd>
      </div>
      <div style="display:flex;gap:12px;align-items:center">
        <dt class="muted" style="min-width:100px;margin:0">請求名</dt>
        <dd style="color:#1a1a1a;margin:0">${escapeHtml(invoice.invoice_title?.trim() || "SNS運用代行")}</dd>
      </div>
      <div style="display:flex;gap:12px;align-items:center">
        <dt class="muted" style="min-width:100px;margin:0">発行日</dt>
        <dd style="color:#1a1a1a;margin:0">${invoice.issue_date}</dd>
      </div>
      <div style="display:flex;gap:12px;align-items:center">
        <dt class="muted" style="min-width:100px;margin:0">支払期限</dt>
        <dd style="color:#1a1a1a;margin:0">${invoice.due_date}</dd>
      </div>
    </dl>
    <table>
      <thead>
        <tr>
          <th>案件名</th>
          <th>動画タイトル</th>
          <th>数量</th>
          <th>単価</th>
          <th>金額</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
    <div style="display:flex;justify-content:flex-end;align-items:center;gap:16px;padding-top:12px;border-top:1px solid #e5e5e5;font-size:15px;font-weight:700;color:#1a1a1a">
      <span>合計</span>
      <span>${fmtCur(Number(invoice.subtotal ?? 0))}</span>
    </div>
    <p class="muted" style="font-size:11px;margin-top:16px;margin-bottom:0">消費税：免税のため表示していません。</p>
  </div>
</body>
</html>`
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
}
