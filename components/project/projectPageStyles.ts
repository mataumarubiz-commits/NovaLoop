import type { CSSProperties } from "react"

export const inputStyle: CSSProperties = {
  padding: "10px 12px",
  borderRadius: 10,
  border: "1px solid var(--input-border)",
  background: "var(--input-bg)",
  color: "var(--input-text)",
}

export const textareaStyle: CSSProperties = {
  ...inputStyle,
  resize: "vertical",
  minHeight: 96,
}

export const buttonPrimaryStyle: CSSProperties = {
  padding: "10px 14px",
  borderRadius: 10,
  border: "1px solid var(--button-primary-bg)",
  background: "var(--button-primary-bg)",
  color: "var(--primary-contrast)",
  fontWeight: 700,
  cursor: "pointer",
}

export const buttonSecondaryStyle: CSSProperties = {
  padding: "10px 14px",
  borderRadius: 10,
  border: "1px solid var(--button-secondary-border)",
  background: "var(--button-secondary-bg)",
  color: "var(--button-secondary-text)",
  fontWeight: 700,
  cursor: "pointer",
}

export const tableStyle: CSSProperties = {
  width: "100%",
  borderCollapse: "collapse",
}

export const thStyle: CSSProperties = {
  padding: "10px 12px",
  borderBottom: "1px solid var(--table-border)",
  background: "var(--table-header-bg)",
  color: "var(--muted)",
  fontSize: 12,
  fontWeight: 700,
  textAlign: "left",
  whiteSpace: "nowrap",
}

export const tdStyle: CSSProperties = {
  padding: "10px 12px",
  borderBottom: "1px solid var(--table-border)",
  color: "var(--text)",
  fontSize: 13,
  verticalAlign: "top",
}

export function formatCurrency(value: number) {
  return new Intl.NumberFormat("ja-JP", {
    style: "currency",
    currency: "JPY",
    maximumFractionDigits: 0,
  }).format(Number(value || 0))
}

export function formatDateTime(value?: string | null, allDay = false) {
  if (!value) return "-"
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return String(value)
  if (allDay) {
    return date.toLocaleDateString("ja-JP")
  }
  return date.toLocaleString("ja-JP", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  })
}

export function textOrDash(value?: string | null) {
  return String(value ?? "").trim() || "-"
}
