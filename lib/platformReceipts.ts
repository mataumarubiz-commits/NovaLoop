import { formatDate, renderPlatformReceiptHtml, type PlatformBillingSettings } from "@/lib/platform"

export type PlatformTaxMode = "exempt" | "registered_taxable"

export type PlatformReceiptTaxBreakdownItem = {
  label: string
  tax_rate: number
  taxable_amount: number
  tax_amount: number
}

export type PlatformReceiptDocumentPayload = {
  receipt_number: string
  invoice_number: string
  request_number: string
  payment_request_id: string
  purchase_request_id: string | null
  purchaser_company_name: string | null
  purchaser_name: string
  purchaser_email: string | null
  purchaser_address: string | null
  currency: string
  service_title: string
  service_description: string
  subtotal_amount: number
  tax_amount: number
  total_amount: number
  tax_mode: PlatformTaxMode
  tax_rate_breakdown_json: PlatformReceiptTaxBreakdownItem[]
  paid_at: string
  issued_at: string
  payment_method: string
  payer_note: string | null
  payment_reference: string
  qualified_invoice_enabled: boolean
  qualified_invoice_registration_number: string | null
  issuer_name: string
  issuer_address: string
  issuer_email: string
  issuer_phone: string
}

type ReceiptComputationInput = {
  totalAmount: number
  taxMode: PlatformTaxMode
}

export function normalizePlatformTaxMode(value: unknown): PlatformTaxMode {
  return value === "registered_taxable" ? "registered_taxable" : "exempt"
}

export function isPlatformQualifiedInvoiceEnabled(
  settings: Pick<PlatformBillingSettings, "qualified_invoice_enabled" | "invoice_registration_number">
) {
  return settings.qualified_invoice_enabled === true && Boolean(settings.invoice_registration_number?.trim())
}

export function computePlatformReceiptAmounts(input: ReceiptComputationInput) {
  const totalAmount = Math.max(0, Math.round(Number(input.totalAmount ?? 0)))
  const taxMode = normalizePlatformTaxMode(input.taxMode)

  if (taxMode === "registered_taxable") {
    const subtotalAmount = Math.round(totalAmount / 1.1)
    const taxAmount = totalAmount - subtotalAmount
    return {
      subtotalAmount,
      taxAmount,
      breakdown: [
        {
          label: "10%",
          tax_rate: 0.1,
          taxable_amount: subtotalAmount,
          tax_amount: taxAmount,
        },
      ] satisfies PlatformReceiptTaxBreakdownItem[],
    }
  }

  return {
    subtotalAmount: totalAmount,
    taxAmount: 0,
    breakdown: [] satisfies PlatformReceiptTaxBreakdownItem[],
  }
}

export function buildPlatformReceiptStoragePath(receiptNumber: string, issuedAt: string) {
  const issueMonth = /^\d{4}-\d{2}/.test(issuedAt) ? issuedAt.slice(0, 7) : deriveReceiptMonth(receiptNumber)
  return `receipts/${issueMonth}/${receiptNumber}.pdf`
}

function deriveReceiptMonth(receiptNumber: string) {
  const match = receiptNumber.match(/(\d{4})(\d{2})/)
  if (!match) return "unknown-month"
  return `${match[1]}-${match[2]}`
}

export function buildPlatformReceiptPayload(params: {
  settings: PlatformBillingSettings
  payment: Record<string, unknown>
  purchase: Record<string, unknown>
  receiptNumber: string
  issuedAt: string
  paidAt: string
  payerNote?: string | null
  providerPayload?: Record<string, unknown> | null
}): PlatformReceiptDocumentPayload {
  const taxMode = normalizePlatformTaxMode(params.settings.default_tax_mode)
  const totalAmount = Math.max(0, Math.round(Number(params.payment.amount_jpy ?? params.settings.license_price_jpy ?? 0)))
  const computed = computePlatformReceiptAmounts({ totalAmount, taxMode })
  const purchaserName =
    stringOrNull(params.purchase.receipt_name) ??
    stringOrNull(params.payment.receipt_name) ??
    stringOrNull(params.purchase.full_name) ??
    "購入者"

  return {
    receipt_number: params.receiptNumber,
    invoice_number: String(params.payment.invoice_number ?? ""),
    request_number: String(params.payment.request_number ?? ""),
    payment_request_id: String(params.payment.id ?? ""),
    purchase_request_id: stringOrNull(params.purchase.id),
    purchaser_company_name: stringOrNull(params.purchase.company_name),
    purchaser_name: purchaserName,
    purchaser_email:
      stringOrNull(params.purchase.billing_email) ??
      stringOrNull(params.payment.billing_email) ??
      stringOrNull(params.purchase.contact_email),
    purchaser_address:
      stringOrNull(params.purchase.billing_address) ??
      stringOrNull(params.payment.billing_address) ??
      stringOrNull(params.purchase.address),
    currency: "JPY",
    service_title: "NovaLoop 利用ライセンス",
    service_description: "新規組織作成ライセンス購入",
    subtotal_amount: computed.subtotalAmount,
    tax_amount: computed.taxAmount,
    total_amount: totalAmount,
    tax_mode: taxMode,
    tax_rate_breakdown_json: computed.breakdown,
    paid_at: params.paidAt,
    issued_at: params.issuedAt,
    payment_method:
      stringOrNull(params.payment.payment_method) ??
      (stringOrNull(params.payment.payment_provider) === "stripe" ? "stripe_checkout" : "bank_transfer"),
    payer_note:
      stringOrNull(params.payerNote) ??
      stringOrNull(params.payment.client_transfer_name) ??
      stringOrNull(params.payment.paid_note) ??
      stringOrNull(params.payment.client_notify_note),
    payment_reference: String(params.payment.id ?? params.payment.request_number ?? ""),
    qualified_invoice_enabled: isPlatformQualifiedInvoiceEnabled(params.settings),
    qualified_invoice_registration_number: stringOrNull(params.settings.invoice_registration_number),
    issuer_name: params.settings.seller_name,
    issuer_address: params.settings.seller_address,
    issuer_email: params.settings.seller_email,
    issuer_phone: params.settings.seller_phone,
  }
}

export function renderPlatformReceiptHtmlFromPayload(
  payload: PlatformReceiptDocumentPayload,
  settings: PlatformBillingSettings
) {
  return renderPlatformReceiptHtml({
    settings,
    receiptNumber: payload.receipt_number,
    invoiceNumber: payload.invoice_number,
    issueDate: formatDate(payload.issued_at),
    paidAt: formatDate(payload.paid_at),
    recipientName: payload.purchaser_name,
    companyName: payload.purchaser_company_name,
    billingEmail: payload.purchaser_email,
    billingAddress: payload.purchaser_address,
    amountJpy: payload.total_amount,
    subtotalAmount: payload.subtotal_amount,
    taxAmount: payload.tax_amount,
    taxMode: payload.tax_mode,
    taxRateBreakdown: payload.tax_rate_breakdown_json,
    paymentMethod: payload.payment_method,
    payerNote: payload.payer_note,
    paymentReference: payload.payment_reference,
    serviceTitle: payload.service_title,
    serviceDescription: payload.service_description,
    qualifiedInvoiceEnabled: payload.qualified_invoice_enabled,
    qualifiedInvoiceRegistrationNumber: payload.qualified_invoice_registration_number,
  })
}

function stringOrNull(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null
}
