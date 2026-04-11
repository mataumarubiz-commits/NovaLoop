"use client"

import Link from "next/link"
import { useSearchParams } from "next/navigation"
import { startTransition, useDeferredValue, useEffect, useMemo, useState, type CSSProperties } from "react"
import { ProjectShell } from "@/components/project/ProjectShell"
import {
  buttonPrimaryStyle,
  buttonSecondaryStyle,
  formatCurrency,
  inputStyle,
  tableStyle,
  tdStyle,
  thStyle,
} from "@/components/project/projectPageStyles"
import { useProjectWorkspace } from "@/hooks/useProjectWorkspace"
import { normalizeContentDueYmd } from "@/lib/contentWorkflow"
import {
  buildCalendarDays,
  buildProjectBoardRows,
  formatDateTimeShort,
  formatShortDate,
  getBoardStatusLabel,
  getBoardStatusStyle,
  getBoardTagLabel,
  getBoardTagStyle,
  getBoardWaitLabel,
  getBoardWaitStyle,
  resolveProjectsWorkspaceQueryState,
  resolveRawProjectStatus,
  type ProjectBoardRow,
  type ProjectsWorkspaceQuickFilter,
} from "@/lib/projectsBoard"
import { supabase } from "@/lib/supabase"

type ViewMode = "table" | "calendar" | "assignee"
type SortKey = "risk" | "due" | "updated" | "name" | "owner" | "margin"
type RowDensity = "comfortable" | "compact"
type BillingFilter = "all" | "spot" | "monthly"
type ColumnKey =
  | "client"
  | "wait"
  | "progress"
  | "revisions"
  | "materials"
  | "handoff"
  | "billing"
  | "unitPrice"
  | "vendorCost"
  | "margin"
  | "tags"
  | "links"
  | "updated"

type SavedView = {
  id: string
  name: string
  quickFilter: ProjectsWorkspaceQuickFilter
  search: string
  clientFilter: string
  ownerFilter: string
  billingFilter: BillingFilter
  sortKey: SortKey
  density: RowDensity
  specOnly: boolean
  viewMode: ViewMode
  visibleColumns: ColumnKey[]
}

type CreateProjectForm = {
  clientId: string
  code: string
  name: string
  status: string
  contractType: "per_content" | "retainer" | "fixed_fee" | "monthly"
  ownerUserId: string
  notes: string
  rateItemType: string
  rateUnitLabel: string
  rateSalesUnitPrice: string
}

type EnrichedBoardRow = ProjectBoardRow & {
  ownerLabel: string
  assigneeLabels: string[]
  openRowCount: number
  totalRowCount: number
  doneRowCount: number
  progressRate: number
  attentionScore: number
  latestSpecChangeAt: string | null
  latestSpecChangeSummary: string | null
}

type MemberLoadRow = {
  userId: string
  label: string
  openProjects: number
  openRows: number
  dueToday: number
  overdue: number
  revisions: number
}

const STORAGE_KEY = "novaloop:projects:workspace-v2"
const SAVED_VIEWS_KEY = "novaloop:projects:saved-views-v2"

const DEFAULT_COLUMNS: ColumnKey[] = [
  "client",
  "wait",
  "progress",
  "revisions",
  "materials",
  "handoff",
  "billing",
  "unitPrice",
  "vendorCost",
  "margin",
  "tags",
  "links",
  "updated",
]

const COLUMN_OPTIONS: Array<{ key: ColumnKey; label: string }> = [
  { key: "client", label: "クライアント" },
  { key: "wait", label: "待ち状態" },
  { key: "progress", label: "進捗" },
  { key: "revisions", label: "菫ｮ豁｣" },
  { key: "materials", label: "素材" },
  { key: "handoff", label: "謠仙・ / 霑比ｿ｡" },
  { key: "billing", label: "請求タイプ" },
  { key: "unitPrice", label: "蜊倅ｾ｡" },
  { key: "vendorCost", label: "螟匁ｳｨ雋ｻ" },
  { key: "margin", label: "蛻ｩ逶顔紫" },
  { key: "tags", label: "繧ｿ繧ｰ" },
  { key: "links", label: "URL / 繝輔ぃ繧､繝ｫ" },
  { key: "updated", label: "譖ｴ譁ｰ" },
]

const QUICK_FILTER_OPTIONS: Array<{ key: ProjectsWorkspaceQuickFilter; label: string }> = [
  { key: "all", label: "全案件" },
  { key: "today", label: "今日やる" },
  { key: "week", label: "今週納期" },
  { key: "overdue", label: "遅延案件" },
  { key: "revision", label: "修正対応" },
  { key: "materials", label: "素材待ち" },
  { key: "vendor", label: "外注待ち" },
  { key: "tomorrow", label: "明日納期" },
]

const VIEW_OPTIONS: Array<{ key: ViewMode; label: string }> = [
  { key: "table", label: "繝・・繝悶Ν" },
  { key: "calendar", label: "繧ｫ繝ｬ繝ｳ繝繝ｼ" },
  { key: "assignee", label: "担当者ビュー" },
]

const PROJECT_TEMPLATES = [
  { id: "retainer", name: "月額案件", contractType: "monthly", status: "internal_production", rateItemType: "ショート動画", rateUnitLabel: "月", rateSalesUnitPrice: "35000", notes: "月次運用の標準テンプレートです。" },
  { id: "spot", name: "スポット案件", contractType: "fixed_fee", status: "not_started", rateItemType: "スポット案件", rateUnitLabel: "式", rateSalesUnitPrice: "180000", notes: "単発案件の立ち上げ用テンプレートです。" },
  { id: "large", name: "大量運用", contractType: "retainer", status: "internal_production", rateItemType: "大量ショート動画", rateUnitLabel: "月", rateSalesUnitPrice: "28000", notes: "本数が多い案件向けのテンプレートです。" },
] as const

const cardStyle: CSSProperties = {
  border: "1px solid rgba(148, 163, 184, 0.18)",
  borderRadius: 18,
  background: "linear-gradient(180deg, rgba(255,255,255,0.98) 0%, rgba(248,250,252,0.96) 100%)",
  boxShadow: "0 18px 40px rgba(15, 23, 42, 0.06)",
}

const mutedTextStyle: CSSProperties = { color: "#64748b", fontSize: 12 }

function emptyProjectForm(clientId = ""): CreateProjectForm {
  return {
    clientId,
    code: "",
    name: "",
    status: "internal_production",
    contractType: "per_content",
    ownerUserId: "",
    notes: "",
    rateItemType: "",
    rateUnitLabel: "譛ｬ",
    rateSalesUnitPrice: "",
  }
}

function readSavedViews() {
  if (typeof window === "undefined") return [] as SavedView[]
  try {
    const raw = window.localStorage.getItem(SAVED_VIEWS_KEY)
    return raw ? (JSON.parse(raw) as SavedView[]) : []
  } catch {
    window.localStorage.removeItem(SAVED_VIEWS_KEY)
    return []
  }
}

function readWorkspacePrefs() {
  if (typeof window === "undefined") {
    return { sortKey: "risk" as SortKey, density: "comfortable" as RowDensity, viewMode: "table" as ViewMode, visibleColumns: DEFAULT_COLUMNS }
  }
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return { sortKey: "risk" as SortKey, density: "comfortable" as RowDensity, viewMode: "table" as ViewMode, visibleColumns: DEFAULT_COLUMNS }
    const parsed = JSON.parse(raw) as Partial<{ sortKey: SortKey; density: RowDensity; viewMode: ViewMode; visibleColumns: ColumnKey[] }>
    return {
      sortKey: parsed.sortKey ?? "risk",
      density: parsed.density ?? "comfortable",
      viewMode: parsed.viewMode ?? "table",
      visibleColumns: parsed.visibleColumns?.length ? parsed.visibleColumns : DEFAULT_COLUMNS,
    }
  } catch {
    window.localStorage.removeItem(STORAGE_KEY)
    return { sortKey: "risk" as SortKey, density: "comfortable" as RowDensity, viewMode: "table" as ViewMode, visibleColumns: DEFAULT_COLUMNS }
  }
}

function toLowerSearch(value: string) {
  return value.trim().toLowerCase()
}

function describeSaveState(isSaving: boolean, uiSuccess: string | null) {
  if (isSaving) return "菫晏ｭ倅ｸｭ"
  if (uiSuccess) return "菫晏ｭ俶ｸ医∩"
  return "自動保存"
}

function progressBarColor(progressRate: number, row: EnrichedBoardRow) {
  if (row.overdueCount > 0) return "#dc2626"
  if (row.revisionOpenCount > 0) return "#d97706"
  if (progressRate >= 0.8) return "#0f766e"
  if (progressRate >= 0.45) return "#2563eb"
  return "#64748b"
}

function stickyCellStyle(left: number, width: number, zIndex = 3): CSSProperties {
  return {
    position: "sticky",
    left,
    zIndex,
    background: "linear-gradient(180deg, rgba(255,255,255,0.985) 0%, rgba(248,250,252,0.985) 100%)",
    minWidth: width,
    maxWidth: width,
    width,
    boxShadow: left > 0 ? "1px 0 0 rgba(226, 232, 240, 0.95)" : undefined,
  }
}

function statusBadge(label: string, style: { background: string; border: string; color: string }) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        minHeight: 28,
        padding: "0 10px",
        borderRadius: 999,
        border: `1px solid ${style.border}`,
        background: style.background,
        color: style.color,
        fontSize: 12,
        fontWeight: 700,
        whiteSpace: "nowrap",
      }}
    >
      {label}
    </span>
  )
}

function filterMatchesQuickState(row: EnrichedBoardRow, quickFilter: ProjectsWorkspaceQuickFilter) {
  if (quickFilter === "all") return true
  if (quickFilter === "today") return row.overdueCount > 0 || row.dueTodayCount > 0
  if (quickFilter === "week") return row.overdueCount > 0 || row.dueThisWeekCount > 0
  if (quickFilter === "overdue") return row.overdueCount > 0
  if (quickFilter === "revision") return row.revisionOpenCount > 0
  if (quickFilter === "materials") return row.materialWaitCount > 0
  if (quickFilter === "vendor") return row.vendorWaitCount > 0
  if (quickFilter === "tomorrow") return row.dueTomorrowCount > 0
  return true
}

function sortRows(rows: EnrichedBoardRow[], sortKey: SortKey) {
  const copy = [...rows]
  copy.sort((left, right) => {
    if (sortKey === "due") return String(left.dueDate || "9999-12-31").localeCompare(String(right.dueDate || "9999-12-31"))
    if (sortKey === "updated") return String(right.updatedAt).localeCompare(String(left.updatedAt))
    if (sortKey === "name") return left.project.name.localeCompare(right.project.name, "ja")
    if (sortKey === "owner") return left.ownerLabel.localeCompare(right.ownerLabel, "ja")
    if (sortKey === "margin") return (right.summary.marginRate ?? -1) - (left.summary.marginRate ?? -1)
    return right.attentionScore - left.attentionScore || String(left.dueDate || "9999-12-31").localeCompare(String(right.dueDate || "9999-12-31"))
  })
  return copy
}

function compactRowPadding(density: RowDensity) {
  return density === "compact" ? "8px 10px" : tdStyle.padding
}

export default function ProjectsWorkspaceClient() {
  const searchParams = useSearchParams()
  const initialQueryState = resolveProjectsWorkspaceQueryState(searchParams.get("focus"))
  const storedPrefs = readWorkspacePrefs()
  const { loading, error, canEdit, canViewFinance, orgId, month, todayYmd, clients, members, projectSummaries, contents, changes, rateCards, refresh } = useProjectWorkspace({ requireAdminSurface: true })

  const [search, setSearch] = useState("")
  const [quickFilter, setQuickFilter] = useState<ProjectsWorkspaceQuickFilter>(initialQueryState.quickFilter)
  const [clientFilter, setClientFilter] = useState("")
  const [ownerFilter, setOwnerFilter] = useState("")
  const [billingFilter, setBillingFilter] = useState<BillingFilter>("all")
  const [sortKey, setSortKey] = useState<SortKey>(storedPrefs.sortKey)
  const [density, setDensity] = useState<RowDensity>(storedPrefs.density)
  const [viewMode, setViewMode] = useState<ViewMode>(storedPrefs.viewMode)
  const [specOnly, setSpecOnly] = useState(false)
  const [advancedOpen, setAdvancedOpen] = useState(initialQueryState.advancedOpen)
  const [visibleColumns, setVisibleColumns] = useState<ColumnKey[]>(storedPrefs.visibleColumns)
  const [selectedProjectId, setSelectedProjectId] = useState("")
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [savedViews, setSavedViews] = useState<SavedView[]>(readSavedViews)
  const [showCreate, setShowCreate] = useState(searchParams.get("create") === "1")
  const [showTemplatePicker, setShowTemplatePicker] = useState(false)
  const [uiError, setUiError] = useState<string | null>(null)
  const [uiSuccess, setUiSuccess] = useState<string | null>(null)
  const [form, setForm] = useState<CreateProjectForm>(() => emptyProjectForm(clients[0]?.id ?? ""))
  const [busy, setBusy] = useState(false)
  const [projectStatusDraft, setProjectStatusDraft] = useState<Record<string, string>>({})
  const [savingProjectIds, setSavingProjectIds] = useState<Set<string>>(new Set())
  const [bulkStatus, setBulkStatus] = useState("")
  const [bulkOwnerUserId, setBulkOwnerUserId] = useState("")
  const [bulkBusy, setBulkBusy] = useState(false)
  const [orphanAssignments, setOrphanAssignments] = useState<Record<string, string>>({})
  const [orphanSavingId, setOrphanSavingId] = useState<string | null>(null)
  const deferredSearch = useDeferredValue(search)

  useEffect(() => {
    const timer = setTimeout(() => {
      const nextState = resolveProjectsWorkspaceQueryState(searchParams.get("focus"))
      setQuickFilter(nextState.quickFilter)
      setAdvancedOpen(nextState.advancedOpen)
    }, 0)
    return () => clearTimeout(timer)
  }, [searchParams])

  useEffect(() => {
    if (!clients.length) return
    const timer = setTimeout(() => {
      setForm((prev) => (prev.clientId ? prev : { ...prev, clientId: clients[0].id }))
    }, 0)
    return () => clearTimeout(timer)
  }, [clients])

  useEffect(() => {
    if (typeof window === "undefined") return
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ sortKey, density, viewMode, visibleColumns }))
  }, [density, sortKey, viewMode, visibleColumns])

  useEffect(() => {
    if (typeof window === "undefined") return
    window.localStorage.setItem(SAVED_VIEWS_KEY, JSON.stringify(savedViews))
  }, [savedViews])

  useEffect(() => {
    queueMicrotask(() => {
      setProjectStatusDraft((draft) => {
        const next = { ...draft }
        let changed = false
        for (const id of Object.keys(next)) {
          const row = projectSummaries.find((item) => item.project.id === id)
          if (row && row.project.status === next[id]) {
            delete next[id]
            changed = true
          }
        }
        return changed ? next : draft
      })
    })
  }, [projectSummaries])

  const memberLabelById = useMemo(() => new Map(members.map((member) => [member.userId, member.displayName || member.email || member.userId] as const)), [members])

  const boardRows = useMemo(
    () => buildProjectBoardRows({ summaries: projectSummaries, contents, changes, rateCards, todayYmd }),
    [changes, contents, projectSummaries, rateCards, todayYmd]
  )

  const enrichedRows = useMemo<EnrichedBoardRow[]>(() => {
    return boardRows.map((row) => {
      const assigneeLabels = Array.from(
        new Set(
          row.openContents
            .flatMap((content) => [content.assignee_editor_user_id, content.assignee_checker_user_id])
            .filter(Boolean)
            .map((userId) => memberLabelById.get(userId as string) ?? "未設定")
        )
      )
      const doneRowCount = row.contents.length - row.openContents.length
      const progressRate = row.contents.length > 0 ? doneRowCount / row.contents.length : 0
      const specChange = row.changes.find((item) => item.request_type === "spec_change") ?? row.changes[0] ?? null
      return {
        ...row,
        ownerLabel: row.summary.ownerName || "未設定",
        assigneeLabels,
        openRowCount: row.openContents.length,
        totalRowCount: row.contents.length,
        doneRowCount,
        progressRate,
        attentionScore:
          row.overdueCount * 100 + row.dueTodayCount * 32 + row.revisionOpenCount * 26 + row.materialWaitCount * 20 + row.vendorWaitCount * 18 + row.clientWaitCount * 14,
        latestSpecChangeAt: specChange?.created_at ?? null,
        latestSpecChangeSummary: specChange?.summary ?? null,
      }
    })
  }, [boardRows, memberLabelById])

  const orphanRows = useMemo(
    () => contents.filter((row) => !row.project_id && normalizeContentDueYmd(row.due_client_at).slice(0, 7) === month),
    [contents, month]
  )

  const filteredRows = useMemo(() => {
    const query = toLowerSearch(deferredSearch)
    return sortRows(
      enrichedRows.filter((row) => {
        if (!filterMatchesQuickState(row, quickFilter)) return false
        if (clientFilter && row.project.client_id !== clientFilter) return false
        if (ownerFilter && (row.project.owner_user_id ?? "") !== ownerFilter) return false
        if (billingFilter !== "all" && row.billingType !== billingFilter) return false
        if (specOnly && !row.latestSpecChangeSummary) return false
        if (!query) return true
        const haystack = [
          row.project.name,
          row.project.code ?? "",
          row.summary.clientName,
          row.ownerLabel,
          row.assigneeLabels.join(" "),
          row.contents.map((content) => content.title).join(" "),
          row.dueDate,
          row.billingTypeLabel,
          getBoardStatusLabel(row.displayStatus),
          getBoardWaitLabel(row.waitState),
          row.latestSpecChangeSummary ?? "",
        ]
          .join(" ")
          .toLowerCase()
        return haystack.includes(query)
      }),
      sortKey
    )
  }, [billingFilter, clientFilter, deferredSearch, enrichedRows, ownerFilter, quickFilter, sortKey, specOnly])

  useEffect(() => {
    const timer = setTimeout(() => {
      if (!filteredRows.some((row) => row.id === selectedProjectId)) {
        setSelectedProjectId("")
      }
    }, 0)
    return () => clearTimeout(timer)
  }, [filteredRows, selectedProjectId])

  const selectedRow = useMemo(() => filteredRows.find((row) => row.id === selectedProjectId) ?? null, [filteredRows, selectedProjectId])
  const visibleColumnSet = useMemo(() => new Set(visibleColumns), [visibleColumns])
  const saveState = describeSaveState(busy || bulkBusy || savingProjectIds.size > 0 || orphanSavingId !== null, uiSuccess)

  const assigneeLoads = useMemo<MemberLoadRow[]>(() => {
    const byUser = new Map<string, MemberLoadRow>()
    const ensure = (userId: string) => {
      if (!byUser.has(userId)) {
        byUser.set(userId, { userId, label: memberLabelById.get(userId) ?? "未設定", openProjects: 0, openRows: 0, dueToday: 0, overdue: 0, revisions: 0 })
      }
      return byUser.get(userId)!
    }
    for (const row of enrichedRows) {
      if (row.project.owner_user_id) {
        const owner = ensure(row.project.owner_user_id)
        owner.openProjects += row.displayStatus === "done" ? 0 : 1
        owner.openRows += row.openRowCount
        owner.dueToday += row.dueTodayCount
        owner.overdue += row.overdueCount
        owner.revisions += row.revisionOpenCount
      }
      for (const content of row.openContents) {
        const ids = [content.assignee_editor_user_id, content.assignee_checker_user_id].filter(Boolean) as string[]
        for (const userId of ids) {
          const target = ensure(userId)
          target.openRows += 1
          if (normalizeContentDueYmd(content.due_client_at) === todayYmd) target.dueToday += 1
          if (normalizeContentDueYmd(content.due_client_at) < todayYmd) target.overdue += 1
          if (Number(content.revision_count ?? 0) > 0) target.revisions += 1
        }
      }
    }
    return [...byUser.values()].sort((left, right) => right.overdue * 100 + right.openRows * 10 - (left.overdue * 100 + left.openRows * 10))
  }, [enrichedRows, memberLabelById, todayYmd])

  const calendarDays = useMemo(() => buildCalendarDays(month), [month])
  const calendarRowsByDay = useMemo(() => {
    const map = new Map<string, EnrichedBoardRow[]>()
    for (const row of filteredRows) {
      if (!row.dueDate) continue
      const list = map.get(row.dueDate) ?? []
      list.push(row)
      map.set(row.dueDate, list)
    }
    return map
  }, [filteredRows])

  const isAllSelected = filteredRows.length > 0 && filteredRows.every((row) => selectedIds.includes(row.id))

  const clearUi = () => {
    setUiError(null)
    setUiSuccess(null)
  }

  const flashError = (message: string) => {
    setUiSuccess(null)
    setUiError(message)
  }

  const flashSuccess = (message: string) => {
    setUiError(null)
    setUiSuccess(message)
  }

  const toggleColumn = (key: ColumnKey) => {
    setVisibleColumns((prev) => (prev.includes(key) ? prev.filter((item) => item !== key) : [...prev, key]))
  }

  const saveView = () => {
    const name = window.prompt("保存する表示名", quickFilter === "all" ? "案件一覧" : QUICK_FILTER_OPTIONS.find((item) => item.key === quickFilter)?.label ?? "案件一覧")
    if (!name?.trim()) return
    setSavedViews((prev) =>
      [
        {
          id: crypto.randomUUID(),
          name: name.trim(),
          quickFilter,
          search,
          clientFilter,
          ownerFilter,
          billingFilter,
          sortKey,
          density,
          specOnly,
          viewMode,
          visibleColumns,
        },
        ...prev,
      ].slice(0, 8)
    )
  }

  const applySavedView = (view: SavedView) => {
    startTransition(() => {
      setQuickFilter(view.quickFilter)
      setSearch(view.search)
      setClientFilter(view.clientFilter)
      setOwnerFilter(view.ownerFilter)
      setBillingFilter(view.billingFilter)
      setSortKey(view.sortKey)
      setDensity(view.density)
      setSpecOnly(view.specOnly)
      setViewMode(view.viewMode)
      setVisibleColumns(view.visibleColumns.length ? view.visibleColumns : DEFAULT_COLUMNS)
    })
  }

  const handleTemplateFill = (templateId: string) => {
    const preset = PROJECT_TEMPLATES.find((item) => item.id === templateId)
    if (!preset) return
    setShowCreate(true)
    setShowTemplatePicker(false)
    setForm((prev) => ({
      ...prev,
      contractType: preset.contractType,
      status: preset.status,
      notes: preset.notes,
      rateItemType: preset.rateItemType,
      rateUnitLabel: preset.rateUnitLabel,
      rateSalesUnitPrice: preset.rateSalesUnitPrice,
    }))
  }

  const createProject = async () => {
    if (!canEdit || !orgId) return
    if (!form.clientId || !form.name.trim()) {
      flashError("クライアントと案件名は必須です。")
      return
    }
    setBusy(true)
    clearUi()
    const newId = crypto.randomUUID()
    const { error: insertError } = await supabase.from("projects").insert({
      id: newId,
      org_id: orgId,
      client_id: form.clientId,
      code: form.code.trim() || null,
      name: form.name.trim(),
      status: form.status,
      contract_type: form.contractType,
      owner_user_id: form.ownerUserId || null,
      notes: form.notes.trim() || null,
    })
    if (insertError) {
      setBusy(false)
      flashError(insertError.message)
      return
    }
    const hasRateCard = form.rateItemType.trim() && Number(form.rateSalesUnitPrice) > 0
    if (hasRateCard) {
      await supabase.from("rate_cards").insert({
        id: crypto.randomUUID(),
        org_id: orgId,
        project_id: newId,
        client_id: form.clientId,
        item_type: form.rateItemType.trim(),
        unit_label: form.rateUnitLabel.trim() || "譛ｬ",
        sales_unit_price: Number(form.rateSalesUnitPrice) || 0,
        standard_cost: 0,
        effective_from: new Date().toISOString().slice(0, 10),
      })
    }
    setBusy(false)
    setShowCreate(false)
    setForm(emptyProjectForm(clients[0]?.id ?? ""))
    flashSuccess(hasRateCard ? "案件と単価テンプレートを作成しました。" : "案件を作成しました。")
    await refresh()
    setSelectedProjectId(newId)
  }

  const handleQuickStatusUpdate = async (row: EnrichedBoardRow, nextDisplayStatus: EnrichedBoardRow["displayStatus"]) => {
    if (!canEdit || !orgId) return
    const nextRawStatus = resolveRawProjectStatus(nextDisplayStatus, row.project.status)
    setProjectStatusDraft((prev) => ({ ...prev, [row.id]: nextRawStatus }))
    setSavingProjectIds((prev) => new Set(prev).add(row.id))
    clearUi()
    const { error: updateError } = await supabase.from("projects").update({ status: nextRawStatus }).eq("id", row.id).eq("org_id", orgId)
    if (updateError) {
      setProjectStatusDraft((prev) => {
        const next = { ...prev }
        delete next[row.id]
        return next
      })
      flashError(`繧ｹ繝・・繧ｿ繧ｹ譖ｴ譁ｰ縺ｫ螟ｱ謨励＠縺ｾ縺励◆: ${updateError.message}`)
    } else {
      flashSuccess("ステータスを更新しました。")
      await refresh({ silent: true })
    }
    setSavingProjectIds((prev) => {
      const next = new Set(prev)
      next.delete(row.id)
      return next
    })
  }

  const toggleSelectedId = (projectId: string, checked: boolean) => {
    setSelectedIds((prev) => (checked ? Array.from(new Set([...prev, projectId])) : prev.filter((id) => id !== projectId)))
  }

  const toggleSelectAll = (checked: boolean) => {
    setSelectedIds(checked ? filteredRows.map((row) => row.id) : [])
  }

  const runBulkUpdate = async () => {
    if (!canEdit || !orgId || selectedIds.length === 0) return
    const payload: Record<string, string | null> = {}
    if (bulkStatus) payload.status = bulkStatus
    if (bulkOwnerUserId) payload.owner_user_id = bulkOwnerUserId
    if (!Object.keys(payload).length) {
      flashError("一括更新する項目を選択してください。")
      return
    }
    setBulkBusy(true)
    clearUi()
    const { error: updateError } = await supabase.from("projects").update(payload).in("id", selectedIds).eq("org_id", orgId)
    setBulkBusy(false)
    if (updateError) {
      flashError(updateError.message)
      return
    }
    setBulkStatus("")
    setBulkOwnerUserId("")
    flashSuccess(`${selectedIds.length}件を更新しました。`)
    await refresh()
  }

  const assignOrphanRow = async (contentId: string) => {
    if (!canEdit || !orgId) return
    const projectId = orphanAssignments[contentId]
    if (!projectId) {
      flashError("紐付け先の案件を選択してください。")
      return
    }
    setOrphanSavingId(contentId)
    clearUi()
    const { error: updateError } = await supabase.from("contents").update({ project_id: projectId }).eq("id", contentId).eq("org_id", orgId)
    setOrphanSavingId(null)
    if (updateError) {
      flashError(updateError.message)
      return
    }
    flashSuccess("未割当の制作行を案件に紐付けました。")
    await refresh()
  }

  const renderTableCell = (columnKey: ColumnKey, row: EnrichedBoardRow) => {
    if (columnKey === "client") return row.summary.clientName
    if (columnKey === "wait") {
      return (
        <div style={{ display: "grid", gap: 6 }}>
          {statusBadge(getBoardWaitLabel(row.waitState), getBoardWaitStyle(row.waitState))}
          <span style={mutedTextStyle}>蜈域婿蠕・■ {row.clientWaitCount} / 螟匁ｳｨ蠕・■ {row.vendorWaitCount}</span>
        </div>
      )
    }
    if (columnKey === "progress") {
      return (
        <div style={{ display: "grid", gap: 8, minWidth: 190 }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: 12 }}>
            <strong style={{ color: "#0f172a" }}>{Math.round(row.progressRate * 100)}%</strong>
            <span style={{ color: "#64748b" }}>螳御ｺ・{row.doneRowCount} / 蜈ｨ {row.totalRowCount}</span>
          </div>
          <div style={{ height: 8, borderRadius: 999, background: "#e2e8f0", overflow: "hidden" }}>
            <div style={{ width: `${Math.max(6, Math.round(row.progressRate * 100))}%`, height: "100%", background: progressBarColor(row.progressRate, row), borderRadius: 999 }} />
          </div>
        </div>
      )
    }
    if (columnKey === "revisions") return <div style={{ display: "grid", gap: 4 }}><strong style={{ color: row.revisionOpenCount > 0 ? "#b45309" : "#0f172a" }}>{row.revisionOpenCount}莉ｶ</strong><span style={mutedTextStyle}>菫ｮ豁｣荳ｭ</span></div>
    if (columnKey === "materials") return <div style={{ display: "grid", gap: 4 }}><strong style={{ color: row.materialWaitCount > 0 ? "#b45309" : "#0f172a" }}>{row.materialWaitCount}莉ｶ</strong><span style={mutedTextStyle}>邏譚仙ｾ・■</span></div>
    if (columnKey === "handoff") return <div style={{ display: "grid", gap: 4 }}><span style={{ color: row.overdueCount > 0 ? "#dc2626" : "#0f172a", fontWeight: 700 }}>今日 {row.dueTodayCount} / 超過 {row.overdueCount}</span><span style={mutedTextStyle}>提出・納期の制作行</span></div>
    if (columnKey === "billing") return row.billingTypeLabel
    if (columnKey === "unitPrice") return canViewFinance ? formatCurrency(row.averageUnitPrice) : "制限"
    if (columnKey === "vendorCost") return canViewFinance ? formatCurrency(row.summary.monthlyVendorCost) : "制限"
    if (columnKey === "margin") return canViewFinance ? <span style={{ color: (row.summary.marginRate ?? 1) < 0.35 ? "#b45309" : "#0f172a", fontWeight: 700 }}>{row.summary.marginRate == null ? "-" : `${Math.round(row.summary.marginRate * 100)}%`}</span> : "制限"
    if (columnKey === "tags") {
      return (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", maxWidth: 220 }}>
          {row.tags.slice(0, 4).map((tag) => (
            <span key={tag} style={{ display: "inline-flex", alignItems: "center", minHeight: 26, padding: "0 8px", borderRadius: 999, border: `1px solid ${getBoardTagStyle(tag).border}`, background: getBoardTagStyle(tag).background, color: getBoardTagStyle(tag).color, fontSize: 11, fontWeight: 700 }}>
              {getBoardTagLabel(tag)}
            </span>
          ))}
        </div>
      )
    }
    if (columnKey === "links") {
      return (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", maxWidth: 240 }}>
          {row.linkItems.slice(0, 3).map((item) => (
            <a key={`${item.contentId}:${item.key}:${item.url}`} href={item.url} target="_blank" rel="noreferrer" onClick={(event) => event.stopPropagation()} style={{ display: "inline-flex", alignItems: "center", minHeight: 26, padding: "0 8px", borderRadius: 999, background: "#eff6ff", color: "#1d4ed8", textDecoration: "none", fontSize: 11, fontWeight: 700 }}>
              {item.label}
            </a>
          ))}
          {row.linkItems.length === 0 ? <span style={mutedTextStyle}>譛ｪ逋ｻ骭ｲ</span> : null}
        </div>
      )
    }
    if (columnKey === "updated") return <span style={mutedTextStyle}>{formatDateTimeShort(row.updatedAt)}</span>
    return null
  }

  return (
    <ProjectShell
      title="案件管理"
      description="今日やる案件、危険案件、素材待ち、修正対応を一覧で判断できます。"
      action={
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
          <span style={{ display: "inline-flex", alignItems: "center", minHeight: 36, padding: "0 12px", borderRadius: 999, border: "1px solid rgba(148, 163, 184, 0.2)", background: "rgba(255,255,255,0.88)", color: "#334155", fontSize: 12, fontWeight: 700 }}>
            {saveState}
          </span>
          <button type="button" onClick={() => setShowTemplatePicker((prev) => !prev)} style={buttonSecondaryStyle}>テンプレ追加</button>
          {canEdit ? <button type="button" onClick={() => setShowCreate((prev) => !prev)} style={buttonPrimaryStyle}>{showCreate ? "閉じる" : "新規案件"}</button> : null}
        </div>
      }
    >
      {showTemplatePicker ? (
        <section style={{ ...cardStyle, padding: 18 }}>
          <div style={{ display: "grid", gap: 14 }}>
            <div>
              <strong style={{ display: "block", fontSize: 14, color: "#0f172a" }}>案件テンプレート</strong>
              <p style={{ margin: "6px 0 0", ...mutedTextStyle }}>月額、スポット、大量運用の初期設定をそのまま案件作成に流し込めます。</p>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12 }}>
              {PROJECT_TEMPLATES.map((preset) => (
                <button key={preset.id} type="button" onClick={() => handleTemplateFill(preset.id)} style={{ textAlign: "left", padding: 16, borderRadius: 16, border: "1px solid rgba(148, 163, 184, 0.18)", background: "rgba(255,255,255,0.94)", cursor: "pointer", display: "grid", gap: 8 }}>
                  <strong style={{ fontSize: 15, color: "#0f172a" }}>{preset.name}</strong>
                  <span style={mutedTextStyle}>{preset.notes}</span>
                </button>
              ))}
            </div>
          </div>
        </section>
      ) : null}

      {showCreate ? (
        <section style={{ ...cardStyle, padding: 18 }}>
          <div style={{ display: "grid", gap: 16 }}>
            <div>
              <strong style={{ display: "block", fontSize: 14, color: "#0f172a" }}>案件追加</strong>
              <p style={{ margin: "6px 0 0", ...mutedTextStyle }}>必要な情報だけを先に作成し、詳細は一覧から詰める前提のフォームです。</p>
            </div>
            <div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(6, minmax(0, 1fr))" }}>
              <label style={{ display: "grid", gap: 6, gridColumn: "span 2" }}>
                <span style={mutedTextStyle}>クライアント</span>
                <select value={form.clientId} onChange={(event) => setForm((prev) => ({ ...prev, clientId: event.target.value }))} style={inputStyle}>
                  <option value="">驕ｸ謚槭＠縺ｦ縺上□縺輔＞</option>
                  {clients.map((client) => <option key={client.id} value={client.id}>{client.name}</option>)}
                </select>
              </label>
              <label style={{ display: "grid", gap: 6, gridColumn: "span 4" }}>
                <span style={mutedTextStyle}>案件名</span>
                <input value={form.name} onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))} style={inputStyle} />
              </label>
              <label style={{ display: "grid", gap: 6, gridColumn: "span 2" }}>
                <span style={mutedTextStyle}>案件コード</span>
                <input value={form.code} onChange={(event) => setForm((prev) => ({ ...prev, code: event.target.value }))} style={inputStyle} />
              </label>
              <label style={{ display: "grid", gap: 6, gridColumn: "span 2" }}>
                <span style={mutedTextStyle}>請求タイプ</span>
                <select value={form.contractType} onChange={(event) => setForm((prev) => ({ ...prev, contractType: event.target.value as CreateProjectForm["contractType"] }))} style={inputStyle}>
                  <option value="per_content">従量</option>
                  <option value="fixed_fee">スポット</option>
                  <option value="retainer">継続</option>
                  <option value="monthly">月額</option>
                </select>
              </label>
              <label style={{ display: "grid", gap: 6, gridColumn: "span 2" }}>
                <span style={mutedTextStyle}>責任者</span>
                <select value={form.ownerUserId} onChange={(event) => setForm((prev) => ({ ...prev, ownerUserId: event.target.value }))} style={inputStyle}>
                  <option value="">未設定</option>
                  {members.map((member) => <option key={member.userId} value={member.userId}>{member.displayName || member.email || member.userId}</option>)}
                </select>
              </label>
              <label style={{ display: "grid", gap: 6, gridColumn: "span 2" }}>
                <span style={mutedTextStyle}>単価項目</span>
                <input value={form.rateItemType} onChange={(event) => setForm((prev) => ({ ...prev, rateItemType: event.target.value }))} style={inputStyle} />
              </label>
              <label style={{ display: "grid", gap: 6, gridColumn: "span 2" }}>
                <span style={mutedTextStyle}>蜊倅ｾ｡</span>
                <input value={form.rateSalesUnitPrice} onChange={(event) => setForm((prev) => ({ ...prev, rateSalesUnitPrice: event.target.value }))} style={inputStyle} />
              </label>
              <label style={{ display: "grid", gap: 6, gridColumn: "span 2" }}>
                <span style={mutedTextStyle}>単位</span>
                <input value={form.rateUnitLabel} onChange={(event) => setForm((prev) => ({ ...prev, rateUnitLabel: event.target.value }))} style={inputStyle} />
              </label>
              <label style={{ display: "grid", gap: 6, gridColumn: "1 / -1" }}>
                <span style={mutedTextStyle}>備考</span>
                <textarea value={form.notes} onChange={(event) => setForm((prev) => ({ ...prev, notes: event.target.value }))} rows={3} style={{ ...inputStyle, resize: "vertical" }} />
              </label>
            </div>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <button type="button" onClick={() => void createProject()} disabled={busy} style={buttonPrimaryStyle}>{busy ? "作成中..." : "案件を作成"}</button>
              <button type="button" onClick={() => setShowCreate(false)} disabled={busy} style={buttonSecondaryStyle}>閉じる</button>
            </div>
          </div>
        </section>
      ) : null}

      {(error || uiError || uiSuccess) ? (
        <section style={{ ...cardStyle, padding: 16 }}>
          {error ? <div style={{ color: "#dc2626", fontWeight: 700 }}>{error}</div> : null}
          {uiError ? <div style={{ color: "#dc2626", fontWeight: 700 }}>{uiError}</div> : null}
          {uiSuccess ? <div style={{ color: "#0f766e", fontWeight: 700 }}>{uiSuccess}</div> : null}
        </section>
      ) : null}

      <section style={{ ...cardStyle, padding: 18, position: "sticky", top: 16, zIndex: 20, backdropFilter: "blur(12px)" }}>
        <div style={{ display: "grid", gap: 14 }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
            <div style={{ display: "grid", gap: 6 }}>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                {VIEW_OPTIONS.map((option) => (
                  <button key={option.key} type="button" onClick={() => setViewMode(option.key)} style={{ minHeight: 38, padding: "0 14px", borderRadius: 999, border: option.key === viewMode ? "1px solid #0f172a" : "1px solid rgba(148, 163, 184, 0.2)", background: option.key === viewMode ? "#0f172a" : "rgba(255,255,255,0.88)", color: option.key === viewMode ? "#fff" : "#334155", fontWeight: 700, cursor: "pointer" }}>
                    {option.label}
                  </button>
                ))}
              </div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {QUICK_FILTER_OPTIONS.map((option) => (
                  <button key={option.key} type="button" onClick={() => setQuickFilter(option.key)} style={{ minHeight: 34, padding: "0 12px", borderRadius: 999, border: option.key === quickFilter ? "1px solid #0f766e" : "1px solid rgba(148, 163, 184, 0.18)", background: option.key === quickFilter ? "rgba(15, 118, 110, 0.08)" : "rgba(255,255,255,0.86)", color: option.key === quickFilter ? "#0f766e" : "#475569", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>
                    {option.label}
                  </button>
                ))}
              </div>
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
              <button type="button" onClick={() => setAdvancedOpen((prev) => !prev)} style={buttonSecondaryStyle}>{advancedOpen ? "表示設定を閉じる" : "表示設定"}</button>
              <button type="button" onClick={saveView} style={buttonSecondaryStyle}>保存済みビュー</button>
            </div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "minmax(280px, 1.2fr) repeat(4, minmax(160px, 0.55fr))", gap: 10 }}>
            <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="案件名、クライアント、担当、ステータスで検索" style={{ ...inputStyle, minHeight: 42 }} />
            <select value={clientFilter} onChange={(event) => setClientFilter(event.target.value)} style={inputStyle}>
              <option value="">クライアント</option>
              {clients.map((client) => <option key={client.id} value={client.id}>{client.name}</option>)}
            </select>
            <select value={ownerFilter} onChange={(event) => setOwnerFilter(event.target.value)} style={inputStyle}>
              <option value="">責任者</option>
              {members.map((member) => <option key={member.userId} value={member.userId}>{member.displayName || member.email || member.userId}</option>)}
            </select>
            <select value={sortKey} onChange={(event) => setSortKey(event.target.value as SortKey)} style={inputStyle}>
              <option value="risk">危険度順</option>
              <option value="due">納期順</option>
              <option value="updated">更新順</option>
              <option value="name">案件名順</option>
              <option value="owner">責任者順</option>
              <option value="margin">利益率順</option>
            </select>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              <button type="button" onClick={() => setDensity("comfortable")} style={{ ...buttonSecondaryStyle, background: density === "comfortable" ? "#0f172a" : buttonSecondaryStyle.background, color: density === "comfortable" ? "#fff" : buttonSecondaryStyle.color }}>標準密度</button>
              <button type="button" onClick={() => setDensity("compact")} style={{ ...buttonSecondaryStyle, background: density === "compact" ? "#0f172a" : buttonSecondaryStyle.background, color: density === "compact" ? "#fff" : buttonSecondaryStyle.color }}>高密度</button>
            </div>
          </div>
          {advancedOpen ? (
            <div style={{ display: "grid", gap: 14, gridTemplateColumns: "1.1fr 0.9fr" }}>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button type="button" onClick={() => setSpecOnly((prev) => !prev)} style={{ minHeight: 34, padding: "0 12px", borderRadius: 999, border: specOnly ? "1px solid #b45309" : "1px solid rgba(148, 163, 184, 0.2)", background: specOnly ? "rgba(245, 158, 11, 0.1)" : "rgba(255,255,255,0.88)", color: specOnly ? "#b45309" : "#475569", fontWeight: 700, cursor: "pointer" }}>仕様変更ありのみ</button>
                <select value={billingFilter} onChange={(event) => setBillingFilter(event.target.value as BillingFilter)} style={{ ...inputStyle, minWidth: 140 }}>
                  <option value="all">請求タイプ 全て</option>
                  <option value="monthly">請求タイプ 月額</option>
                  <option value="spot">請求タイプ スポット</option>
                </select>
                <button type="button" onClick={() => { setSearch(""); setClientFilter(""); setOwnerFilter(""); setBillingFilter("all"); setQuickFilter("all"); setSpecOnly(false) }} style={buttonSecondaryStyle}>譚｡莉ｶ繧偵Μ繧ｻ繝・ヨ</button>
                {savedViews.map((view) => <button key={view.id} type="button" onClick={() => applySavedView(view)} style={{ minHeight: 34, padding: "0 12px", borderRadius: 999, border: "1px solid rgba(148, 163, 184, 0.18)", background: "rgba(255,255,255,0.92)", color: "#334155", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>{view.name}</button>)}
              </div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {COLUMN_OPTIONS.map((column) => {
                  const active = visibleColumnSet.has(column.key)
                  return <button key={column.key} type="button" onClick={() => toggleColumn(column.key)} style={{ minHeight: 32, padding: "0 10px", borderRadius: 999, border: active ? "1px solid #0f172a" : "1px solid rgba(148, 163, 184, 0.18)", background: active ? "#0f172a" : "rgba(255,255,255,0.88)", color: active ? "#fff" : "#334155", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>{column.label}</button>
                })}
              </div>
            </div>
          ) : null}
        </div>
      </section>
      {selectedIds.length > 0 ? (
        <section style={{ ...cardStyle, padding: 16 }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
            <div><strong style={{ display: "block", fontSize: 14, color: "#0f172a" }}>{selectedIds.length}件を選択中</strong><span style={mutedTextStyle}>案件ステータスと責任者をまとめて更新できます。</span></div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <select value={bulkStatus} onChange={(event) => setBulkStatus(event.target.value)} style={{ ...inputStyle, minWidth: 150 }}>
                <option value="">ステータス変更</option>
                <option value="not_started">未着手</option>
                <option value="internal_production">進行中</option>
                <option value="internal_revision">修正中</option>
                <option value="client_submission">提出待ち</option>
                <option value="paused">保留</option>
                <option value="completed">完了</option>
              </select>
              <select value={bulkOwnerUserId} onChange={(event) => setBulkOwnerUserId(event.target.value)} style={{ ...inputStyle, minWidth: 180 }}>
                <option value="">責任者を変更</option>
                {members.map((member) => <option key={member.userId} value={member.userId}>{member.displayName || member.email || member.userId}</option>)}
              </select>
              <button type="button" onClick={() => void runBulkUpdate()} disabled={bulkBusy} style={buttonPrimaryStyle}>{bulkBusy ? "更新中..." : "一括更新"}</button>
              <button type="button" onClick={() => setSelectedIds([])} disabled={bulkBusy} style={buttonSecondaryStyle}>選択解除</button>
            </div>
          </div>
        </section>
      ) : null}

      <section>
        <div style={{ ...cardStyle, padding: 0, overflow: "hidden" }}>
          {selectedRow ? (
            <div style={{ padding: "16px 18px", borderBottom: "1px solid rgba(226, 232, 240, 0.88)", background: "linear-gradient(180deg, rgba(248,250,252,0.96) 0%, rgba(255,255,255,0.98) 100%)", display: "grid", gap: 12 }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "start", flexWrap: "wrap" }}>
                <div style={{ display: "grid", gap: 6 }}>
                  <div>
                    <strong style={{ display: "block", fontSize: 16, color: "#0f172a" }}>{selectedRow.project.name}</strong>
                    <span style={mutedTextStyle}>{selectedRow.summary.clientName} / {selectedRow.ownerLabel}</span>
                  </div>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    {statusBadge(getBoardStatusLabel(selectedRow.displayStatus), getBoardStatusStyle(selectedRow.displayStatus))}
                    {statusBadge(getBoardWaitLabel(selectedRow.waitState), getBoardWaitStyle(selectedRow.waitState))}
                    <span style={{ display: "inline-flex", alignItems: "center", minHeight: 28, padding: "0 10px", borderRadius: 999, background: selectedRow.billingType === "monthly" ? "rgba(15,118,110,0.08)" : "rgba(30,64,175,0.08)", color: selectedRow.billingType === "monthly" ? "#0f766e" : "#1d4ed8", fontSize: 12, fontWeight: 700 }}>{selectedRow.billingTypeLabel}</span>
                    {selectedRow.latestSpecChangeSummary ? <span style={{ display: "inline-flex", alignItems: "center", minHeight: 28, padding: "0 10px", borderRadius: 999, background: "rgba(245, 158, 11, 0.1)", color: "#b45309", fontSize: 12, fontWeight: 700 }}>仕様変更あり</span> : null}
                  </div>
                </div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <Link href={`/projects/${selectedRow.id}`} style={{ ...buttonSecondaryStyle, textDecoration: "none" }}>詳細ページ</Link>
                  <button type="button" onClick={() => setSelectedProjectId("")} style={buttonSecondaryStyle}>選択解除</button>
                </div>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 10 }}>
                <div><div style={mutedTextStyle}>納期</div><strong style={{ color: selectedRow.overdueCount > 0 ? "#dc2626" : "#0f172a" }}>{formatShortDate(selectedRow.dueDate)}</strong></div>
                <div><div style={mutedTextStyle}>開いている制作行</div><strong style={{ color: "#0f172a" }}>{selectedRow.openRowCount}</strong></div>
                <div><div style={mutedTextStyle}>修正 / 素材待ち</div><strong style={{ color: "#0f172a" }}>{selectedRow.revisionOpenCount} / {selectedRow.materialWaitCount}</strong></div>
                <div><div style={mutedTextStyle}>単価 / 利益率</div><strong style={{ color: "#0f172a" }}>{canViewFinance ? `${formatCurrency(selectedRow.averageUnitPrice)} / ${selectedRow.summary.marginRate != null ? `${Math.round(selectedRow.summary.marginRate * 100)}%` : "-"}` : "制限"}</strong></div>
              </div>
            </div>
          ) : null}
          {viewMode === "table" ? (
            <>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", padding: "16px 18px 12px" }}>
                <div>
                  <strong style={{ display: "block", fontSize: 15, color: "#0f172a" }}>案件一覧</strong>
                  <span style={mutedTextStyle}>{filteredRows.length}件 / 納期・検索・危険度で即断できる並びにしています。</span>
                </div>
                <span style={{ ...mutedTextStyle, fontWeight: 700 }}>{loading ? "読み込み中..." : "更新済み"}</span>
              </div>
              <div style={{ overflowX: "auto", borderTop: "1px solid rgba(226, 232, 240, 0.8)" }}>
                <table style={{ ...tableStyle, minWidth: 1580 }}>
                  <thead>
                    <tr>
                      <th style={{ ...thStyle, ...stickyCellStyle(0, 54, 6) }}><input type="checkbox" checked={isAllSelected} onChange={(event) => toggleSelectAll(event.target.checked)} /></th>
                      <th style={{ ...thStyle, ...stickyCellStyle(54, 270, 6) }}>案件名</th>
                      <th style={{ ...thStyle, ...stickyCellStyle(324, 160, 6) }}>担当</th>
                      <th style={{ ...thStyle, ...stickyCellStyle(484, 118, 6) }}>納期</th>
                      <th style={thStyle}>進行</th>
                      {COLUMN_OPTIONS.filter((column) => visibleColumnSet.has(column.key)).map((column) => <th key={column.key} style={thStyle}>{column.label}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {filteredRows.map((row) => {
                      const isSelected = row.id === selectedRow?.id
                      const rowBorderColor = row.overdueCount > 0 ? "rgba(220, 38, 38, 0.22)" : row.revisionOpenCount > 0 ? "rgba(217, 119, 6, 0.2)" : "rgba(226, 232, 240, 0.85)"
                      const baseBackground = isSelected ? "linear-gradient(90deg, rgba(15,118,110,0.08) 0%, rgba(255,255,255,0.98) 22%)" : row.overdueCount > 0 ? "linear-gradient(90deg, rgba(254,226,226,0.7) 0%, rgba(255,255,255,0.98) 18%)" : "rgba(255,255,255,0.98)"
                      return (
                        <tr key={row.id} onClick={() => setSelectedProjectId((current) => (current === row.id ? "" : row.id))} style={{ cursor: "pointer", background: baseBackground }}>
                          <td style={{ ...tdStyle, ...stickyCellStyle(0, 54, 4), padding: compactRowPadding(density), borderBottom: `1px solid ${rowBorderColor}` }}>
                            <input type="checkbox" checked={selectedIds.includes(row.id)} onClick={(event) => event.stopPropagation()} onChange={(event) => toggleSelectedId(row.id, event.target.checked)} />
                          </td>
                          <td style={{ ...tdStyle, ...stickyCellStyle(54, 270, 4), padding: compactRowPadding(density), borderBottom: `1px solid ${rowBorderColor}` }}>
                            <div style={{ display: "grid", gap: 8 }}>
                              <div style={{ display: "flex", alignItems: "start", justifyContent: "space-between", gap: 8 }}>
                                <div>
                                  <strong style={{ display: "block", fontSize: 14, color: "#0f172a" }}>{row.project.name}</strong>
                                  <span style={mutedTextStyle}>{row.project.code || "コード未設定"} / {row.summary.clientName}</span>
                                </div>
                                {row.tags.includes("risk") ? <span style={{ color: "#dc2626", fontSize: 11, fontWeight: 800 }}>危険</span> : null}
                              </div>
                              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                                {statusBadge(getBoardStatusLabel(row.displayStatus), getBoardStatusStyle(row.displayStatus))}
                                {row.latestSpecChangeSummary ? <span style={{ display: "inline-flex", alignItems: "center", minHeight: 28, padding: "0 10px", borderRadius: 999, background: "rgba(217, 119, 6, 0.1)", color: "#b45309", fontSize: 12, fontWeight: 700 }}>仕様変更あり</span> : null}
                              </div>
                            </div>
                          </td>
                          <td style={{ ...tdStyle, ...stickyCellStyle(324, 160, 4), padding: compactRowPadding(density), borderBottom: `1px solid ${rowBorderColor}` }}>
                            <div style={{ display: "grid", gap: 6 }}>
                              <strong style={{ fontSize: 13, color: "#0f172a" }}>{row.ownerLabel}</strong>
                              <span style={mutedTextStyle}>{row.assigneeLabels.length > 0 ? row.assigneeLabels.slice(0, 2).join(" / ") : "未設定"}</span>
                            </div>
                          </td>
                          <td style={{ ...tdStyle, ...stickyCellStyle(484, 118, 4), padding: compactRowPadding(density), borderBottom: `1px solid ${rowBorderColor}` }}>
                            <div style={{ display: "grid", gap: 4 }}>
                              <strong style={{ color: row.overdueCount > 0 ? "#dc2626" : "#0f172a" }}>{formatShortDate(row.dueDate)}</strong>
                              <span style={mutedTextStyle}>{row.overdueCount > 0 ? `超過 ${row.overdueCount}` : `今日 ${row.dueTodayCount}`}</span>
                            </div>
                          </td>
                          <td style={{ ...tdStyle, padding: compactRowPadding(density), borderBottom: `1px solid ${rowBorderColor}` }}>
                            {canEdit ? (
                              <select
                                value={projectStatusDraft[row.id] ?? resolveRawProjectStatus(row.displayStatus, row.project.status)}
                                onChange={(event) => {
                                  const nextStatus = event.target.value
                                  const nextDisplayStatus = nextStatus === "internal_production" ? "in_progress" : nextStatus === "internal_revision" ? "revision" : nextStatus === "client_submission" ? "awaiting_submission" : nextStatus === "completed" ? "done" : nextStatus === "paused" ? "paused" : "not_started"
                                  void handleQuickStatusUpdate(row, nextDisplayStatus)
                                }}
                                onClick={(event) => event.stopPropagation()}
                                disabled={savingProjectIds.has(row.id)}
                                style={{ ...inputStyle, minWidth: 150, fontWeight: 700 }}
                              >
                                <option value="not_started">未着手</option>
                                <option value="internal_production">進行中</option>
                                <option value="internal_revision">修正中</option>
                                <option value="client_submission">提出待ち</option>
                                <option value="paused">保留</option>
                                <option value="completed">完了</option>
                              </select>
                            ) : statusBadge(getBoardStatusLabel(row.displayStatus), getBoardStatusStyle(row.displayStatus))}
                          </td>
                          {COLUMN_OPTIONS.filter((column) => visibleColumnSet.has(column.key)).map((column) => (
                            <td key={`${row.id}:${column.key}`} style={{ ...tdStyle, padding: compactRowPadding(density), borderBottom: `1px solid ${rowBorderColor}` }}>
                              {renderTableCell(column.key, row)}
                            </td>
                          ))}
                        </tr>
                      )
                    })}
                    {!loading && filteredRows.length === 0 ? <tr><td colSpan={5 + visibleColumns.length} style={{ ...tdStyle, padding: "28px 18px", textAlign: "center", color: "#64748b" }}>条件に一致する案件はありません。</td></tr> : null}
                  </tbody>
                </table>
              </div>
            </>
          ) : null}

          {viewMode === "calendar" ? (
            <div style={{ padding: 18, display: "grid", gap: 14 }}>
              <div><strong style={{ display: "block", fontSize: 15, color: "#0f172a" }}>納期カレンダー</strong><span style={mutedTextStyle}>納期ベースで案件を確認できます。案件をクリックすると選択サマリーに反映されます。</span></div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(7, minmax(0, 1fr))", gap: 10 }}>
                {["日", "月", "火", "水", "木", "金", "土"].map((label) => <div key={label} style={{ ...mutedTextStyle, fontWeight: 800, textAlign: "center" }}>{label}</div>)}
                {calendarDays.map((day) => {
                  const rows = calendarRowsByDay.get(day) ?? []
                  const inMonth = day.startsWith(month)
                  return (
                    <div key={day} style={{ minHeight: 134, padding: 10, borderRadius: 14, border: "1px solid rgba(226, 232, 240, 0.9)", background: inMonth ? "rgba(255,255,255,0.96)" : "rgba(248,250,252,0.72)", display: "grid", gap: 8, alignContent: "start" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                        <strong style={{ fontSize: 12, color: inMonth ? "#0f172a" : "#94a3b8" }}>{day.slice(-2)}</strong>
                        {rows.length > 0 ? <span style={{ ...mutedTextStyle, fontWeight: 700 }}>{rows.length}件</span> : null}
                      </div>
                      <div style={{ display: "grid", gap: 6 }}>
                        {rows.slice(0, 4).map((row) => (
                          <button key={row.id} type="button" onClick={() => setSelectedProjectId((current) => (current === row.id ? "" : row.id))} style={{ textAlign: "left", padding: "8px 10px", borderRadius: 12, border: row.overdueCount > 0 ? "1px solid rgba(220, 38, 38, 0.24)" : "1px solid rgba(148, 163, 184, 0.16)", background: row.id === selectedRow?.id ? "rgba(15,118,110,0.08)" : "rgba(248,250,252,0.92)", cursor: "pointer", display: "grid", gap: 4 }}>
                            <strong style={{ fontSize: 12, color: "#0f172a" }}>{row.project.name}</strong>
                            <span style={mutedTextStyle}>{row.summary.clientName}</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          ) : null}

          {viewMode === "assignee" ? (
            <div style={{ padding: 18, display: "grid", gap: 14 }}>
              <div><strong style={{ display: "block", fontSize: 15, color: "#0f172a" }}>担当者ビュー</strong><span style={mutedTextStyle}>抱えている案件数と納期負荷をすぐ確認できます。</span></div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12 }}>
                {assigneeLoads.map((load) => (
                  <button key={load.userId} type="button" onClick={() => { setOwnerFilter(load.userId); setViewMode("table") }} style={{ textAlign: "left", padding: 16, borderRadius: 18, border: "1px solid rgba(148, 163, 184, 0.18)", background: "rgba(255,255,255,0.96)", cursor: "pointer", display: "grid", gap: 10 }}>
                    <div><strong style={{ display: "block", fontSize: 15, color: "#0f172a" }}>{load.label}</strong><span style={mutedTextStyle}>案件責任者 / 制作担当の負荷</span></div>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 8 }}>
                      <div><div style={mutedTextStyle}>担当案件</div><strong style={{ fontSize: 20, color: "#0f172a" }}>{load.openProjects}</strong></div>
                      <div><div style={mutedTextStyle}>制作行</div><strong style={{ fontSize: 20, color: "#0f172a" }}>{load.openRows}</strong></div>
                      <div><div style={mutedTextStyle}>今日納期</div><strong style={{ fontSize: 20, color: load.dueToday > 0 ? "#b45309" : "#0f172a" }}>{load.dueToday}</strong></div>
                      <div><div style={mutedTextStyle}>遅延</div><strong style={{ fontSize: 20, color: load.overdue > 0 ? "#dc2626" : "#0f172a" }}>{load.overdue}</strong></div>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          {advancedOpen && orphanRows.length > 0 ? (
            <div style={{ borderTop: "1px solid rgba(226, 232, 240, 0.85)", padding: 18, display: "grid", gap: 12 }}>
              <div><strong style={{ display: "block", fontSize: 15, color: "#0f172a" }}>未割当の制作行</strong><span style={mutedTextStyle}>案件未設定の行をこの場で案件に紐付けできます。</span></div>
              <div style={{ display: "grid", gap: 10 }}>
                {orphanRows.slice(0, 8).map((row) => {
                  const candidateProjects = projectSummaries.filter((item) => item.project.client_id === row.client_id)
                  return (
                    <div key={row.id} style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(220px, 240px) auto", gap: 10, padding: 12, borderRadius: 14, border: "1px solid rgba(148, 163, 184, 0.16)", background: "rgba(255,255,255,0.96)" }}>
                      <div><strong style={{ display: "block", fontSize: 13, color: "#0f172a" }}>{row.title}</strong><span style={mutedTextStyle}>公開予定 {formatShortDate(row.due_client_at)} / 既存案件 {row.project_name || "未設定"}</span></div>
                      <select value={orphanAssignments[row.id] ?? ""} onChange={(event) => setOrphanAssignments((prev) => ({ ...prev, [row.id]: event.target.value }))} style={inputStyle}>
                        <option value="">紐付け先の案件を選択</option>
                        {candidateProjects.map((item) => <option key={item.project.id} value={item.project.id}>{item.project.name}</option>)}
                      </select>
                      <button type="button" onClick={() => void assignOrphanRow(row.id)} disabled={orphanSavingId === row.id} style={buttonPrimaryStyle}>{orphanSavingId === row.id ? "紐付け中..." : "案件に紐付け"}</button>
                    </div>
                  )
                })}
              </div>
            </div>
          ) : null}
        </div>
      </section>
    </ProjectShell>
  )
}

