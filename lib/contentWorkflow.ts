export type ContentLinks = Record<string, string>

export type ContentRuleInput = {
  dueClientAt: string
  dueEditorAt: string
  status: string
  unitPrice: number
  billable: boolean
  materialStatus?: string | null
  draftStatus?: string | null
  finalStatus?: string | null
  assigneeEditorUserId?: string | null
  assigneeCheckerUserId?: string | null
  nextAction?: string | null
  revisionCount?: number | null
  estimatedCost?: number | null
  links?: ContentLinks
  todayYmd?: string | null
  integrationMissing?: boolean | null
}

import { CONTENT_WORKFLOW_STATUS_OPTIONS } from "./projectStatus.ts"

export type ContentWorkflowOption = {
  value: string
  label: string
  enabled?: boolean
}

export const MATERIAL_STATUS_OPTIONS = [
  { value: "not_ready", label: "未準備" },
  { value: "collecting", label: "収集中" },
  { value: "ready", label: "準備完了" },
  { value: "approved", label: "確認済み" },
] as const

export const DRAFT_STATUS_OPTIONS = [
  { value: "not_started", label: "未着手" },
  { value: "drafting", label: "作成中" },
  { value: "reviewing", label: "確認中" },
  { value: "approved", label: "承認済み" },
] as const

export const FINAL_STATUS_OPTIONS = [
  { value: "not_started", label: "未着手" },
  { value: "assembling", label: "組み立て中" },
  { value: "ready", label: "納品準備完了" },
  { value: "delivered", label: "納品済み" },
] as const

export const WORKFLOW_STATUS_OPTIONS = CONTENT_WORKFLOW_STATUS_OPTIONS

/** 編集者側の提出シグナル相当（納期判定・旧ステータス互換） */
const EDITOR_SUBMITTED_STATUSES = new Set([
  "internal_revision",
  "client_submission",
  "client_revision_work",
  "delivered",
  "invoiced",
  "completed",
  "editing_revision",
  "submitted_to_client",
  "client_revision",
  "scheduling",
  "approved",
  "launched",
  "published",
])

/** 先方提出済み相当（納期判定・旧ステータス互換） */
const CLIENT_SUBMITTED_STATUSES = new Set([
  "client_submission",
  "client_revision_work",
  "delivered",
  "invoiced",
  "completed",
  "submitted_to_client",
  "client_revision",
  "scheduling",
  "approved",
  "launched",
  "published",
])

export const CLOSED_WORKFLOW_STATUSES = new Set([
  "delivered",
  "invoiced",
  "completed",
  "canceled",
  "cancelled",
  "archive",
  "approved",
  "launched",
  "published",
])

/** 請求ドラフト対象になりうる「納品相当」（請求済みステータスは含めない） */
export const BILLABLE_DONE_WORKFLOW_STATUSES = new Set([
  "delivered",
  "completed",
  "approved",
  "launched",
  "published",
])

const normalizeWorkflowStatusValue = (status: string | null | undefined) => {
  const normalized = typeof status === "string" ? status.trim() : ""
  return normalized === "cancelled" ? "canceled" : normalized
}

/**
 * 先方/編集納期の比較用。`date` / `timestamptz` の文字列表現が混在してもブラウザのローカル暦で YYYY-MM-DD に揃える。
 * （UTC の日付だけ切り出すと JST 利用時に「遅れ」が 1 日ずれることがある）
 */
export function normalizeContentDueYmd(value: string | null | undefined): string {
  if (typeof value !== "string") return ""
  const s = value.trim()
  if (!s) return ""
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s
  const t = Date.parse(s)
  if (Number.isNaN(t)) {
    const head = s.slice(0, 10)
    return /^\d{4}-\d{2}-\d{2}$/.test(head) ? head : ""
  }
  const d = new Date(t)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, "0")
  const day = String(d.getDate()).padStart(2, "0")
  return `${y}-${m}-${day}`
}

export function hasEditorSubmissionSignal(status: string | null | undefined, editorSubmittedAt?: string | null) {
  if (typeof editorSubmittedAt === "string" && editorSubmittedAt.trim().length > 0) return true
  return EDITOR_SUBMITTED_STATUSES.has(normalizeWorkflowStatusValue(status))
}

export function hasClientSubmissionSignal(status: string | null | undefined, clientSubmittedAt?: string | null) {
  if (typeof clientSubmittedAt === "string" && clientSubmittedAt.trim().length > 0) return true
  return CLIENT_SUBMITTED_STATUSES.has(normalizeWorkflowStatusValue(status))
}

export function isContentClosedStatus(status: string | null | undefined) {
  return CLOSED_WORKFLOW_STATUSES.has(normalizeWorkflowStatusValue(status))
}

/** 案件 ID なし（NULL / 空文字）を同一視。RLS や JSON 経由で undefined になる場合もある */
export function isContentWithoutProject(projectId: string | null | undefined) {
  return projectId == null || String(projectId).trim() === ""
}

/**
 * 請求・対象月チップと一致させる YYYY-MM。
 * delivery_month は DB 上 YYYY-MM だが、UI では normalizeContentDueYmd 後に YYYY-MM-DD になることがある。
 */
export function getContentBillingMonthYm(
  deliveryMonthOrYmd: string | null | undefined,
  dueClientAt: string | null | undefined
): string {
  const dm = typeof deliveryMonthOrYmd === "string" ? deliveryMonthOrYmd.trim() : ""
  if (/^\d{4}-\d{2}$/.test(dm)) return dm
  if (/^\d{4}-\d{2}-\d{2}/.test(dm)) return dm.slice(0, 7)
  const due = typeof dueClientAt === "string" ? dueClientAt.trim() : ""
  if (/^\d{4}-\d{2}-\d{2}/.test(due)) return due.slice(0, 7)
  if (/^\d{4}-\d{2}$/.test(due)) return due
  return ""
}

export function isBillableDoneStatus(status: string | null | undefined) {
  return BILLABLE_DONE_WORKFLOW_STATUSES.has(normalizeWorkflowStatusValue(status))
}

export function isContentClientOverdue(
  status: string | null | undefined,
  dueClientAt: string | null | undefined,
  todayYmd: string,
  clientSubmittedAt?: string | null
) {
  const due = normalizeContentDueYmd(dueClientAt)
  if (!due) return false
  if (hasClientSubmissionSignal(status, clientSubmittedAt)) return false
  return due < todayYmd
}

export function isContentEditorOverdue(
  status: string | null | undefined,
  dueEditorAt: string | null | undefined,
  todayYmd: string,
  editorSubmittedAt?: string | null
) {
  const due = normalizeContentDueYmd(dueEditorAt)
  if (!due) return false
  if (hasEditorSubmissionSignal(status, editorSubmittedAt)) return false
  return due < todayYmd
}

const cloneWorkflowOptions = (options: ReadonlyArray<ContentWorkflowOption>) =>
  options.map((option) => ({ ...option }))

export function normalizeContentWorkflowOptions(
  raw: unknown,
  fallback: ReadonlyArray<ContentWorkflowOption>
) {
  const fallbackMap = new Map(fallback.map((option) => [option.value, option]))
  if (!Array.isArray(raw)) return cloneWorkflowOptions(fallback)

  const seen = new Set<string>()
  const normalized: ContentWorkflowOption[] = []

  for (const entry of raw) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue

    const value = typeof entry.value === "string" ? entry.value.trim() : ""
    if (!value || seen.has(value) || !fallbackMap.has(value)) continue

    const base = fallbackMap.get(value)!
    normalized.push({
      value,
      label: typeof entry.label === "string" && entry.label.trim() ? entry.label.trim() : base.label,
      enabled: typeof entry.enabled === "boolean" ? entry.enabled : true,
    })
    seen.add(value)
  }

  for (const option of fallback) {
    if (seen.has(option.value)) continue
    normalized.push({ ...option })
  }

  return normalized
}

export function buildContentWorkflowLabelMap(options: ReadonlyArray<ContentWorkflowOption>) {
  return Object.fromEntries(options.map((option) => [option.value, option.label])) as Record<string, string>
}

export function getVisibleContentWorkflowOptions(options: ReadonlyArray<ContentWorkflowOption>) {
  const visible = options.filter((option) => option.enabled !== false)
  return visible.length > 0 ? visible : cloneWorkflowOptions(options)
}

export function getRenderableContentWorkflowOptions(
  options: ReadonlyArray<ContentWorkflowOption>,
  currentValue?: string | null
) {
  const visible = getVisibleContentWorkflowOptions(options)
  const normalizedCurrentValue = typeof currentValue === "string" ? currentValue.trim() : ""
  if (!normalizedCurrentValue) return visible

  const current =
    options.find((option) => option.value === normalizedCurrentValue) ??
    visible.find((option) => option.value === normalizedCurrentValue)

  if (!current) {
    return [{ value: normalizedCurrentValue, label: normalizedCurrentValue, enabled: true }, ...visible]
  }

  if (current.enabled === false) {
    return [{ ...current, enabled: true }, ...visible]
  }

  return visible
}

export function normalizeContentLinks(raw: unknown): ContentLinks {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {}
  return Object.fromEntries(
    Object.entries(raw as Record<string, unknown>)
      .map(([key, value]) => [key, typeof value === "string" ? value.trim() : ""])
      .filter(([, value]) => value.length > 0)
  )
}

export function hasAnyContentLink(links: ContentLinks | undefined | null) {
  if (!links) return false
  return Object.values(links).some((value) => value.trim().length > 0)
}

export function validateContentRules(input: ContentRuleInput) {
  const errors: string[] = []
  const revisionCount = Number(input.revisionCount ?? 0)
  const estimatedCost = Number(input.estimatedCost ?? 0)

  const dueClientNorm = normalizeContentDueYmd(input.dueClientAt)
  const dueEditorNorm = normalizeContentDueYmd(input.dueEditorAt)
  if (dueClientNorm && dueEditorNorm && dueEditorNorm > dueClientNorm) {
    errors.push("編集者提出日は先方提出日以前である必要があります。")
  }

  if (input.billable && Number(input.unitPrice) <= 0) {
    errors.push("請求対象のコンテンツには単価が必要です。")
  }

  if (Number(input.unitPrice) > 0 && estimatedCost > Number(input.unitPrice)) {
    errors.push("想定原価が売上を上回っています。利益条件を確認してください。")
  }

  if (revisionCount >= 5) {
    errors.push("修正回数が多すぎます。仕様変更または追加請求の判断を行ってください。")
  }

  return errors
}

export function buildContentHealthScore(input: ContentRuleInput) {
  let score = 100
  const todayYmd = input.todayYmd ?? null
  const revisionCount = Number(input.revisionCount ?? 0)
  const estimatedCost = Number(input.estimatedCost ?? 0)

  if (Number(input.unitPrice) <= 0) score -= 25
  const dueCn = normalizeContentDueYmd(input.dueClientAt)
  const dueEn = normalizeContentDueYmd(input.dueEditorAt)
  if (dueCn && dueEn && dueEn > dueCn) score -= 35
  if (revisionCount >= 3) score -= 10
  if (Number(input.unitPrice) > 0 && estimatedCost > Number(input.unitPrice)) score -= 20
  if (input.integrationMissing) score -= 10
  if (
    todayYmd &&
    dueCn &&
    dueCn < todayYmd &&
    !hasClientSubmissionSignal(input.status) &&
    !isContentClosedStatus(input.status)
  ) {
    score -= 15
  }

  return Math.max(0, Math.min(100, score))
}
