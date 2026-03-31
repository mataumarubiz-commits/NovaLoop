import type { CSSProperties } from "react"

/** 案件・コンテンツ共通の進行フェーズ（案件 projects.status と contents.status を揃える） */
export const PROJECT_STATUS_OPTIONS = [
  { value: "not_started", label: "未着手" },
  { value: "internal_production", label: "内部制作中" },
  { value: "internal_revision", label: "内部修正中" },
  { value: "client_submission", label: "先方提出中" },
  { value: "client_revision_work", label: "先方修正依頼対応中" },
  { value: "delivered", label: "納品" },
  { value: "invoiced", label: "請求済み" },
  { value: "paused", label: "停止中" },
  { value: "completed", label: "完了" },
] as const

/** 制作シート（contents）用: 共通フェーズ + キャンセル */
export const CONTENT_WORKFLOW_STATUS_OPTIONS = [
  ...PROJECT_STATUS_OPTIONS,
  { value: "canceled", label: "キャンセル" },
] as const

export const PROJECT_STATUS_LABELS: Record<string, string> = Object.fromEntries(
  PROJECT_STATUS_OPTIONS.map((o) => [o.value, o.label])
)

export const CONTENT_STATUS_LABELS: Record<string, string> = {
  ...PROJECT_STATUS_LABELS,
  canceled: "キャンセル",
  cancelled: "キャンセル",
  // 移行前データの表示用（066 適用後は原則不要）
  materials_checked: "内部制作中（旧）",
  editing: "内部制作中（旧）",
  submitted_to_client: "先方提出中（旧）",
  client_revision: "先方修正依頼対応中（旧）",
  editing_revision: "内部修正中（旧）",
  scheduling: "先方提出中（旧）",
  published: "納品（旧）",
  active: "進行中（旧）",
}

export function getProjectStatusBadgeStyle(status: string): Pick<CSSProperties, "background" | "color" | "border"> {
  if (status === "canceled" || status === "cancelled") {
    return { background: "#fef2f2", color: "#991b1b", border: "1px solid #fecaca" }
  }
  if (status === "invoiced") {
    return { background: "#f1f5f9", color: "#334155", border: "1px solid #cbd5e1" }
  }
  if (status === "delivered" || status === "completed") {
    return { background: "#ecfdf5", color: "#166534", border: "1px solid #86efac" }
  }
  if (status === "client_submission" || status === "client_revision_work") {
    return { background: "#fffbeb", color: "#854d0e", border: "1px solid #fde68a" }
  }
  if (status === "internal_production" || status === "internal_revision") {
    return { background: "#eef2ff", color: "#3730a3", border: "1px solid #c7d2fe" }
  }
  if (status === "not_started") {
    return { background: "#eff6ff", color: "#1e40af", border: "1px solid #93c5fd" }
  }
  if (status === "paused") {
    return { background: "#fefce8", color: "#854d0e", border: "1px solid #fde68a" }
  }
  if (status === "active") {
    return { background: "#ecfdf5", color: "#166534", border: "1px solid #86efac" }
  }
  return { background: "#f8fafc", color: "#475569", border: "1px solid #cbd5e1" }
}
