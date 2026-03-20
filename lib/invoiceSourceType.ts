export type InvoiceSourceType =
  | "manual"
  | "copy"
  | "request"
  | "billing"
  | "billing_monthly"
  | "billing_bulk"

export function isMonthlyBillingSourceType(sourceType?: string | null): boolean {
  return (
    sourceType === "billing" ||
    sourceType === "billing_monthly" ||
    sourceType === "billing_bulk"
  )
}

export function normalizeInvoiceSourceTypeForWrite(
  sourceType?: string | null
): "manual" | "copy" | "request" | "billing" {
  if (isMonthlyBillingSourceType(sourceType)) return "billing"
  if (sourceType === "copy" || sourceType === "request") return sourceType
  return "manual"
}

export function describeInvoiceSourceType(sourceType?: string | null): string {
  return isMonthlyBillingSourceType(sourceType)
    ? "月次請求から発行"
    : "手動または依頼から作成"
}
