"use client"

import Link from "next/link"
import { useCallback, useEffect, useState, useMemo, useRef, type CSSProperties } from "react"
import { useSearchParams } from "next/navigation"
import { supabase } from "../../lib/supabase"
import { useAuthOrg } from "@/hooks/useAuthOrg"
import ChecklistReturnButton from "@/components/home/ChecklistReturnButton"
import type { ApplyAiResultDetail } from "@/lib/aiClientEvents"
import {
  buildContentHealthScore,
  isContentClientOverdue,
  isContentEditorOverdue,
  normalizeContentLinks,
  validateContentRules,
  type ContentLinks,
} from "@/lib/contentWorkflow"
import {
  GUIDED_ADD_TYPE_OPTIONS,
  GUIDED_STATUS_OPTIONS,
  buildGuidedTitle,
  calculateGuidedAmount,
  getGuidedBillingModelLabel,
  getGuidedStatusLabel,
  getGuidedTemplateById,
  getGuidedTemplates,
  getGuidedUnitLabel,
  getMonthEndDate,
  type GuidedAddType,
  type GuidedTemplate,
} from "@/lib/contentsGuidedCatalog"
import GuideEmptyState from "@/components/shared/GuideEmptyState"

const tableStyle: CSSProperties = {
  width: "100%",
  borderCollapse: "collapse",
  background: "var(--table-bg)",
  tableLayout: "auto",
  fontSize: 13,
}

const thStyle: CSSProperties = {
  textAlign: "left",
  fontSize: 12,
  letterSpacing: "0.04em",
  color: "var(--muted)",
  fontWeight: 600,
  padding: "8px 10px",
  borderBottom: "1px solid var(--table-border)",
  background: "var(--table-header-bg)",
  position: "sticky",
  top: 0,
  zIndex: 1,
  whiteSpace: "nowrap",
}

const tdStyle: CSSProperties = {
  padding: "8px 10px",
  borderBottom: "1px solid var(--table-border)",
  fontSize: 13,
  fontWeight: 500,
  color: "var(--text)",
  verticalAlign: "middle",
}

/** クライアント・プロジェクト・タイトル用: 横読み省略表示 */
const tdTextStyle: CSSProperties = {
  ...tdStyle,
  maxWidth: 160,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
}
const tdTitleStyle: CSSProperties = {
  ...tdTextStyle,
  maxWidth: 220,
}

/** 対象月など chip 用スタイル */
const pillStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  padding: "1px 6px",
  borderRadius: 999,
  fontSize: 11,
  fontWeight: 600,
  background: "var(--chip-bg)",
  color: "var(--chip-text)",
  border: "1px solid var(--chip-border)",
}

/** 済・OK 用緑バッジ */
const badgeGreen: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  padding: "1px 6px",
  borderRadius: 999,
  fontSize: 11,
  fontWeight: 600,
  background: "#dcfce7",
  color: "#14532d",
  border: "1px solid #86efac",
}

/** 未・注意用黄バッジ */
const badgeAmber: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  padding: "1px 6px",
  borderRadius: 999,
  fontSize: 11,
  fontWeight: 600,
  background: "#fef3c7",
  color: "#92400e",
  border: "1px solid #fcd34d",
}

/** NG・削除系赤バッジ */
const badgeRed: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  padding: "1px 6px",
  borderRadius: 999,
  fontSize: 11,
  fontWeight: 600,
  background: "#fee2e2",
  color: "#7f1d1d",
  border: "1px solid #fca5a5",
}

/** 操作ボタン共通スタイル */
const actionBtnStyle: CSSProperties = {
  padding: "3px 8px",
  borderRadius: 6,
  border: "1px solid var(--button-secondary-border)",
  background: "var(--button-secondary-bg)",
  fontSize: 11,
  color: "var(--button-secondary-text)",
  cursor: "pointer",
  whiteSpace: "nowrap",
}

const formatCurrency = (value: number) =>
  new Intl.NumberFormat("ja-JP", {
    style: "currency",
    currency: "JPY",
    maximumFractionDigits: 0,
  }).format(Number(value || 0))

/** ステータス表示用の型 */
type ClientOption = {
  id: string
  name: string
}

type ProjectOption = {
  id: string
  clientId: string
  name: string
}

type MemberOption = {
  userId: string
  displayName?: string
  email?: string
  role: string
}

type ContentTemplate = {
  id: string
  name: string
  default_title: string | null
  default_unit_price: number | null
  default_project_name: string | null
  default_billable_flag: boolean | null
  default_status: string | null
  default_due_offset_days: number | null
  sort_order: number
}

type Row = {
  id: string
  clientId: string
  clientName: string
  projectId: string | null
  projectName: string
  title: string
  serviceName: string
  serviceCategory: string | null
  billingModel: string | null
  unitType: string | null
  quantity: number
  amount: number
  dueClientAt: string
  dueEditorAt: string
  publishAt: string | null
  unitPrice: number
  thumbnailDone: boolean
  billable: boolean
  deliveryMonth: string
  status: string
  invoiceId: string | null
  editorSubmittedAt: string | null
  clientSubmittedAt: string | null
  sequenceNo: number | null
  assigneeEditorUserId: string | null
  assigneeCheckerUserId: string | null
  revisionCount: number
  workloadPoints: number
  estimatedCost: number
  nextAction: string
  blockedReason: string
  materialStatus: string
  draftStatus: string
  finalStatus: string
  healthScore: number
  links: ContentLinks
}

type DetailDraft = {
  projectId: string
  projectName: string
  publishAt: string
  assigneeEditorUserId: string
  revisionCount: string
  workloadPoints: string
  estimatedCost: string
  nextAction: string
  blockedReason: string
  sequenceNo: string
  links: Record<string, string>
}

type SavedView = {
  id: string
  name: string
  filterDue: "" | "today" | "tomorrow" | "week" | "late"
  filterClientId: string
  filterProjectId: string
}

type GuidedIntakeForm = {
  clientId: string
  addType: GuidedAddType
  templateId: string
  projectId: string
  projectName: string
  targetMonth: string
  quantity: string
  unitPrice: string
  status: string
  customTitle: string
  dueClientAt: string
  showAdvanced: boolean
}

const SAVED_VIEW_STORAGE_KEY = "novaloop:contents:saved-views"

/** 未完了ではないステータス（納品・公開・没） */
const COMPLETED_STATUSES = new Set(["delivered", "published", "invoiced", "canceled", "cancelled"])

const isIncomplete = (status: string) => !COMPLETED_STATUSES.has(status)

/** 先方遅延: 先方提出前だけを遅延扱いにする */
const isClientLate = (row: Row, todayYmd: string) =>
  isContentClientOverdue(row.status, row.dueClientAt, todayYmd, row.clientSubmittedAt)

/** 外注遅延: 編集完了前だけを遅延扱いにする */
const isEditorLate = (row: Row, todayYmd: string) =>
  isContentEditorOverdue(row.status, row.dueEditorAt, todayYmd, row.editorSubmittedAt)

const buildContentProgressNote = (row: Row, todayYmd: string) => {
  if (isClientLate(row, todayYmd)) {
    return "先方提出日を過ぎています。影響範囲を確認し、今日中の対応方針を固めてください。"
  }
  if (isEditorLate(row, todayYmd)) {
    return "編集者提出が遅れています。進捗を確認し、必要なら日程の再調整を進めてください。"
  }
  return "大きな遅れはありません。次の更新タイミングだけ押さえておけば十分です。"
}

const buildContentNextAction = (row: Row, todayYmd: string) => {
  if (isClientLate(row, todayYmd)) {
    return "先方提出の可否と再調整の要否を確認し、関係者への連絡方針を決めてください。"
  }
  if (isEditorLate(row, todayYmd)) {
    return "編集者の提出見込みを確認し、差し替えや日程再調整の必要性を整理してください。"
  }
  if (row.status === "submitted_to_client") {
    return "先方確認待ちです。戻しの有無と次回の確認タイミングを共有してください。"
  }
  if (row.status === "delivered" || row.status === "published") {
    return "納品済みです。請求対象月と請求可否を最後に確認してください。"
  }
  return "次の更新担当と確認タイミングを決め、必要な共有先へ案内してください。"
}

const buildContentShareDraft = (row: Row, todayYmd: string) =>
  [
    `案件: ${row.clientName} / ${row.projectName}`,
    `タイトル: ${row.title}`,
    `状況: ${buildContentProgressNote(row, todayYmd)}`,
    `次アクション: ${buildContentNextAction(row, todayYmd)}`,
  ].join("\n")

function buildContentAiContext(row: Row, todayYmd: string) {
  return [
    `クライアント: ${row.clientName}`,
    `案件: ${row.projectName}`,
    `タイトル: ${row.title}`,
    `先方提出日: ${row.dueClientAt}`,
    `編集者提出日: ${row.dueEditorAt}`,
    `対象月: ${row.deliveryMonth || "-"}`,
    `単価: ${row.unitPrice}`,
    `ステータス: ${statusLabels[row.status] ?? row.status}`,
    `請求対象: ${row.billable ? "対象" : "対象外"}`,
    `進行メモ: ${buildContentProgressNote(row, todayYmd)}`,
    `次の行動: ${buildContentNextAction(row, todayYmd)}`,
  ].join("\n")
}

function buildContentAiMeta(row: Row) {
  return {
    sourceObject: "content",
    recordId: row.id,
    recordLabel: `${row.clientName} / ${row.projectName}`,
  }
}

const statusLabels: Record<string, string> = {
  not_started: "未着手",
  materials_checked: "進行中",
  editing: "編集中",
  internal_revision: "内部確認",
  editing_revision: "編集修正",
  billable: "請求対象",
  operating: "進行中",
  submitted_to_client: "先方提出",
  client_revision: "先方修正",
  scheduling: "公開調整",
  delivered: "納品済み",
  completed: "納品済み",
  approved: "請求対象",
  invoiced: "請求済み",
  published: "公開済み",
  launched: "公開済み",
  canceled: "キャンセル",
  cancelled: "キャンセル",
}

const createCurrentMonth = () => {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`
}

const toDateInputValue = (value: Date) => {
  const year = value.getFullYear()
  const month = String(value.getMonth() + 1).padStart(2, "0")
  const day = String(value.getDate()).padStart(2, "0")
  return `${year}-${month}-${day}`
}

const addDays = (dateStr: string, days: number) => {
  const date = new Date(`${dateStr}T00:00:00`)
  date.setDate(date.getDate() + days)
  return toDateInputValue(date)
}

const defaultGuidedTemplate = getGuidedTemplates("monthly_fixed")[0] ?? null

const createDefaultGuidedForm = (): GuidedIntakeForm => ({
  clientId: "",
  addType: "monthly_fixed",
  templateId: defaultGuidedTemplate?.id ?? "",
  projectId: "",
  projectName: "",
  targetMonth: createCurrentMonth(),
  quantity: String(defaultGuidedTemplate?.defaultQuantity ?? 1),
  unitPrice: String(defaultGuidedTemplate?.defaultUnitPrice ?? 0),
  status: defaultGuidedTemplate?.defaultStatus ?? "billable",
  customTitle: "",
  dueClientAt: getMonthEndDate(createCurrentMonth()),
  showAdvanced: false,
})

const DETAIL_LINK_KEYS = ["draft", "final", "publish", "proof", "reference"] as const

function buildDetailDraft(row: Row | null): DetailDraft {
  const links = normalizeContentLinks(row?.links ?? {})
  return {
    projectId: row?.projectId ?? "",
    projectName: row?.projectName ?? "",
    publishAt: row?.publishAt ?? "",
    assigneeEditorUserId: row?.assigneeEditorUserId ?? "",
    revisionCount: String(row?.revisionCount ?? 0),
    workloadPoints: String(row?.workloadPoints ?? 1),
    estimatedCost: String(row?.estimatedCost ?? 0),
    nextAction: row?.nextAction ?? "",
    blockedReason: row?.blockedReason ?? "",
    sequenceNo: row?.sequenceNo != null ? String(row.sequenceNo) : "",
    links: Object.fromEntries(DETAIL_LINK_KEYS.map((key) => [key, links[key] ?? ""])),
  }
}

function loadSavedViews() {
  if (typeof window === "undefined") return []
  try {
    const raw = window.localStorage.getItem(SAVED_VIEW_STORAGE_KEY)
    return raw ? (JSON.parse(raw) as SavedView[]) : []
  } catch {
    window.localStorage.removeItem(SAVED_VIEW_STORAGE_KEY)
    return []
  }
}

type OrgDebug = {
  userId: string | null
  orgId: string | null
  role: string | null
  error: string | null
}

const isMissingLinksJsonError = (message?: string | null) =>
  message?.includes("column contents.links_json does not exist") ?? false

const isMissingWorkItemFieldsError = (message?: string | null) =>
  message?.includes("column contents.service_name does not exist") ||
  message?.includes("column contents.quantity does not exist") ||
  message?.includes("column contents.amount does not exist") ||
  message?.includes("column contents.billing_model does not exist") ||
  message?.includes("column contents.service_category does not exist") ||
  message?.includes("column contents.unit_type does not exist")

const withoutLinksJson = (payload: Record<string, unknown>) => {
  if (!Object.prototype.hasOwnProperty.call(payload, "links_json")) return payload
  const next = { ...payload }
  delete next.links_json
  return next
}

const withoutWorkItemFields = (payload: Record<string, unknown>) => {
  const next = { ...payload }
  delete next.service_name
  delete next.service_category
  delete next.billing_model
  delete next.unit_type
  delete next.quantity
  delete next.amount
  return next
}

const prepareContentWritePayload = (
  payload: Record<string, unknown> | Record<string, unknown>[],
  supportsLinksJson: boolean | null,
  supportsWorkItemFields: boolean | null
) => {
  const sanitize = (item: Record<string, unknown>) => {
    let next = item
    if (supportsLinksJson === false) next = withoutLinksJson(next)
    if (supportsWorkItemFields === false) next = withoutWorkItemFields(next)
    return next
  }
  return Array.isArray(payload) ? payload.map((item) => sanitize(item)) : sanitize(payload)
}

export default function ContentsPage() {
  const { activeOrgId: orgId, role, user, loading: authLoading, needsOnboarding } = useAuthOrg({ redirectToOnboarding: true })
  const [rows, setRows] = useState<Row[]>([])
  const [clients, setClients] = useState<ClientOption[]>([])
  const [projects, setProjects] = useState<ProjectOption[]>([])
  const [members, setMembers] = useState<MemberOption[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [uiError, setUiError] = useState<string | null>(null)
  const [uiSuccess, setUiSuccess] = useState<string | null>(null)
  const [isAdding, setIsAdding] = useState(false)
  const [guidedStep, setGuidedStep] = useState<1 | 2>(1)
  const [guidedForm, setGuidedForm] = useState<GuidedIntakeForm>(createDefaultGuidedForm)
  const [showFilters, setShowFilters] = useState(false)
  const [isCreatingClient, setIsCreatingClient] = useState(false)
  const [creatingClient, setCreatingClient] = useState(false)
  const [newClientName, setNewClientName] = useState("")
  const [newClientType, setNewClientType] = useState<"corporate" | "individual">(
    "corporate"
  )
  const [debug, setDebug] = useState<OrgDebug>({
    userId: null,
    orgId: null,
    role: null,
    error: null,
  })
  const [form, setForm] = useState({
    clientId: "",
    projectId: "",
    projectName: "",
    title: "",
    dueClientAt: "",
    unitPrice: "",
  })
  const [templateClientId, setTemplateClientId] = useState("")
  const [templates, setTemplates] = useState<ContentTemplate[]>([])
  const [addingFromTemplateId, setAddingFromTemplateId] = useState<string | null>(null)
  const [bulkAdding, setBulkAdding] = useState(false)
  const [bulkTemplateId, setBulkTemplateId] = useState<string>("")
  const [bulkTextarea, setBulkTextarea] = useState("")
  const [bulkResultMessage, setBulkResultMessage] = useState<string | null>(null)
  type EditingCell = { rowId: string; field: "unitPrice" | "dueClientAt"; value: string }
  const [editingCell, setEditingCell] = useState<EditingCell | null>(null)
  const [savingRowIds, setSavingRowIds] = useState<Set<string>>(() => new Set())
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({})
  const [focusMonth, setFocusMonth] = useState(createCurrentMonth())
  const [filterDue, setFilterDue] = useState<"" | "today" | "tomorrow" | "week" | "late">("")
  const [filterClientId, setFilterClientId] = useState("")
  const [filterProjectId, setFilterProjectId] = useState("")
  const [filterStatus, setFilterStatus] = useState("")
  const [savedViews, setSavedViews] = useState<SavedView[]>(loadSavedViews)
  const [detailRow, setDetailRow] = useState<Row | null>(null)
  const [detailTitleDraft, setDetailTitleDraft] = useState("")
  const [detailShareDraft, setDetailShareDraft] = useState("")
  const [detailDraft, setDetailDraft] = useState<DetailDraft>(() => buildDetailDraft(null))
  const [supportsLinksJson, setSupportsLinksJson] = useState<boolean | null>(null)
  const [supportsWorkItemFields, setSupportsWorkItemFields] = useState<boolean | null>(null)
  const isMountedRef = useRef(false)
  const timeoutIdsRef = useRef<number[]>([])
  const searchParams = useSearchParams()
  const highlightId = searchParams.get("highlight")
  const openClientCreate = searchParams.get("newClient")
  const projectIdQuery = searchParams.get("projectId")
  const dueQuery = searchParams.get("due")
  const filterQuery = searchParams.get("filter")
  const isLoading = authLoading || loading

  const canEdit = role === "owner" || role === "executive_assistant"
  const selectedCreateClient = useMemo(
    () => clients.find((client) => client.id === form.clientId) ?? null,
    [clients, form.clientId]
  )
  const selectedTemplateClient = useMemo(
    () => clients.find((client) => client.id === templateClientId) ?? null,
    [clients, templateClientId]
  )
  const selectedProject = useMemo(
    () => projects.find((project) => project.id === form.projectId) ?? null,
    [form.projectId, projects]
  )
  const selectedGuidedProject = useMemo(
    () => projects.find((project) => project.id === guidedForm.projectId) ?? null,
    [guidedForm.projectId, projects]
  )
  const guidedTemplates = useMemo(
    () => getGuidedTemplates(guidedForm.addType),
    [guidedForm.addType]
  )
  const selectedGuidedTemplate = useMemo(
    () =>
      guidedTemplates.find((template) => template.id === guidedForm.templateId) ??
      getGuidedTemplateById(guidedForm.templateId) ??
      guidedTemplates[0] ??
      null,
    [guidedForm.templateId, guidedTemplates]
  )
  const selectedBulkTemplate = useMemo(
    () => templates.find((template) => template.id === bulkTemplateId) ?? templates[0] ?? null,
    [bulkTemplateId, templates]
  )
  const guidedProjects = useMemo(
    () => projects.filter((project) => !guidedForm.clientId || project.clientId === guidedForm.clientId),
    [guidedForm.clientId, projects]
  )
  const guidedPreviewTitle = useMemo(() => {
    if (!selectedGuidedTemplate) return ""
    return (
      guidedForm.customTitle.trim() ||
      buildGuidedTitle({
        serviceName: selectedGuidedTemplate.name,
        billingModel: selectedGuidedTemplate.billingModel,
        unitType: selectedGuidedTemplate.unitType,
        quantity: Number(guidedForm.quantity || selectedGuidedTemplate.defaultQuantity || 1),
        targetMonth: guidedForm.targetMonth,
      })
    )
  }, [guidedForm.customTitle, guidedForm.quantity, guidedForm.targetMonth, selectedGuidedTemplate])
  const guidedPreviewAmount = useMemo(
    () => calculateGuidedAmount(Number(guidedForm.quantity || 0), Number(guidedForm.unitPrice || 0)),
    [guidedForm.quantity, guidedForm.unitPrice]
  )

  const scheduleDelayedAction = useCallback((callback: () => void, delayMs: number) => {
    const timeoutId = window.setTimeout(() => {
      if (isMountedRef.current) callback()
    }, delayMs)
    timeoutIdsRef.current.push(timeoutId)
    return timeoutId
  }, [])

  const todayYmd = useMemo(() => {
    const d = new Date()
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
  }, [])

  const tomorrowYmd = useMemo(() => {
    const d = new Date()
    d.setDate(d.getDate() + 1)
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
  }, [])

  const weekStartYmd = useMemo(() => {
    const d = new Date()
    const day = d.getDay()
    const diff = d.getDate() - day + (day === 0 ? -6 : 1)
    d.setDate(diff)
    return d.toISOString().slice(0, 10)
  }, [])
  const weekEndYmd = useMemo(() => {
    const d = new Date(weekStartYmd)
    d.setDate(d.getDate() + 6)
    return d.toISOString().slice(0, 10)
  }, [weekStartYmd])

  const detectLinksJsonSupport = async (currentOrgId: string) => {
    const { error: linksError } = await supabase
      .from("contents")
      .select("links_json")
      .eq("org_id", currentOrgId)
      .limit(1)

    if (linksError && isMissingLinksJsonError(linksError.message)) {
      setSupportsLinksJson(false)
      return false
    }

    setSupportsLinksJson(true)
    return true
  }

  const detectWorkItemFieldSupport = async (currentOrgId: string) => {
    const { error: workItemError } = await supabase
      .from("contents")
      .select("service_name, quantity, amount, billing_model, service_category, unit_type")
      .eq("org_id", currentOrgId)
      .limit(1)

    if (workItemError && isMissingWorkItemFieldsError(workItemError.message)) {
      setSupportsWorkItemFields(false)
      return false
    }

    setSupportsWorkItemFields(true)
    return true
  }

  const insertContentsRows = async (payload: Record<string, unknown> | Record<string, unknown>[]) => {
    let result = await supabase
      .from("contents")
      .insert(prepareContentWritePayload(payload, supportsLinksJson, supportsWorkItemFields))
    if (result.error && isMissingLinksJsonError(result.error.message)) {
      setSupportsLinksJson(false)
      result = await supabase
        .from("contents")
        .insert(prepareContentWritePayload(payload, false, supportsWorkItemFields))
    }
    if (result.error && isMissingWorkItemFieldsError(result.error.message)) {
      setSupportsWorkItemFields(false)
      result = await supabase
        .from("contents")
        .insert(prepareContentWritePayload(payload, supportsLinksJson, false))
    }
    return result
  }

  const updateContentRow = async (rowId: string, payload: Record<string, unknown>) => {
    if (!orgId) {
      return { error: { message: "所属情報が取得できませんでした" } }
    }

    let result = await supabase
      .from("contents")
      .update(prepareContentWritePayload(payload, supportsLinksJson, supportsWorkItemFields))
      .eq("id", rowId)
      .eq("org_id", orgId)

    if (result.error && isMissingLinksJsonError(result.error.message)) {
      setSupportsLinksJson(false)
      result = await supabase
        .from("contents")
        .update(prepareContentWritePayload(payload, false, supportsWorkItemFields))
        .eq("id", rowId)
        .eq("org_id", orgId)
    }

    if (result.error && isMissingWorkItemFieldsError(result.error.message)) {
      setSupportsWorkItemFields(false)
      result = await supabase
        .from("contents")
        .update(prepareContentWritePayload(payload, supportsLinksJson, false))
        .eq("id", rowId)
        .eq("org_id", orgId)
    }

    return result
  }

  const filteredRows = useMemo(() => {
    let list = rows
    if (focusMonth) list = list.filter((r) => r.deliveryMonth === focusMonth)
    if (filterDue === "today") list = list.filter((r) => r.dueClientAt === todayYmd)
    else if (filterDue === "tomorrow") list = list.filter((r) => r.dueClientAt === tomorrowYmd)
    else if (filterDue === "week") list = list.filter((r) => r.dueClientAt >= weekStartYmd && r.dueClientAt <= weekEndYmd)
    else if (filterDue === "late") list = list.filter((r) => isClientLate(r, todayYmd) || isEditorLate(r, todayYmd))

    if (filterClientId) {
      const client = clients.find((c) => c.id === filterClientId)
      if (client) {
        list = list.filter((r) => r.clientName === client.name)
      }
    }

    if (filterProjectId) {
      list = list.filter((r) => r.projectId === filterProjectId)
    }

    if (filterStatus) {
      list = list.filter((r) => r.status === filterStatus)
    }

    return [...list].sort((a, b) => {
      const invoiceableA = Number(a.billable && !a.invoiceId)
      const invoiceableB = Number(b.billable && !b.invoiceId)
      if (invoiceableA !== invoiceableB) return invoiceableB - invoiceableA
      if (a.deliveryMonth !== b.deliveryMonth) return a.deliveryMonth < b.deliveryMonth ? 1 : -1
      if (a.clientName !== b.clientName) return a.clientName.localeCompare(b.clientName, "ja")
      if (a.dueClientAt !== b.dueClientAt) return a.dueClientAt < b.dueClientAt ? -1 : 1
      return a.title.localeCompare(b.title, "ja")
    })
  }, [
    rows,
    focusMonth,
    filterDue,
    filterClientId,
    filterProjectId,
    filterStatus,
    todayYmd,
    tomorrowYmd,
    weekStartYmd,
    weekEndYmd,
    clients,
  ])

  const invoicePreviewRows = useMemo(
    () => filteredRows.filter((row) => row.billable && !row.invoiceId),
    [filteredRows]
  )
  const invoicePreviewAmount = useMemo(
    () => invoicePreviewRows.reduce((sum, row) => sum + Number(row.amount || row.unitPrice), 0),
    [invoicePreviewRows]
  )
  const invoiceReadyCount = useMemo(
    () =>
      invoicePreviewRows.filter((row) =>
        ["billable", "operating", "delivered", "published", "approved", "completed"].includes(row.status)
      ).length,
    [invoicePreviewRows]
  )
  const lateCount = useMemo(
    () => filteredRows.filter((row) => isClientLate(row, todayYmd) || isEditorLate(row, todayYmd)).length,
    [filteredRows, todayYmd]
  )

  useEffect(() => {
    isMountedRef.current = true
    return () => {
      isMountedRef.current = false
      timeoutIdsRef.current.forEach((timeoutId) => window.clearTimeout(timeoutId))
      timeoutIdsRef.current = []
    }
  }, [])

  useEffect(() => {
    setDebug({ userId: user?.id ?? null, orgId: orgId ?? null, role, error: needsOnboarding ? "onboarding needed" : null })
  }, [user?.id, orgId, role, needsOnboarding])

  useEffect(() => {
    if (projectIdQuery) {
      setFilterProjectId(projectIdQuery)
    }
  }, [projectIdQuery])

  useEffect(() => {
    if (dueQuery === "today") setFilterDue("today")
    else if (dueQuery === "tomorrow") setFilterDue("tomorrow")
  }, [dueQuery])

  useEffect(() => {
    if (filterQuery === "client_overdue" || filterQuery === "editor_overdue") {
      setFilterDue("late")
    }
  }, [filterQuery])

  useEffect(() => {
    if (projectIdQuery || highlightId || dueQuery || filterQuery) {
      setFocusMonth("")
      setShowFilters(true)
    }
  }, [projectIdQuery, highlightId, dueQuery, filterQuery])

  useEffect(() => {
    if (typeof window === "undefined") return
    window.localStorage.setItem(SAVED_VIEW_STORAGE_KEY, JSON.stringify(savedViews))
  }, [savedViews])

  useEffect(() => {
    setDetailTitleDraft(detailRow?.title ?? "")
    setDetailShareDraft(detailRow ? buildContentShareDraft(detailRow, todayYmd) : "")
    setDetailDraft(buildDetailDraft(detailRow))
  }, [detailRow, todayYmd])

  useEffect(() => {
    if (!detailRow) return
    const latest = rows.find((row) => row.id === detailRow.id)
    if (latest && latest !== detailRow) {
      setDetailRow(latest)
    }
  }, [detailRow, rows])

  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<ApplyAiResultDetail>).detail
      if (detail?.source !== "contents" || !detail.result?.text) return
      if (detail.applyTarget === "contents_create_title") {
        setForm((prev) => ({ ...prev, title: detail.result.text }))
        setUiSuccess("AI結果を新規タイトルに反映しました")
        scheduleDelayedAction(() => setUiSuccess(null), 2500)
        return
      }
      if (detail.applyTarget === "contents_bulk_textarea") {
        setBulkTextarea(detail.result.text)
        setUiSuccess("AI結果を一括入力に反映しました")
        scheduleDelayedAction(() => setUiSuccess(null), 2500)
        return
      }
      if (detail.applyTarget === "contents_detail_title") {
        setDetailTitleDraft(detail.result.text)
        return
      }
      if (detail.applyTarget === "contents_detail_share_draft") {
        setDetailShareDraft(detail.result.text)
        setUiSuccess("AI結果を共有文ドラフトに反映しました")
        scheduleDelayedAction(() => setUiSuccess(null), 2500)
      }
    }

    window.addEventListener("apply-ai-result", handler as EventListener)
    return () => window.removeEventListener("apply-ai-result", handler as EventListener)
  }, [])

  const openContentTitleIdeas = (row: Row) => {
    setDetailRow(row)
    scheduleDelayedAction(() => {
      window.dispatchEvent(
        new CustomEvent("open-ai-palette", {
          detail: {
            source: "contents" as const,
            mode: "title_ideas" as const,
            text: row.title,
            compareText: row.title,
            context: buildContentAiContext(row, todayYmd),
            title: "コンテンツAI",
            applyLabel: "タイトル候補に反映",
            applyTarget: "contents_detail_title",
            applyTransform: "first_line" as const,
            meta: buildContentAiMeta(row),
          },
        })
      )
    }, 0)
  }

  const createContentAiContext = useMemo(
    () =>
      [
        `クライアント: ${selectedCreateClient?.name ?? "-"}`,
        `案件: ${form.projectName || "-"}`,
        `タイトル: ${form.title || "-"}`,
        `先方提出日: ${form.dueClientAt || "-"}`,
        `単価: ${form.unitPrice || "-"}`,
      ].join("\n"),
    [form.dueClientAt, form.projectName, form.title, form.unitPrice, selectedCreateClient?.name]
  )

  const bulkContentAiContext = useMemo(
    () =>
      [
        `クライアント: ${selectedTemplateClient?.name ?? "-"}`,
        `テンプレート: ${selectedBulkTemplate?.name ?? "-"}`,
        `案件: ${selectedBulkTemplate?.default_project_name ?? selectedBulkTemplate?.name ?? "-"}`,
        "一括追加の入力形式: YYYY-MM-DD[TAB]タイトル",
        "日付が含まれる行は保ちつつ、タイトル候補または整形結果を返してください。",
      ].join("\n"),
    [selectedBulkTemplate, selectedTemplateClient?.name]
  )

  const handleCopyDetailShareDraft = async () => {
    if (!detailShareDraft.trim()) return
    try {
      await navigator.clipboard.writeText(detailShareDraft)
      setUiSuccess("共有文ドラフトをコピーしました")
      scheduleDelayedAction(() => setUiSuccess(null), 2500)
    } catch (copyError) {
      setUiError(copyError instanceof Error ? copyError.message : "共有文ドラフトのコピーに失敗しました")
      scheduleDelayedAction(() => setUiError(null), 2500)
    }
  }

  const handleSaveView = () => {
    const name = window.prompt("保存ビュー名", filterProjectId ? "project-view" : "contents-view")
    if (!name?.trim()) return
    setSavedViews((prev) => [
      {
        id: crypto.randomUUID(),
        name: name.trim(),
        filterDue,
        filterClientId,
        filterProjectId,
      },
      ...prev,
    ].slice(0, 8))
  }

  const fetchClients = async (currentOrgId: string) => {
    const { data, error: fetchError } = await supabase
      .from("clients")
      .select("id, name")
      .eq("org_id", currentOrgId)
      .order("created_at", { ascending: false })

    if (fetchError) {
      setError(`クライアント取得に失敗しました: ${fetchError.message}`)
      return
    }

    setClients(data ?? [])
  }

  const fetchProjects = async (currentOrgId: string) => {
    const { data, error: fetchError } = await supabase
      .from("projects")
      .select("id, client_id, name")
      .eq("org_id", currentOrgId)
      .order("name")

    if (fetchError) {
      setProjects([])
      return
    }

    setProjects(
      (data ?? []).map((row) => ({
        id: row.id,
        clientId: row.client_id,
        name: row.name,
      }))
    )
  }

  const fetchMembers = async (currentOrgId: string) => {
    const { data } = await supabase.auth.getSession()
    const token = data.session?.access_token
    if (!token) {
      setMembers([])
      return
    }

    const res = await fetch(`/api/org/members?orgId=${encodeURIComponent(currentOrgId)}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    const json = (await res.json().catch(() => null)) as { ok?: boolean; members?: MemberOption[] } | null
    if (!res.ok || !json?.ok || !Array.isArray(json.members)) {
      setMembers([])
      return
    }
    setMembers(json.members)
  }

  const fetchContents = async (currentOrgId: string) => {
    const { data, error: fetchError } = await supabase
      .from("contents")
      .select("*, client:clients(name)")
      .eq("org_id", currentOrgId)
      .order("due_client_at", { ascending: true })

    if (fetchError) {
      setError(`コンテンツ取得に失敗しました: ${fetchError.message}`)
      return
    }

    const firstRow = data?.[0] as Record<string, unknown> | undefined
    if (firstRow) {
      setSupportsLinksJson(Object.prototype.hasOwnProperty.call(firstRow, "links_json"))
      setSupportsWorkItemFields(
        Object.prototype.hasOwnProperty.call(firstRow, "service_name") &&
          Object.prototype.hasOwnProperty.call(firstRow, "quantity") &&
          Object.prototype.hasOwnProperty.call(firstRow, "amount") &&
          Object.prototype.hasOwnProperty.call(firstRow, "billing_model") &&
          Object.prototype.hasOwnProperty.call(firstRow, "service_category") &&
          Object.prototype.hasOwnProperty.call(firstRow, "unit_type")
      )
    }

    const mapped = (data ?? []).map((row) => {
      const client = Array.isArray(row.client) ? row.client[0] : row.client
      const quantity = Number(row.quantity ?? 1)
      const unitPrice = Number(row.unit_price ?? 0)
      return {
      id: row.id,
    clientId: row.client_id,
      clientName: (client as { name?: string } | null)?.name ?? "",
      projectId: row.project_id ?? null,
      projectName: row.project_name,
      title: row.title,
      serviceName: row.service_name ?? row.title ?? row.project_name,
      serviceCategory: row.service_category ?? null,
      billingModel: row.billing_model ?? null,
      unitType: row.unit_type ?? null,
      quantity,
      amount: Number(row.amount ?? quantity * unitPrice),
      dueClientAt: row.due_client_at,
      dueEditorAt: row.due_editor_at,
      publishAt: row.publish_at ?? null,
      unitPrice,
      thumbnailDone: row.thumbnail_done,
      billable: row.billable_flag,
      deliveryMonth: row.delivery_month,
      status: row.status,
      invoiceId: row.invoice_id ?? null,
      editorSubmittedAt: row.editor_submitted_at ?? null,
      clientSubmittedAt: row.client_submitted_at ?? null,
      sequenceNo: row.sequence_no ?? null,
      assigneeEditorUserId: row.assignee_editor_user_id ?? null,
      assigneeCheckerUserId: row.assignee_checker_user_id ?? null,
      revisionCount: Number(row.revision_count ?? 0),
      workloadPoints: Number(row.workload_points ?? 1),
      estimatedCost: Number(row.estimated_cost ?? 0),
      nextAction: row.next_action ?? "",
      blockedReason: row.blocked_reason ?? "",
      materialStatus: row.material_status ?? "not_ready",
      draftStatus: row.draft_status ?? "not_started",
      finalStatus: row.final_status ?? "not_started",
      healthScore: Number(row.health_score ?? 100),
      links: normalizeContentLinks(row.links_json),
    }
    })

    setRows(mapped)
  }

  useEffect(() => {
    if (!orgId) return
    let active = true

    const load = async () => {
      setLoading(true)
      await Promise.all([
        fetchClients(orgId),
        fetchProjects(orgId),
        fetchMembers(orgId),
        detectLinksJsonSupport(orgId),
        detectWorkItemFieldSupport(orgId),
        fetchContents(orgId),
      ])
      if (active) setLoading(false)
    }

    void load()

    return () => {
      active = false
    }
  }, [orgId])

  useEffect(() => {
    if (!form.clientId && clients.length > 0) {
      setForm((prev) => ({ ...prev, clientId: clients[0].id }))
    }
  }, [clients, form.clientId])

  useEffect(() => {
    if (!guidedForm.clientId && clients.length > 0) {
      setGuidedForm((prev) => ({ ...prev, clientId: clients[0].id }))
    }
  }, [clients, guidedForm.clientId])

  useEffect(() => {
    if (!templateClientId && clients.length > 0) {
      setTemplateClientId(clients[0].id)
    }
  }, [clients, templateClientId])

  const hasClients = clients.length > 0

  useEffect(() => {
    if (!hasClients) {
      setIsAdding(false)
    }
  }, [hasClients])

  useEffect(() => {
    if (!hasClients) {
      setGuidedForm(createDefaultGuidedForm())
    }
  }, [hasClients])

  const openClientRegistration = useCallback(() => {
    setIsAdding(false)
    setUiError(null)
    setUiSuccess(null)
    setIsCreatingClient(true)
  }, [])

  useEffect(() => {
    if (openClientCreate === "1") {
      openClientRegistration()
    }
  }, [openClientCreate, openClientRegistration])

  const fetchTemplates = async (currentOrgId: string, clientId: string) => {
    const { data, error: fetchError } = await supabase
      .from("content_templates")
      .select(
        "id, name, default_title, default_unit_price, default_project_name, default_billable_flag, default_status, default_due_offset_days, sort_order"
      )
      .eq("org_id", currentOrgId)
      .in("client_id", [clientId, null])
      .order("sort_order", { ascending: true })

    if (fetchError) {
      setTemplates([])
      return
    }
    setTemplates(
      (data ?? []).map((r) => ({
        id: r.id,
        name: r.name,
        default_title: r.default_title ?? null,
        default_unit_price: r.default_unit_price != null ? Number(r.default_unit_price) : null,
        default_project_name: r.default_project_name ?? null,
        default_billable_flag: typeof r.default_billable_flag === "boolean" ? r.default_billable_flag : null,
        default_status: r.default_status ?? null,
        default_due_offset_days:
          typeof r.default_due_offset_days === "number" ? r.default_due_offset_days : null,
        sort_order: r.sort_order ?? 0,
      }))
    )
  }

  useEffect(() => {
    if (!orgId || !templateClientId) {
      setTemplates([])
      return
    }
    void fetchTemplates(orgId, templateClientId)
  }, [orgId, templateClientId])

  const canSubmit =
    form.clientId &&
    form.projectName &&
    form.title &&
    form.dueClientAt &&
    form.unitPrice

  const prepareContentPayload = (row: Row, patch: Record<string, unknown>) => {
    const payload = { ...patch }
    const dueClientAt = typeof payload.due_client_at === "string" ? payload.due_client_at : row.dueClientAt
    let dueEditorAt = typeof payload.due_editor_at === "string" ? payload.due_editor_at : row.dueEditorAt
    if (typeof payload.due_client_at === "string" && !("due_editor_at" in payload)) {
      dueEditorAt = addDays(payload.due_client_at, -3)
      payload.due_editor_at = dueEditorAt
    }
    if (/^\d{4}-\d{2}-\d{2}$/.test(dueClientAt)) {
      payload.delivery_month = dueClientAt.slice(0, 7)
    }

    const links = "links_json" in payload ? normalizeContentLinks(payload.links_json) : row.links
    const validation = {
      dueClientAt,
      dueEditorAt,
      status: String(payload.status ?? row.status),
      unitPrice: Number(payload.unit_price ?? row.unitPrice),
      billable: Boolean(payload.billable_flag ?? row.billable),
      materialStatus: String(payload.material_status ?? row.materialStatus),
      draftStatus: String(payload.draft_status ?? row.draftStatus),
      finalStatus: String(payload.final_status ?? row.finalStatus),
      assigneeEditorUserId: String(payload.assignee_editor_user_id ?? row.assigneeEditorUserId ?? "") || null,
      assigneeCheckerUserId: String(payload.assignee_checker_user_id ?? row.assigneeCheckerUserId ?? "") || null,
      nextAction: String(payload.next_action ?? row.nextAction ?? ""),
      revisionCount: Number(payload.revision_count ?? row.revisionCount ?? 0),
      estimatedCost: Number(payload.estimated_cost ?? row.estimatedCost ?? 0),
      links,
    }

    const errors = validateContentRules(validation)
    payload.health_score = buildContentHealthScore({
      ...validation,
      todayYmd,
    })

    return { payload, errors, links }
  }

  const createRowDraft = (params: {
    clientId: string
    projectId?: string | null
    projectName: string
    title: string
    serviceName?: string
    serviceCategory?: string | null
    billingModel?: string | null
    unitType?: string | null
    quantity?: number
    amount?: number
    dueClientAt: string
    unitPrice: number
    status?: string
    billable?: boolean
  }): Row => {
    const dueEditorAt = addDays(params.dueClientAt, -3)
    const quantity = Number(params.quantity ?? 1)
    const amount = Number(params.amount ?? quantity * params.unitPrice)
    return {
      id: "draft",
      clientId: params.clientId,
      clientName:
        clients.find((client) => client.id === params.clientId)?.name ??
        selectedCreateClient?.name ??
        selectedTemplateClient?.name ??
        "",
      projectId: params.projectId ?? null,
      projectName: params.projectName,
      title: params.title,
      serviceName: params.serviceName ?? params.title,
      serviceCategory: params.serviceCategory ?? null,
      billingModel: params.billingModel ?? null,
      unitType: params.unitType ?? null,
      quantity,
      amount,
      dueClientAt: params.dueClientAt,
      dueEditorAt,
      publishAt: null,
      unitPrice: params.unitPrice,
      thumbnailDone: false,
      billable: params.billable ?? true,
      deliveryMonth: params.dueClientAt.slice(0, 7),
      status: params.status ?? "not_started",
      invoiceId: null,
      editorSubmittedAt: null,
      clientSubmittedAt: null,
      sequenceNo: null,
      assigneeEditorUserId: null,
      assigneeCheckerUserId: null,
      revisionCount: 0,
      workloadPoints: 1,
      estimatedCost: 0,
      nextAction: "",
      blockedReason: "",
      materialStatus: "not_ready",
      draftStatus: "not_started",
      finalStatus: "not_started",
      healthScore: 100,
      links: {},
    }
  }

  /** 行更新: due_client_at 更新時に due_editor_at / delivery_month も再計算 */
  const updateContent = async (
    rowId: string,
    patch: Record<string, unknown>,
    prevRowSnapshot: Row,
    label: string
  ) => {
    void label
    if (!orgId) {
      setUiError("所属情報が取得できませんでした")
      return
    }
    setRowErrors((prev) => {
      const next = { ...prev }
      delete next[rowId]
      return next
    })
    setSavingRowIds((prev) => new Set(prev).add(rowId))
    const { payload, errors } = prepareContentPayload(prevRowSnapshot, patch)
    if (errors.length > 0) {
      setSavingRowIds((prev) => {
        const next = new Set(prev)
        next.delete(rowId)
        return next
      })
      setUiError(errors[0])
      return
    }
    try {
      const { error: updateError } = await updateContentRow(rowId, payload)

      if (updateError) {
        const shortMsg = updateError.message.length > 40 ? updateError.message.slice(0, 37) + "..." : updateError.message
        setRowErrors((prev) => ({ ...prev, [rowId]: shortMsg }))
        setUiError(`保存に失敗しました（${label}）: ${updateError.message}`)
        setRows((prev) => prev.map((r) => (r.id !== rowId ? r : { ...prevRowSnapshot })))
        return
      }
      setRowErrors((prev) => {
        const next = { ...prev }
        delete next[rowId]
        return next
      })
      await fetchContents(orgId)
      setUiSuccess("保存しました")
      scheduleDelayedAction(() => setUiSuccess(null), 2500)
    } finally {
      setSavingRowIds((prev) => {
        const next = new Set(prev)
        next.delete(rowId)
        return next
      })
    }
  }

  const handleSaveAsTemplate = async (row: Row) => {
    if (!canEdit) return
    setUiError(null)
    setUiSuccess(null)
    if (!orgId) {
      setUiError("所属情報が取得できませんでした")
      return
    }
    if (!row.clientId) {
      setUiError("クライアント情報が不足しているためテンプレート保存できません")
      return
    }
    const name = window.prompt("テンプレート名を入力してください", row.projectName || row.title)
    if (!name) return
    const { error: insertError } = await supabase.from("content_templates").insert({
      id: crypto.randomUUID(),
      org_id: orgId,
      client_id: row.clientId,
      name,
      default_project_name: row.projectName,
      default_title: row.title,
      default_unit_price: row.unitPrice,
      default_billable_flag: row.billable,
      default_status: row.status,
      default_due_offset_days: 0,
    })
    if (insertError) {
      setUiError(`テンプレート保存に失敗しました: ${insertError.message}`)
      return
    }
    setUiSuccess("テンプレートを保存しました")
    scheduleDelayedAction(() => setUiSuccess(null), 2500)
  }

  /** ステータス変更: contents 更新 + status_events に履歴 insert */
  const updateContentStatus = async (row: Row, newStatus: string) => {
    if (!orgId || !user?.id) {
      setUiError("所属またはユーザー情報が取得できませんでした")
      return
    }
    const status = newStatus === "cancelled" ? "canceled" : newStatus
    const { payload, errors } = prepareContentPayload(row, { status })
    const nonBlockingErrors = errors.filter(
      (message) => !message.includes("編集担当が未設定のまま進行ステータスへ進められません。")
    )
    if (nonBlockingErrors.length > 0) {
      setUiError(nonBlockingErrors[0])
      return
    }
    setRowErrors((prev) => {
      const next = { ...prev }
      delete next[row.id]
      return next
    })
    setSavingRowIds((prev) => new Set(prev).add(row.id))
    try {
      const { error: updateError } = await updateContentRow(row.id, payload)
      if (updateError) {
        setRowErrors((prev) => ({ ...prev, [row.id]: updateError.message.slice(0, 40) }))
        setUiError(`ステータス保存に失敗: ${updateError.message}`)
        return
      }
      const { error: eventError } = await supabase.from("status_events").insert({
        id: crypto.randomUUID(),
        org_id: orgId,
        content_id: row.id,
        from_status: row.status,
        to_status: status,
        changed_by: user.id,
      })
      if (eventError) {
        setUiError(`履歴の記録に失敗しました: ${eventError.message}`)
      }
      await fetchContents(orgId)
      setUiSuccess("ステータスを更新しました")
      scheduleDelayedAction(() => setUiSuccess(null), 2500)
    } finally {
      setSavingRowIds((prev) => {
        const next = new Set(prev)
        next.delete(row.id)
        return next
      })
    }
  }

  const handleStatusChange = async (row: Row, newStatus: string) => {
    if (!canEdit) return
    await updateContentStatus(row, newStatus)
  }

  const handleSetCanceled = async (row: Row) => {
    if (!canEdit) return
    await updateContent(row.id, { status: "canceled" }, row, "?")
  }

  const handleDuplicateRow = async (row: Row) => {
    if (!canEdit || !orgId) return

    const duplicateTitle = `${row.title} copy`
    const draftRow = createRowDraft({
      clientId: row.clientId,
      projectId: row.projectId,
      projectName: row.projectName,
      title: duplicateTitle,
      dueClientAt: row.dueClientAt,
      unitPrice: row.unitPrice,
      status: "not_started",
      billable: row.billable,
    })

    const { payload, errors } = prepareContentPayload(draftRow, {
      id: crypto.randomUUID(),
      org_id: orgId,
      client_id: row.clientId,
      project_id: row.projectId,
      project_name: row.projectName,
      title: duplicateTitle,
      due_client_at: row.dueClientAt,
      due_editor_at: row.dueEditorAt,
      publish_at: null,
      unit_price: row.unitPrice,
      thumbnail_done: false,
      billable_flag: row.billable,
      delivery_month: row.deliveryMonth,
      status: "not_started",
      editor_submitted_at: null,
      client_submitted_at: null,
      sequence_no: null,
      assignee_editor_user_id: row.assigneeEditorUserId,
      assignee_checker_user_id: row.assigneeCheckerUserId,
      revision_count: 0,
      workload_points: row.workloadPoints,
      estimated_cost: row.estimatedCost,
      next_action: row.nextAction || null,
      blocked_reason: row.blockedReason || null,
      material_status: row.materialStatus,
      draft_status: row.draftStatus,
      final_status: row.finalStatus,
      links_json: row.links,
    })

    if (errors.length > 0) {
      setUiError(errors[0])
      return
    }

    const { error: insertError } = await insertContentsRows(payload)
    if (insertError) {
      setUiError(`行複製に失敗しました: ${insertError.message}`)
      return
    }

    setUiSuccess("行を複製しました")
    scheduleDelayedAction(() => setUiSuccess(null), 2500)
    await fetchContents(orgId)
  }

  const handleThumbnailChange = async (row: Row, checked: boolean) => {
    if (!canEdit) return
    await updateContent(row.id, { thumbnail_done: checked }, row, "サムネ")
  }

  const handleBillableChange = async (row: Row, checked: boolean) => {
    if (!canEdit) return
    await updateContent(row.id, { billable_flag: checked }, row, "請求フラグ")
  }

  const handleUnitPriceBlur = async (row: Row, valueStr: string) => {
    if (!canEdit) {
      setEditingCell(null)
      return
    }
    setEditingCell(null)
    const n = Number(valueStr)
    if (Number.isNaN(n) || n < 0) return
    await updateContent(row.id, { unit_price: n }, row, "単価")
  }

  const handleDueClientSave = async (row: Row, valueStr: string) => {
    if (!canEdit) return
    if (!/^\d{4}-\d{2}-\d{2}$/.test(valueStr)) return
    await updateContent(row.id, { due_client_at: valueStr }, row, "先方提出日")
  }

  const handleSaveDetailTitle = async () => {
    if (!detailRow || !canEdit) return
    const nextTitle = detailTitleDraft.trim()
    if (!nextTitle || nextTitle === detailRow.title) return
    await updateContent(detailRow.id, { title: nextTitle }, detailRow, "タイトル")
    setDetailRow((prev) => (prev ? { ...prev, title: nextTitle } : prev))
  }

  const handleSaveDetailMeta = async () => {
    if (!detailRow || !canEdit) return
    const normalizedLinks = normalizeContentLinks(detailDraft.links)
    const projectName =
      detailDraft.projectName.trim() ||
      projects.find((project) => project.id === detailDraft.projectId)?.name ||
      detailRow.projectName

    await updateContent(
      detailRow.id,
      {
        project_id: detailDraft.projectId || null,
        project_name: projectName,
        publish_at: detailDraft.publishAt || null,
        assignee_editor_user_id: detailDraft.assigneeEditorUserId || null,
        revision_count: Number(detailDraft.revisionCount || 0),
        workload_points: Number(detailDraft.workloadPoints || 1),
        estimated_cost: Number(detailDraft.estimatedCost || 0),
        next_action: detailDraft.nextAction.trim() || null,
        blocked_reason: detailDraft.blockedReason.trim() || null,
        sequence_no: detailDraft.sequenceNo ? Number(detailDraft.sequenceNo) : null,
        links_json: normalizedLinks,
      },
      detailRow,
      "詳細"
    )
  }

  const openGuidedAdd = () => {
    const initialMonth = createCurrentMonth()
    const initialTemplate = getGuidedTemplates("monthly_fixed")[0] ?? null
    setGuidedStep(1)
    setIsAdding(true)
    setGuidedForm({
      clientId: "",
      addType: "monthly_fixed",
      templateId: initialTemplate?.id ?? "",
      projectId: "",
      projectName: "",
      targetMonth: initialMonth,
      quantity: String(initialTemplate?.defaultQuantity ?? 1),
      unitPrice: String(initialTemplate?.defaultUnitPrice ?? 0),
      status: initialTemplate?.defaultStatus ?? "billable",
      customTitle: "",
      dueClientAt: getMonthEndDate(initialMonth),
      showAdvanced: false,
    })
  }

  const handleGuidedAddTypeSelect = (addType: GuidedAddType) => {
    const nextTemplates = getGuidedTemplates(addType)
    const nextTemplate = nextTemplates[0] ?? null
    setGuidedForm((prev) => ({
      ...prev,
      addType,
      templateId: nextTemplate?.id ?? "",
      projectId: "",
      projectName: "",
      quantity: String(nextTemplate?.defaultQuantity ?? 1),
      unitPrice: String(nextTemplate?.defaultUnitPrice ?? 0),
      status: nextTemplate?.defaultStatus ?? "billable",
      customTitle: "",
    }))
  }

  const handleGuidedTemplateSelect = (template: GuidedTemplate) => {
    setGuidedForm((prev) => ({
      ...prev,
      templateId: template.id,
      quantity: String(template.defaultQuantity),
      unitPrice: String(template.defaultUnitPrice),
      status: template.defaultStatus,
      customTitle: "",
    }))
  }

  const handleGuidedAdd = async () => {
    if (!canEdit || !orgId || !selectedGuidedTemplate) return
    if (guidedForm.addType === "vendor_invoice") return
    const unitPrice = Number(guidedForm.unitPrice || 0)
    const quantity = Number(guidedForm.quantity || 1)
    if (!guidedForm.clientId) {
      setUiError("取引先を選択してください")
      return
    }
    if (!guidedForm.targetMonth) {
      setUiError("対象月を入力してください")
      return
    }
    if (!Number.isFinite(unitPrice) || unitPrice < 0) {
      setUiError("単価を正しく入力してください")
      return
    }
    if (!Number.isFinite(quantity) || quantity <= 0) {
      setUiError("数量を正しく入力してください")
      return
    }

    const dueClientAt = guidedForm.showAdvanced && guidedForm.dueClientAt
      ? guidedForm.dueClientAt
      : getMonthEndDate(guidedForm.targetMonth)
    const projectName =
      guidedForm.projectName.trim() ||
      selectedGuidedProject?.name ||
      selectedGuidedTemplate.name
    const title =
      guidedForm.customTitle.trim() ||
      buildGuidedTitle({
        serviceName: selectedGuidedTemplate.name,
        billingModel: selectedGuidedTemplate.billingModel,
        unitType: selectedGuidedTemplate.unitType,
        quantity,
        targetMonth: guidedForm.targetMonth,
      })

    const draft = createRowDraft({
      clientId: guidedForm.clientId,
      projectId: guidedForm.projectId || null,
      projectName,
      title,
      serviceName: selectedGuidedTemplate.name,
      serviceCategory: selectedGuidedTemplate.serviceCategory,
      billingModel: selectedGuidedTemplate.billingModel,
      unitType: selectedGuidedTemplate.unitType,
      quantity,
      amount: calculateGuidedAmount(quantity, unitPrice),
      dueClientAt,
      unitPrice,
      status: guidedForm.status,
      billable: guidedForm.status !== "invoiced",
    })

    const { payload, errors } = prepareContentPayload(draft, {
      id: crypto.randomUUID(),
      org_id: orgId,
      client_id: guidedForm.clientId,
      project_id: guidedForm.projectId || null,
      project_name: projectName,
      title,
      service_name: selectedGuidedTemplate.name,
      service_category: selectedGuidedTemplate.serviceCategory,
      billing_model: selectedGuidedTemplate.billingModel,
      unit_type: selectedGuidedTemplate.unitType,
      quantity,
      amount: calculateGuidedAmount(quantity, unitPrice),
      unit_price: unitPrice,
      due_client_at: dueClientAt,
      delivery_month: guidedForm.targetMonth,
      status: guidedForm.status,
      thumbnail_done: false,
      billable_flag: guidedForm.status !== "invoiced",
      publish_at: null,
      sequence_no: null,
      assignee_editor_user_id: null,
      assignee_checker_user_id: null,
      revision_count: 0,
      workload_points: Math.max(1, quantity),
      estimated_cost: 0,
      next_action: null,
      blocked_reason: null,
      material_status: "not_ready",
      draft_status: "not_started",
      final_status: "not_started",
      links_json: {},
    })

    if (errors.length > 0) {
      setUiError(errors[0])
      return
    }

    payload.delivery_month = guidedForm.targetMonth

    const { error: insertError } = await insertContentsRows(payload)
    if (insertError) {
      setUiError(`追加に失敗しました: ${insertError.message}`)
      return
    }

    await fetchContents(orgId)
    setFocusMonth(guidedForm.targetMonth)
    setUiSuccess("請求対象を追加しました")
    scheduleDelayedAction(() => setUiSuccess(null), 2500)
    setIsAdding(false)
    setGuidedStep(1)
    setGuidedForm(createDefaultGuidedForm())
  }

  const handleAdd = async () => {
    if (!canSubmit || !canEdit) return
    if (!orgId) {
      setError("トークンの取得に失敗しました")
      return
    }

    const projectName = form.projectName.trim() || selectedProject?.name || ""
    const draft = createRowDraft({
      clientId: form.clientId,
      projectId: form.projectId || null,
      projectName,
      title: form.title.trim(),
      dueClientAt: form.dueClientAt,
      unitPrice: Number(form.unitPrice),
    })
    const { payload, errors } = prepareContentPayload(draft, {
      id: crypto.randomUUID(),
      org_id: orgId,
      client_id: form.clientId,
      project_id: form.projectId || null,
      project_name: projectName,
      title: form.title.trim(),
      unit_price: Number(form.unitPrice),
      due_client_at: form.dueClientAt,
      status: "not_started",
      thumbnail_done: false,
      billable_flag: true,
      publish_at: null,
      sequence_no: null,
      assignee_editor_user_id: null,
      assignee_checker_user_id: null,
      revision_count: 0,
      workload_points: 1,
      estimated_cost: 0,
      next_action: null,
      blocked_reason: null,
      material_status: "not_ready",
      draft_status: "not_started",
      final_status: "not_started",
      links_json: {},
    })

    if (errors.length > 0) {
      setError(errors[0])
      return
    }

    const { error: insertError } = await insertContentsRows(payload)

    if (insertError) {
      setError(`追加に失敗しました: ${insertError.message}`)
      return
    }

    await fetchContents(orgId)
    setForm({
      clientId: clients[0]?.id ?? "",
      projectId: "",
      projectName: "",
      title: "",
      dueClientAt: "",
      unitPrice: "",
    })
    setIsAdding(false)
  }

  /** テンプレから1件追加: default_due_offset_days を反映して1行追加 */
  const handleAddFromTemplate = async (tpl: ContentTemplate) => {
    if (!orgId || !templateClientId || !canEdit) return
    const base = new Date()
    const offsetDays = tpl.default_due_offset_days ?? 0
    base.setDate(base.getDate() + offsetDays)
    const dueClientAt = toDateInputValue(base)
    const projectName = tpl.default_project_name ?? tpl.name
    const draft = createRowDraft({
      clientId: templateClientId,
      projectName,
      title: tpl.default_title ?? tpl.name,
      dueClientAt,
      unitPrice: Number(tpl.default_unit_price ?? 0),
      status: tpl.default_status ?? "not_started",
      billable: tpl.default_billable_flag ?? true,
    })
    setAddingFromTemplateId(tpl.id)
    setUiError(null)
    try {
      const { payload, errors } = prepareContentPayload(draft, {
        id: crypto.randomUUID(),
        org_id: orgId,
        client_id: templateClientId,
        project_name: projectName,
        title: tpl.default_title ?? tpl.name,
        unit_price: Number(tpl.default_unit_price ?? 0),
        due_client_at: dueClientAt,
        status: tpl.default_status ?? "not_started",
        thumbnail_done: false,
        billable_flag: tpl.default_billable_flag ?? true,
        publish_at: null,
        sequence_no: null,
        assignee_editor_user_id: null,
        assignee_checker_user_id: null,
        revision_count: 0,
        workload_points: 1,
        estimated_cost: 0,
        next_action: null,
        blocked_reason: null,
        material_status: "not_ready",
        draft_status: "not_started",
        final_status: "not_started",
        links_json: {},
      })
      if (errors.length > 0) {
        setUiError(errors[0])
        return
      }
      const { error: insertError } = await insertContentsRows(payload)
      if (insertError) {
        setUiError(`追加に失敗しました。しばらくして再試行してください。`)
        return
      }
      await fetchContents(orgId)
      setUiSuccess("追加しました")
      scheduleDelayedAction(() => setUiSuccess(null), 2500)
    } finally {
      setAddingFromTemplateId(null)
    }
  }

  const handleCreateClient = async () => {
    if (!canEdit) return
    setUiError(null)
    setUiSuccess(null)
    setError(null)

    try {
      const name = newClientName.trim()
      if (!name) {
        setUiError("クライアント名を入力してください")
        return
      }
      if (!orgId) {
        setUiError("トークンの取得に失敗しました")
        return
      }

      setCreatingClient(true)
      const clientId = crypto.randomUUID()
      const { error: insertError } = await supabase.from("clients").insert({
        id: clientId,
        org_id: orgId,
        name,
        client_type: newClientType,
      })

      if (insertError) {
        setUiError(`クライアント作成に失敗しました: ${insertError.message}`)
        return
      }

      await fetchClients(orgId)
      setForm((prev) => ({ ...prev, clientId }))
      setGuidedForm((prev) => ({ ...prev, clientId }))
      setNewClientName("")
      setIsCreatingClient(false)
      setUiSuccess("クライアントを作成しました")
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      setUiError(`クライアント作成に失敗しました: ${message}`)
    } finally {
      setCreatingClient(false)
    }
  }

  const clientCreateForm = (
    <section
      style={{
        marginBottom: 16,
        padding: "14px 16px",
        borderRadius: 12,
        border: "1px dashed var(--border)",
        background: "var(--surface)",
      }}
    >
      <div style={{ fontSize: 14, fontWeight: 600, color: "var(--text)" }}>
        クライアントを作成
      </div>
      {orgId && (
        <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 2 }}>
          org_id: {orgId}
        </div>
      )}
      <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 4 }}>
        名称と区分を入力してください。      </div>
      {uiError && (
        <div
          style={{
            marginTop: 8,
            padding: "6px 10px",
            borderRadius: 8,
            border: "1px solid #fecaca",
            background: "#fff1f2",
            color: "#b91c1c",
            fontSize: 12,
          }}
        >
          {uiError}
        </div>
      )}
      {uiSuccess && (
        <div
          style={{
            marginTop: 8,
            padding: "6px 10px",
            borderRadius: 8,
            border: "1px solid #bbf7d0",
            background: "#f0fdf4",
            color: "#166534",
            fontSize: 12,
          }}
        >
          {uiSuccess}
        </div>
      )}
      <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
        <input
          value={newClientName}
          onChange={(event) => setNewClientName(event.target.value)}
          placeholder="クライアント名"
          style={{
            padding: "8px 10px",
            borderRadius: 8,
            border: "1px solid var(--input-border)",
            background: "var(--input-bg)",
            color: "var(--input-text)",
            fontSize: 13,
            fontWeight: 500,
            minWidth: 200,
          }}
        />
        <select
          value={newClientType}
          onChange={(event) =>
            setNewClientType(event.target.value as "corporate" | "individual")
          }
          style={{
            padding: "8px 10px",
            borderRadius: 8,
            border: "1px solid var(--input-border)",
            background: "var(--input-bg)",
            color: "var(--input-text)",
            fontSize: 13,
            fontWeight: 500,
            cursor: "pointer",
          }}
        >
          <option value="corporate">法人</option>
          <option value="individual">個人</option>
        </select>
        <button
          type="button"
          style={{
            padding: "8px 12px",
            borderRadius: 8,
            border: "1px solid var(--button-primary-bg)",
            background: "var(--button-primary-bg)",
            color: "var(--primary-contrast)",
            fontSize: 12,
            cursor: "pointer",
          }}
          onClick={handleCreateClient}
          disabled={creatingClient}
        >
          {creatingClient ? "作成中..." : "作成"}
        </button>
        <button
          type="button"
          style={{
            padding: "8px 12px",
            borderRadius: 8,
            border: "1px solid var(--button-secondary-border)",
            background: "var(--button-secondary-bg)",
            color: "var(--button-secondary-text)",
            fontSize: 12,
            fontWeight: 500,
            cursor: "pointer",
          }}
          onClick={() => setIsCreatingClient(false)}
        >
          キャンセル
        </button>
      </div>
    </section>
  )

  return (
    <div
      style={{
        minHeight: "100vh",
        position: "relative",
      }}
    >
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: "var(--bg-grad)",
          pointerEvents: "none",
          zIndex: 0,
        }}
      />
      <div
        style={{
          padding: "32px 40px 60px",
          position: "relative",
          zIndex: 1,
          pointerEvents: "auto",
        }}
      >
        <div style={{ marginBottom: 16 }}>
          <ChecklistReturnButton />
        </div>
        <header style={{ marginBottom: 24, display: "grid", gap: 16 }}>
          <section
            style={{
              display: "grid",
              gap: 16,
              gridTemplateColumns: "minmax(0, 1.5fr) minmax(280px, 0.9fr)",
              padding: "22px 24px",
              borderRadius: 24,
              border: "1px solid color-mix(in srgb, var(--border) 84%, white 16%)",
              background:
                "linear-gradient(135deg, color-mix(in srgb, var(--surface) 86%, white 14%), color-mix(in srgb, #dbeafe 22%, var(--surface) 78%))",
              boxShadow: "0 18px 48px rgba(15, 23, 42, 0.08)",
            }}
          >
            <div style={{ display: "grid", gap: 12 }}>
              <div style={{ fontSize: 12, letterSpacing: "0.12em", color: "var(--muted)", fontWeight: 700 }}>
                BILLING INTAKE
              </div>
              <div>
                <h1 style={{ fontSize: 30, margin: "0 0 8px", color: "var(--text)", lineHeight: 1.15 }}>
                  今月請求するものを迷わず追加して確認する
                </h1>
                <p style={{ margin: 0, color: "var(--muted)", fontSize: 14, lineHeight: 1.8 }}>
                  Lycollection 向けに、この画面は「請求対象の追加と確認」に絞っています。取引先、追加タイプ、対象月、金額だけ決めれば十分です。
                  ワークフローや詳細リンクはあとから必要な分だけ触れます。
                </p>
              </div>
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
                {canEdit ? (
                  hasClients ? (
                    <button
                      type="button"
                      onClick={openGuidedAdd}
                      style={{
                        padding: "12px 16px",
                        borderRadius: 999,
                        border: "1px solid var(--button-primary-bg)",
                        background: "var(--button-primary-bg)",
                        color: "var(--primary-contrast)",
                        fontSize: 14,
                        fontWeight: 700,
                        cursor: "pointer",
                      }}
                    >
                      請求対象を追加
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={openClientRegistration}
                      style={{
                        padding: "12px 16px",
                        borderRadius: 999,
                        border: "1px solid var(--button-primary-bg)",
                        background: "var(--button-primary-bg)",
                        color: "var(--primary-contrast)",
                        fontSize: 14,
                        fontWeight: 700,
                        cursor: "pointer",
                      }}
                    >
                      取引先を追加
                    </button>
                  )
                ) : null}
                <div
                  style={{
                    fontSize: 12,
                    color: "var(--muted)",
                    maxWidth: 360,
                    lineHeight: 1.6,
                  }}
                >
                  案件全体の管理や連携設定は後回しで大丈夫です。まずは今月請求するものだけをここに揃えます。
                </div>
                <button
                  type="button"
                  onClick={() => setShowFilters((prev) => !prev)}
                  style={{
                    padding: "10px 14px",
                    borderRadius: 999,
                    border: "1px solid var(--button-secondary-border)",
                    background: "var(--button-secondary-bg)",
                    color: "var(--button-secondary-text)",
                    fontSize: 13,
                    fontWeight: 700,
                    cursor: "pointer",
                  }}
                >
                  {showFilters ? "絞り込みを閉じる" : "絞り込みを開く"}
                </button>
              </div>
            </div>
            <div
              style={{
                display: "grid",
                gap: 10,
                gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
                alignContent: "start",
              }}
            >
              {[
                {
                  label: focusMonth ? `${focusMonth} の請求候補` : "表示中の請求候補",
                  value: `${invoicePreviewRows.length}件`,
                },
                { label: "請求見込み", value: formatCurrency(invoicePreviewAmount) },
                { label: "すぐ請求へ回せる", value: `${invoiceReadyCount}件` },
                { label: "要確認", value: `${lateCount}件` },
              ].map((item) => (
                <div
                  key={item.label}
                  style={{
                    padding: "14px 16px",
                    borderRadius: 18,
                    border: "1px solid color-mix(in srgb, var(--border) 80%, white 20%)",
                    background: "color-mix(in srgb, var(--surface) 92%, white 8%)",
                  }}
                >
                  <div style={{ fontSize: 11, color: "var(--muted)", fontWeight: 700, letterSpacing: "0.04em" }}>
                    {item.label}
                  </div>
                  <div style={{ marginTop: 6, fontSize: 22, fontWeight: 800, color: "var(--text)" }}>{item.value}</div>
                </div>
              ))}
            </div>
          </section>

          <section
            style={{
              display: "grid",
              gap: 12,
              gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
            }}
          >
            <div
              style={{
                display: "grid",
                gap: 8,
                padding: "16px 18px",
                borderRadius: 18,
                border: "1px solid var(--border)",
                background: "var(--surface)",
                boxShadow: "0 6px 18px rgba(15, 23, 42, 0.05)",
              }}
            >
              <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: "0.06em", color: "var(--muted)" }}>HOW TO USE</div>
              <div style={{ fontSize: 18, fontWeight: 800, color: "var(--text)" }}>ここでは請求対象だけ扱います</div>
              <div style={{ color: "var(--muted)", lineHeight: 1.7 }}>
                1件追加するときに決めるのは、取引先、追加タイプ、対象月、金額が中心です。明細タイトル、請求区分、単位、初期ステータスは自動で補完します。
              </div>
              <div style={{ fontSize: 12, color: "var(--muted)" }}>後回しでよいもの: ワークフロー / 外部参照ID / 詳細リンク / 細かい運用メモ</div>
            </div>
            <div
              style={{
                display: "grid",
                gap: 8,
                padding: "16px 18px",
                borderRadius: 18,
                border: "1px solid var(--border)",
                background: "var(--surface)",
                boxShadow: "0 6px 18px rgba(15, 23, 42, 0.05)",
              }}
            >
              <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: "0.06em", color: "var(--muted)" }}>MONTH-END FLOW</div>
              <div style={{ fontSize: 18, fontWeight: 800, color: "var(--text)" }}>月末請求までの流れ</div>
              <div style={{ color: "var(--muted)", lineHeight: 1.7 }}>
                1. 請求対象を追加する。 2. 今月分の一覧で漏れと金額を確認する。 3. `delivery_month` を軸に Billing で請求書をまとめて作る。
              </div>
              <div>
                <Link
                  href={focusMonth ? `/billing?month=${encodeURIComponent(focusMonth)}` : "/billing"}
                  style={{
                    display: "inline-flex",
                    padding: "8px 12px",
                    borderRadius: 999,
                    border: "1px solid var(--button-secondary-border)",
                    background: "var(--button-secondary-bg)",
                    color: "var(--button-secondary-text)",
                    fontSize: 12,
                    fontWeight: 700,
                    textDecoration: "none",
                  }}
                >
                  対象月の請求を開く
                </Link>
              </div>
            </div>
          </section>

          <section
            style={{
              padding: "14px 16px",
              borderRadius: 18,
              border: "1px solid var(--border)",
              background: "var(--surface)",
              boxShadow: "0 6px 18px rgba(15, 23, 42, 0.05)",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
              <div style={{ display: "grid", gap: 4 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text)" }}>
                  表示中: {focusMonth || "全月"} / {filterClientId ? clients.find((client) => client.id === filterClientId)?.name ?? "取引先指定" : "全取引先"}
                </div>
                <div style={{ fontSize: 12, color: "var(--muted)" }}>
                  初期表示は今月分の請求確認です。必要なときだけ条件を広げてください。
                </div>
              </div>
              {showFilters ? (
                <button
                  type="button"
                  onClick={() => {
                    setFocusMonth(createCurrentMonth())
                    setFilterDue("")
                    setFilterClientId("")
                    setFilterProjectId("")
                    setFilterStatus("")
                  }}
                  style={{
                    padding: "8px 12px",
                    borderRadius: 999,
                    border: "1px solid var(--button-secondary-border)",
                    background: "var(--button-secondary-bg)",
                    color: "var(--button-secondary-text)",
                    fontSize: 12,
                    fontWeight: 700,
                    cursor: "pointer",
                  }}
                >
                  表示をリセット
                </button>
              ) : null}
            </div>
            {showFilters ? (
              <div
                style={{
                  marginTop: 14,
                  display: "grid",
                  gap: 10,
                  gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))",
                }}
              >
                <label style={{ display: "grid", gap: 6, fontSize: 12, color: "var(--text)" }}>
                  対象月
                  <input
                    type="month"
                    value={focusMonth}
                    onChange={(event) => setFocusMonth(event.target.value)}
                    style={{
                      padding: "8px 10px",
                      borderRadius: 10,
                      border: "1px solid var(--input-border)",
                      background: "var(--input-bg)",
                      color: "var(--input-text)",
                      fontSize: 12,
                    }}
                  />
                </label>
                <label style={{ display: "grid", gap: 6, fontSize: 12, color: "var(--text)" }}>
                  納期の見方
                  <select
                    value={filterDue}
                    onChange={(event) => setFilterDue(event.target.value as typeof filterDue)}
                    style={{
                      padding: "8px 10px",
                      borderRadius: 10,
                      border: "1px solid var(--input-border)",
                      background: "var(--input-bg)",
                      color: "var(--input-text)",
                      fontSize: 12,
                    }}
                  >
                    <option value="">すべて</option>
                    <option value="today">今日</option>
                    <option value="tomorrow">明日</option>
                    <option value="week">今週</option>
                    <option value="late">遅延のみ</option>
                  </select>
                </label>
                <label style={{ display: "grid", gap: 6, fontSize: 12, color: "var(--text)" }}>
                  取引先
                  <select
                    value={filterClientId}
                    onChange={(event) => setFilterClientId(event.target.value)}
                    style={{
                      padding: "8px 10px",
                      borderRadius: 10,
                      border: "1px solid var(--input-border)",
                      background: "var(--input-bg)",
                      color: "var(--input-text)",
                      fontSize: 12,
                    }}
                  >
                    <option value="">すべて</option>
                    {clients.map((client) => (
                      <option key={client.id} value={client.id}>
                        {client.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label style={{ display: "grid", gap: 6, fontSize: 12, color: "var(--text)" }}>
                  案件
                  <select
                    value={filterProjectId}
                    onChange={(event) => setFilterProjectId(event.target.value)}
                    style={{
                      padding: "8px 10px",
                      borderRadius: 10,
                      border: "1px solid var(--input-border)",
                      background: "var(--input-bg)",
                      color: "var(--input-text)",
                      fontSize: 12,
                    }}
                  >
                    <option value="">すべて</option>
                    {projects
                      .filter((project) => !filterClientId || project.clientId === filterClientId)
                      .map((project) => (
                        <option key={project.id} value={project.id}>
                          {project.name}
                        </option>
                      ))}
                  </select>
                </label>
                <label style={{ display: "grid", gap: 6, fontSize: 12, color: "var(--text)" }}>
                  ステータス
                  <select
                    value={filterStatus}
                    onChange={(event) => setFilterStatus(event.target.value)}
                    style={{
                      padding: "8px 10px",
                      borderRadius: 10,
                      border: "1px solid var(--input-border)",
                      background: "var(--input-bg)",
                      color: "var(--input-text)",
                      fontSize: 12,
                    }}
                  >
                    <option value="">すべて</option>
                    {Object.entries(statusLabels).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            ) : null}
          </section>
        </header>
        {false && <header style={{ marginBottom: 24 }}>
          <p style={{ fontSize: 12, letterSpacing: "0.08em", color: "var(--muted)" }}>
            制作シート          </p>
          <h1 style={{ fontSize: 28, margin: "6px 0 8px", color: "var(--text)" }}>コンテンツ一覧</h1>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            {canEdit && (
              <>
                {hasClients ? (
                  <button
                    type="button"
                    style={{
                      padding: "10px 14px",
                      borderRadius: 10,
                      border: "1px solid var(--button-primary-bg)",
                      background: "var(--button-primary-bg)",
                      color: "var(--primary-contrast)",
                      fontSize: 14,
                      cursor: "pointer",
                    }}
                    onClick={() => setIsAdding((prev) => !prev)}
                  >
                    +追加
                  </button>
                ) : null}
              </>
            )}
            <div
              style={{
                display: "flex",
                gap: 8,
                alignItems: "center",
                flexWrap: "wrap",
              }}
            >
              <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--text)" }}>
                日付
                <select
                  value={filterDue}
                  onChange={(e) => setFilterDue(e.target.value as typeof filterDue)}
                  style={{
                    padding: "6px 8px",
                    borderRadius: 8,
                    border: "1px solid var(--input-border)",
                    background: "var(--input-bg)",
                    color: "var(--input-text)",
                    fontSize: 12,
                  }}
                >
                  <option value="">すべて</option>
                  <option value="today">今日</option>
                  <option value="tomorrow">明日</option>
                  <option value="week">今週</option>
                  <option value="late">遅延のみ</option>
                </select>
              </label>
              <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--text)" }}>
                クライアント
                <select
                  value={filterClientId}
                  onChange={(e) => setFilterClientId(e.target.value)}
                  style={{
                    padding: "6px 8px",
                    borderRadius: 8,
                    border: "1px solid var(--input-border)",
                    background: "var(--input-bg)",
                    color: "var(--input-text)",
                    fontSize: 12,
                  }}
                >
                  <option value="">すべて</option>
                  {clients.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </label>
              <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--text)" }}>
                案件
                <select
                  value={filterProjectId}
                  onChange={(e) => setFilterProjectId(e.target.value)}
                  style={{
                    padding: "6px 8px",
                    borderRadius: 8,
                    border: "1px solid var(--input-border)",
                    background: "var(--input-bg)",
                    color: "var(--input-text)",
                    fontSize: 12,
                  }}
                >
                  <option value="">すべて</option>
                  {projects
                    .filter((project) => !filterClientId || project.clientId === filterClientId)
                    .map((project) => (
                      <option key={project.id} value={project.id}>
                        {project.name}
                      </option>
                    ))}
                </select>
              </label>
              <button
                type="button"
                onClick={handleSaveView}
                style={{
                  padding: "6px 10px",
                  borderRadius: 999,
                  border: "1px solid var(--button-secondary-border)",
                  background: "var(--button-secondary-bg)",
                  color: "var(--button-secondary-text)",
                  fontSize: 12,
                  fontWeight: 700,
                  cursor: "pointer",
                }}
              >
                保存ビュー
              </button>
            </div>
            <button
              type="button"
              style={{
                padding: "10px 14px",
                borderRadius: 10,
                border: "1px solid var(--button-secondary-border)",
                background: "var(--button-secondary-bg)",
                color: "var(--button-secondary-text)",
                fontSize: 14,
                fontWeight: 500,
                cursor: "pointer",
              }}
            >
              CSV出力            </button>
            <span style={{ fontSize: 12, color: "var(--muted)", paddingTop: 10 }}>
              1行 = 1本（動画/投稿）            </span>
          </div>

          {savedViews.length > 0 && (
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
              {savedViews.map((view) => (
                <div key={view.id} style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "4px 8px", borderRadius: 999, background: "var(--surface-2)", border: "1px solid var(--border)" }}>
                  <button
                    type="button"
                    onClick={() => {
                      setFilterDue(view.filterDue)
                      setFilterClientId(view.filterClientId)
                      setFilterProjectId(view.filterProjectId)
                    }}
                    style={{ border: "none", background: "transparent", color: "var(--text)", fontSize: 12, fontWeight: 700, cursor: "pointer" }}
                  >
                    {view.name}
                  </button>
                  <button
                    type="button"
                    onClick={() => setSavedViews((prev) => prev.filter((row) => row.id !== view.id))}
                    style={{ border: "none", background: "transparent", color: "#b91c1c", fontSize: 12, cursor: "pointer" }}
                  >
                    削除
                  </button>
                </div>
              ))}
            </div>
          )}

          {hasClients && (
            <section
              style={{
                marginTop: 16,
                padding: "12px 16px",
                borderRadius: 12,
                border: "1px solid var(--border)",
                background: "var(--surface)",
              }}
            >
              <div style={{ fontSize: 12, fontWeight: 600, color: "var(--muted)", marginBottom: 8 }}>
                テンプレから追加
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10 }}>
                <select
                  value={templateClientId}
                  onChange={(e) => setTemplateClientId(e.target.value)}
                  style={{
                    padding: "6px 10px",
                    borderRadius: 8,
                    border: "1px solid var(--input-border)",
                    background: "var(--input-bg)",
                    color: "var(--input-text)",
                    fontSize: 12,
                  }}
                >
                  {clients.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
                {templates.length === 0 ? (
                  <span style={{ fontSize: 12, color: "var(--muted)" }}>
                    このクライアントにはテンプレートがありません
                  </span>
                ) : (
                  templates.map((tpl) => (
                    <button
                      key={tpl.id}
                      type="button"
                      disabled={!canEdit || addingFromTemplateId !== null}
                      onClick={() => handleAddFromTemplate(tpl)}
                      style={{
                        padding: "6px 12px",
                        borderRadius: 8,
                        border: "1px solid var(--chip-border)",
                        background: addingFromTemplateId === tpl.id ? "var(--muted)" : "var(--chip-bg)",
                        color: "var(--chip-text)",
                        fontSize: 12,
                        cursor:
                          !canEdit || addingFromTemplateId !== null ? "not-allowed" : "pointer",
                      }}
                    >
                      {addingFromTemplateId === tpl.id ? "追加中..." : tpl.name}
                    </button>
                  ))
                )}
                {canEdit && templates.length > 0 && (
                  <button
                    type="button"
                    onClick={() => {
                      setBulkAdding((prev) => !prev)
                      setBulkResultMessage(null)
                      if (!bulkTemplateId && templates.length > 0) {
                        setBulkTemplateId(templates[0].id)
                      }
                    }}
                    style={{
                      marginLeft: "auto",
                      padding: "6px 12px",
                      borderRadius: 999,
                      border: "1px solid var(--primary-border)",
                      background: "var(--primary-bg)",
                      color: "var(--primary-contrast)",
                      fontSize: 12,
                      cursor: "pointer",
                    }}
                  >
                    一括追加...
                  </button>
                )}
              </div>
              {canEdit && bulkAdding && templates.length > 0 && (
                <div
                  style={{
                    marginTop: 12,
                    padding: "10px 12px",
                    borderRadius: 10,
                    border: "1px dashed var(--border)",
                    background: "var(--surface-elevated)",
                    display: "flex",
                    flexDirection: "column",
                    gap: 8,
                  }}
                >
                  <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <span style={{ fontSize: 12, color: "var(--muted)" }}>テンプレ</span>
                    <select
                      value={bulkTemplateId || templates[0].id}
                      onChange={(e) => setBulkTemplateId(e.target.value)}
                      style={{
                        padding: "4px 8px",
                        borderRadius: 8,
                        border: "1px solid var(--input-border)",
                        background: "var(--input-bg)",
                        color: "var(--input-text)",
                        fontSize: 12,
                      }}
                    >
                      {templates.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.name}
                        </option>
                      ))}
                    </select>
                    <span style={{ fontSize: 12, color: "var(--muted)" }}>
                      貼り付け形式 YYYY-MM-DD[TAB]タイトル
                    </span>
                    <button
                      type="button"
                      onClick={() =>
                        window.dispatchEvent(
                          new CustomEvent("open-ai-palette", {
                            detail: {
                              source: "contents" as const,
                              mode: "title_ideas" as const,
                              modes: ["title_ideas", "rewrite", "format"] as const,
                              text:
                                bulkTextarea ||
                                `${todayYmd}\t${selectedBulkTemplate?.default_title ?? selectedBulkTemplate?.name ?? ""}`.trim(),
                              compareText: bulkTextarea,
                              context: bulkContentAiContext,
                              title: "コンテンツAI",
                              applyLabel: "一括入力に反映",
                              applyTarget: "contents_bulk_textarea",
                              meta: {
                                sourceObject: "content_bulk_draft",
                                recordId: `${templateClientId || "no-client"}:${selectedBulkTemplate?.id ?? "no-template"}`,
                                recordLabel: `${selectedTemplateClient?.name ?? "未選択"} / ${selectedBulkTemplate?.name ?? "一括追加"}`,
                              },
                            },
                          })
                        )
                      }
                      style={{
                        padding: "4px 10px",
                        borderRadius: 999,
                        border: "1px solid var(--button-secondary-border)",
                        background: "var(--button-secondary-bg)",
                        color: "var(--button-secondary-text)",
                        fontSize: 12,
                        fontWeight: 700,
                        cursor: "pointer",
                      }}
                    >
                      AIタイトル案
                    </button>
                  </div>
                  <textarea
                    rows={4}
                    value={bulkTextarea}
                    onChange={(e) => setBulkTextarea(e.target.value)}
                    placeholder={"例:\n2026-03-01\tショート動画A\n2026-03-02\tショート動画B"}
                    style={{
                      width: "100%",
                      padding: "6px 8px",
                      borderRadius: 8,
                      border: "1px solid var(--input-border)",
                      background: "var(--input-bg)",
                      color: "var(--input-text)",
                      fontSize: 12,
                      resize: "vertical",
                    }}
                  />
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <button
                      type="button"
                      onClick={async () => {
                        if (!orgId || !templateClientId || !canEdit) return
                        const tpl =
                          templates.find((t) => t.id === bulkTemplateId) ?? templates[0]
                        if (!tpl) return

                        const lines = bulkTextarea.split(/\r?\n/)
                        const inserts: {
                          dueClientAt: string
                          title: string
                        }[] = []
                        const errors: string[] = []
                        const dateRe = /^\d{4}-\d{2}-\d{2}$/

                        lines.forEach((raw, idx) => {
                          const line = raw.trim()
                          if (!line) return
                          const [datePart, titlePart] = line.split("\t")
                          if (!datePart || !titlePart) {
                            errors.push(`${idx + 1}行目: フォーマットが不正です`)
                            return
                          }
                          const date = datePart.trim()
                          const title = titlePart.trim()
                          if (!dateRe.test(date)) {
                            errors.push(`${idx + 1}行目: 日付形式が不正です`)
                            return
                          }
                          if (!title) {
                            errors.push(`${idx + 1}行目: タイトルが空です`)
                            return
                          }
                          inserts.push({ dueClientAt: date, title })
                        })

                        if (inserts.length === 0) {
                          setBulkResultMessage(
                            errors.length > 0 ? errors.join(" / ") : "有効な行がありません"
                          )
                          return
                        }

                        const payloads = inserts.map((item) => {
                          const dueClientAt = item.dueClientAt
                          const draft = createRowDraft({
                            clientId: templateClientId,
                            projectName: tpl.default_project_name ?? tpl.name,
                            title: item.title,
                            dueClientAt,
                            unitPrice: Number(tpl.default_unit_price ?? 0),
                            status: tpl.default_status ?? "not_started",
                            billable: tpl.default_billable_flag ?? true,
                          })
                          const { payload, errors: payloadErrors } = prepareContentPayload(draft, {
                            id: crypto.randomUUID(),
                            org_id: orgId,
                            client_id: templateClientId,
                            project_name: tpl.default_project_name ?? tpl.name,
                            title: item.title,
                            unit_price: Number(tpl.default_unit_price ?? 0),
                            due_client_at: dueClientAt,
                            status: tpl.default_status ?? "not_started",
                            thumbnail_done: false,
                            billable_flag: tpl.default_billable_flag ?? true,
                            publish_at: null,
                            sequence_no: null,
                            assignee_editor_user_id: null,
                            assignee_checker_user_id: null,
                            revision_count: 0,
                            workload_points: 1,
                            estimated_cost: 0,
                            next_action: null,
                            blocked_reason: null,
                            material_status: "not_ready",
                            draft_status: "not_started",
                            final_status: "not_started",
                            links_json: {},
                          })
                          if (payloadErrors.length > 0) {
                            errors.push(`${item.dueClientAt} ${item.title}: ${payloadErrors[0]}`)
                            return null
                          }
                          return payload
                        })

                        const validPayloads = payloads.filter((payload): payload is Record<string, unknown> => payload != null)

                        if (validPayloads.length === 0) {
                          setBulkResultMessage(errors.join(" / "))
                          return
                        }

                        const { error: insertError } = await insertContentsRows(validPayloads)

                        if (insertError) {
                          setBulkResultMessage(
                            `一括追加に失敗しました: ${insertError.message}`
                          )
                          return
                        }

                        await fetchContents(orgId)
                        setBulkResultMessage(
                          `追加成功: ${validPayloads.length}件 / 失敗: ${errors.length}件${
                            errors.length ? `（${errors.join(" / ")}）` : ""
                          }`
                        )
                        setUiSuccess("一括追加しました")
                        scheduleDelayedAction(() => setUiSuccess(null), 2500)
                      }}
                      style={{
                        padding: "6px 12px",
                        borderRadius: 999,
                        border: "1px solid var(--primary-border)",
                        background: "var(--primary-bg)",
                        color: "var(--primary-contrast)",
                        fontSize: 12,
                        cursor: "pointer",
                      }}
                    >
                      この内容で一括追加
                    </button>
                    {bulkResultMessage && (
                      <span style={{ fontSize: 11, color: "var(--muted)" }}>
                        {bulkResultMessage}
                      </span>
                    )}
                  </div>
                </div>
              )}
            </section>
          )}
        </header>}

        {error && (
          <div
            style={{
              marginBottom: 16,
              padding: "10px 12px",
              borderRadius: 10,
              border: "1px solid #fecaca",
              background: "#fff1f2",
              color: "#b91c1c",
              fontSize: 12,
            }}
          >
            {error}
          </div>
        )}
        {uiError && (
          <div
            style={{
              marginBottom: 16,
              padding: "10px 12px",
              borderRadius: 10,
              border: "1px solid #fecaca",
              background: "#fff1f2",
              color: "#b91c1c",
              fontSize: 12,
            }}
          >
            {uiError}
          </div>
        )}
        {uiSuccess && (
          <div
            style={{
              marginBottom: 16,
              padding: "10px 12px",
              borderRadius: 10,
              border: "1px solid #bbf7d0",
              background: "#f0fdf4",
              color: "#166534",
              fontSize: 12,
            }}
          >
            {uiSuccess}
          </div>
        )}

        {isCreatingClient && clientCreateForm}

        {!isLoading && !hasClients && !isCreatingClient && (
          <section
            style={{
              marginBottom: 16,
              padding: "14px 16px",
              borderRadius: 12,
              border: "1px dashed var(--border)",
              background: "var(--surface)",
            }}
          >
            <div style={{ fontSize: 14, fontWeight: 600, color: "var(--text)" }}>
              クライアントが未登録です            </div>
            <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 4 }}>
              まずクライアントを作成してください。            </div>
          </section>
        )}

        {isAdding ? (
          <section
            style={{
              marginBottom: 16,
              padding: 18,
              borderRadius: 20,
              border: "1px solid var(--border)",
              background: "var(--surface)",
              boxShadow: "0 16px 44px rgba(15, 23, 42, 0.12)",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "flex-start" }}>
              <div>
                <div style={{ fontSize: 12, color: "var(--muted)", fontWeight: 700, letterSpacing: "0.08em" }}>
                  STEP {guidedStep} / 2
                </div>
                <h2 style={{ margin: "6px 0 4px", fontSize: 22, color: "var(--text)" }}>請求対象を追加</h2>
                <p style={{ margin: 0, fontSize: 13, lineHeight: 1.7, color: "var(--muted)" }}>
                  取引先と追加タイプを選んだら、対象月と金額だけで登録できます。明細タイトル、請求区分、単位は自動で補完します。
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setIsAdding(false)
                  setGuidedStep(1)
                }}
                style={{
                  padding: "8px 12px",
                  borderRadius: 999,
                  border: "1px solid var(--button-secondary-border)",
                  background: "var(--button-secondary-bg)",
                  color: "var(--button-secondary-text)",
                  fontSize: 12,
                  fontWeight: 700,
                  cursor: "pointer",
                }}
              >
                閉じる
              </button>
            </div>

            {guidedStep === 1 ? (
              <div style={{ marginTop: 18, display: "grid", gap: 16 }}>
                <div style={{ display: "grid", gap: 8 }}>
                  <label style={{ display: "grid", gap: 6, fontSize: 12, color: "var(--text)" }}>
                    取引先
                    <select
                      value={guidedForm.clientId}
                      onChange={(event) => setGuidedForm((prev) => ({ ...prev, clientId: event.target.value }))}
                      style={{
                        padding: "10px 12px",
                        borderRadius: 10,
                        border: "1px solid var(--input-border)",
                        background: "var(--input-bg)",
                        color: "var(--input-text)",
                        fontSize: 13,
                      }}
                    >
                      <option value="">選択してください</option>
                      {clients.map((client) => (
                        <option key={client.id} value={client.id}>
                          {client.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <button
                    type="button"
                    onClick={openClientRegistration}
                    style={{
                      justifySelf: "start",
                      border: "none",
                      background: "transparent",
                      color: "var(--primary)",
                      fontSize: 12,
                      fontWeight: 700,
                      cursor: "pointer",
                      padding: 0,
                    }}
                  >
                    一覧にない取引先を追加
                  </button>
                </div>

                <div style={{ display: "grid", gap: 10, gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))" }}>
                  {GUIDED_ADD_TYPE_OPTIONS.map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() => handleGuidedAddTypeSelect(option.value)}
                      style={{
                        display: "grid",
                        gap: 6,
                        textAlign: "left",
                        padding: "14px 16px",
                        borderRadius: 16,
                        border: `1px solid ${guidedForm.addType === option.value ? "var(--primary)" : "var(--border)"}`,
                        background:
                          guidedForm.addType === option.value
                            ? "color-mix(in srgb, var(--primary) 10%, var(--surface) 90%)"
                            : "color-mix(in srgb, var(--surface) 92%, white 8%)",
                        color: "var(--text)",
                        cursor: "pointer",
                      }}
                    >
                      <span style={{ fontSize: 15, fontWeight: 800 }}>{option.label}</span>
                      <span style={{ fontSize: 12, color: "var(--muted)", lineHeight: 1.6 }}>{option.description}</span>
                    </button>
                  ))}
                </div>

                <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, flexWrap: "wrap" }}>
                  <button
                    type="button"
                    onClick={() => setIsAdding(false)}
                    style={{
                      padding: "10px 14px",
                      borderRadius: 999,
                      border: "1px solid var(--button-secondary-border)",
                      background: "var(--button-secondary-bg)",
                      color: "var(--button-secondary-text)",
                      fontSize: 13,
                      fontWeight: 700,
                      cursor: "pointer",
                    }}
                  >
                    キャンセル
                  </button>
                  <button
                    type="button"
                    onClick={() => setGuidedStep(2)}
                    disabled={!guidedForm.clientId}
                    style={{
                      padding: "10px 16px",
                      borderRadius: 999,
                      border: "1px solid var(--button-primary-bg)",
                      background: guidedForm.clientId ? "var(--button-primary-bg)" : "var(--surface-2)",
                      color: guidedForm.clientId ? "var(--primary-contrast)" : "var(--muted)",
                      fontSize: 13,
                      fontWeight: 700,
                      cursor: guidedForm.clientId ? "pointer" : "not-allowed",
                    }}
                  >
                    次へ
                  </button>
                </div>
              </div>
            ) : guidedForm.addType === "vendor_invoice" ? (
              <div style={{ marginTop: 18, display: "grid", gap: 12 }}>
                <div
                  style={{
                    padding: "16px 18px",
                    borderRadius: 16,
                    border: "1px solid var(--border)",
                    background: "color-mix(in srgb, var(--surface) 90%, white 10%)",
                  }}
                >
                  <div style={{ fontSize: 16, fontWeight: 800, color: "var(--text)" }}>外注請求は専用導線へ</div>
                  <div style={{ marginTop: 6, fontSize: 13, color: "var(--muted)", lineHeight: 1.7 }}>
                    PMF では、外注請求を `contents` に混ぜずに専用画面へ誘導します。コンテンツ追加の画面を重くしないためです。
                  </div>
                </div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <button
                    type="button"
                    onClick={() => setGuidedStep(1)}
                    style={{
                      padding: "10px 14px",
                      borderRadius: 999,
                      border: "1px solid var(--button-secondary-border)",
                      background: "var(--button-secondary-bg)",
                      color: "var(--button-secondary-text)",
                      fontSize: 13,
                      fontWeight: 700,
                      cursor: "pointer",
                    }}
                  >
                    戻る
                  </button>
                  <Link
                    href="/vendors/submissions"
                    style={{
                      padding: "10px 16px",
                      borderRadius: 999,
                      border: "1px solid var(--button-primary-bg)",
                      background: "var(--button-primary-bg)",
                      color: "var(--primary-contrast)",
                      fontSize: 13,
                      fontWeight: 700,
                      textDecoration: "none",
                    }}
                  >
                    外注請求の画面を開く
                  </Link>
                </div>
              </div>
            ) : (
              <div style={{ marginTop: 18, display: "grid", gap: 18 }}>
                <div style={{ fontSize: 12, color: "var(--muted)", lineHeight: 1.7 }}>
                  ここで必要なのは、商材、対象月、金額だけです。ワークフローや詳細項目はあとで詳細から調整できます。
                </div>
                <div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))" }}>
                  <label style={{ display: "grid", gap: 6, fontSize: 12, color: "var(--text)" }}>
                    商材テンプレ
                    <select
                      value={selectedGuidedTemplate?.id ?? ""}
                      onChange={(event) => {
                        const template = getGuidedTemplateById(event.target.value)
                        if (template) handleGuidedTemplateSelect(template)
                      }}
                      style={{
                        padding: "10px 12px",
                        borderRadius: 10,
                        border: "1px solid var(--input-border)",
                        background: "var(--input-bg)",
                        color: "var(--input-text)",
                        fontSize: 13,
                      }}
                    >
                      {guidedTemplates.map((template) => (
                        <option key={template.id} value={template.id}>
                          {template.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label style={{ display: "grid", gap: 6, fontSize: 12, color: "var(--text)" }}>
                    既存案件に紐づける（任意）
                    <select
                      value={guidedForm.projectId}
                      onChange={(event) => setGuidedForm((prev) => ({ ...prev, projectId: event.target.value }))}
                      style={{
                        padding: "10px 12px",
                        borderRadius: 10,
                        border: "1px solid var(--input-border)",
                        background: "var(--input-bg)",
                        color: "var(--input-text)",
                        fontSize: 13,
                      }}
                    >
                      <option value="">選択しない</option>
                      {guidedProjects.map((project) => (
                        <option key={project.id} value={project.id}>
                          {project.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label style={{ display: "grid", gap: 6, fontSize: 12, color: "var(--text)" }}>
                    管理用の案件名（任意）
                    <input
                      value={guidedForm.projectName}
                      onChange={(event) => setGuidedForm((prev) => ({ ...prev, projectName: event.target.value }))}
                      placeholder={selectedGuidedTemplate?.name ?? "案件名を入力"}
                      style={{
                        padding: "10px 12px",
                        borderRadius: 10,
                        border: "1px solid var(--input-border)",
                        background: "var(--input-bg)",
                        color: "var(--input-text)",
                        fontSize: 13,
                      }}
                    />
                  </label>
                  <label style={{ display: "grid", gap: 6, fontSize: 12, color: "var(--text)" }}>
                    対象月
                    <input
                      type="month"
                      value={guidedForm.targetMonth}
                      onChange={(event) =>
                        setGuidedForm((prev) => ({
                          ...prev,
                          targetMonth: event.target.value,
                          dueClientAt: prev.showAdvanced ? prev.dueClientAt : getMonthEndDate(event.target.value),
                        }))
                      }
                      style={{
                        padding: "10px 12px",
                        borderRadius: 10,
                        border: "1px solid var(--input-border)",
                        background: "var(--input-bg)",
                        color: "var(--input-text)",
                        fontSize: 13,
                      }}
                    />
                  </label>
                  {selectedGuidedTemplate &&
                  selectedGuidedTemplate.billingModel !== "monthly_fixed" &&
                  selectedGuidedTemplate.billingModel !== "project_fixed" ? (
                    <label style={{ display: "grid", gap: 6, fontSize: 12, color: "var(--text)" }}>
                      数量
                      <input
                        type="number"
                        min="1"
                        value={guidedForm.quantity}
                        onChange={(event) => setGuidedForm((prev) => ({ ...prev, quantity: event.target.value }))}
                        style={{
                          padding: "10px 12px",
                          borderRadius: 10,
                          border: "1px solid var(--input-border)",
                          background: "var(--input-bg)",
                          color: "var(--input-text)",
                          fontSize: 13,
                        }}
                      />
                    </label>
                  ) : null}
                  <label style={{ display: "grid", gap: 6, fontSize: 12, color: "var(--text)" }}>
                    単価
                    <input
                      type="text"
                      inputMode="numeric"
                      value={guidedForm.unitPrice}
                      onChange={(event) => setGuidedForm((prev) => ({ ...prev, unitPrice: event.target.value }))}
                      style={{
                        padding: "10px 12px",
                        borderRadius: 10,
                        border: "1px solid var(--input-border)",
                        background: "var(--input-bg)",
                        color: "var(--input-text)",
                        fontSize: 13,
                      }}
                    />
                  </label>
                  <label style={{ display: "grid", gap: 6, fontSize: 12, color: "var(--text)" }}>
                    初期ステータス
                    <select
                      value={guidedForm.status}
                      onChange={(event) => setGuidedForm((prev) => ({ ...prev, status: event.target.value }))}
                      style={{
                        padding: "10px 12px",
                        borderRadius: 10,
                        border: "1px solid var(--input-border)",
                        background: "var(--input-bg)",
                        color: "var(--input-text)",
                        fontSize: 13,
                      }}
                    >
                      {GUIDED_STATUS_OPTIONS.map((status) => (
                        <option key={status.value} value={status.value}>
                          {status.label}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>

                <div
                  style={{
                    padding: "16px 18px",
                    borderRadius: 18,
                    border: "1px solid var(--border)",
                    background: "color-mix(in srgb, var(--surface) 90%, white 10%)",
                  }}
                >
                  <div style={{ fontSize: 12, fontWeight: 700, color: "var(--muted)", letterSpacing: "0.08em" }}>
                    請求プレビュー
                  </div>
                  <div style={{ marginTop: 10, display: "grid", gap: 6 }}>
                    <div style={{ fontSize: 18, fontWeight: 800, color: "var(--text)" }}>{guidedPreviewTitle || "明細タイトルを作成します"}</div>
                    <div style={{ fontSize: 13, color: "var(--muted)" }}>
                      {selectedGuidedTemplate ? getGuidedBillingModelLabel(selectedGuidedTemplate.billingModel) : "-"} / 数量 {guidedForm.quantity || "1"} {selectedGuidedTemplate ? getGuidedUnitLabel(selectedGuidedTemplate.unitType) : ""}
                    </div>
                    <div style={{ fontSize: 13, color: "var(--muted)" }}>納品予定 {guidedForm.showAdvanced ? guidedForm.dueClientAt || "-" : getMonthEndDate(guidedForm.targetMonth)}</div>
                    <div style={{ fontSize: 22, fontWeight: 800, color: "var(--text)" }}>{formatCurrency(guidedPreviewAmount)}</div>
                  </div>
                </div>

                <div style={{ display: "grid", gap: 10 }}>
                  <button
                    type="button"
                    onClick={() => setGuidedForm((prev) => ({ ...prev, showAdvanced: !prev.showAdvanced }))}
                    style={{
                      justifySelf: "start",
                      border: "none",
                      background: "transparent",
                      color: "var(--primary)",
                      fontSize: 12,
                      fontWeight: 700,
                      cursor: "pointer",
                      padding: 0,
                    }}
                  >
                    {guidedForm.showAdvanced ? "詳細入力を閉じる" : "明細タイトルと納品予定を手動で調整する"}
                  </button>
                  {guidedForm.showAdvanced ? (
                    <div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))" }}>
                      <label style={{ display: "grid", gap: 6, fontSize: 12, color: "var(--text)" }}>
                        明細タイトル
                        <input
                          value={guidedForm.customTitle}
                          onChange={(event) => setGuidedForm((prev) => ({ ...prev, customTitle: event.target.value }))}
                          placeholder={guidedPreviewTitle || "明細タイトル"}
                          style={{
                            padding: "10px 12px",
                            borderRadius: 10,
                            border: "1px solid var(--input-border)",
                            background: "var(--input-bg)",
                            color: "var(--input-text)",
                            fontSize: 13,
                          }}
                        />
                      </label>
                      <label style={{ display: "grid", gap: 6, fontSize: 12, color: "var(--text)" }}>
                        納品予定日
                        <input
                          type="date"
                          value={guidedForm.dueClientAt}
                          onChange={(event) => setGuidedForm((prev) => ({ ...prev, dueClientAt: event.target.value }))}
                          style={{
                            padding: "10px 12px",
                            borderRadius: 10,
                            border: "1px solid var(--input-border)",
                            background: "var(--input-bg)",
                            color: "var(--input-text)",
                            fontSize: 13,
                          }}
                        />
                      </label>
                    </div>
                  ) : null}
                </div>

                <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
                  <button
                    type="button"
                    onClick={() => setGuidedStep(1)}
                    style={{
                      padding: "10px 14px",
                      borderRadius: 999,
                      border: "1px solid var(--button-secondary-border)",
                      background: "var(--button-secondary-bg)",
                      color: "var(--button-secondary-text)",
                      fontSize: 13,
                      fontWeight: 700,
                      cursor: "pointer",
                    }}
                  >
                    戻る
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleGuidedAdd()}
                    disabled={!guidedForm.clientId || !guidedForm.targetMonth || !selectedGuidedTemplate}
                    style={{
                      padding: "10px 16px",
                      borderRadius: 999,
                      border: "1px solid var(--button-primary-bg)",
                      background:
                        guidedForm.clientId && guidedForm.targetMonth && selectedGuidedTemplate
                          ? "var(--button-primary-bg)"
                          : "var(--surface-2)",
                      color:
                        guidedForm.clientId && guidedForm.targetMonth && selectedGuidedTemplate
                          ? "var(--primary-contrast)"
                          : "var(--muted)",
                      fontSize: 13,
                      fontWeight: 700,
                      cursor:
                        guidedForm.clientId && guidedForm.targetMonth && selectedGuidedTemplate
                          ? "pointer"
                          : "not-allowed",
                    }}
                  >
                    この内容で請求対象を追加
                  </button>
                </div>
              </div>
            )}
          </section>
        ) : null}

        {false && isAdding && (
          <section
            style={{
              marginBottom: 16,
              padding: "16px",
              borderRadius: 16,
              border: "1px solid var(--border)",
              background: "var(--surface)",
              boxShadow: "0 10px 30px rgba(0,0,0,0.08)",
            }}
          >
            <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 8, color: "var(--text)" }}>
              コンテンツ追加
            </div>
            <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 12, lineHeight: 1.7 }}>
              この画面では 1本ごとの実行明細を追加します。継続案件の責任者、期間、連携設定まで整えるときは案件管理へ戻してください。
            </div>
            <div
              style={{
                display: "grid",
                gap: 10,
                gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
              }}
            >
              <label style={{ display: "grid", gap: 4, fontSize: 12, color: "var(--text)" }}>
                クライアント                <select
                  value={form.clientId}
                  onChange={(event) =>
                    setForm((prev) => ({ ...prev, clientId: event.target.value }))
                  }
                  style={{
                    padding: "8px 10px",
                    borderRadius: 8,
                    border: "1px solid var(--input-border)",
                    background: "var(--input-bg)",
                    color: "var(--input-text)",
                    fontSize: 12,
                  }}
                >
                  <option value="">選択してください</option>
                  {clients.map((client) => (
                    <option key={client.id} value={client.id}>
                      {client.name}
                    </option>
                  ))}
                </select>
              </label>
              <label style={{ display: "grid", gap: 4, fontSize: 12, color: "var(--text)" }}>
                既存案件に紐づける
                <select
                  value={form.projectId}
                  onChange={(event) => {
                    const project = projects.find((row) => row.id === event.target.value)
                    setForm((prev) => ({
                      ...prev,
                      projectId: event.target.value,
                      projectName: project?.name ?? prev.projectName,
                    }))
                  }}
                  style={{
                    padding: "8px 10px",
                    borderRadius: 8,
                    border: "1px solid var(--input-border)",
                    background: "var(--input-bg)",
                    color: "var(--input-text)",
                    fontSize: 12,
                  }}
                >
                  <option value="">未設定</option>
                  {projects
                    .filter((project) => !form.clientId || project.clientId === form.clientId)
                    .map((project) => (
                      <option key={project.id} value={project.id}>
                        {project.name}
                      </option>
                    ))}
                </select>
              </label>
              <label style={{ display: "grid", gap: 4, fontSize: 12, color: "var(--text)" }}>
                案件名（未登録でも可）                <input
                  value={form.projectName}
                  onChange={(event) =>
                    setForm((prev) => ({
                      ...prev,
                      projectName: event.target.value,
                    }))
                  }
                  placeholder="新規キャンペーン"
                  style={{
                    padding: "8px 10px",
                    borderRadius: 8,
                    border: "1px solid var(--input-border)",
                    background: "var(--input-bg)",
                    color: "var(--input-text)",
                    fontSize: 12,
                  }}
                />
              </label>
              <label style={{ display: "grid", gap: 4, fontSize: 12, color: "var(--text)" }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                  <span>タイトル</span>
                  <button
                    type="button"
                    onClick={() =>
                      window.dispatchEvent(
                        new CustomEvent("open-ai-palette", {
                          detail: {
                            source: "contents" as const,
                            mode: "title_ideas" as const,
                            modes: ["title_ideas", "rewrite"] as const,
                            text: form.title || form.projectName,
                            compareText: form.title,
                            context: createContentAiContext,
                            title: "コンテンツAI",
                            applyLabel: "タイトルに反映",
                            applyTarget: "contents_create_title",
                            applyTransform: "first_line" as const,
                            meta: {
                              sourceObject: "content_draft",
                              recordId: `${form.clientId || "no-client"}:${form.dueClientAt || "draft"}`,
                              recordLabel: `${selectedCreateClient?.name ?? "未選択"} / ${form.projectName || "新規案件"}`,
                            },
                          },
                        })
                      )
                    }
                    style={{
                      padding: "4px 10px",
                      borderRadius: 999,
                      border: "1px solid var(--button-secondary-border)",
                      background: "var(--button-secondary-bg)",
                      color: "var(--button-secondary-text)",
                      fontSize: 12,
                      fontWeight: 700,
                      cursor: "pointer",
                    }}
                  >
                    AIタイトル案
                  </button>
                </div>
                <input
                  value={form.title}
                  onChange={(event) =>
                    setForm((prev) => ({ ...prev, title: event.target.value }))
                  }
                  placeholder="記事のタイトル"
                  style={{
                    padding: "8px 10px",
                    borderRadius: 8,
                    border: "1px solid var(--input-border)",
                    background: "var(--input-bg)",
                    color: "var(--input-text)",
                    fontSize: 12,
                  }}
                />
              </label>
              <label style={{ display: "grid", gap: 4, fontSize: 12, color: "var(--text)" }}>
                先方提出日
                <input
                  type="date"
                  value={form.dueClientAt}
                  onChange={(event) =>
                    setForm((prev) => ({
                      ...prev,
                      dueClientAt: event.target.value,
                    }))
                  }
                  style={{
                    padding: "8px 10px",
                    borderRadius: 8,
                    border: "1px solid var(--input-border)",
                    background: "var(--input-bg)",
                    color: "var(--input-text)",
                    fontSize: 12,
                  }}
                />
              </label>
              <label style={{ display: "grid", gap: 4, fontSize: 12, color: "var(--text)" }}>
                単価
                <input
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  value={form.unitPrice}
                  onChange={(event) =>
                    setForm((prev) => ({
                      ...prev,
                      unitPrice: event.target.value,
                    }))
                  }
                  placeholder="80000"
                  style={{
                    padding: "8px 10px",
                    borderRadius: 8,
                    border: "1px solid var(--input-border)",
                    background: "var(--input-bg)",
                    color: "var(--input-text)",
                    fontSize: 12,
                  }}
                />
              </label>
            </div>
            <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
              <button
                style={{
                  padding: "8px 12px",
                  borderRadius: 8,
                  border: "1px solid var(--button-primary-bg)",
                  background: canSubmit ? "var(--button-primary-bg)" : "var(--surface-2)",
                  color: canSubmit ? "var(--primary-contrast)" : "var(--muted)",
                  fontSize: 12,
                  cursor: canSubmit ? "pointer" : "not-allowed",
                }}
                onClick={handleAdd}
                disabled={!canSubmit}
              >
                コンテンツを追加する
              </button>
              <button
                type="button"
                style={{
                  padding: "8px 12px",
                  borderRadius: 8,
                  border: "1px solid var(--button-secondary-border)",
                  background: "var(--button-secondary-bg)",
                  color: "var(--button-secondary-text)",
                  fontSize: 12,
                  fontWeight: 500,
                  cursor: "pointer",
                }}
                onClick={() => setIsAdding(false)}
              >
                キャンセル
              </button>
            </div>
          </section>
        )}

        <section
          style={{
            border: "1px solid var(--table-border)",
            borderRadius: 12,
            overflow: "hidden",
            boxShadow: "0 4px 16px rgba(0,0,0,0.06)",
          }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              gap: 12,
              flexWrap: "wrap",
              alignItems: "center",
              padding: "16px 18px",
              borderBottom: "1px solid var(--table-border)",
              background: "var(--surface)",
            }}
          >
            <div style={{ display: "grid", gap: 4 }}>
              <div style={{ fontSize: 18, fontWeight: 800, color: "var(--text)" }}>
                {focusMonth ? `${focusMonth} の請求対象` : "請求対象一覧"}
              </div>
              <div style={{ fontSize: 12, color: "var(--muted)" }}>
                今月何を請求するかが分かる順で並びます。請求対象が上、請求済みや対象外は下に寄せています。
              </div>
            </div>
            <div style={{ fontSize: 12, color: "var(--muted)" }}>
              表示件数 {filteredRows.length}件 / 請求見込み {formatCurrency(invoicePreviewAmount)}
            </div>
          </div>
          <div style={{ maxHeight: "72vh", overflowX: "auto", overflowY: "auto" }}>
            <table style={tableStyle}>
              <thead>
                <tr>
                  <th style={{ ...thStyle, width: 140 }}>取引先</th>
                  <th style={{ ...thStyle, width: 150 }}>案件</th>
                  <th style={{ ...thStyle, width: 280 }}>商材 / 明細</th>
                  <th style={{ ...thStyle, width: 170 }}>対象月 / 納品予定</th>
                  <th style={{ ...thStyle, width: 110 }}>単価</th>
                  <th style={{ ...thStyle, width: 76 }}>数量</th>
                  <th style={{ ...thStyle, width: 110 }}>金額</th>
                  <th style={{ ...thStyle, width: 120 }}>ステータス</th>
                  <th style={{ ...thStyle, width: 80 }}>請求</th>
                  <th style={{ ...thStyle, width: 120 }}>詳細</th>
                </tr>
              </thead>
              <tbody>
                {filteredRows.map((row) => {
                  const clientLate = isClientLate(row, todayYmd)
                  const editorLate = isEditorLate(row, todayYmd)
                  const isLate = clientLate || editorLate
                  const isHighlighted = highlightId === row.id
                  return (
                  <tr
                    key={row.id}
                    style={{
                      background: isHighlighted
                        ? "rgba(129, 140, 248, 0.15)"
                        : isLate
                        ? "rgba(254, 202, 202, 0.25)"
                        : undefined,
                    }}
                  >
                    <td style={tdTextStyle} title={row.clientName}>
                      {row.clientName}
                    </td>
                    <td style={tdTextStyle} title={row.projectName}>
                      {row.projectName}
                    </td>
                    <td style={tdTitleStyle} title={row.title}>
                      <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", marginBottom: 4 }}>
                        <span style={pillStyle}>{getGuidedBillingModelLabel(row.billingModel)}</span>
                        {clientLate && <span style={badgeRed}>先方遅延</span>}
                        {editorLate && <span style={badgeRed}>外注遅延</span>}
                      </div>
                      <div style={{ fontWeight: 700 }}>{row.serviceName || row.projectName}</div>
                      <div style={{ marginTop: 4, fontSize: 12, color: "var(--muted)", lineHeight: 1.6 }}>
                        {row.title}
                      </div>
                    </td>
                    <td style={tdStyle}>
                      <div>
                        <span style={pillStyle}>{row.deliveryMonth}</span>
                      </div>
                      <div style={{ marginTop: 6 }}>
                        <input
                          type="date"
                          disabled={savingRowIds.has(row.id) || !canEdit}
                          value={
                            editingCell?.rowId === row.id && editingCell?.field === "dueClientAt"
                              ? editingCell.value
                              : row.dueClientAt
                          }
                          onChange={(e) => {
                            const v = e.target.value
                            setEditingCell(
                              editingCell?.rowId === row.id && editingCell?.field === "dueClientAt"
                                ? { ...editingCell, value: v }
                                : { rowId: row.id, field: "dueClientAt", value: v }
                            )
                          }}
                          onFocus={() =>
                            setEditingCell({
                              rowId: row.id,
                              field: "dueClientAt",
                              value: row.dueClientAt,
                            })
                          }
                          onBlur={(e) => {
                            setEditingCell(null)
                            const v = e.target.value
                            if (/^\d{4}-\d{2}-\d{2}$/.test(v)) {
                              void handleDueClientSave(row, v)
                            }
                          }}
                          style={{
                            padding: "4px 6px",
                            borderRadius: 6,
                            border: "1px solid var(--input-border)",
                            background: savingRowIds.has(row.id) || !canEdit ? "var(--surface-2)" : "var(--input-bg)",
                            fontSize: 12,
                            color: "var(--input-text)",
                            cursor: savingRowIds.has(row.id) ? "not-allowed" : "pointer",
                            width: "100%",
                          }}
                        />
                      </div>
                    </td>
                    <td style={tdStyle}>
                      <input
                        type="text"
                        inputMode="numeric"
                        pattern="[0-9]*"
                        disabled={savingRowIds.has(row.id) || !canEdit}
                        value={
                          editingCell?.rowId === row.id && editingCell?.field === "unitPrice"
                            ? editingCell.value
                            : String(row.unitPrice)
                        }
                        onChange={(e) =>
                          setEditingCell(
                            editingCell?.rowId === row.id && editingCell?.field === "unitPrice"
                              ? { ...editingCell, value: e.target.value }
                              : { rowId: row.id, field: "unitPrice", value: e.target.value }
                          )
                        }
                        onFocus={() =>
                          setEditingCell({
                            rowId: row.id,
                            field: "unitPrice",
                            value: String(row.unitPrice),
                          })
                        }
                        onBlur={(e) =>
                          handleUnitPriceBlur(row, e.target.value)
                        }
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.currentTarget.blur()
                          }
                        }}
                        style={{
                          padding: "4px 6px",
                          borderRadius: 6,
                          border: "1px solid var(--input-border)",
                          background: savingRowIds.has(row.id) || !canEdit ? "var(--surface-2)" : "var(--input-bg)",
                          fontSize: 12,
                          color: "var(--input-text)",
                          width: 72,
                          cursor: savingRowIds.has(row.id) ? "not-allowed" : "text",
                        }}
                      />
                    </td>
                    <td style={tdStyle}>
                      {row.quantity}
                      {row.unitType ? (
                        <span style={{ marginLeft: 4, fontSize: 11, color: "var(--muted)" }}>
                          {getGuidedUnitLabel(row.unitType)}
                        </span>
                      ) : null}
                    </td>
                    <td style={tdStyle}>{formatCurrency(row.amount ?? row.unitPrice)}</td>
                    <td style={tdStyle}>
                      <select
                        value={row.status ?? ""}
                        disabled={savingRowIds.has(row.id) || !canEdit}
                        onChange={(e) =>
                          handleStatusChange(row, e.target.value)
                        }
                        style={{
                          padding: "4px 6px",
                          borderRadius: 6,
                          border: "1px solid var(--input-border)",
                          background: savingRowIds.has(row.id) || !canEdit ? "var(--surface-2)" : "var(--input-bg)",
                          fontSize: 12,
                          fontWeight: 500,
                          color: "var(--input-text)",
                          cursor: savingRowIds.has(row.id) || !canEdit ? "not-allowed" : "pointer",
                          width: "100%",
                          maxWidth: 120,
                        }}
                      >
                        {row.status &&
                        !(row.status in statusLabels) ? (
                          <option value={row.status}>{getGuidedStatusLabel(row.status)}</option>
                        ) : null}
                        {Object.entries(statusLabels)
                          .filter(([k]) => k !== "cancelled")
                          .map(([value, label]) => (
                            <option key={value} value={value}>
                              {label}
                            </option>
                          ))}
                      </select>
                    </td>
                    <td style={{ ...tdStyle, textAlign: "center" }}>
                      <label style={{ display: "inline-flex", alignItems: "center", gap: 4, cursor: savingRowIds.has(row.id) || !canEdit ? "not-allowed" : "pointer" }}>
                        <input
                          type="checkbox"
                          disabled={savingRowIds.has(row.id) || !canEdit}
                          checked={row.billable}
                          onChange={() =>
                            handleBillableChange(row, !row.billable)
                          }
                          style={{ width: 15, height: 15, cursor: savingRowIds.has(row.id) || !canEdit ? "not-allowed" : "pointer" }}
                        />
                        {row.billable ? (
                          <span style={badgeGreen}>OK</span>
                        ) : (
                          <span style={badgeRed}>NG</span>
                        )}
                      </label>
                    </td>
                    <td style={{ ...tdStyle, whiteSpace: "nowrap" }}>
                      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                        {savingRowIds.has(row.id) && (
                          <span style={{ fontSize: 11, color: "var(--muted)" }}>保存中...</span>
                        )}
                        {rowErrors[row.id] && (
                          <span style={{ fontSize: 11, color: "#b91c1c" }}>
                            保存失敗
                          </span>
                        )}
                        <button
                          type="button"
                          onClick={() => setDetailRow(row)}
                          style={actionBtnStyle}
                        >
                          詳細
                        </button>
                      </div>
                    </td>
                  </tr>
                );
                })}
                {!isLoading && filteredRows.length === 0 && (
                  <tr>
                    <td style={tdStyle} colSpan={10}>
                      <GuideEmptyState
                        title={rows.length === 0 ? "請求対象はまだ登録されていません" : "この条件に合う請求対象はありません"}
                        description={
                          rows.length === 0
                            ? hasClients
                              ? "取引先登録は済んでいます。上の「請求対象を追加」から、今月分をそのまま登録してください。"
                              : "最初の取引先を登録すると、請求対象の追加から月末請求までをそのまま始められます。"
                            : "対象月や取引先の条件を広げると、他の請求候補も確認できます。"
                        }
                        primaryHref="/contents"
                        primaryLabel={rows.length === 0 ? "取引先を登録する" : "請求対象を追加する"}
                        hidePrimaryAction={rows.length === 0 ? hasClients : false}
                        onPrimaryClick={rows.length === 0 ? (hasClients ? openGuidedAdd : openClientRegistration) : openGuidedAdd}
                        helpHref="/help/contents-daily"
                      />
                    </td>
                  </tr>
                )}
                <tr>
                  <td style={tdStyle} colSpan={10}>
                    <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
                      <div>
                        追加時に自動で入る項目:
                        <strong style={{ marginLeft: 6 }}>
                          delivery_month / 明細タイトル / 単位 / 請求区分 / 初期ステータス
                        </strong>
                      </div>
                      <div style={{ color: "var(--muted)" }}>
                        一覧は請求対象のものが上に寄りやすく、今月分の確認をしやすい順で表示します。
                      </div>
                    </div>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        {detailRow ? (
          <div
            role="dialog"
            aria-modal="true"
              style={{
                position: "fixed",
                inset: 0,
                background: "rgba(15, 23, 42, 0.42)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                padding: 12,
                zIndex: 60,
              }}
            onClick={() => setDetailRow(null)}
          >
            <div
              style={{
                width: "min(860px, 100%)",
                maxHeight: "calc(100vh - 24px)",
                borderRadius: 18,
                border: "1px solid var(--border)",
                background: "var(--surface)",
                boxShadow: "0 18px 48px rgba(15, 23, 42, 0.24)",
                padding: 18,
                display: "grid",
                gap: 16,
                overflowY: "auto",
              }}
              onClick={(event) => event.stopPropagation()}
            >
              <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "start" }}>
                <div>
                  <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 6 }}>
                    {detailRow.clientName} / {detailRow.projectName}
                  </div>
                  {canEdit ? (
                    <div style={{ display: "grid", gap: 10 }}>
                      <input
                        value={detailTitleDraft}
                        onChange={(event) => setDetailTitleDraft(event.target.value)}
                          style={{
                            width: "100%",
                            borderRadius: 12,
                            border: "1px solid var(--input-border)",
                            background: "var(--input-bg)",
                            color: "var(--input-text)",
                            fontSize: 22,
                            fontWeight: 700,
                            padding: "10px 12px",
                            boxSizing: "border-box",
                          }}
                        />
                      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                        <button
                          type="button"
                          onClick={() =>
                            window.dispatchEvent(
                              new CustomEvent("open-ai-palette", {
                                detail: {
                                  source: "contents" as const,
                                  mode: "title_ideas" as const,
                                  text: detailTitleDraft || detailRow.title,
                                  compareText: detailTitleDraft || detailRow.title,
                                  context: buildContentAiContext(detailRow, todayYmd),
                                  title: "コンテンツAI",
                                  applyLabel: "タイトル候補に反映",
                                  applyTarget: "contents_detail_title",
                                  applyTransform: "first_line" as const,
                                  meta: buildContentAiMeta(detailRow),
                                },
                              })
                            )
                          }
                          style={{
                            padding: "8px 12px",
                            borderRadius: 10,
                            border: "1px solid var(--button-secondary-border)",
                            background: "var(--button-secondary-bg)",
                            color: "var(--button-secondary-text)",
                            fontWeight: 700,
                            cursor: "pointer",
                          }}
                        >
                          AIタイトル案
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleSaveDetailTitle()}
                          disabled={!detailTitleDraft.trim() || detailTitleDraft.trim() === detailRow.title}
                          style={{
                            padding: "8px 12px",
                            borderRadius: 10,
                            border: "1px solid var(--button-primary-bg)",
                            background: "var(--button-primary-bg)",
                            color: "var(--primary-contrast)",
                            fontWeight: 700,
                            cursor:
                              !detailTitleDraft.trim() || detailTitleDraft.trim() === detailRow.title ? "not-allowed" : "pointer",
                          }}
                        >
                          タイトルを保存
                        </button>
                      </div>
                    </div>
                  ) : (
                    <h2 style={{ margin: 0, fontSize: 22, color: "var(--text)" }}>{detailRow.title}</h2>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => setDetailRow(null)}
                  style={{
                    padding: "8px 12px",
                    borderRadius: 999,
                    border: "1px solid var(--button-secondary-border)",
                    background: "var(--button-secondary-bg)",
                    color: "var(--button-secondary-text)",
                    cursor: "pointer",
                  }}
                >
                  閉じる
                </button>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12 }}>
                <DetailStat label="案件" value={detailRow.projectName || "-"} />
                <DetailStat label="先方提出日" value={detailRow.dueClientAt} />
                <DetailStat label="編集者提出日" value={detailRow.dueEditorAt} />
                <DetailStat label="公開日" value={detailRow.publishAt || "-"} />
                <DetailStat label="対象月" value={detailRow.deliveryMonth || "-"} />
                <DetailStat label="単価" value={`¥${detailRow.unitPrice.toLocaleString("ja-JP")}`} />
                <DetailStat label="ステータス" value={statusLabels[detailRow.status] ?? detailRow.status} />
                <DetailStat label="請求対象" value={detailRow.billable ? "対象" : "対象外"} />
                <DetailStat label="ヘルス" value={`${detailRow.healthScore}`} />
              </div>

              {canEdit ? (
                <div style={{ border: "1px solid var(--border)", borderRadius: 14, padding: 14, background: "var(--surface-2)" }}>
                  <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 10 }}>詳細項目</div>
                  <div style={{ display: "grid", gap: 10, gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))" }}>
                    <label style={{ display: "grid", gap: 6, fontSize: 12, color: "var(--text)" }}>
                      案件
                      <select
                        value={detailDraft.projectId}
                        onChange={(event) => {
                          const project = projects.find((row) => row.id === event.target.value)
                          setDetailDraft((prev) => ({
                            ...prev,
                            projectId: event.target.value,
                            projectName: project?.name ?? prev.projectName,
                          }))
                        }}
                        style={{
                          padding: "8px 10px",
                          borderRadius: 8,
                          border: "1px solid var(--input-border)",
                          background: "var(--input-bg)",
                          color: "var(--input-text)",
                        }}
                      >
                        <option value="">未設定</option>
                        {projects.map((project) => (
                          <option key={project.id} value={project.id}>
                            {project.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label style={{ display: "grid", gap: 6, fontSize: 12, color: "var(--text)" }}>
                      案件名
                      <input
                        value={detailDraft.projectName}
                        onChange={(event) => setDetailDraft((prev) => ({ ...prev, projectName: event.target.value }))}
                        style={{ padding: "8px 10px", borderRadius: 8, border: "1px solid var(--input-border)", background: "var(--input-bg)", color: "var(--input-text)" }}
                      />
                    </label>
                    <label style={{ display: "grid", gap: 6, fontSize: 12, color: "var(--text)" }}>
                      公開日
                      <input
                        type="date"
                        value={detailDraft.publishAt}
                        onChange={(event) => setDetailDraft((prev) => ({ ...prev, publishAt: event.target.value }))}
                        style={{ padding: "8px 10px", borderRadius: 8, border: "1px solid var(--input-border)", background: "var(--input-bg)", color: "var(--input-text)" }}
                      />
                    </label>
                    <label style={{ display: "grid", gap: 6, fontSize: 12, color: "var(--text)" }}>
                      編集担当
                      <select
                        value={detailDraft.assigneeEditorUserId}
                        onChange={(event) => setDetailDraft((prev) => ({ ...prev, assigneeEditorUserId: event.target.value }))}
                        style={{ padding: "8px 10px", borderRadius: 8, border: "1px solid var(--input-border)", background: "var(--input-bg)", color: "var(--input-text)" }}
                      >
                        <option value="">未設定</option>
                        {members.map((member) => (
                          <option key={member.userId} value={member.userId}>
                            {member.displayName || member.email || member.userId}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label style={{ display: "grid", gap: 6, fontSize: 12, color: "var(--text)" }}>
                      修正回数
                      <input
                        type="number"
                        min="0"
                        value={detailDraft.revisionCount}
                        onChange={(event) => setDetailDraft((prev) => ({ ...prev, revisionCount: event.target.value }))}
                        style={{ padding: "8px 10px", borderRadius: 8, border: "1px solid var(--input-border)", background: "var(--input-bg)", color: "var(--input-text)" }}
                      />
                    </label>
                    <label style={{ display: "grid", gap: 6, fontSize: 12, color: "var(--text)" }}>
                      工数ポイント
                      <input
                        type="number"
                        min="1"
                        value={detailDraft.workloadPoints}
                        onChange={(event) => setDetailDraft((prev) => ({ ...prev, workloadPoints: event.target.value }))}
                        style={{ padding: "8px 10px", borderRadius: 8, border: "1px solid var(--input-border)", background: "var(--input-bg)", color: "var(--input-text)" }}
                      />
                    </label>
                    <label style={{ display: "grid", gap: 6, fontSize: 12, color: "var(--text)" }}>
                      想定原価
                      <input
                        type="number"
                        min="0"
                        value={detailDraft.estimatedCost}
                        onChange={(event) => setDetailDraft((prev) => ({ ...prev, estimatedCost: event.target.value }))}
                        style={{ padding: "8px 10px", borderRadius: 8, border: "1px solid var(--input-border)", background: "var(--input-bg)", color: "var(--input-text)" }}
                      />
                    </label>
                    <label style={{ display: "grid", gap: 6, fontSize: 12, color: "var(--text)" }}>
                      連番
                      <input
                        type="number"
                        min="0"
                        value={detailDraft.sequenceNo}
                        onChange={(event) => setDetailDraft((prev) => ({ ...prev, sequenceNo: event.target.value }))}
                        style={{ padding: "8px 10px", borderRadius: 8, border: "1px solid var(--input-border)", background: "var(--input-bg)", color: "var(--input-text)" }}
                      />
                    </label>
                    <label style={{ display: "grid", gap: 6, fontSize: 12, color: "var(--text)", gridColumn: "1 / -1" }}>
                      次アクション
                      <textarea
                        rows={3}
                        value={detailDraft.nextAction}
                        onChange={(event) => setDetailDraft((prev) => ({ ...prev, nextAction: event.target.value }))}
                        style={{ width: "100%", borderRadius: 8, border: "1px solid var(--input-border)", background: "var(--input-bg)", color: "var(--input-text)", padding: "8px 10px", resize: "vertical", boxSizing: "border-box" }}
                      />
                    </label>
                    <label style={{ display: "grid", gap: 6, fontSize: 12, color: "var(--text)", gridColumn: "1 / -1" }}>
                      ブロッカー
                      <textarea
                        rows={2}
                        value={detailDraft.blockedReason}
                        onChange={(event) => setDetailDraft((prev) => ({ ...prev, blockedReason: event.target.value }))}
                        style={{ width: "100%", borderRadius: 8, border: "1px solid var(--input-border)", background: "var(--input-bg)", color: "var(--input-text)", padding: "8px 10px", resize: "vertical", boxSizing: "border-box" }}
                      />
                    </label>
                    {DETAIL_LINK_KEYS.map((key) => (
                      <label key={key} style={{ display: "grid", gap: 6, fontSize: 12, color: "var(--text)" }}>
                        {key}
                        <input
                          value={detailDraft.links[key]}
                          onChange={(event) =>
                            setDetailDraft((prev) => ({
                              ...prev,
                              links: { ...prev.links, [key]: event.target.value },
                            }))
                          }
                          placeholder="https://..."
                          style={{ padding: "8px 10px", borderRadius: 8, border: "1px solid var(--input-border)", background: "var(--input-bg)", color: "var(--input-text)" }}
                        />
                      </label>
                    ))}
                  </div>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 12 }}>
                    <button
                      type="button"
                      onClick={() => void handleSaveDetailMeta()}
                      style={{
                        padding: "8px 12px",
                        borderRadius: 10,
                        border: "1px solid var(--button-primary-bg)",
                        background: "var(--button-primary-bg)",
                        color: "var(--primary-contrast)",
                        fontWeight: 700,
                        cursor: "pointer",
                      }}
                    >
                      詳細を保存
                    </button>
                  </div>
                </div>
              ) : null}

              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12 }}>
                <div style={{ border: "1px solid var(--border)", borderRadius: 14, padding: 14, background: "var(--surface-2)" }}>
                  <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 6 }}>進行メモ</div>
                  <div style={{ fontSize: 13, color: "var(--text)", lineHeight: 1.7 }}>{buildContentProgressNote(detailRow, todayYmd)}</div>
                </div>

                <div style={{ border: "1px solid var(--border)", borderRadius: 14, padding: 14, background: "var(--surface-2)" }}>
                  <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 6 }}>次の行動</div>
                  <div style={{ fontSize: 13, color: "var(--text)", lineHeight: 1.7, marginBottom: canEdit ? 12 : 10 }}>
                    {buildContentNextAction(detailRow, todayYmd)}
                  </div>
                  {canEdit && (
                    <div style={{ display: "grid", gap: 10, marginBottom: 10 }}>
                      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                        <button
                          type="button"
                          onClick={() =>
                            window.dispatchEvent(
                              new CustomEvent("open-ai-palette", {
                                detail: {
                                  source: "contents" as const,
                                  mode: "status_summary" as const,
                                  text: detailShareDraft || buildContentShareDraft(detailRow, todayYmd),
                                  compareText: detailShareDraft || buildContentShareDraft(detailRow, todayYmd),
                                   context: buildContentAiContext(detailRow, todayYmd),
                                  title: "コンテンツAI",
                                   applyLabel: "共有文ドラフトに反映",
                                   applyTarget: "contents_detail_share_draft",
                                   meta: buildContentAiMeta(detailRow),
                                 },
                               })
                             )
                          }
                          style={{
                            padding: "8px 12px",
                            borderRadius: 10,
                            border: "1px solid var(--button-secondary-border)",
                            background: "var(--button-secondary-bg)",
                            color: "var(--button-secondary-text)",
                            fontWeight: 700,
                            cursor: "pointer",
                          }}
                        >
                          AI状況要約
                        </button>
                        {(isClientLate(detailRow, todayYmd) || isEditorLate(detailRow, todayYmd)) && (
                          <button
                            type="button"
                            onClick={() =>
                              window.dispatchEvent(
                                new CustomEvent("open-ai-palette", {
                                  detail: {
                                    source: "contents" as const,
                                    mode: "delay_summary" as const,
                                    text: detailShareDraft || buildContentShareDraft(detailRow, todayYmd),
                                    compareText: detailShareDraft || buildContentShareDraft(detailRow, todayYmd),
                                     context: buildContentAiContext(detailRow, todayYmd),
                                     title: "コンテンツAI",
                                     applyLabel: "共有文ドラフトに反映",
                                     applyTarget: "contents_detail_share_draft",
                                     meta: buildContentAiMeta(detailRow),
                                   },
                                 })
                               )
                            }
                            style={{
                              padding: "8px 12px",
                              borderRadius: 10,
                              border: "1px solid var(--button-secondary-border)",
                              background: "var(--button-secondary-bg)",
                              color: "var(--button-secondary-text)",
                              fontWeight: 700,
                              cursor: "pointer",
                            }}
                          >
                            AI遅延要約
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() =>
                            window.dispatchEvent(
                              new CustomEvent("open-ai-palette", {
                                detail: {
                                  source: "contents" as const,
                                  mode: "task_rewrite" as const,
                                  text: detailShareDraft || buildContentShareDraft(detailRow, todayYmd),
                                  compareText: detailShareDraft || buildContentShareDraft(detailRow, todayYmd),
                                  context: buildContentAiContext(detailRow, todayYmd),
                                  title: "コンテンツAI",
                                  applyLabel: "共有文ドラフトに反映",
                                  applyTarget: "contents_detail_share_draft",
                                  meta: buildContentAiMeta(detailRow),
                                },
                              })
                            )
                          }
                          style={{
                            padding: "8px 12px",
                            borderRadius: 10,
                            border: "1px solid var(--button-secondary-border)",
                            background: "var(--button-secondary-bg)",
                            color: "var(--button-secondary-text)",
                            fontWeight: 700,
                            cursor: "pointer",
                          }}
                        >
                          AIタスク文変換
                        </button>
                      </div>

                      <div style={{ display: "grid", gap: 8 }}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                          <div style={{ fontSize: 12, color: "var(--muted)" }}>共有文ドラフト</div>
                          <button
                            type="button"
                            onClick={() => void handleCopyDetailShareDraft()}
                            disabled={!detailShareDraft.trim()}
                            style={{
                              padding: "6px 10px",
                              borderRadius: 10,
                              border: "1px solid var(--button-secondary-border)",
                              background: "var(--button-secondary-bg)",
                              color: "var(--button-secondary-text)",
                              fontWeight: 700,
                              cursor: detailShareDraft.trim() ? "pointer" : "not-allowed",
                            }}
                          >
                            ドラフトをコピー
                          </button>
                        </div>
                        <textarea
                          value={detailShareDraft}
                          onChange={(event) => setDetailShareDraft(event.target.value)}
                          rows={5}
                          style={{
                            width: "100%",
                            borderRadius: 12,
                            border: "1px solid var(--input-border)",
                            background: "var(--input-bg)",
                            color: "var(--input-text)",
                            fontSize: 13,
                            lineHeight: 1.7,
                            padding: "10px 12px",
                            resize: "vertical",
                            boxSizing: "border-box",
                          }}
                        />
                        <div style={{ fontSize: 11, color: "var(--muted)", lineHeight: 1.6 }}>
                          この欄は保存されません。Slack などへ共有する文面の下書きとして使います。
                        </div>
                      </div>
                    </div>
                  )}
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    <Link href={`/contents?highlight=${encodeURIComponent(detailRow.id)}`} style={{ fontSize: 12, color: "var(--primary)", fontWeight: 700, textDecoration: "none" }}>
                      一覧で位置を確認
                    </Link>
                    <Link href="/help/contents-daily" style={{ fontSize: 12, color: "var(--primary)", fontWeight: 700, textDecoration: "none" }}>
                      運用手順を見る
                    </Link>
                    <Link href={`/billing?month=${encodeURIComponent(detailRow.deliveryMonth || "")}`} style={{ fontSize: 12, color: "var(--primary)", fontWeight: 700, textDecoration: "none" }}>
                      対象月の請求を確認
                    </Link>
                  </div>
                </div>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  )
}

function DetailStat({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ border: "1px solid var(--border)", borderRadius: 14, padding: 14, background: "var(--surface-2)" }}>
      <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 6 }}>{label}</div>
      <div style={{ fontSize: 14, fontWeight: 700, color: "var(--text)" }}>{value}</div>
    </div>
  )
}














