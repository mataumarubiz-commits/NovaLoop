"use client"

import Link from "next/link"
import { useEffect, useState, useMemo, type CSSProperties } from "react"
import { useSearchParams } from "next/navigation"
import { supabase } from "../../lib/supabase"
import { useAuthOrg } from "@/hooks/useAuthOrg"
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
  projectName: string
  title: string
  dueClientAt: string
  dueEditorAt: string
  unitPrice: number
  thumbnailDone: boolean
  billable: boolean
  deliveryMonth: string
  status: string
  editorSubmittedAt: string | null
  clientSubmittedAt: string | null
}

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

type OrgDebug = {
  userId: string | null
  orgId: string | null
  role: string | null
  error: string | null
}

export default function ContentsPage() {
  const { activeOrgId: orgId, role, user, loading: authLoading, needsOnboarding } = useAuthOrg({ redirectToOnboarding: true })
  const [rows, setRows] = useState<Row[]>([])
  const [clients, setClients] = useState<ClientOption[]>([])
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
  const [detailRow, setDetailRow] = useState<Row | null>(null)
  const searchParams = useSearchParams()
  const highlightId = searchParams.get("highlight")
  const openClientCreate = searchParams.get("newClient")
  const isLoading = authLoading || loading

  const canEdit = role === "owner" || role === "executive_assistant"

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

    // デフォルトは提出日昇順
    return [...list].sort((a, b) => (a.dueClientAt < b.dueClientAt ? -1 : a.dueClientAt > b.dueClientAt ? 1 : 0))
  }, [rows, filterDue, filterClientId, todayYmd, tomorrowYmd, weekStartYmd, weekEndYmd, clients])

  useEffect(() => {
    setDebug({ userId: user?.id ?? null, orgId: orgId ?? null, role, error: needsOnboarding ? "onboarding needed" : null })
  }, [user?.id, orgId, role, needsOnboarding])

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

  const fetchContents = async (currentOrgId: string) => {
    const { data, error: fetchError } = await supabase
      .from("contents")
      .select(
        "id, project_name, title, unit_price, due_client_at, due_editor_at, status, thumbnail_done, billable_flag, delivery_month, client_id, editor_submitted_at, client_submitted_at, client:clients(name)"
      )
      .eq("org_id", currentOrgId)
      .order("due_client_at", { ascending: true })

    if (fetchError) {
      setError(`コンテンツ取得に失敗しました: ${fetchError.message}`)
      return
    }

    const mapped = (data ?? []).map((row) => {
      const client = Array.isArray(row.client) ? row.client[0] : row.client
      return {
      id: row.id,
    clientId: row.client_id,
      clientName: (client as { name?: string } | null)?.name ?? "",
      projectName: row.project_name,
      title: row.title,
      dueClientAt: row.due_client_at,
      dueEditorAt: row.due_editor_at,
      unitPrice: Number(row.unit_price),
      thumbnailDone: row.thumbnail_done,
      billable: row.billable_flag,
      deliveryMonth: row.delivery_month,
      status: row.status,
      editorSubmittedAt: row.editor_submitted_at ?? null,
      clientSubmittedAt: row.client_submitted_at ?? null,
    }
    })

    setRows(mapped)
  }

  useEffect(() => {
    if (!orgId) return
    let active = true

    const load = async () => {
      setLoading(true)
      await Promise.all([fetchClients(orgId), fetchContents(orgId)])
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

  useEffect(() => {
    if (openClientCreate === "1") {
      setIsCreatingClient(true)
    }
  }, [openClientCreate])

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

  const hasClients = clients.length > 0

  const canSubmit =
    form.clientId &&
    form.projectName &&
    form.title &&
    form.dueClientAt &&
    form.unitPrice

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
    const payload = { ...patch }
    if (typeof payload.due_client_at === "string" && /^\d{4}-\d{2}-\d{2}$/.test(payload.due_client_at)) {
      (payload as Record<string, unknown>).due_editor_at = addDays(payload.due_client_at as string, -3)
      ;(payload as Record<string, unknown>).delivery_month = (payload.due_client_at as string).slice(0, 7)
    }
    try {
      const { error: updateError } = await supabase
        .from("contents")
        .update(payload)
        .eq("id", rowId)
        .eq("org_id", orgId)

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
    setRowErrors((prev) => {
      const next = { ...prev }
      delete next[row.id]
      return next
    })
    setSavingRowIds((prev) => new Set(prev).add(row.id))
    try {
      const { error: updateError } = await supabase
        .from("contents")
        .update({ status })
        .eq("id", row.id)
        .eq("org_id", orgId)
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

  const handleAdd = async () => {
    if (!canSubmit || !canEdit) return
    if (!orgId) {
      setError("トークンの取得に失敗しました")
      return
    }

    const dueEditorAt = addDays(form.dueClientAt, -3)
    const deliveryMonth = form.dueClientAt.slice(0, 7)

    const { error: insertError } = await supabase.from("contents").insert({
      id: crypto.randomUUID(),
      org_id: orgId,
      client_id: form.clientId,
      project_name: form.projectName,
      title: form.title,
      unit_price: Number(form.unitPrice),
      due_client_at: form.dueClientAt,
      due_editor_at: dueEditorAt,
      status: "not_started",
      thumbnail_done: false,
      billable_flag: true,
      delivery_month: deliveryMonth,
    })

    if (insertError) {
      setError(`追加に失敗しました: ${insertError.message}`)
      return
    }

    await fetchContents(orgId)
    setForm({
      clientId: clients[0]?.id ?? "",
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
    const dueEditorAt = addDays(dueClientAt, -3)
    const deliveryMonth = dueClientAt.slice(0, 7)
    setAddingFromTemplateId(tpl.id)
    setUiError(null)
    try {
      const { error: insertError } = await supabase.from("contents").insert({
        id: crypto.randomUUID(),
        org_id: orgId,
        client_id: templateClientId,
        project_name: tpl.default_project_name ?? tpl.name,
        title: tpl.default_title ?? tpl.name,
        unit_price: Number(tpl.default_unit_price ?? 0),
        due_client_at: dueClientAt,
        due_editor_at: dueEditorAt,
        status: tpl.default_status ?? "not_started",
        thumbnail_done: false,
        billable_flag: tpl.default_billable_flag ?? true,
        delivery_month: deliveryMonth,
      })
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
        <header style={{ marginBottom: 24 }}>
          <p style={{ fontSize: 12, letterSpacing: "0.08em", color: "var(--muted)" }}>
            制作シート          </p>
          <h1 style={{ fontSize: 28, margin: "6px 0 8px", color: "var(--text)" }}>コンテンツ一覧</h1>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            {canEdit && (
              <>
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
                  onClick={() => setIsCreatingClient((prev) => !prev)}
                >
                  クライアント作成
                </button>
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
                クライアント                <select
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
                          const dueEditorAt = addDays(dueClientAt, -3)
                          const deliveryMonth = dueClientAt.slice(0, 7)
                          return {
                            id: crypto.randomUUID(),
                            org_id: orgId,
                            client_id: templateClientId,
                            project_name: tpl.default_project_name ?? tpl.name,
                            title: item.title,
                            unit_price: Number(tpl.default_unit_price ?? 0),
                            due_client_at: dueClientAt,
                            due_editor_at: dueEditorAt,
                            status: tpl.default_status ?? "not_started",
                            thumbnail_done: false,
                            billable_flag: tpl.default_billable_flag ?? true,
                            delivery_month: deliveryMonth,
                          }
                        })

                        const { error: insertError } = await supabase
                          .from("contents")
                          .insert(payloads)

                        if (insertError) {
                          setBulkResultMessage(
                            `一括追加に失敗しました: ${insertError.message}`
                          )
                          return
                        }

                        await fetchContents(orgId)
                        setBulkResultMessage(
                          `追加成功: ${inserts.length}件 / 失敗: ${errors.length}件${
                            errors.length ? `?${errors.join(" / ")}?` : ""
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
                タイトル
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
                        description="最初のクライアントと1本目の案件を入れると、Home と Billing の導線が一気に使いやすくなります。"
                        primaryHref="/contents?newClient=1"
                        primaryLabel="クライアントを登録する"
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
                  <h2 style={{ margin: 0, fontSize: 22, color: "var(--text)" }}>{detailRow.title}</h2>
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
                <DetailStat label="先方提出日" value={detailRow.dueClientAt} />
                <DetailStat label="編集者提出日" value={detailRow.dueEditorAt} />
                <DetailStat label="対象月" value={detailRow.deliveryMonth || "-"} />
                <DetailStat label="単価" value={`¥${detailRow.unitPrice.toLocaleString("ja-JP")}`} />
                <DetailStat label="ステータス" value={statusLabels[detailRow.status] ?? detailRow.status} />
                <DetailStat label="請求対象" value={detailRow.billable ? "対象" : "対象外"} />
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12 }}>
                <div style={{ border: "1px solid var(--border)", borderRadius: 14, padding: 14, background: "var(--surface-2)" }}>
                  <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 6 }}>進行メモ</div>
                  <div style={{ fontSize: 13, color: "var(--text)", lineHeight: 1.7 }}>
                    {isClientLate(detailRow, todayYmd)
                      ? "先方提出日を過ぎています。最優先で対応状況を確認してください。"
                      : isEditorLate(detailRow, todayYmd)
                        ? "編集者提出が遅れています。外注確認とリスケ判断が必要です。"
                        : "大きな遅延はありません。次の更新タイミングを確認してください。"}
                  </div>
                </div>

                <div style={{ border: "1px solid var(--border)", borderRadius: 14, padding: 14, background: "var(--surface-2)" }}>
                  <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 6 }}>次の行動</div>
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













