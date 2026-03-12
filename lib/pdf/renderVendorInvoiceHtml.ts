/**
 * Server-only. Renders vendor invoice as HTML for PDF (A4).
 * Tax: exempt / no tax line.
 */

export type VendorInvoiceForPdf = {
  id: string
  invoice_number?: string | null
  billing_month: string
  submitted_at?: string | null
  submit_deadline?: string | null
  pay_date?: string | null
  total: number
  memo?: string | null
  recipient_snapshot?: Record<string, unknown> | null
  vendor_profile_snapshot?: Record<string, unknown> | null
  vendor_bank_snapshot?: Record<string, unknown> | null
}

export type VendorForPdf = {
  name: string
  email?: string | null
}

export type VendorInvoiceLineForPdf = {
  id: string
  work_type: string | null
  description: string | null
  qty: number
  unit_price: number
  amount: number
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
}

function formatDate(value?: string | null) {
  return value ? value.slice(0, 10) : "-"
}

function fmtCurrency(n: number) {
  return new Intl.NumberFormat("ja-JP", {
    style: "currency",
    currency: "JPY",
    maximumFractionDigits: 0,
  }).format(n)
}

function fmtNumber(n: number) {
  return new Intl.NumberFormat("ja-JP", { maximumFractionDigits: 0 }).format(n)
}

export function renderVendorInvoiceHtml(params: {
  invoice: VendorInvoiceForPdf
  vendor: VendorForPdf
  lines: VendorInvoiceLineForPdf[]
}): string {
  const { invoice, vendor, lines } = params
  const profile = (invoice.vendor_profile_snapshot ?? {}) as Record<string, unknown>
  const bank = (invoice.vendor_bank_snapshot ?? {}) as Record<string, unknown>
  const recipient = (invoice.recipient_snapshot ?? {}) as Record<string, unknown>

  const vendorName = String(profile.billing_name ?? profile.display_name ?? vendor.name ?? "外注先")
  const vendorAddress = [profile.postal_code, profile.address].filter(Boolean).map((value) => escapeHtml(String(value))).join(" ")
  const recipientName = String(recipient.recipient_name ?? recipient.organization_name ?? "請求先")
  const recipientAddress = [recipient.postal_code, recipient.address]
    .filter(Boolean)
    .map((value) => escapeHtml(String(value)))
    .join(" ")
  const bankInfo = [bank.bank_name, bank.branch_name, bank.account_type, bank.account_number, bank.account_holder]
    .filter(Boolean)
    .map((value) => escapeHtml(String(value)))
    .join(" / ")

  const rows = lines
    .map(
      (line) => `
        <tr>
          <td>${escapeHtml(line.work_type ?? "-")}</td>
          <td>${escapeHtml(line.description ?? "-")}</td>
          <td class="num">${fmtNumber(Number(line.qty ?? 0))}</td>
          <td class="num">${fmtNumber(Number(line.unit_price ?? 0))}</td>
          <td class="num">${fmtNumber(Number(line.amount ?? 0))}</td>
        </tr>
      `
    )
    .join("")

  return `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeHtml(invoice.invoice_number ?? `VENDOR-${invoice.billing_month}`)}</title>
  <style>
    @page { size: A4; margin: 14mm 12mm 16mm 12mm; }
    body { font-family: "Yu Gothic", "Hiragino Sans", sans-serif; color: #111827; font-size: 13px; line-height: 1.6; }
    h1,h2,h3,p { margin: 0; }
    .sheet { border: 1px solid #e5e7eb; border-radius: 16px; padding: 28px; }
    .header { display: flex; justify-content: space-between; gap: 20px; padding-bottom: 18px; border-bottom: 1px solid #e5e7eb; }
    .muted { color: #6b7280; font-size: 12px; }
    .summary { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; margin-top: 20px; }
    .card { border: 1px solid #e5e7eb; border-radius: 12px; padding: 14px 16px; background: #f9fafb; }
    table { width: 100%; border-collapse: collapse; margin-top: 20px; }
    th, td { padding: 8px 10px; border-bottom: 1px solid #e5e7eb; vertical-align: top; }
    th { color: #6b7280; font-size: 12px; text-align: left; }
    .num { text-align: right; }
    .footer { margin-top: 18px; display: flex; justify-content: flex-end; gap: 18px; font-weight: 700; }
    .memo { margin-top: 16px; border: 1px solid #e5e7eb; border-radius: 12px; padding: 14px 16px; background: #fff; }
  </style>
</head>
<body>
  <div class="sheet">
    <div class="header">
      <div>
        <div class="muted">請求書</div>
        <h1 style="font-size: 24px; margin-top: 4px;">${escapeHtml(invoice.invoice_number ?? "-")}</h1>
        <p class="muted" style="margin-top: 8px;">対象月: ${escapeHtml(invoice.billing_month)}</p>
        <p class="muted">発行日: ${escapeHtml(formatDate(invoice.submitted_at))}</p>
      </div>
      <div style="text-align: right;">
        <div class="muted">合計金額</div>
        <div style="font-size: 24px; font-weight: 700; margin-top: 4px;">${fmtCurrency(Number(invoice.total ?? 0))}</div>
        <p class="muted" style="margin-top: 8px;">支払予定日: ${escapeHtml(formatDate(invoice.pay_date))}</p>
      </div>
    </div>

    <div class="summary">
      <section class="card">
        <div class="muted">請求元情報</div>
        <div style="font-weight: 700; margin-top: 8px;">${escapeHtml(vendorName)}</div>
        <div>${escapeHtml(String(profile.legal_name ?? ""))}</div>
        <div>${escapeHtml(String(profile.company_name ?? ""))}</div>
        <div>${vendorAddress || "-"}</div>
        <div>${escapeHtml(String(profile.email ?? vendor.email ?? ""))}</div>
        <div>${escapeHtml(String(profile.registration_number ?? ""))}</div>
      </section>
      <section class="card">
        <div class="muted">請求先情報</div>
        <div style="font-weight: 700; margin-top: 8px;">${escapeHtml(recipientName)}</div>
        <div>${escapeHtml(String(recipient.organization_name ?? ""))}</div>
        <div>${recipientAddress || "-"}</div>
        <div>${escapeHtml(String(recipient.email ?? ""))}</div>
        <div>${escapeHtml(String(recipient.phone ?? ""))}</div>
        <div>${escapeHtml(String(recipient.registration_number ?? ""))}</div>
      </section>
    </div>

    <table>
      <thead>
        <tr>
          <th>作業内容</th>
          <th>明細</th>
          <th class="num">数量</th>
          <th class="num">単価</th>
          <th class="num">小計</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>

    <div class="memo">
      <div class="muted">振込先情報</div>
      <div style="margin-top: 6px;">${bankInfo || "-"}</div>
    </div>

    <div class="memo">
      <div class="muted">備考</div>
      <div style="margin-top: 6px;">${escapeHtml(String(invoice.memo ?? "-"))}</div>
    </div>

    <div class="footer">
      <span>合計</span>
      <span>${fmtCurrency(Number(invoice.total ?? 0))}</span>
    </div>
  </div>
</body>
</html>`
}
