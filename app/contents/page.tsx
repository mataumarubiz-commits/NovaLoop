"use client"

import Link from "next/link"
import { useCallback, useEffect, useState, useMemo, type CSSProperties } from "react"
import { useSearchParams } from "next/navigation"
import { supabase } from "../../lib/supabase"
import { useAuthOrg } from "@/hooks/useAuthOrg"
import ChecklistReturnButton from "@/components/home/ChecklistReturnButton"
import type { ApplyAiResultDetail } from "@/lib/aiClientEvents"
import {
  buildContentHealthScore,
  DRAFT_STATUS_OPTIONS,
  FINAL_STATUS_OPTIONS,
  MATERIAL_STATUS_OPTIONS,
  normalizeContentLinks,
  validateContentRules,
  type ContentLinks,
} from "@/lib/contentWorkflow"
import GuideEmptyState from "@/components/shared/GuideEmptyState"

const tableStyle: CSSProperties = {
  width: "100%",
  borderCollapse: "collapse",
  background: "var(--table-bg)",
}

const thStyle: CSSProperties = {
  textAlign: "left",
  fontSize: 13,
  letterSpacing: "0.04em",
  color: "var(--text)",
  fontWeight: 600,
  padding: "10px 12px",
  borderBottom: "1px solid var(--table-border)",
  background: "var(--table-header-bg)",
  position: "sticky",
  top: 0,
  zIndex: 1,
}

const tdStyle: CSSProperties = {
  padding: "12px",
  borderBottom: "1px solid var(--table-border)",
  fontSize: 14,
  fontWeight: 500,
  color: "var(--text)",
  verticalAlign: "top",
}

/** クライアント・プロジェクト・タイトル用: 横読み省略表示 */
const tdTextStyle: CSSProperties = {
  ...tdStyle,
  maxWidth: 0,
  minWidth: 140,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
}
const tdTitleStyle: CSSProperties = {
  ...tdTextStyle,
  minWidth: 200,
}

/** 対象月など chip 用スタイル */
const pillStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  padding: "2px 8px",
  borderRadius: 999,
  fontSize: 13,
  fontWeight: 600,
  background: "var(--chip-bg)",
  color: "var(--chip-text)",
  border: "1px solid var(--chip-border)",
}

/** 済・OK 用緑バッジ */
const badgeGreen: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  padding: "2px 8px",
  borderRadius: 999,
  fontSize: 13,
  fontWeight: 600,
  background: "#dcfce7",
  color: "#14532d",
  border: "1px solid #86efac",
}

/** 未・注意用黄バッジ */
const badgeAmber: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  padding: "2px 8px",
  borderRadius: 999,
  fontSize: 13,
  fontWeight: 600,
  background: "#fef3c7",
  color: "#92400e",
  border: "1px solid #fcd34d",
}

/** NG・削除系赤バッジ */
const badgeRed: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  padding: "2px 8px",
  borderRadius: 999,
  fontSize: 13,
  fontWeight: 600,
  background: "#fee2e2",
  color: "#7f1d1d",
  border: "1px solid #fca5a5",
}

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
  dueClientAt: string
  dueEditorAt: string
  publishAt: string | null
  unitPrice: number
  thumbnailDone: boolean
  billable: boolean
  deliveryMonth: string
  status: string
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
  assigneeCheckerUserId: string
  revisionCount: string
  workloadPoints: string
  estimatedCost: string
  nextAction: string
  blockedReason: string
  materialStatus: string
  draftStatus: string
  finalStatus: string
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

const SAVED_VIEW_STORAGE_KEY = "novaloop:contents:saved-views"

/** 未完了ではないステータス（納品・公開・没） */
const COMPLETED_STATUSES = new Set(["delivered", "published", "canceled", "cancelled"])

const isIncomplete = (status: string) => !COMPLETED_STATUSES.has(status)

/** 先方遅延: 先方提出日を過ぎていて未完了 */
const isClientLate = (row: Row, todayYmd: string) =>
  isIncomplete(row.status) && row.dueClientAt < todayYmd

/** 外注遅延: 編集者提出日を過ぎていて未提出かつ未完了 */
const isEditorLate = (row: Row, todayYmd: string) =>
  isIncomplete(row.status) &&
  row.dueEditorAt < todayYmd &&
  row.editorSubmittedAt == null

const buildContentProgressNote = (row: Row, todayYmd: string) => {
  if (isClientLate(row, todayYmd)) {
    return "先方提出日を過ぎています。最優先で対応状況を確認してください。"
  }
  if (isEditorLate(row, todayYmd)) {
    return "編集者提出が遅れています。外注確認とリスケ判断が必要です。"
  }
  return "大きな遅延はありません。次の更新タイミングを確認してください。"
}

const buildContentNextAction = (row: Row, todayYmd: string) => {
  if (isClientLate(row, todayYmd)) {
    return "先方提出可否とリスケ要否を関係者に確認し、今日中の連絡方針を決めてください。"
  }
  if (isEditorLate(row, todayYmd)) {
    return "編集者の提出見込みを確認し、差し替えや日程再調整の要否を整理してください。"
  }
  if (row.status === "submitted_to_client") {
    return "先方確認待ちです。戻し有無と次回の確認タイミングを共有してください。"
  }
  if (row.status === "delivered" || row.status === "published") {
    return "納品済みです。請求対象月と請求可否を最終確認してください。"
  }
  return "次の更新担当と確認タイミングを決め、必要な共有先へ連絡してください。"
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
  materials_checked: "素材確認",
  editing: "編集中",
  internal_revision: "内部確認",
  editing_revision: "編集修正",
  submitted_to_client: "先方提出",
  client_revision: "先方修正",
  scheduling: "予約投稿",
  delivered: "納品完了",
  published: "公開済み",
  canceled: "キャンセル",
  cancelled: "キャンセル",
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

const DETAIL_LINK_KEYS = ["draft", "final", "publish", "proof", "reference"] as const

function buildDetailDraft(row: Row | null): DetailDraft {
  const links = normalizeContentLinks(row?.links ?? {})
  return {
    projectId: row?.projectId ?? "",
    projectName: row?.projectName ?? "",
    publishAt: row?.publishAt ?? "",
    assigneeEditorUserId: row?.assigneeEditorUserId ?? "",
    assigneeCheckerUserId: row?.assigneeCheckerUserId ?? "",
    revisionCount: String(row?.revisionCount ?? 0),
    workloadPoints: String(row?.workloadPoints ?? 1),
    estimatedCost: String(row?.estimatedCost ?? 0),
    nextAction: row?.nextAction ?? "",
    blockedReason: row?.blockedReason ?? "",
    materialStatus: row?.materialStatus ?? "not_ready",
    draftStatus: row?.draftStatus ?? "not_started",
    finalStatus: row?.finalStatus ?? "not_started",
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

const withoutLinksJson = (payload: Record<string, unknown>) => {
  if (!Object.prototype.hasOwnProperty.call(payload, "links_json")) return payload
  const next = { ...payload }
  delete next.links_json
  return next
}

const prepareContentWritePayload = (
  payload: Record<string, unknown> | Record<string, unknown>[],
  supportsLinksJson: boolean | null
) => {
  if (supportsLinksJson !== false) return payload
  return Array.isArray(payload) ? payload.map((item) => withoutLinksJson(item)) : withoutLinksJson(payload)
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
  const [filterDue, setFilterDue] = useState<"" | "today" | "tomorrow" | "week" | "late">("")
  const [filterClientId, setFilterClientId] = useState("")
  const [filterProjectId, setFilterProjectId] = useState("")
  const [savedViews, setSavedViews] = useState<SavedView[]>(loadSavedViews)
  const [detailRow, setDetailRow] = useState<Row | null>(null)
  const [detailTitleDraft, setDetailTitleDraft] = useState("")
  const [detailShareDraft, setDetailShareDraft] = useState("")
  const [detailDraft, setDetailDraft] = useState<DetailDraft>(() => buildDetailDraft(null))
  const [supportsLinksJson, setSupportsLinksJson] = useState<boolean | null>(null)
  const searchParams = useSearchParams()
  const highlightId = searchParams.get("highlight")
  const openClientCreate = searchParams.get("newClient")
  const projectIdQuery = searchParams.get("projectId")
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
  const selectedBulkTemplate = useMemo(
    () => templates.find((template) => template.id === bulkTemplateId) ?? templates[0] ?? null,
    [bulkTemplateId, templates]
  )

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

  const insertContentsRows = async (payload: Record<string, unknown> | Record<string, unknown>[]) => {
    let result = await supabase.from("contents").insert(prepareContentWritePayload(payload, supportsLinksJson))
    if (result.error && isMissingLinksJsonError(result.error.message)) {
      setSupportsLinksJson(false)
      result = await supabase.from("contents").insert(prepareContentWritePayload(payload, false))
    }
    return result
  }

  const updateContentRow = async (rowId: string, payload: Record<string, unknown>) => {
    if (!orgId) {
      return { error: { message: "所属情報が取得できませんでした" } }
    }

    let result = await supabase
      .from("contents")
      .update(prepareContentWritePayload(payload, supportsLinksJson))
      .eq("id", rowId)
      .eq("org_id", orgId)

    if (result.error && isMissingLinksJsonError(result.error.message)) {
      setSupportsLinksJson(false)
      result = await supabase
        .from("contents")
        .update(prepareContentWritePayload(payload, false))
        .eq("id", rowId)
        .eq("org_id", orgId)
    }

    return result
  }

  const filteredRows = useMemo(() => {
    let list = rows
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

    // デフォルトは提出日昇順
    return [...list].sort((a, b) => (a.dueClientAt < b.dueClientAt ? -1 : a.dueClientAt > b.dueClientAt ? 1 : 0))
  }, [rows, filterDue, filterClientId, filterProjectId, todayYmd, tomorrowYmd, weekStartYmd, weekEndYmd, clients])

  useEffect(() => {
    setDebug({ userId: user?.id ?? null, orgId: orgId ?? null, role, error: needsOnboarding ? "onboarding needed" : null })
  }, [user?.id, orgId, role, needsOnboarding])

  useEffect(() => {
    if (projectIdQuery) {
      setFilterProjectId(projectIdQuery)
    }
  }, [projectIdQuery])

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
        window.setTimeout(() => setUiSuccess(null), 2500)
        return
      }
      if (detail.applyTarget === "contents_bulk_textarea") {
        setBulkTextarea(detail.result.text)
        setUiSuccess("AI結果を一括入力に反映しました")
        window.setTimeout(() => setUiSuccess(null), 2500)
        return
      }
      if (detail.applyTarget === "contents_detail_title") {
        setDetailTitleDraft(detail.result.text)
        return
      }
      if (detail.applyTarget === "contents_detail_share_draft") {
        setDetailShareDraft(detail.result.text)
        setUiSuccess("AI結果を共有文ドラフトに反映しました")
        window.setTimeout(() => setUiSuccess(null), 2500)
      }
    }

    window.addEventListener("apply-ai-result", handler as EventListener)
    return () => window.removeEventListener("apply-ai-result", handler as EventListener)
  }, [])

  const openContentTitleIdeas = (row: Row) => {
    setDetailRow(row)
    window.setTimeout(() => {
      window.dispatchEvent(
        new CustomEvent("open-ai-palette", {
          detail: {
            source: "contents" as const,
            mode: "title_ideas" as const,
            text: row.title,
            compareText: row.title,
            context: buildContentAiContext(row, todayYmd),
            title: "Contents AI",
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
      window.setTimeout(() => setUiSuccess(null), 2500)
    } catch (copyError) {
      setUiError(copyError instanceof Error ? copyError.message : "共有文ドラフトのコピーに失敗しました")
      window.setTimeout(() => setUiError(null), 2500)
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
    }

    const mapped = (data ?? []).map((row) => {
      const client = Array.isArray(row.client) ? row.client[0] : row.client
      return {
      id: row.id,
    clientId: row.client_id,
      clientName: (client as { name?: string } | null)?.name ?? "",
      projectId: row.project_id ?? null,
      projectName: row.project_name,
      title: row.title,
      dueClientAt: row.due_client_at,
      dueEditorAt: row.due_editor_at,
      publishAt: row.publish_at ?? null,
      unitPrice: Number(row.unit_price),
      thumbnailDone: row.thumbnail_done,
      billable: row.billable_flag,
      deliveryMonth: row.delivery_month,
      status: row.status,
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
      await Promise.all([fetchClients(orgId), fetchProjects(orgId), fetchMembers(orgId), detectLinksJsonSupport(orgId), fetchContents(orgId)])
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
    dueClientAt: string
    unitPrice: number
    status?: string
    billable?: boolean
  }): Row => {
    const dueEditorAt = addDays(params.dueClientAt, -3)
    return {
      id: "draft",
      clientId: params.clientId,
      clientName: selectedCreateClient?.name ?? selectedTemplateClient?.name ?? "",
      projectId: params.projectId ?? null,
      projectName: params.projectName,
      title: params.title,
      dueClientAt: params.dueClientAt,
      dueEditorAt,
      publishAt: null,
      unitPrice: params.unitPrice,
      thumbnailDone: false,
      billable: params.billable ?? true,
      deliveryMonth: params.dueClientAt.slice(0, 7),
      status: params.status ?? "not_started",
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
      setTimeout(() => setUiSuccess(null), 2500)
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
    setTimeout(() => setUiSuccess(null), 2500)
  }

  /** ステータス変更: contents 更新 + status_events に履歴 insert */
  const updateContentStatus = async (row: Row, newStatus: string) => {
    if (!orgId || !user?.id) {
      setUiError("所属またはユーザー情報が取得できませんでした")
      return
    }
    const status = newStatus === "cancelled" ? "canceled" : newStatus
    const { payload, errors } = prepareContentPayload(row, { status })
    if (errors.length > 0) {
      setUiError(errors[0])
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
      setTimeout(() => setUiSuccess(null), 2500)
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
    window.setTimeout(() => setUiSuccess(null), 2500)
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
        assignee_checker_user_id: detailDraft.assigneeCheckerUserId || null,
        revision_count: Number(detailDraft.revisionCount || 0),
        workload_points: Number(detailDraft.workloadPoints || 1),
        estimated_cost: Number(detailDraft.estimatedCost || 0),
        next_action: detailDraft.nextAction.trim() || null,
        blocked_reason: detailDraft.blockedReason.trim() || null,
        material_status: detailDraft.materialStatus,
        draft_status: detailDraft.draftStatus,
        final_status: detailDraft.finalStatus,
        sequence_no: detailDraft.sequenceNo ? Number(detailDraft.sequenceNo) : null,
        links_json: normalizedLinks,
      },
      detailRow,
      "詳細"
    )
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
      setTimeout(() => setUiSuccess(null), 2500)
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
        <div
          style={{
            fontSize: 11,
            color: "var(--muted)",
            fontFamily:
              "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, Liberation Mono, Courier New, monospace",
            marginBottom: 8,
          }}
        >
          <div>user_id: {debug.userId ?? "-"}</div>
          <div>org_id: {debug.orgId ?? "-"}</div>
          <div>role: {debug.role ?? "-"}</div>
          <div>error: {debug.error ?? "-"}</div>
        </div>
        <div style={{ marginBottom: 16 }}>
          <ChecklistReturnButton />
        </div>
        <header style={{ marginBottom: 24 }}>
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
            <Link
              href="/settings/dashboard?context=/contents&type=feedback"
              style={{
                padding: "10px 14px",
                borderRadius: 10,
                border: "1px solid var(--button-secondary-border)",
                background: "var(--button-secondary-bg)",
                color: "var(--button-secondary-text)",
                fontSize: 14,
                fontWeight: 500,
                textDecoration: "none",
              }}
            >
              改善要望を送る
            </Link>
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
                              title: "Contents AI",
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
                        setTimeout(() => setUiSuccess(null), 2500)
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
        </header>

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

        {isAdding && (
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
                案件
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
                プロジェクト                <input
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
                            title: "Contents AI",
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
                  type="number"
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
                追加する
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
            borderRadius: 16,
            overflow: "hidden",
            boxShadow: "0 8px 24px rgba(0,0,0,0.08)",
          }}
        >
          <div style={{ maxHeight: "70vh", overflow: "auto" }}>
            <table style={tableStyle}>
              <thead>
                <tr>
                  <th style={{ ...thStyle, minWidth: 140 }}>クライアント</th>
                  <th style={{ ...thStyle, minWidth: 140 }}>プロジェクト</th>
                  <th style={{ ...thStyle, minWidth: 200 }}>タイトル</th>
                  <th style={thStyle}>先方提出日</th>
                  <th style={thStyle}>編集者提出日</th>
                  <th style={thStyle}>単価</th>
                  <th style={thStyle}>サムネ</th>
                  <th style={thStyle}>請求</th>
                  <th style={thStyle}>対象月</th>
                  <th style={thStyle}>ステータス</th>
                  <th style={thStyle}>操作</th>
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
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        {clientLate && <span style={badgeRed}>先方遅延</span>}
                        {editorLate && <span style={badgeRed}>外注遅延</span>}
                      </div>
                      <div>{row.title}</div>
                    </td>
                    <td style={tdStyle}>
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
                          padding: "6px 8px",
                          borderRadius: 8,
                          border: "1px solid var(--input-border)",
                          background: savingRowIds.has(row.id) || !canEdit ? "var(--surface-2)" : "var(--input-bg)",
                          fontSize: 13,
                          color: "var(--input-text)",
                          cursor: savingRowIds.has(row.id) ? "not-allowed" : "pointer",
                        }}
                      />
                      <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 2 }}>
                        自動計算: 先方提出日 - 3日。編集者提出日・対象月も連動更新
                      </div>
                    </td>
                    <td style={tdStyle}>
                      {row.dueEditorAt}
                    </td>
                    <td style={tdStyle}>
                      <input
                        type="number"
                        min={0}
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
                          padding: "6px 8px",
                          borderRadius: 8,
                          border: "1px solid var(--input-border)",
                          background: savingRowIds.has(row.id) || !canEdit ? "var(--surface-2)" : "var(--input-bg)",
                          fontSize: 13,
                          color: "var(--input-text)",
                          width: 100,
                          cursor: savingRowIds.has(row.id) ? "not-allowed" : "text",
                        }}
                      />
                    </td>
                    <td style={tdStyle}>
                      <label style={{ display: "inline-flex", alignItems: "center", gap: 6, cursor: savingRowIds.has(row.id) || !canEdit ? "not-allowed" : "pointer" }}>
                        <input
                          type="checkbox"
                          disabled={savingRowIds.has(row.id) || !canEdit}
                          checked={row.thumbnailDone}
                          onChange={() =>
                            handleThumbnailChange(row, !row.thumbnailDone)
                          }
                          style={{ width: 18, height: 18, cursor: savingRowIds.has(row.id) || !canEdit ? "not-allowed" : "pointer" }}
                        />
                        {row.thumbnailDone ? (
                          <span style={badgeGreen}>済</span>
                        ) : (
                          <span style={badgeAmber}>未</span>
                        )}
                      </label>
                    </td>
                    <td style={tdStyle}>
                      <label style={{ display: "inline-flex", alignItems: "center", gap: 6, cursor: savingRowIds.has(row.id) || !canEdit ? "not-allowed" : "pointer" }}>
                        <input
                          type="checkbox"
                          disabled={savingRowIds.has(row.id) || !canEdit}
                          checked={row.billable}
                          onChange={() =>
                            handleBillableChange(row, !row.billable)
                          }
                          style={{ width: 18, height: 18, cursor: savingRowIds.has(row.id) || !canEdit ? "not-allowed" : "pointer" }}
                        />
                        {row.billable ? (
                          <span style={badgeGreen}>OK</span>
                        ) : (
                          <span style={badgeRed}>NG</span>
                        )}
                      </label>
                    </td>
                    <td style={tdStyle}>
                      <span style={pillStyle}>{row.deliveryMonth}</span>
                    </td>
                    <td style={tdStyle}>
                      <select
                        value={row.status ?? ""}
                        disabled={savingRowIds.has(row.id) || !canEdit}
                        onChange={(e) =>
                          handleStatusChange(row, e.target.value)
                        }
                        style={{
                          padding: "6px 8px",
                          borderRadius: 8,
                          border: "1px solid var(--input-border)",
                          background: savingRowIds.has(row.id) || !canEdit ? "var(--surface-2)" : "var(--input-bg)",
                          fontSize: 13,
                          fontWeight: 500,
                          color: "var(--input-text)",
                          cursor: savingRowIds.has(row.id) || !canEdit ? "not-allowed" : "pointer",
                          minWidth: 120,
                        }}
                      >
                        {row.status &&
                        !(row.status in statusLabels) ? (
                          <option value={row.status}>{row.status}</option>
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
                    <td style={tdStyle}>
                      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                        {savingRowIds.has(row.id) && (
                          <span style={{ fontSize: 12, color: "var(--muted)" }}>保存中...</span>
                        )}
                        {rowErrors[row.id] && (
                          <span style={{ fontSize: 12, color: "#b91c1c" }}>
                            保存失敗: {rowErrors[row.id]}
                          </span>
                        )}
                        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                          {canEdit && (
                            <>
                              <button
                                type="button"
                                onClick={() => openContentTitleIdeas(row)}
                                style={{
                                  padding: "6px 10px",
                                  borderRadius: 8,
                                  border: "1px solid var(--button-secondary-border)",
                                  background: "var(--button-secondary-bg)",
                                  fontSize: 12,
                                  color: "var(--button-secondary-text)",
                                  cursor: "pointer",
                                }}
                              >
                                AIタイトル案
                              </button>
                              <button
                                type="button"
                                disabled={savingRowIds.has(row.id)}
                                onClick={() => handleSetCanceled(row)}
                                style={{
                                  padding: "6px 10px",
                                  borderRadius: 8,
                                  border: "1px solid #b91c1c",
                                  background: savingRowIds.has(row.id) ? "#fecaca" : "#fef2f2",
                                  color: "#b91c1c",
                                  fontSize: 12,
                                  cursor: savingRowIds.has(row.id) ? "wait" : "pointer",
                                }}
                              >
                                没にする
                              </button>
                              <button
                                type="button"
                                onClick={() => handleSaveAsTemplate(row)}
                                style={{
                                  padding: "6px 10px",
                                  borderRadius: 8,
                                  border: "1px solid var(--chip-border)",
                                  background: "var(--chip-bg)",
                                  fontSize: 12,
                                  color: "var(--chip-text)",
                                  cursor: "pointer",
                                }}
                              >
                                テンプレとして保存                              </button>
                              <button
                                type="button"
                                onClick={() => void handleDuplicateRow(row)}
                                style={{
                                  padding: "6px 10px",
                                  borderRadius: 8,
                                  border: "1px solid var(--button-secondary-border)",
                                  background: "var(--button-secondary-bg)",
                                  fontSize: 12,
                                  color: "var(--button-secondary-text)",
                                  cursor: "pointer",
                                }}
                              >
                                行複製
                              </button>
                            </>
                          )}
                          <button
                            type="button"
                            onClick={() => setDetailRow(row)}
                            style={{
                              padding: "6px 10px",
                              borderRadius: 8,
                              border: "1px solid var(--button-secondary-border)",
                              background: "var(--button-secondary-bg)",
                              fontSize: 12,
                              color: "var(--button-secondary-text)",
                              cursor: "pointer",
                            }}
                          >
                            詳細
                          </button>
                        </div>
                      </div>
                    </td>
                  </tr>
                );
                })}
                {!isLoading && rows.length === 0 && (
                  <tr>
                    <td style={tdStyle} colSpan={11}>
                      <GuideEmptyState
                        title="コンテンツはまだ登録されていません"
                        description={
                          hasClients
                            ? "クライアント登録は済んでいます。上の +追加 から最初の1本を入れると、Home と Billing の導線が動き始めます。"
                            : "最初のクライアントを登録すると、1本目の制作と請求の導線をそのまま始められます。"
                        }
                        primaryHref="/contents"
                        primaryLabel="クライアントを登録する"
                        hidePrimaryAction={hasClients}
                        onPrimaryClick={hasClients ? () => setIsAdding(true) : openClientRegistration}
                        helpHref="/help/contents-daily"
                      />
                    </td>
                  </tr>
                )}
                <tr>
                  <td style={tdStyle} colSpan={11}>
                    <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
                      <div>
                        必須項目:
                        <strong style={{ marginLeft: 6 }}>
                          client / project_name / title / due_client_at / unit_price
                        </strong>
                      </div>
                      <div style={{ color: "var(--muted)" }}>
                        先方提出日昇順で表示します。                      </div>
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
              padding: 20,
              zIndex: 60,
            }}
            onClick={() => setDetailRow(null)}
          >
            <div
              style={{
                width: "min(720px, 100%)",
                borderRadius: 18,
                border: "1px solid var(--border)",
                background: "var(--surface)",
                boxShadow: "0 18px 48px rgba(15, 23, 42, 0.24)",
                padding: 20,
                display: "grid",
                gap: 16,
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
                          width: "min(520px, 100%)",
                          borderRadius: 12,
                          border: "1px solid var(--input-border)",
                          background: "var(--input-bg)",
                          color: "var(--input-text)",
                          fontSize: 22,
                          fontWeight: 700,
                          padding: "10px 12px",
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
                                  title: "Contents AI",
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
                  <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 10 }}>競合吸収拡張フィールド</div>
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
                      Editor
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
                      Checker
                      <select
                        value={detailDraft.assigneeCheckerUserId}
                        onChange={(event) => setDetailDraft((prev) => ({ ...prev, assigneeCheckerUserId: event.target.value }))}
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
                      素材
                      <select
                        value={detailDraft.materialStatus}
                        onChange={(event) => setDetailDraft((prev) => ({ ...prev, materialStatus: event.target.value }))}
                        style={{ padding: "8px 10px", borderRadius: 8, border: "1px solid var(--input-border)", background: "var(--input-bg)", color: "var(--input-text)" }}
                      >
                        {MATERIAL_STATUS_OPTIONS.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label style={{ display: "grid", gap: 6, fontSize: 12, color: "var(--text)" }}>
                      Draft
                      <select
                        value={detailDraft.draftStatus}
                        onChange={(event) => setDetailDraft((prev) => ({ ...prev, draftStatus: event.target.value }))}
                        style={{ padding: "8px 10px", borderRadius: 8, border: "1px solid var(--input-border)", background: "var(--input-bg)", color: "var(--input-text)" }}
                      >
                        {DRAFT_STATUS_OPTIONS.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label style={{ display: "grid", gap: 6, fontSize: 12, color: "var(--text)" }}>
                      Final
                      <select
                        value={detailDraft.finalStatus}
                        onChange={(event) => setDetailDraft((prev) => ({ ...prev, finalStatus: event.target.value }))}
                        style={{ padding: "8px 10px", borderRadius: 8, border: "1px solid var(--input-border)", background: "var(--input-bg)", color: "var(--input-text)" }}
                      >
                        {FINAL_STATUS_OPTIONS.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
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
                                   title: "Contents AI",
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
                                     title: "Contents AI",
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
                                  title: "Contents AI",
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













