type InvoiceRecipientInput = {
  clientName?: string | null
  guestCompanyName?: string | null
  guestClientName?: string | null
}

type InvoicePdfNameInput = InvoiceRecipientInput & {
  invoiceMonth?: string | null
  invoiceTitle?: string | null
  invoiceName?: string | null
}

function cleanValue(value: string | null | undefined): string {
  return typeof value === "string" ? value.trim() : ""
}

export function resolveInvoiceRecipientName(input: InvoiceRecipientInput): string {
  const clientName = cleanValue(input.clientName)
  if (clientName) return clientName

  const guestCompanyName = cleanValue(input.guestCompanyName)
  if (guestCompanyName) return guestCompanyName

  const guestClientName = cleanValue(input.guestClientName)
  if (guestClientName) return guestClientName

  return "請求先"
}

export function resolveInvoiceRecipientLabel(input: InvoiceRecipientInput): string {
  const clientName = cleanValue(input.clientName)
  if (clientName) return clientName

  const guestCompanyName = cleanValue(input.guestCompanyName)
  const guestClientName = cleanValue(input.guestClientName)
  if (guestCompanyName && guestClientName) return `${guestCompanyName} / ${guestClientName}`

  return guestCompanyName || guestClientName || "請求先"
}

export function buildInvoicePdfBaseName(input: InvoicePdfNameInput): string {
  const customInvoiceName = cleanValue(input.invoiceName)
  if (customInvoiceName) return customInvoiceName

  const invoiceMonth = cleanValue(input.invoiceMonth) || "0000-00"
  const recipientName = resolveInvoiceRecipientName(input)
  const invoiceTitle = cleanValue(input.invoiceTitle) || "SNS運用代行"
  return `【御請求書】${invoiceMonth}_${recipientName}_${invoiceTitle}`
}

export function safeInvoicePdfFileName(value: string): string {
  return (value || "invoice")
    .replace(/[/\\:*?"<>|\s]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 120) || "invoice"
}
