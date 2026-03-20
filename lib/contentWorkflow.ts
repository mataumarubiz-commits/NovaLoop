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

export const WORKFLOW_STATUS_OPTIONS = [
  { value: "not_started", label: "未着手" },
  { value: "materials_checked", label: "素材確認" },
  { value: "editing", label: "編集中" },
  { value: "internal_revision", label: "内部確認" },
  { value: "editing_revision", label: "修正対応" },
  { value: "submitted_to_client", label: "先方提出" },
  { value: "client_revision", label: "先方修正" },
  { value: "scheduling", label: "予約投稿" },
  { value: "delivered", label: "納品完了" },
  { value: "published", label: "公開済み" },
  { value: "canceled", label: "キャンセル" },
] as const

const STATUS_REQUIRING_EDITOR = new Set([
  "editing",
  "internal_revision",
  "editing_revision",
  "submitted_to_client",
  "client_revision",
  "scheduling",
  "delivered",
  "published",
])

const STATUS_REQUIRING_CHECKER = new Set([
  "submitted_to_client",
  "client_revision",
  "scheduling",
  "delivered",
  "published",
])

const STATUS_REQUIRING_MATERIALS = new Set([
  "editing",
  "internal_revision",
  "editing_revision",
  "submitted_to_client",
  "client_revision",
  "scheduling",
  "delivered",
  "published",
])

const STATUS_REQUIRING_LINKS = new Set([
  "submitted_to_client",
  "scheduling",
  "delivered",
  "published",
])

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
  const materialStatus = input.materialStatus ?? "not_ready"
  const links = input.links ?? {}
  const revisionCount = Number(input.revisionCount ?? 0)
  const estimatedCost = Number(input.estimatedCost ?? 0)

  if (
    input.dueClientAt &&
    input.dueEditorAt &&
    /^\d{4}-\d{2}-\d{2}$/.test(input.dueClientAt) &&
    /^\d{4}-\d{2}-\d{2}$/.test(input.dueEditorAt) &&
    input.dueEditorAt > input.dueClientAt
  ) {
    errors.push("編集者提出日は先方提出日以前である必要があります。")
  }

  if (input.billable && Number(input.unitPrice) <= 0) {
    errors.push("請求対象のコンテンツには単価が必要です。")
  }

  if (STATUS_REQUIRING_MATERIALS.has(input.status) && materialStatus === "not_ready") {
    errors.push("素材が未準備のままでは進行ステータスへ進められません。")
  }

  if (STATUS_REQUIRING_EDITOR.has(input.status) && !input.assigneeEditorUserId) {
    errors.push("編集担当が未設定のままでは進行ステータスへ進められません。")
  }

  if (STATUS_REQUIRING_CHECKER.has(input.status) && !input.assigneeCheckerUserId) {
    errors.push("確認担当が未設定のままでは提出以降のステータスへ進められません。")
  }

  if (STATUS_REQUIRING_LINKS.has(input.status) && !hasAnyContentLink(links)) {
    errors.push("提出・公開系ステータスには必須リンクが必要です。")
  }

  if ((input.status === "editing" || input.status === "internal_revision") && !input.nextAction?.trim()) {
    errors.push("編集中または内部確認中の行には次アクションが必要です。")
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
  const materialStatus = input.materialStatus ?? "not_ready"
  const revisionCount = Number(input.revisionCount ?? 0)
  const estimatedCost = Number(input.estimatedCost ?? 0)
  const links = input.links ?? {}

  if (Number(input.unitPrice) <= 0) score -= 25
  if (input.dueEditorAt && input.dueClientAt && input.dueEditorAt > input.dueClientAt) score -= 35
  if (!input.assigneeEditorUserId) score -= 15
  if (!input.assigneeCheckerUserId) score -= 10
  if (!input.nextAction?.trim()) score -= 10
  if (materialStatus === "not_ready") score -= 10
  if (!hasAnyContentLink(links)) score -= 5
  if (revisionCount >= 3) score -= 10
  if (Number(input.unitPrice) > 0 && estimatedCost > Number(input.unitPrice)) score -= 20
  if (
    todayYmd &&
    input.dueClientAt &&
    input.dueClientAt < todayYmd &&
    input.status !== "delivered" &&
    input.status !== "published" &&
    input.status !== "canceled"
  ) {
    score -= 15
  }

  return Math.max(0, Math.min(100, score))
}
