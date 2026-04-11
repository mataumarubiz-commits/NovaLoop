import {
  getContentBillingMonthYm,
  hasClientSubmissionSignal,
  hasEditorSubmissionSignal,
  isContentClientOverdue,
  isContentClosedStatus,
  isContentEditorOverdue,
  normalizeContentDueYmd,
  normalizeContentLinks,
} from "./contentWorkflow.ts"
import type {
  ChangeRequestRow,
  ProjectRow,
  ProjectSummary,
  RateCardRow,
  WorkspaceContent,
} from "./projectWorkspace.ts"

export type ProjectBoardStatus = "not_started" | "in_progress" | "awaiting_submission" | "revision" | "done" | "paused"
export type ProjectBoardWaitState = "none" | "materials" | "client" | "vendor"
export type ProjectBoardTag = "materials" | "client" | "vendor" | "spec" | "risk" | "priority"
export type ProjectBillingType = "spot" | "monthly"
export type ProjectsWorkspaceQuickFilter =
  | "all"
  | "today"
  | "week"
  | "overdue"
  | "revision"
  | "materials"
  | "vendor"
  | "tomorrow"

export type ProjectLinkItem = {
  key: string
  label: string
  url: string
  contentId: string
  contentTitle: string
}

export type ProjectBoardRow = {
  id: string
  project: ProjectRow
  summary: ProjectSummary
  contents: WorkspaceContent[]
  openContents: WorkspaceContent[]
  changes: ChangeRequestRow[]
  displayStatus: ProjectBoardStatus
  waitState: ProjectBoardWaitState
  tags: ProjectBoardTag[]
  dueDate: string
  dueTodayCount: number
  dueTomorrowCount: number
  dueThisWeekCount: number
  overdueCount: number
  revisionOpenCount: number
  materialWaitCount: number
  vendorWaitCount: number
  clientWaitCount: number
  updatedAt: string
  averageUnitPrice: number
  billingType: ProjectBillingType
  billingTypeLabel: string
  linkItems: ProjectLinkItem[]
}

type BuildBoardRowsParams = {
  summaries: ProjectSummary[]
  contents: WorkspaceContent[]
  changes: ChangeRequestRow[]
  rateCards: RateCardRow[]
  todayYmd: string
}

const DAYS_IN_WEEK_WINDOW = 7

const STATUS_LABELS: Record<ProjectBoardStatus, string> = {
  not_started: "未着手",
  in_progress: "進行中",
  awaiting_submission: "提出待ち",
  revision: "修正中",
  done: "完了",
  paused: "保留",
}

const WAIT_LABELS: Record<ProjectBoardWaitState, string> = {
  none: "進行可能",
  materials: "素材待ち",
  client: "先方待ち",
  vendor: "外注待ち",
}

const TAG_LABELS: Record<ProjectBoardTag, string> = {
  materials: "素材待ち",
  client: "先方待ち",
  vendor: "外注待ち",
  spec: "仕様変更",
  risk: "納期危険",
  priority: "優先高",
}

const STATUS_STYLES: Record<ProjectBoardStatus, { background: string; border: string; color: string }> = {
  not_started: { background: "#f3f4f6", border: "#d1d5db", color: "#4b5563" },
  in_progress: { background: "#eff6ff", border: "#bfdbfe", color: "#1d4ed8" },
  awaiting_submission: { background: "#eff6ff", border: "#93c5fd", color: "#1d4ed8" },
  revision: { background: "#fffbeb", border: "#fcd34d", color: "#92400e" },
  done: { background: "#ecfdf5", border: "#86efac", color: "#166534" },
  paused: { background: "#f3f4f6", border: "#d1d5db", color: "#4b5563" },
}

const WAIT_STYLES: Record<ProjectBoardWaitState, { background: string; border: string; color: string }> = {
  none: { background: "#f8fafc", border: "#cbd5e1", color: "#475569" },
  materials: { background: "#fffbeb", border: "#fcd34d", color: "#92400e" },
  client: { background: "#fff7ed", border: "#fdba74", color: "#c2410c" },
  vendor: { background: "#fff7ed", border: "#fdba74", color: "#c2410c" },
}

const TAG_STYLES: Record<ProjectBoardTag, { background: string; border: string; color: string }> = {
  materials: WAIT_STYLES.materials,
  client: WAIT_STYLES.client,
  vendor: WAIT_STYLES.vendor,
  spec: { background: "#f8fafc", border: "#cbd5e1", color: "#475569" },
  risk: { background: "#fef2f2", border: "#fca5a5", color: "#b91c1c" },
  priority: { background: "#eef2ff", border: "#c7d2fe", color: "#4338ca" },
}

const REVISION_STATUSES = new Set(["internal_revision", "client_revision_work", "client_revision", "editing_revision"])
const SUBMISSION_STATUSES = new Set(["client_submission", "submitted_to_client", "scheduling"])
const DONE_STATUSES = new Set(["delivered", "completed", "invoiced", "approved", "published", "launched"])
const MONTHLY_CONTRACT_TYPES = new Set(["monthly", "retainer"])
const MATERIAL_WAIT_STATUSES = new Set(["not_ready", "collecting"])

function toDate(value: string) {
  const normalized = normalizeContentDueYmd(value)
  return normalized ? new Date(`${normalized}T00:00:00`) : null
}

function addDaysYmd(value: string, days: number) {
  const base = toDate(value)
  if (!base) return ""
  base.setDate(base.getDate() + days)
  const year = base.getFullYear()
  const month = String(base.getMonth() + 1).padStart(2, "0")
  const day = String(base.getDate()).padStart(2, "0")
  return `${year}-${month}-${day}`
}

function diffDays(from: string, to: string) {
  const left = toDate(from)
  const right = toDate(to)
  if (!left || !right) return 0
  return Math.round((right.getTime() - left.getTime()) / 86_400_000)
}

function inferLinkLabel(key: string) {
  const normalized = key.trim().toLowerCase()
  if (normalized.includes("material") || normalized.includes("raw")) return "素材リンク"
  if (normalized.includes("draft") || normalized.includes("revision")) return "修正稿"
  if (normalized.includes("private") || normalized.includes("preview") || normalized.includes("limited")) return "限定公開URL"
  if (normalized.includes("mp4") || normalized.includes("movie") || normalized.includes("video")) return "mp4"
  if (normalized.includes("final")) return "納品データ"
  return key.trim() || "リンク"
}

function buildLinkItems(rows: WorkspaceContent[]) {
  const items: ProjectLinkItem[] = []
  const seen = new Set<string>()
  for (const row of rows) {
    const links = normalizeContentLinks(row.links_json)
    for (const [key, url] of Object.entries(links)) {
      const dedupeKey = `${row.id}:${key}:${url}`
      if (!url || seen.has(dedupeKey)) continue
      seen.add(dedupeKey)
      items.push({
        key,
        label: inferLinkLabel(key),
        url,
        contentId: row.id,
        contentTitle: row.title,
      })
      if (items.length >= 10) return items
    }
  }
  return items
}

function resolveBillingType(project: ProjectRow): ProjectBillingType {
  return MONTHLY_CONTRACT_TYPES.has(project.contract_type) ? "monthly" : "spot"
}

function waitSignalIncludes(text: string | null | undefined, keywords: string[]) {
  const value = String(text ?? "").toLowerCase()
  return keywords.some((keyword) => value.includes(keyword))
}

function deriveDisplayStatus(project: ProjectRow, openContents: WorkspaceContent[]) {
  const status = project.status === "active" ? "internal_production" : project.status
  if (status === "paused") return "paused"
  if (status === "not_started") return "not_started"
  if (DONE_STATUSES.has(status)) return "done"
  if (REVISION_STATUSES.has(status)) return "revision"
  if (SUBMISSION_STATUSES.has(status)) return "awaiting_submission"
  if (openContents.some((row) => REVISION_STATUSES.has(row.status) || Number(row.revision_count ?? 0) > 0)) return "revision"
  if (openContents.some((row) => SUBMISSION_STATUSES.has(row.status) || hasEditorSubmissionSignal(row.status, row.editor_submitted_at))) return "awaiting_submission"
  if (openContents.length === 0) return status === "completed" ? "done" : "not_started"
  return "in_progress"
}

function deriveWaitState(params: {
  openContents: WorkspaceContent[]
  materialWaitCount: number
  vendorWaitCount: number
  clientWaitCount: number
}): ProjectBoardWaitState {
  const { openContents, materialWaitCount, vendorWaitCount, clientWaitCount } = params
  if (materialWaitCount > 0) return "materials"
  if (clientWaitCount > 0) return "client"
  if (vendorWaitCount > 0) return "vendor"
  if (openContents.length === 0) return "none"
  return "none"
}

export function buildProjectBoardRows(params: BuildBoardRowsParams) {
  const weekEndYmd = addDaysYmd(params.todayYmd, DAYS_IN_WEEK_WINDOW - 1)

  return params.summaries.map((summary) => {
    const projectContents = params.contents
      .filter((row) => row.project_id === summary.project.id)
      .sort((left, right) => normalizeContentDueYmd(left.due_client_at).localeCompare(normalizeContentDueYmd(right.due_client_at)))
    const openContents = projectContents.filter((row) => !isContentClosedStatus(row.status))
    const activeContents = openContents.length > 0 ? openContents : projectContents
    const projectChanges = params.changes
      .filter((row) => row.project_id === summary.project.id)
      .sort((left, right) => String(right.created_at ?? "").localeCompare(String(left.created_at ?? "")))
    const candidateRateCards = params.rateCards
      .filter((row) => row.project_id === summary.project.id || (!row.project_id && row.client_id === summary.project.client_id))
      .sort((left, right) => String(right.effective_from ?? "").localeCompare(String(left.effective_from ?? "")))

    const dueRows = openContents.filter((row) => !hasClientSubmissionSignal(row.status, row.client_submitted_at))
    const dueDates = dueRows.map((row) => normalizeContentDueYmd(row.due_client_at)).filter(Boolean).sort()
    const dueDate = dueDates[0] ?? normalizeContentDueYmd(summary.project.end_date ?? "") ?? ""

    const dueTodayCount = dueRows.filter((row) => normalizeContentDueYmd(row.due_client_at) === params.todayYmd).length
    const dueTomorrowCount = dueRows.filter((row) => normalizeContentDueYmd(row.due_client_at) === addDaysYmd(params.todayYmd, 1)).length
    const dueThisWeekCount = dueRows.filter((row) => {
      const due = normalizeContentDueYmd(row.due_client_at)
      return Boolean(due) && due >= params.todayYmd && due <= weekEndYmd
    }).length
    const overdueCount = dueRows.filter((row) =>
      isContentClientOverdue(row.status, row.due_client_at, params.todayYmd, row.client_submitted_at)
    ).length
    const revisionOpenCount = openContents.filter(
      (row) => REVISION_STATUSES.has(row.status) || Number(row.revision_count ?? 0) > 0
    ).length
    const materialWaitCount = openContents.filter((row) => MATERIAL_WAIT_STATUSES.has(row.material_status ?? "not_ready")).length
    const vendorWaitCount = openContents.filter((row) => {
      if (isContentEditorOverdue(row.status, row.due_editor_at, params.todayYmd, row.editor_submitted_at)) return true
      return (
        waitSignalIncludes(row.blocked_reason, ["外注", "editor", "vendor"]) ||
        waitSignalIncludes(row.next_action, ["外注", "editor", "vendor"])
      )
    }).length
    const clientWaitCount = openContents.filter((row) => {
      return (
        waitSignalIncludes(row.blocked_reason, ["先方", "client", "確認待ち"]) ||
        waitSignalIncludes(row.next_action, ["先方", "client", "確認待ち"])
      )
    }).length
    const displayStatus = deriveDisplayStatus(summary.project, openContents)
    const waitState = deriveWaitState({
      openContents,
      materialWaitCount,
      vendorWaitCount,
      clientWaitCount,
    })
    const averageUnitPriceSource = activeContents.length > 0 ? activeContents : projectContents
    const averageUnitPrice =
      averageUnitPriceSource.length > 0
        ? Math.round(averageUnitPriceSource.reduce((sum, row) => sum + Number(row.unit_price ?? 0), 0) / averageUnitPriceSource.length)
        : Number(candidateRateCards[0]?.sales_unit_price ?? 0)
    const tags: ProjectBoardTag[] = []
    if (materialWaitCount > 0) tags.push("materials")
    if (clientWaitCount > 0) tags.push("client")
    if (vendorWaitCount > 0) tags.push("vendor")
    if (projectChanges.length > 0) tags.push("spec")
    if (overdueCount > 0 || (dueDate && diffDays(params.todayYmd, dueDate) <= 1)) tags.push("risk")
    if (overdueCount > 0 || dueTodayCount > 0) tags.push("priority")

    return {
      id: summary.project.id,
      project: summary.project,
      summary,
      contents: projectContents,
      openContents,
      changes: projectChanges,
      displayStatus,
      waitState,
      tags,
      dueDate,
      dueTodayCount,
      dueTomorrowCount,
      dueThisWeekCount,
      overdueCount,
      revisionOpenCount,
      materialWaitCount,
      vendorWaitCount,
      clientWaitCount,
      updatedAt: summary.project.updated_at,
      averageUnitPrice,
      billingType: resolveBillingType(summary.project),
      billingTypeLabel: resolveBillingType(summary.project) === "monthly" ? "月額" : "スポット",
      linkItems: buildLinkItems(activeContents),
    } satisfies ProjectBoardRow
  })
}

export function getBoardStatusLabel(status: ProjectBoardStatus) {
  return STATUS_LABELS[status]
}

export function getBoardWaitLabel(waitState: ProjectBoardWaitState) {
  return WAIT_LABELS[waitState]
}

export function getBoardTagLabel(tag: ProjectBoardTag) {
  return TAG_LABELS[tag]
}

export function getBoardStatusStyle(status: ProjectBoardStatus) {
  return STATUS_STYLES[status]
}

export function getBoardWaitStyle(waitState: ProjectBoardWaitState) {
  return WAIT_STYLES[waitState]
}

export function getBoardTagStyle(tag: ProjectBoardTag) {
  return TAG_STYLES[tag]
}

export function resolveRawProjectStatus(nextStatus: ProjectBoardStatus, currentStatus: string) {
  const current = currentStatus === "active" ? "internal_production" : currentStatus
  if (nextStatus === "not_started") return "not_started"
  if (nextStatus === "in_progress") {
    return current === "paused" || DONE_STATUSES.has(current) ? "internal_production" : current
  }
  if (nextStatus === "awaiting_submission") {
    return SUBMISSION_STATUSES.has(current) ? current : "client_submission"
  }
  if (nextStatus === "revision") {
    return REVISION_STATUSES.has(current) ? current : "internal_revision"
  }
  if (nextStatus === "done") {
    return DONE_STATUSES.has(current) ? current : "completed"
  }
  return "paused"
}

export function formatShortDate(value: string) {
  const normalized = normalizeContentDueYmd(value)
  if (!normalized) return "-"
  const [, month, day] = normalized.split("-")
  return `${Number(month)} / ${Number(day)}`
}

export function formatDateTimeShort(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return "-"
  return date.toLocaleString("ja-JP", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })
}

export function buildCalendarDays(month: string) {
  const [yearText, monthText] = month.split("-")
  const year = Number(yearText)
  const monthIndex = Number(monthText) - 1
  const first = new Date(year, monthIndex, 1)
  const start = new Date(first)
  start.setDate(first.getDate() - first.getDay())
  const last = new Date(year, monthIndex + 1, 0)
  const end = new Date(last)
  end.setDate(last.getDate() + (6 - last.getDay()))

  const days: string[] = []
  const cursor = new Date(start)
  while (cursor <= end) {
    const yyyy = cursor.getFullYear()
    const mm = String(cursor.getMonth() + 1).padStart(2, "0")
    const dd = String(cursor.getDate()).padStart(2, "0")
    days.push(`${yyyy}-${mm}-${dd}`)
    cursor.setDate(cursor.getDate() + 1)
  }
  return days
}

export function isBoardRowInCurrentMonth(row: ProjectBoardRow, month: string) {
  if (row.dueDate && row.dueDate.startsWith(month)) return true
  return row.contents.some((content) => getContentBillingMonthYm(content.delivery_month, content.due_client_at) === month)
}

export function shiftYmd(value: string, days: number) {
  const base = toDate(value)
  if (!base) return value
  base.setDate(base.getDate() + days)
  const year = base.getFullYear()
  const month = String(base.getMonth() + 1).padStart(2, "0")
  const day = String(base.getDate()).padStart(2, "0")
  return `${year}-${month}-${day}`
}

export function resolveProjectsWorkspaceQueryState(focus: string | null): {
  quickFilter: ProjectsWorkspaceQuickFilter
  advancedOpen: boolean
} {
  if (focus === "client_overdue") return { quickFilter: "overdue", advancedOpen: false }
  if (focus === "editor_overdue") return { quickFilter: "vendor", advancedOpen: false }
  if (focus === "due_today") return { quickFilter: "today", advancedOpen: false }
  if (focus === "due_tomorrow") return { quickFilter: "tomorrow", advancedOpen: false }
  if (focus === "unlinked") return { quickFilter: "all", advancedOpen: true }
  return { quickFilter: "all", advancedOpen: false }
}
