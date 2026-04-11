"use client"

import Link from "next/link"
import { useParams, useSearchParams } from "next/navigation"
import { useCallback, useEffect, useMemo, useState } from "react"
import { ProjectInfoCard, ProjectSection, ProjectShell } from "@/components/project/ProjectShell"
import {
  buttonPrimaryStyle,
  buttonSecondaryStyle,
  formatCurrency,
  formatDateTime,
  inputStyle,
  tableStyle,
  tdStyle,
  textOrDash,
  thStyle,
} from "@/components/project/projectPageStyles"
import { useProjectWorkspace } from "@/hooks/useProjectWorkspace"
import { canAccessProjectsSurface } from "@/lib/projectWorkspaceAccess"
import {
  buildContentHealthScore,
  getContentBillingMonthYm,
  isContentClientOverdue,
  normalizeContentDueYmd,
  normalizeContentLinks,
  validateContentRules,
} from "@/lib/contentWorkflow"
import {
  isMissingContentsLinksJsonColumn,
  isMissingContentsWorkItemFieldsColumn,
  sanitizeContentWritePayload,
} from "@/lib/contentsCompat"
import {
  normalizeAutomationContentDates,
  shiftIsoDateTimeByDays,
  shiftYmdByDaysAligned,
  syncAutomationArtifacts,
  type AutomationContent,
  type AutomationProject,
} from "@/lib/projectAutomation"
import { CONTENT_STATUS_LABELS, CONTENT_WORKFLOW_STATUS_OPTIONS, PROJECT_STATUS_LABELS, PROJECT_STATUS_OPTIONS } from "@/lib/projectStatus"
import { supabase } from "@/lib/supabase"

/* ─── Tab Config ─── */

const tabs = ["overview", "contents", "tasks", "calendar", "materials", "changes", "finance", "integrations", "log"] as const
type TabKey = (typeof tabs)[number]

const tabLabels: Record<TabKey, string> = {
  overview: "概要",
  contents: "案件明細",
  tasks: "工程",
  calendar: "カレンダー",
  materials: "素材",
  changes: "変更履歴",
  finance: "収支",
  integrations: "連携",
  log: "例外・ログ",
}

/* ─── Label Maps ─── */

const contractLabels: Record<string, string> = { per_content: "明細単価", retainer: "リテナー", fixed_fee: "固定費", monthly: "月額" }

const taskStatus: Record<string, string> = { not_started: "未着手", in_progress: "進行中", blocked: "ブロック", done: "完了" }
const taskType: Record<string, string> = { materials: "素材", script: "台本", editing: "編集", internal_review: "社内確認", client_review: "先方確認", revision: "修正", publishing: "公開準備", publish: "公開" }
const eventType: Record<string, string> = { editor_due: "編集納期", client_due: "先方納期", publish: "公開", meeting: "打ち合わせ", payout: "振込", invoice_issue: "請求", reminder: "リマインド", custom: "カスタム" }
const assetType: Record<string, string> = { raw: "原本", script: "台本", draft: "ドラフト", revision: "修正版", final: "最終版", thumbnail: "サムネイル", reference: "参考資料", proof: "校正" }
const changeType: Record<string, string> = { deadline_change: "納期変更", spec_change: "仕様変更", revision_additional: "追加修正", asset_replace: "素材差し替え", publish_reschedule: "公開日変更", extra_deliverable: "追加納品" }
const impactLabels: Record<string, string> = { low: "小", medium: "中", high: "大" }
const exceptionLabels: Record<string, string> = { missing_assignee: "担当者未設定", material_missing: "素材不足", due_reverse: "納期逆転", stagnation: "停滞", revision_heavy: "修正過多", price_missing: "単価未設定", cost_over: "原価超過", integration_missing: "連携不足", invoice_missing: "請求漏れ", client_overdue: "先方納期遅延", required_link_missing: "必須リンク不足", manual_check: "手動確認" }
const severityLabels: Record<string, string> = { low: "低", medium: "中", high: "高" }
const recordStatusLabels: Record<string, string> = { runtime: "実行時", open: "未対応", resolved: "解消済み", ignored: "無視" }

/* ─── Helpers ─── */

function looksMojibake(text: string) {
  return text.includes("\uFFFD") || text.includes("\u7E3A") || text.includes("\u7E67") || text.includes("\u8B5B")
}

const pct = (v: number | null) => (v == null ? "-" : `${Math.round(v * 100)}%`)

const toIcsTimestamp = (value: string, allDay: boolean) => {
  const date = new Date(value)
  if (allDay) {
    const y = date.getUTCFullYear()
    const m = String(date.getUTCMonth() + 1).padStart(2, "0")
    const d = String(date.getUTCDate()).padStart(2, "0")
    return `${y}${m}${d}`
  }
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z")
}

const escapeIcsText = (value: string) => value.replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/,/g, "\\,").replace(/;/g, "\\;")
const safeFileToken = (value: string) => value.trim().replace(/[\\/:*?"<>|]+/g, "_") || "project"
const buildChatworkRoomUrl = (roomId: string) => { const t = roomId.trim(); return /^\d+$/.test(t) ? `https://www.chatwork.com/#!rid${t}` : null }
const buildGoogleCalendarUrl = (calendarId: string) => { const t = calendarId.trim(); return t ? `https://calendar.google.com/calendar/u/0/r?cid=${encodeURIComponent(t)}` : null }

function toAutomationProject(project: { id: string; name: string; chatwork_room_id?: string | null; google_calendar_id?: string | null; slack_channel_id?: string | null; discord_channel_id?: string | null; drive_folder_url?: string | null }): AutomationProject {
  return { id: project.id, name: project.name, chatwork_room_id: project.chatwork_room_id, google_calendar_id: project.google_calendar_id, slack_channel_id: project.slack_channel_id, discord_channel_id: project.discord_channel_id, drive_folder_url: project.drive_folder_url }
}

function toAutomationContent(content: { id: string; org_id: string; project_id?: string | null; project_name: string; title: string; due_client_at: string; due_editor_at: string; publish_at?: string | null; status: string; billable_flag: boolean; delivery_month: string; unit_price: number; invoice_id?: string | null; assignee_editor_user_id?: string | null; assignee_checker_user_id?: string | null; revision_count?: number | null; estimated_cost?: number | null; next_action?: string | null; blocked_reason?: string | null; material_status?: string | null; draft_status?: string | null; final_status?: string | null; health_score?: number | null; links_json?: unknown; editor_submitted_at?: string | null; client_submitted_at?: string | null }): AutomationContent {
  return { ...content }
}

const quickActionStyle = (enabled: boolean) => ({ ...buttonSecondaryStyle, opacity: enabled ? 1 : 0.55, cursor: enabled ? "pointer" : "not-allowed" })

/* ─── Rate Card Form ─── */

type RateCardDraft = {
  id: string | null
  itemType: string
  unitLabel: string
  salesUnitPrice: string
  standardCost: string
  effectiveFrom: string
  effectiveTo: string
}

const emptyRateCard: RateCardDraft = { id: null, itemType: "", unitLabel: "本", salesUnitPrice: "", standardCost: "", effectiveFrom: "", effectiveTo: "" }

/* ================================================================ */
/* Main Component                                                   */
/* ================================================================ */

export default function ProjectDetailPage() {
  const params = useParams<{ id: string }>()
  const id = typeof params?.id === "string" ? params.id : ""
  const {
    loading, error, role, canEdit, canViewFinance, orgId, todayYmd, members, projects, contents, tasks, events, assets, changes, expenses, rateCards, storedExceptions, runtimeExceptions, invoices, invoiceLines, vendorInvoices, vendorInvoiceLines, projectSummaries, refresh,
  } = useProjectWorkspace({ requireAdminSurface: true })
  const canAccessProjects = canAccessProjectsSurface(role)

  const project = useMemo(() => projects.find((r) => r.id === id) ?? null, [id, projects])
  const summary = useMemo(() => projectSummaries.find((r) => r.project.id === id) ?? null, [id, projectSummaries])
  const rows = useMemo(() => contents.filter((r) => r.project_id === id), [contents, id])
  const taskRows = useMemo(() => tasks.filter((r) => r.project_id === id), [id, tasks])
  const eventRows = useMemo(() => events.filter((r) => r.project_id === id), [events, id])
  const assetRows = useMemo(() => assets.filter((r) => r.project_id === id), [assets, id])
  const changeRows = useMemo(() => changes.filter((r) => r.project_id === id), [changes, id])
  const expenseRows = useMemo(() => expenses.filter((r) => r.project_id === id), [expenses, id])
  const storedRows = useMemo(() => storedExceptions.filter((r) => r.project_id === id), [id, storedExceptions])
  const runtimeRows = useMemo(() => runtimeExceptions.filter((r) => r.projectId === id), [id, runtimeExceptions])
  const cardRows = useMemo(
    () => (!project ? [] : rateCards.filter((r) => r.project_id === id || (!r.project_id && r.client_id === project.client_id))),
    [id, project, rateCards],
  )
  const memberName = useMemo(() => new Map(members.map((m) => [m.userId, m.displayName || m.email || m.userId])), [members])
  const taskName = useMemo(() => new Map(taskRows.map((r) => [r.id, r.title])), [taskRows])
  const validInvoices = useMemo(() => new Set(invoices.filter((r) => r.status !== "void").map((r) => r.id)), [invoices])
  const validVendorInvoices = useMemo(() => new Set(vendorInvoices.filter((r) => r.status !== "void").map((r) => r.id)), [vendorInvoices])

  const salesByContent = useMemo(() => {
    const map = new Map<string, number>()
    for (const line of invoiceLines) {
      if (line.content_id && validInvoices.has(line.invoice_id)) {
        map.set(line.content_id, (map.get(line.content_id) ?? 0) + Number(line.amount ?? 0))
      }
    }
    return map
  }, [invoiceLines, validInvoices])

  const costByContent = useMemo(() => {
    const map = new Map<string, number>()
    for (const line of vendorInvoiceLines) {
      if (line.content_id && validVendorInvoices.has(line.vendor_invoice_id)) {
        map.set(line.content_id, (map.get(line.content_id) ?? 0) + Number(line.amount ?? 0))
      }
    }
    return map
  }, [validVendorInvoices, vendorInvoiceLines])

  const expenseByContent = useMemo(() => {
    const map = new Map<string, number>()
    for (const row of expenseRows) {
      if (row.content_id) map.set(row.content_id, (map.get(row.content_id) ?? 0) + Number(row.amount ?? 0))
    }
    return map
  }, [expenseRows])

  const profitRows = useMemo(
    () =>
      rows
        .map((r) => {
          const sales = salesByContent.get(r.id) ?? Number(r.unit_price ?? 0)
          const cost = costByContent.get(r.id) ?? Number(r.estimated_cost ?? 0)
          const expense = expenseByContent.get(r.id) ?? 0
          const gross = sales - cost - expense
          return { id: r.id, title: r.title, due: r.due_client_at, status: CONTENT_STATUS_LABELS[r.status] ?? r.status, sales, cost, expense, gross, margin: sales > 0 ? gross / sales : null, revision: Number(r.revision_count ?? 0), health: Number(r.health_score ?? 100) }
        })
        .sort((a, b) => (a.margin ?? -1) - (b.margin ?? -1)),
    [costByContent, expenseByContent, rows, salesByContent],
  )

  const monthlyTrend = useMemo(() => {
    const map = new Map<string, { sales: number; cost: number; expense: number }>()
    for (const r of rows) {
      const month = getContentBillingMonthYm(r.delivery_month, r.due_client_at)
      const cur = map.get(month) ?? { sales: 0, cost: 0, expense: 0 }
      cur.sales += salesByContent.get(r.id) ?? Number(r.unit_price ?? 0)
      cur.cost += costByContent.get(r.id) ?? Number(r.estimated_cost ?? 0)
      map.set(month, cur)
    }
    for (const e of expenseRows) {
      const month = e.occurred_on.slice(0, 7)
      const cur = map.get(month) ?? { sales: 0, cost: 0, expense: 0 }
      cur.expense += Number(e.amount ?? 0)
      map.set(month, cur)
    }
    return [...map.entries()].map(([month, v]) => ({ month, ...v, gross: v.sales - v.cost - v.expense })).sort((a, b) => b.month.localeCompare(a.month))
  }, [costByContent, expenseRows, rows, salesByContent])

  /* ─── UI State ─── */
  const searchParams = useSearchParams()
  const initialTab = (searchParams?.get("tab") ?? "overview") as TabKey
  const highlightContentId = searchParams?.get("highlight") ?? ""
  const [tab, setTabRaw] = useState<TabKey>(tabs.includes(initialTab as TabKey) ? initialTab : "overview")
  useEffect(() => {
    queueMicrotask(() => {
      setTabRaw(tabs.includes(initialTab as TabKey) ? initialTab : "overview")
    })
  }, [initialTab])
  const setTab = useCallback((t: TabKey) => {
    setTabRaw(t)
    const url = new URL(window.location.href)
    url.searchParams.set("tab", t)
    window.history.replaceState(null, "", url.toString())
  }, [])
  const [draft, setDraft] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const [uiError, setUiError] = useState<string | null>(null)
  const [uiSuccess, setUiSuccess] = useState<string | null>(null)
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [bulkShift, setBulkShift] = useState("0")
  const [bulkStatus, setBulkStatus] = useState("")
  const [bulkEditor, setBulkEditor] = useState("")
  const [bulkChecker, setBulkChecker] = useState("")
  const [bulkBillable, setBulkBillable] = useState<"keep" | "true" | "false">("keep")
  const [bulkUnitPrice, setBulkUnitPrice] = useState("")
  const [newContent, setNewContent] = useState({
    title: "",
    dueClientAt: todayYmd,
    unitPrice: "",
    status: "not_started",
    billable: true,
    assigneeEditorUserId: "",
    assigneeCheckerUserId: "",
  })
  const [createContentBusy, setCreateContentBusy] = useState(false)
  const [rateCardDraft, setRateCardDraft] = useState<RateCardDraft>(emptyRateCard)
  const [rateCardBusy, setRateCardBusy] = useState(false)

  const clearUi = useCallback(() => { setUiError(null); setUiSuccess(null) }, [])
  const flashSuccess = useCallback((msg: string) => { setUiError(null); setUiSuccess(msg) }, [])
  const flashError = useCallback((msg: string) => { setUiSuccess(null); setUiError(msg) }, [])

  /* ─── Loading / Not found ─── */
  if (loading) return <ProjectShell title="案件詳細" description="読み込み中です。">読み込み中...</ProjectShell>
  if (!canAccessProjects) {
    return (
      <ProjectShell title="案件詳細" description="案件詳細は owner / executive_assistant のみ利用できます。">
        <ProjectSection title="権限不足">この画面は owner / executive_assistant のみ利用できます。</ProjectSection>
      </ProjectShell>
    )
  }
  if (!project || !summary) return <ProjectShell title="案件詳細" description="案件が見つかりません。"><ProjectSection title="案件が見つかりません"><Link href="/projects">案件一覧へ戻る</Link></ProjectSection></ProjectShell>

  /* ─── Draft fields ─── */
  const d = {
    code: draft.code ?? project.code ?? "",
    name: draft.name ?? project.name,
    status: draft.status ?? project.status,
    contractType: draft.contractType ?? project.contract_type,
    ownerUserId: draft.ownerUserId ?? project.owner_user_id ?? "",
    startDate: draft.startDate ?? project.start_date ?? "",
    endDate: draft.endDate ?? project.end_date ?? "",
    notes: draft.notes ?? project.notes ?? "",
    chatworkRoomId: draft.chatworkRoomId ?? project.chatwork_room_id ?? "",
    googleCalendarId: draft.googleCalendarId ?? project.google_calendar_id ?? "",
    slackChannelId: draft.slackChannelId ?? project.slack_channel_id ?? "",
    discordChannelId: draft.discordChannelId ?? project.discord_channel_id ?? "",
    driveFolderUrl: draft.driveFolderUrl ?? project.drive_folder_url ?? "",
  }

  /* ─── Project Save ─── */
  const saveProject = async () => {
    if (!canEdit || !orgId) return
    if (!d.name.trim()) {
      clearUi()
      return flashError("案件名を入力してください。")
    }
    setBusy(true)
    clearUi()
    const { error: e } = await supabase.from("projects").update({
      code: d.code.trim() || null,
      name: d.name.trim(),
      status: d.status,
      contract_type: d.contractType,
      owner_user_id: d.ownerUserId || null,
      start_date: d.startDate || null,
      end_date: d.endDate || null,
      notes: d.notes.trim() || null,
      chatwork_room_id: d.chatworkRoomId.trim() || null,
      google_calendar_id: d.googleCalendarId.trim() || null,
      slack_channel_id: d.slackChannelId.trim() || null,
      discord_channel_id: d.discordChannelId.trim() || null,
      drive_folder_url: d.driveFolderUrl.trim() || null,
    }).eq("id", project.id).eq("org_id", orgId)
    if (e) return flashError(e.message)
    flashSuccess("保存しました。")
    setDraft({})
    await refresh()
  }

  /* ─── Rate Card CRUD ─── */
  const saveRateCard = async () => {
    if (!canEdit || !orgId || !project) return
    if (!rateCardDraft.itemType.trim()) return flashError("項目名を入力してください。")
    setRateCardBusy(true)
    clearUi()

    const payload = {
      org_id: orgId,
      project_id: project.id,
      client_id: project.client_id,
      item_type: rateCardDraft.itemType.trim(),
      unit_label: rateCardDraft.unitLabel.trim() || "本",
      sales_unit_price: Number(rateCardDraft.salesUnitPrice) || 0,
      standard_cost: Number(rateCardDraft.standardCost) || 0,
      effective_from: rateCardDraft.effectiveFrom || todayYmd,
      effective_to: rateCardDraft.effectiveTo || null,
    }

    if (rateCardDraft.id) {
      const { error: e } = await supabase.from("rate_cards").update(payload).eq("id", rateCardDraft.id).eq("org_id", orgId)
      setRateCardBusy(false)
      if (e) return flashError(e.message)
      flashSuccess("単価を更新しました。")
    } else {
      const { error: e } = await supabase.from("rate_cards").insert({ ...payload, id: crypto.randomUUID() })
      setRateCardBusy(false)
      if (e) return flashError(e.message)
      flashSuccess("単価を追加しました。")
    }
    setRateCardDraft(emptyRateCard)
    await refresh()
  }

  const deleteRateCard = async (cardId: string) => {
    if (!canEdit || !orgId) return
    if (typeof window !== "undefined" && !window.confirm("この単価を削除しますか？")) return
    setRateCardBusy(true)
    clearUi()
    const { error: e } = await supabase.from("rate_cards").delete().eq("id", cardId).eq("org_id", orgId)
    setRateCardBusy(false)
    if (e) return flashError(e.message)
    flashSuccess("単価を削除しました。")
    if (rateCardDraft.id === cardId) setRateCardDraft(emptyRateCard)
    await refresh()
  }

  const editRateCard = (card: typeof cardRows[number]) => {
    setRateCardDraft({
      id: card.id,
      itemType: card.item_type,
      unitLabel: card.unit_label,
      salesUnitPrice: String(card.sales_unit_price ?? 0),
      standardCost: String(card.standard_cost ?? 0),
      effectiveFrom: card.effective_from,
      effectiveTo: card.effective_to ?? "",
    })
  }

  /* ─── Bulk update ─── */
  const scopedRows = selectedIds.length > 0 ? rows.filter((row) => selectedIds.includes(row.id)) : rows
  const delayedRows = scopedRows.filter((row) => isContentClientOverdue(row.status, row.due_client_at, todayYmd, row.client_submitted_at))
  const todayDueRows = scopedRows.filter((row) => normalizeContentDueYmd(row.due_client_at) === todayYmd)

  const applyBulk = async () => {
    if (!canEdit || !orgId) return
    if (selectedIds.length === 0) return flashError("対象行を選択してください。")
    const shiftDays = Number(bulkShift || 0)
    const selectedRows = rows.filter((row) => selectedIds.includes(row.id))
    const automationProject = toAutomationProject(project)
    setBusy(true)
    clearUi()
    try {

    for (const row of selectedRows) {
      const editorId = bulkEditor || row.assignee_editor_user_id || null
      const checkerId = bulkChecker || row.assignee_checker_user_id || null
      const billable = bulkBillable === "keep" ? row.billable_flag : bulkBillable === "true"
      const unitPrice = bulkUnitPrice !== "" ? Number(bulkUnitPrice) : Number(row.unit_price ?? 0)
      const normalized = normalizeAutomationContentDates({
        previous: toAutomationContent(row),
        next: {
          ...toAutomationContent(row),
          due_client_at: shiftDays !== 0 ? shiftYmdByDaysAligned(row.due_client_at, shiftDays) : row.due_client_at,
          due_editor_at: shiftDays !== 0 ? shiftYmdByDaysAligned(row.due_editor_at, shiftDays) : row.due_editor_at,
          publish_at: shiftDays !== 0 && row.publish_at ? shiftIsoDateTimeByDays(row.publish_at, shiftDays) : row.publish_at,
          status: bulkStatus || row.status,
          assignee_editor_user_id: editorId,
          assignee_checker_user_id: checkerId,
          billable_flag: Boolean(billable),
          unit_price: unitPrice,
        },
        todayYmd,
        project: automationProject,
      })
      const links = normalizeContentLinks(row.links_json)
      const errs = validateContentRules({
        dueClientAt: normalized.due_client_at,
        dueEditorAt: normalized.due_editor_at,
        status: normalized.status,
        unitPrice: Number(normalized.unit_price),
        billable: Boolean(normalized.billable_flag),
        materialStatus: normalized.material_status,
        draftStatus: normalized.draft_status,
        finalStatus: normalized.final_status,
        assigneeEditorUserId: normalized.assignee_editor_user_id,
        assigneeCheckerUserId: normalized.assignee_checker_user_id,
        nextAction: normalized.next_action,
        revisionCount: Number(normalized.revision_count ?? 0),
        estimatedCost: Number(normalized.estimated_cost ?? 0),
        links,
      })
      if (errs.length > 0) { setBusy(false); return flashError(`${row.title}: ${errs[0]}`) }

      const updatePayload: Record<string, unknown> = {
        due_client_at: normalized.due_client_at,
        due_editor_at: normalized.due_editor_at,
        publish_at: normalized.publish_at,
        status: normalized.status,
        assignee_editor_user_id: normalized.assignee_editor_user_id,
        assignee_checker_user_id: normalized.assignee_checker_user_id,
        billable_flag: normalized.billable_flag,
        delivery_month: normalized.delivery_month,
        health_score: normalized.health_score ?? buildContentHealthScore({
          dueClientAt: normalized.due_client_at, dueEditorAt: normalized.due_editor_at, status: normalized.status, unitPrice: Number(normalized.unit_price), billable: Boolean(normalized.billable_flag), materialStatus: normalized.material_status, draftStatus: normalized.draft_status, finalStatus: normalized.final_status, assigneeEditorUserId: normalized.assignee_editor_user_id, assigneeCheckerUserId: normalized.assignee_checker_user_id, nextAction: normalized.next_action, revisionCount: Number(normalized.revision_count ?? 0), estimatedCost: Number(normalized.estimated_cost ?? 0), links, todayYmd,
        }),
      }
      if (bulkUnitPrice !== "") updatePayload.unit_price = unitPrice

      let contentResult = await supabase.from("contents").update(updatePayload).eq("id", row.id).eq("org_id", orgId)
      let contentError = contentResult.error ? { message: contentResult.error.message } : null
      if (
        contentError &&
        (isMissingContentsLinksJsonColumn(contentError.message) ||
          isMissingContentsWorkItemFieldsColumn(contentError.message))
      ) {
        contentResult = await supabase
          .from("contents")
          .update(
            sanitizeContentWritePayload(updatePayload, {
              supportsLinksJson: !isMissingContentsLinksJsonColumn(contentError.message),
              supportsWorkItemFields: !isMissingContentsWorkItemFieldsColumn(contentError.message),
            })
          )
          .eq("id", row.id)
          .eq("org_id", orgId)
        contentError = contentResult.error ? { message: contentResult.error.message } : null
        if (
          contentError &&
          (isMissingContentsLinksJsonColumn(contentError.message) ||
            isMissingContentsWorkItemFieldsColumn(contentError.message))
        ) {
          contentResult = await supabase
            .from("contents")
            .update(
              sanitizeContentWritePayload(updatePayload, {
                supportsLinksJson: false,
                supportsWorkItemFields: false,
              })
            )
            .eq("id", row.id)
            .eq("org_id", orgId)
          contentError = contentResult.error ? { message: contentResult.error.message } : null
        }
      }
      if (contentError) return flashError(contentError.message)

      try {
        await syncAutomationArtifacts({ db: supabase, orgId, previous: toAutomationContent(row), next: normalized, project: automationProject, todayYmd })
      } catch (error) {
        setBusy(false)
        await refresh()
        return flashError(
          `一括更新の内容は保存されましたが、自動同期に失敗しました: ${error instanceof Error ? error.message : "unknown error"}`
        )
      }

      if (shiftDays === 0) continue
      for (const task of taskRows.filter((t) => t.content_id === row.id)) {
        const { error: taskError } = await supabase.from("project_tasks").update({ planned_start_date: task.planned_start_date ? shiftYmdByDaysAligned(task.planned_start_date, shiftDays) : null, planned_end_date: task.planned_end_date ? shiftYmdByDaysAligned(task.planned_end_date, shiftDays) : null }).eq("id", task.id).eq("org_id", orgId)
        if (taskError) return flashError(taskError.message)
      }
      for (const event of eventRows.filter((ev) => ev.content_id === row.id)) {
        const { error: eventError } = await supabase.from("schedule_events").update({ start_at: shiftIsoDateTimeByDays(event.start_at, shiftDays), end_at: event.end_at ? shiftIsoDateTimeByDays(event.end_at, shiftDays) : null }).eq("id", event.id).eq("org_id", orgId)
        if (eventError) return flashError(eventError.message)
      }
    }

    setBusy(false)
    flashSuccess(shiftDays !== 0 ? "タスクと関連日程を更新しました。" : "タスクを更新しました。")
    setSelectedIds([])
    setBulkUnitPrice("")
    await refresh()
    } catch (error) {
      flashError(error instanceof Error ? error.message : "一括更新に失敗しました。")
    } finally {
      setBusy(false)
    }
  }

  const createContent = async () => {
    if (!canEdit || !orgId) return
    const title = newContent.title.trim()
    if (!title) return flashError("タイトルを入力してください。")

    const contentId = crypto.randomUUID()
    const baseDueClientAt = newContent.dueClientAt || todayYmd
    const automationProject = toAutomationProject(project)
    const draftContent: AutomationContent = {
      id: contentId,
      org_id: orgId,
      project_id: project.id,
      project_name: project.name,
      title,
      due_client_at: baseDueClientAt,
      due_editor_at: baseDueClientAt,
      publish_at: null,
      status: newContent.status,
      billable_flag: Boolean(newContent.billable),
      delivery_month: baseDueClientAt.slice(0, 7),
      unit_price: Number(newContent.unitPrice || 0),
      invoice_id: null,
      assignee_editor_user_id: newContent.assigneeEditorUserId || null,
      assignee_checker_user_id: newContent.assigneeCheckerUserId || null,
      revision_count: 0,
      estimated_cost: 0,
      next_action: null,
      blocked_reason: null,
      material_status: "not_ready",
      draft_status: "not_started",
      final_status: "not_started",
      health_score: null,
      links_json: {},
      editor_submitted_at: null,
      client_submitted_at: null,
    }

    const normalized = normalizeAutomationContentDates({
      previous: null,
      next: draftContent,
      todayYmd,
      project: automationProject,
    })
    const links = normalizeContentLinks(normalized.links_json)
    const errs = validateContentRules({
      dueClientAt: normalized.due_client_at,
      dueEditorAt: normalized.due_editor_at,
      status: normalized.status,
      unitPrice: Number(normalized.unit_price),
      billable: Boolean(normalized.billable_flag),
      materialStatus: normalized.material_status,
      draftStatus: normalized.draft_status,
      finalStatus: normalized.final_status,
      assigneeEditorUserId: normalized.assignee_editor_user_id,
      assigneeCheckerUserId: normalized.assignee_checker_user_id,
      nextAction: normalized.next_action,
      revisionCount: Number(normalized.revision_count ?? 0),
      estimatedCost: Number(normalized.estimated_cost ?? 0),
      links,
    })
    if (errs.length > 0) return flashError(errs[0])

    const payload: Record<string, unknown> = {
      id: normalized.id,
      org_id: orgId,
      client_id: project.client_id,
      project_id: project.id,
      project_name: project.name,
      title: normalized.title,
      due_client_at: normalized.due_client_at,
      due_editor_at: normalized.due_editor_at,
      publish_at: normalized.publish_at,
      status: normalized.status,
      thumbnail_done: false,
      billable_flag: normalized.billable_flag,
      delivery_month: normalized.delivery_month,
      unit_price: normalized.unit_price,
      invoice_id: null,
      sequence_no: null,
      assignee_editor_user_id: normalized.assignee_editor_user_id,
      assignee_checker_user_id: normalized.assignee_checker_user_id,
      revision_count: normalized.revision_count ?? 0,
      workload_points: 1,
      estimated_cost: normalized.estimated_cost ?? 0,
      next_action: normalized.next_action,
      blocked_reason: normalized.blocked_reason,
      material_status: normalized.material_status,
      draft_status: normalized.draft_status,
      final_status: normalized.final_status,
      health_score: normalized.health_score ?? buildContentHealthScore({
        dueClientAt: normalized.due_client_at,
        dueEditorAt: normalized.due_editor_at,
        status: normalized.status,
        unitPrice: Number(normalized.unit_price),
        billable: Boolean(normalized.billable_flag),
        materialStatus: normalized.material_status,
        draftStatus: normalized.draft_status,
        finalStatus: normalized.final_status,
        assigneeEditorUserId: normalized.assignee_editor_user_id,
        assigneeCheckerUserId: normalized.assignee_checker_user_id,
        nextAction: normalized.next_action,
        revisionCount: Number(normalized.revision_count ?? 0),
        estimatedCost: Number(normalized.estimated_cost ?? 0),
        links,
        todayYmd,
      }),
      links_json: links,
      editor_submitted_at: null,
      client_submitted_at: null,
    }

    setCreateContentBusy(true)
    clearUi()
    let inserted = false
    try {
      let insertError: { message: string } | null = null
    let insertResult = await supabase.from("contents").insert(payload)
    insertError = insertResult.error ? { message: insertResult.error.message } : null
    if (
      insertError &&
      (isMissingContentsLinksJsonColumn(insertError.message) ||
        isMissingContentsWorkItemFieldsColumn(insertError.message))
    ) {
      insertResult = await supabase.from("contents").insert(
        sanitizeContentWritePayload(payload, {
          supportsLinksJson: !isMissingContentsLinksJsonColumn(insertError.message),
          supportsWorkItemFields: !isMissingContentsWorkItemFieldsColumn(insertError.message),
        })
      )
      insertError = insertResult.error ? { message: insertResult.error.message } : null
      if (
        insertError &&
        (isMissingContentsLinksJsonColumn(insertError.message) ||
          isMissingContentsWorkItemFieldsColumn(insertError.message))
      ) {
        insertResult = await supabase.from("contents").insert(
          sanitizeContentWritePayload(payload, {
            supportsLinksJson: false,
            supportsWorkItemFields: false,
          })
        )
        insertError = insertResult.error ? { message: insertResult.error.message } : null
      }
    }
      if (insertError) {
        return flashError(insertError.message)
      }

      inserted = true
      await syncAutomationArtifacts({ db: supabase, orgId, previous: null, next: normalized, project: automationProject, todayYmd })
    setNewContent({
      title: "",
      dueClientAt: todayYmd,
      unitPrice: "",
      status: "not_started",
      billable: true,
      assigneeEditorUserId: "",
      assigneeCheckerUserId: "",
    })
    flashSuccess("コンテンツを追加しました。")
    setTab("contents")
    await refresh()
    } catch (error) {
      if (inserted) {
        setNewContent({
          title: "",
          dueClientAt: todayYmd,
          unitPrice: "",
          status: "not_started",
          billable: true,
          assigneeEditorUserId: "",
          assigneeCheckerUserId: "",
        })
        await refresh()
        return flashError(
          `明細は追加されましたが、自動同期に失敗しました: ${error instanceof Error ? error.message : "unknown error"}`
        )
      }
      return flashError(error instanceof Error ? error.message : "明細の追加に失敗しました。")
    } finally {
      setCreateContentBusy(false)
    }
  }

  /* ─── Clipboard / Navigation helpers ─── */
  const copyToClipboard = async (text: string, successMessage: string) => {
    if (!text.trim()) return
    try { await navigator.clipboard.writeText(text); flashSuccess(successMessage) } catch { flashError("コピーに失敗しました。") }
  }
  const openExternal = (url: string | null) => { if (url && typeof window !== "undefined") window.open(url, "_blank", "noopener,noreferrer") }

  /* ─── ICS Export ─── */
  const exportProjectIcs = () => {
    if (eventRows.length === 0) return flashError("書き出す予定がありません。")
    const lines = [
      "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//NovaLoop//Project Detail Calendar//JA", "CALSCALE:GREGORIAN",
      ...eventRows.flatMap((ev) => {
        const start = toIcsTimestamp(ev.start_at, ev.all_day)
        const end = toIcsTimestamp(ev.end_at || ev.start_at, ev.all_day)
        return ["BEGIN:VEVENT", `UID:${ev.id}@novaloop.local`, `DTSTAMP:${toIcsTimestamp(new Date().toISOString(), false)}`, ev.all_day ? `DTSTART;VALUE=DATE:${start}` : `DTSTART:${start}`, ev.all_day ? `DTEND;VALUE=DATE:${end}` : `DTEND:${end}`, `SUMMARY:${escapeIcsText(ev.title)}`, `DESCRIPTION:${escapeIcsText(eventType[ev.event_type] ?? ev.event_type)}`, "END:VEVENT"]
      }),
      "END:VCALENDAR",
    ]
    const blob = new Blob([lines.join("\r\n")], { type: "text/calendar;charset=utf-8" })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement("a")
    anchor.href = url
    anchor.download = `novaloop-${safeFileToken(project.name)}-calendar.ics`
    anchor.click()
    URL.revokeObjectURL(url)
    flashSuccess("プロジェクトの ICS を書き出しました。")
  }

  /* ─── Template Text ─── */
  const buildTemplateLine = (row: typeof rows[number]) => {
    const assignee = memberName.get(row.assignee_editor_user_id ?? "") ?? "未設定"
    return `- ${row.title} / 先方納期 ${row.due_client_at} / 編集担当 ${assignee} / ステータス ${CONTENT_STATUS_LABELS[row.status] ?? row.status}`
  }
  const delayedNoticeTemplate = `【進行確認】${summary.clientName} / ${project.name}\n遅延案件の状況確認をお願いします。\n${delayedRows.slice(0, 5).map(buildTemplateLine).join("\n")}\n必要であれば ETA と次アクションをこのスレッドに返信してください。${delayedRows.length > 5 ? `\nほか ${delayedRows.length - 5} 件あり。` : ""}`
  const submitCheckTemplate = `【本日提出確認】${summary.clientName} / ${project.name}\n本日確認したい案件です。\n${todayDueRows.slice(0, 5).map(buildTemplateLine).join("\n")}\n提出可否と懸念点があればこのまま返信してください。${todayDueRows.length > 5 ? `\nほか ${todayDueRows.length - 5} 件あり。` : ""}`

  const chatworkRoomUrl = buildChatworkRoomUrl(d.chatworkRoomId)
  const googleCalendarUrl = buildGoogleCalendarUrl(d.googleCalendarId)
  const driveFolderUrl = d.driveFolderUrl.trim()

  /* ================================================================ */
  /* Tab Views                                                        */
  /* ================================================================ */

  const overviewView = (
    <>
      <ProjectSection title="基本情報">
        <div style={{ display: "grid", gap: 10, gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))" }}>
          <label style={{ display: "grid", gap: 6 }}><span>コード</span><input value={d.code} onChange={(e) => setDraft((p) => ({ ...p, code: e.target.value }))} disabled={!canEdit} style={{ ...inputStyle, opacity: !canEdit ? 0.85 : 1 }} /></label>
          <label style={{ display: "grid", gap: 6 }}><span>案件名</span><input value={d.name} onChange={(e) => setDraft((p) => ({ ...p, name: e.target.value }))} disabled={!canEdit} style={{ ...inputStyle, opacity: !canEdit ? 0.85 : 1 }} /></label>
          <label style={{ display: "grid", gap: 6 }}><span>クライアント</span><input value={summary.clientName} disabled style={{ ...inputStyle, opacity: 0.8 }} /></label>
          <label style={{ display: "grid", gap: 6 }}><span>ステータス</span><select value={d.status} onChange={(e) => setDraft((p) => ({ ...p, status: e.target.value }))} disabled={!canEdit} style={{ ...inputStyle, opacity: !canEdit ? 0.85 : 1 }}>{!PROJECT_STATUS_LABELS[d.status] && <option value={d.status}>{d.status}</option>}{PROJECT_STATUS_OPTIONS.map(({ value: v, label: l }) => <option key={v} value={v}>{l}</option>)}</select></label>
          <label style={{ display: "grid", gap: 6 }}><span>契約形態</span><select value={d.contractType} onChange={(e) => setDraft((p) => ({ ...p, contractType: e.target.value }))} disabled={!canEdit} style={{ ...inputStyle, opacity: !canEdit ? 0.85 : 1 }}>{Object.entries(contractLabels).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
          <label style={{ display: "grid", gap: 6 }}><span>責任者</span><select value={d.ownerUserId} onChange={(e) => setDraft((p) => ({ ...p, ownerUserId: e.target.value }))} disabled={!canEdit} style={{ ...inputStyle, opacity: !canEdit ? 0.85 : 1 }}><option value="">未設定</option>{members.map((m) => <option key={m.userId} value={m.userId}>{m.displayName || m.email || m.userId}</option>)}</select></label>
          <label style={{ display: "grid", gap: 6 }}><span>開始日</span><input type="date" value={d.startDate} onChange={(e) => setDraft((p) => ({ ...p, startDate: e.target.value }))} disabled={!canEdit} style={{ ...inputStyle, opacity: !canEdit ? 0.85 : 1 }} /></label>
          <label style={{ display: "grid", gap: 6 }}><span>終了日</span><input type="date" value={d.endDate} onChange={(e) => setDraft((p) => ({ ...p, endDate: e.target.value }))} disabled={!canEdit} style={{ ...inputStyle, opacity: !canEdit ? 0.85 : 1 }} /></label>
          <label style={{ display: "grid", gap: 6, gridColumn: "1 / -1" }}><span>メモ</span><textarea value={d.notes} onChange={(e) => setDraft((p) => ({ ...p, notes: e.target.value }))} rows={4} disabled={!canEdit} style={{ ...inputStyle, resize: "vertical", opacity: !canEdit ? 0.85 : 1 }} /></label>
        </div>
        {!canEdit && (
          <p style={{ marginTop: 12, marginBottom: 0, fontSize: 13, color: "var(--muted)" }}>案件の編集には「制作の更新（contents_write）」権限が必要です。</p>
        )}
        {canEdit && (
          <div style={{ marginTop: 12 }}>
            <button type="button" onClick={() => void saveProject()} disabled={busy} style={buttonPrimaryStyle}>{busy ? "保存中..." : "保存する"}</button>
          </div>
        )}
      </ProjectSection>

      {/* ── Rate Card (単価表) with CRUD ── */}
      <ProjectSection title="単価表" description="案件で請ける単価を登録します。コンテンツ作成時の初期値として使えます。">
        {canEdit && (
          <div style={{ display: "grid", gap: 10, gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", padding: "14px 16px", borderRadius: 14, border: "1px solid var(--border)", background: "var(--surface-2)", marginBottom: 14 }}>
            <label style={{ display: "grid", gap: 4 }}>
              <span style={{ fontSize: 12, color: "var(--muted)", fontWeight: 600 }}>項目名 *</span>
              <input value={rateCardDraft.itemType} onChange={(e) => setRateCardDraft((p) => ({ ...p, itemType: e.target.value }))} placeholder="例: ショート動画編集" style={inputStyle} />
            </label>
            <label style={{ display: "grid", gap: 4 }}>
              <span style={{ fontSize: 12, color: "var(--muted)", fontWeight: 600 }}>単位</span>
              <input value={rateCardDraft.unitLabel} onChange={(e) => setRateCardDraft((p) => ({ ...p, unitLabel: e.target.value }))} placeholder="本" style={inputStyle} />
            </label>
            <label style={{ display: "grid", gap: 4 }}>
              <span style={{ fontSize: 12, color: "var(--muted)", fontWeight: 600 }}>売上単価</span>
              <input type="number" min="0" value={rateCardDraft.salesUnitPrice} onChange={(e) => setRateCardDraft((p) => ({ ...p, salesUnitPrice: e.target.value }))} placeholder="0" style={inputStyle} />
            </label>
            <label style={{ display: "grid", gap: 4 }}>
              <span style={{ fontSize: 12, color: "var(--muted)", fontWeight: 600 }}>原価</span>
              <input type="number" min="0" value={rateCardDraft.standardCost} onChange={(e) => setRateCardDraft((p) => ({ ...p, standardCost: e.target.value }))} placeholder="0" style={inputStyle} />
            </label>
            <label style={{ display: "grid", gap: 4 }}>
              <span style={{ fontSize: 12, color: "var(--muted)", fontWeight: 600 }}>適用開始</span>
              <input type="date" value={rateCardDraft.effectiveFrom} onChange={(e) => setRateCardDraft((p) => ({ ...p, effectiveFrom: e.target.value }))} style={inputStyle} />
            </label>
            <label style={{ display: "grid", gap: 4 }}>
              <span style={{ fontSize: 12, color: "var(--muted)", fontWeight: 600 }}>適用終了</span>
              <input type="date" value={rateCardDraft.effectiveTo} onChange={(e) => setRateCardDraft((p) => ({ ...p, effectiveTo: e.target.value }))} style={inputStyle} />
            </label>
            <div style={{ display: "flex", gap: 8, alignItems: "end", gridColumn: "1 / -1" }}>
              <button type="button" onClick={() => void saveRateCard()} disabled={rateCardBusy} style={buttonPrimaryStyle}>
                {rateCardBusy ? "保存中..." : rateCardDraft.id ? "単価を更新" : "単価を追加"}
              </button>
              {rateCardDraft.id && (
                <button type="button" onClick={() => setRateCardDraft(emptyRateCard)} style={buttonSecondaryStyle}>キャンセル</button>
              )}
            </div>
          </div>
        )}
        <div style={{ overflowX: "auto" }}>
          <table style={{ ...tableStyle, minWidth: 720 }}>
            <thead>
              <tr>
                <th style={thStyle}>項目</th>
                <th style={thStyle}>単位</th>
                <th style={thStyle}>売上単価</th>
                <th style={thStyle}>原価</th>
                <th style={thStyle}>粗利</th>
                <th style={thStyle}>適用開始</th>
                <th style={thStyle}>適用終了</th>
                {canEdit && <th style={thStyle}>操作</th>}
              </tr>
            </thead>
            <tbody>
              {cardRows.map((r) => {
                const gross = Number(r.sales_unit_price ?? 0) - Number(r.standard_cost ?? 0)
                return (
                  <tr key={r.id}>
                    <td style={tdStyle}>{r.item_type}</td>
                    <td style={tdStyle}>{r.unit_label}</td>
                    <td style={tdStyle}>{formatCurrency(Number(r.sales_unit_price ?? 0))}</td>
                    <td style={tdStyle}>{formatCurrency(Number(r.standard_cost ?? 0))}</td>
                    <td style={{ ...tdStyle, color: gross < 0 ? "var(--error-text)" : "var(--text)", fontWeight: 600 }}>{formatCurrency(gross)}</td>
                    <td style={tdStyle}>{r.effective_from}</td>
                    <td style={tdStyle}>{r.effective_to || "-"}</td>
                    {canEdit && (
                      <td style={tdStyle}>
                        <div style={{ display: "flex", gap: 6 }}>
                          <button type="button" onClick={() => editRateCard(r)} style={{ ...buttonSecondaryStyle, padding: "4px 10px", fontSize: 12 }}>編集</button>
                          <button type="button" onClick={() => void deleteRateCard(r.id)} disabled={rateCardBusy} style={{ ...buttonSecondaryStyle, padding: "4px 10px", fontSize: 12, color: "var(--error-text)", borderColor: "var(--error-text)" }}>削除</button>
                        </div>
                      </td>
                    )}
                  </tr>
                )
              })}
              {cardRows.length === 0 && (
                <tr><td colSpan={canEdit ? 8 : 7} style={tdStyle}>単価表はありません。上のフォームから追加してください。</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </ProjectSection>
    </>
  )

  const contentsView = (
    <ProjectSection title="コンテンツ" description="案件配下の請求対象明細をこのタブで管理します。">
      {canEdit && (
        <div style={{ display: "grid", gap: 10, gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", padding: "14px 16px", borderRadius: 14, border: "1px solid var(--border)", background: "var(--surface-2)", marginBottom: 14 }}>
          <label style={{ display: "grid", gap: 4, gridColumn: "span 2" }}>
            <span style={{ fontSize: 12, color: "var(--muted)", fontWeight: 600 }}>タイトル *</span>
            <input value={newContent.title} onChange={(e) => setNewContent((prev) => ({ ...prev, title: e.target.value }))} placeholder="例: 4月1本目" style={inputStyle} />
          </label>
          <label style={{ display: "grid", gap: 4 }}>
            <span style={{ fontSize: 12, color: "var(--muted)", fontWeight: 600 }}>先方納期</span>
            <input type="date" value={newContent.dueClientAt} onChange={(e) => setNewContent((prev) => ({ ...prev, dueClientAt: e.target.value }))} style={inputStyle} />
          </label>
          <label style={{ display: "grid", gap: 4 }}>
            <span style={{ fontSize: 12, color: "var(--muted)", fontWeight: 600 }}>単価</span>
            <input type="number" min="0" value={newContent.unitPrice} onChange={(e) => setNewContent((prev) => ({ ...prev, unitPrice: e.target.value }))} placeholder="0" style={inputStyle} />
          </label>
          <label style={{ display: "grid", gap: 4 }}>
            <span style={{ fontSize: 12, color: "var(--muted)", fontWeight: 600 }}>ステータス</span>
            <select value={newContent.status} onChange={(e) => setNewContent((prev) => ({ ...prev, status: e.target.value }))} style={inputStyle}>
              {CONTENT_WORKFLOW_STATUS_OPTIONS.map(({ value, label }) => <option key={value} value={value}>{label}</option>)}
            </select>
          </label>
          <label style={{ display: "grid", gap: 4 }}>
            <span style={{ fontSize: 12, color: "var(--muted)", fontWeight: 600 }}>編集担当</span>
            <select value={newContent.assigneeEditorUserId} onChange={(e) => setNewContent((prev) => ({ ...prev, assigneeEditorUserId: e.target.value }))} style={inputStyle}>
              <option value="">未設定</option>
              {members.map((m) => <option key={m.userId} value={m.userId}>{m.displayName || m.email || m.userId}</option>)}
            </select>
          </label>
          <label style={{ display: "grid", gap: 4 }}>
            <span style={{ fontSize: 12, color: "var(--muted)", fontWeight: 600 }}>確認担当</span>
            <select value={newContent.assigneeCheckerUserId} onChange={(e) => setNewContent((prev) => ({ ...prev, assigneeCheckerUserId: e.target.value }))} style={inputStyle}>
              <option value="">未設定</option>
              {members.map((m) => <option key={m.userId} value={m.userId}>{m.displayName || m.email || m.userId}</option>)}
            </select>
          </label>
          <label style={{ display: "flex", alignItems: "center", gap: 8, alignSelf: "end", paddingBottom: 10 }}>
            <input type="checkbox" checked={newContent.billable} onChange={(e) => setNewContent((prev) => ({ ...prev, billable: e.target.checked }))} />
            <span style={{ fontSize: 13, color: "var(--text)", fontWeight: 600 }}>請求対象</span>
          </label>
          <div style={{ display: "flex", gap: 8, alignItems: "end", gridColumn: "1 / -1" }}>
            <button type="button" onClick={() => void createContent()} disabled={createContentBusy} style={buttonPrimaryStyle}>
              {createContentBusy ? "追加中..." : "明細を追加"}
            </button>
          </div>
        </div>
      )}

      <div style={{ display: "grid", gap: 10, gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))" }}>
        <label style={{ display: "grid", gap: 4 }}><span style={{ fontSize: 12, color: "var(--muted)", fontWeight: 600 }}>日程調整(日)</span><input type="number" value={bulkShift} onChange={(e) => setBulkShift(e.target.value)} style={inputStyle} /></label>
        <label style={{ display: "grid", gap: 4 }}><span style={{ fontSize: 12, color: "var(--muted)", fontWeight: 600 }}>ステータス</span><select value={bulkStatus} onChange={(e) => setBulkStatus(e.target.value)} style={inputStyle}><option value="">変更しない</option>{CONTENT_WORKFLOW_STATUS_OPTIONS.map(({ value: v, label: l }) => <option key={v} value={v}>{l}</option>)}</select></label>
        <label style={{ display: "grid", gap: 4 }}><span style={{ fontSize: 12, color: "var(--muted)", fontWeight: 600 }}>編集担当</span><select value={bulkEditor} onChange={(e) => setBulkEditor(e.target.value)} style={inputStyle}><option value="">変更しない</option>{members.map((m) => <option key={m.userId} value={m.userId}>{m.displayName || m.email || m.userId}</option>)}</select></label>
        <label style={{ display: "grid", gap: 4 }}><span style={{ fontSize: 12, color: "var(--muted)", fontWeight: 600 }}>確認担当</span><select value={bulkChecker} onChange={(e) => setBulkChecker(e.target.value)} style={inputStyle}><option value="">変更しない</option>{members.map((m) => <option key={m.userId} value={m.userId}>{m.displayName || m.email || m.userId}</option>)}</select></label>
        <label style={{ display: "grid", gap: 4 }}><span style={{ fontSize: 12, color: "var(--muted)", fontWeight: 600 }}>請求対象</span><select value={bulkBillable} onChange={(e) => setBulkBillable(e.target.value as typeof bulkBillable)} style={inputStyle}><option value="keep">変更しない</option><option value="true">対象</option><option value="false">対象外</option></select></label>
        <label style={{ display: "grid", gap: 4 }}><span style={{ fontSize: 12, color: "var(--muted)", fontWeight: 600 }}>単価</span><input type="number" min="0" value={bulkUnitPrice} onChange={(e) => setBulkUnitPrice(e.target.value)} placeholder="変更しない" style={inputStyle} /></label>
      </div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 12 }}>
        <button type="button" onClick={() => void applyBulk()} disabled={busy} style={buttonPrimaryStyle}>{busy ? "更新中..." : `一括更新${selectedIds.length > 0 ? ` (${selectedIds.length}件)` : ""}`}</button>
      </div>
      <div style={{ marginTop: 14, overflowX: "auto" }}>
        <table style={{ ...tableStyle, minWidth: 1280 }}>
          <thead>
            <tr>
              {["", "タイトル", "ステータス", "先方納期", "編集納期", "公開日", "単価", "編集担当", "確認担当", "修正回数", "請求対象", "健全性"].map((l) => <th key={l} style={thStyle}>{l}</th>)}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} style={{ background: highlightContentId === r.id ? "color-mix(in srgb, var(--primary) 10%, var(--surface))" : isContentClientOverdue(r.status, r.due_client_at, todayYmd, r.client_submitted_at) ? "rgba(254, 242, 242, 0.5)" : undefined }}>
                <td style={tdStyle}><input type="checkbox" checked={selectedIds.includes(r.id)} onChange={() => setSelectedIds((p) => p.includes(r.id) ? p.filter((x) => x !== r.id) : [...p, r.id])} /></td>
                <td style={{ ...tdStyle, fontWeight: 600 }}>{r.title}</td>
                <td style={tdStyle}>
                  <span style={{ display: "inline-flex", padding: "2px 8px", borderRadius: 999, fontSize: 11, fontWeight: 600, background: r.status === "delivered" || r.status === "published" ? "#ecfdf5" : "var(--surface-2)", color: r.status === "delivered" || r.status === "published" ? "#166534" : "var(--text)", border: `1px solid ${r.status === "delivered" || r.status === "published" ? "#86efac" : "var(--border)"}` }}>
                    {CONTENT_STATUS_LABELS[r.status] ?? r.status}
                  </span>
                </td>
                <td style={{ ...tdStyle, color: isContentClientOverdue(r.status, r.due_client_at, todayYmd, r.client_submitted_at) ? "var(--error-text)" : undefined, fontWeight: isContentClientOverdue(r.status, r.due_client_at, todayYmd, r.client_submitted_at) ? 700 : undefined }}>{r.due_client_at}</td>
                <td style={tdStyle}>{r.due_editor_at}</td>
                <td style={tdStyle}>{r.publish_at ? r.publish_at.slice(0, 10) : "-"}</td>
                <td style={{ ...tdStyle, fontWeight: 600, color: Number(r.unit_price ?? 0) === 0 ? "var(--warning-text)" : "var(--text)" }}>
                  {Number(r.unit_price ?? 0) === 0 ? "未設定" : formatCurrency(Number(r.unit_price))}
                </td>
                <td style={tdStyle}>{memberName.get(r.assignee_editor_user_id ?? "") ?? "-"}</td>
                <td style={tdStyle}>{memberName.get(r.assignee_checker_user_id ?? "") ?? "-"}</td>
                <td style={{ ...tdStyle, color: Number(r.revision_count ?? 0) >= 3 ? "var(--warning-text)" : undefined, fontWeight: Number(r.revision_count ?? 0) >= 3 ? 700 : undefined }}>{Number(r.revision_count ?? 0)}</td>
                <td style={tdStyle}>{r.billable_flag ? "対象" : "対象外"}</td>
                <td style={{ ...tdStyle, color: Number(r.health_score ?? 100) < 80 ? "var(--error-text)" : undefined }}>{Number(r.health_score ?? 100)}</td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={12} style={tdStyle}>コンテンツはありません。</td></tr>}
          </tbody>
        </table>
      </div>
    </ProjectSection>
  )

  const tasksView = (
    <ProjectSection title="タスク">
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <Link href={`/timeline?projectId=${encodeURIComponent(project.id)}`} style={{ ...buttonSecondaryStyle, textDecoration: "none" }}>タイムラインを開く</Link>
      </div>
      <div style={{ marginTop: 12, overflowX: "auto" }}>
        <table style={{ ...tableStyle, minWidth: 960 }}>
          <thead><tr><th style={thStyle}>タスク</th><th style={thStyle}>種別</th><th style={thStyle}>担当者</th><th style={thStyle}>開始</th><th style={thStyle}>終了</th><th style={thStyle}>依存</th><th style={thStyle}>ステータス</th></tr></thead>
          <tbody>
            {taskRows.map((r) => (
              <tr key={r.id}>
                <td style={tdStyle}>{r.title}</td>
                <td style={tdStyle}>{taskType[r.task_type] ?? r.task_type}</td>
                <td style={tdStyle}>{memberName.get(r.assignee_user_id ?? "") ?? "-"}</td>
                <td style={tdStyle}>{r.planned_start_date || "-"}</td>
                <td style={{ ...tdStyle, color: (r.planned_end_date || r.planned_start_date || "") < todayYmd && r.status !== "done" ? "var(--error-text)" : tdStyle.color }}>{r.planned_end_date || "-"}</td>
                <td style={tdStyle}>{taskName.get(r.dependency_task_id ?? "") ?? "-"}</td>
                <td style={tdStyle}>{taskStatus[r.status] ?? r.status}</td>
              </tr>
            ))}
            {taskRows.length === 0 && <tr><td colSpan={7} style={tdStyle}>タスクはありません。</td></tr>}
          </tbody>
        </table>
      </div>
    </ProjectSection>
  )

  const calendarView = (
    <ProjectSection title="カレンダー">
      <Link href={`/calendar?projectId=${encodeURIComponent(project.id)}`} style={{ ...buttonSecondaryStyle, textDecoration: "none" }}>カレンダーを開く</Link>
      <div style={{ marginTop: 12, overflowX: "auto" }}>
        <table style={{ ...tableStyle, minWidth: 860 }}>
          <thead><tr><th style={thStyle}>開始</th><th style={thStyle}>終了</th><th style={thStyle}>種別</th><th style={thStyle}>タイトル</th></tr></thead>
          <tbody>
            {eventRows.slice(0, 20).map((r) => (
              <tr key={r.id}><td style={tdStyle}>{formatDateTime(r.start_at, r.all_day)}</td><td style={tdStyle}>{formatDateTime(r.end_at, r.all_day)}</td><td style={tdStyle}>{eventType[r.event_type] ?? r.event_type}</td><td style={tdStyle}>{r.title}</td></tr>
            ))}
            {eventRows.length === 0 && <tr><td colSpan={4} style={tdStyle}>予定はありません。</td></tr>}
          </tbody>
        </table>
      </div>
    </ProjectSection>
  )

  const materialsView = (
    <ProjectSection title="素材">
      <Link href={`/materials?projectId=${encodeURIComponent(project.id)}`} style={{ ...buttonSecondaryStyle, textDecoration: "none" }}>素材管理を開く</Link>
      <div style={{ marginTop: 12, overflowX: "auto" }}>
        <table style={{ ...tableStyle, minWidth: 860 }}>
          <thead><tr><th style={thStyle}>作成日</th><th style={thStyle}>種別</th><th style={thStyle}>タイトル</th><th style={thStyle}>版</th></tr></thead>
          <tbody>
            {assetRows.slice(0, 20).map((r) => (
              <tr key={r.id}><td style={tdStyle}>{formatDateTime(r.created_at)}</td><td style={tdStyle}>{assetType[r.asset_type] ?? r.asset_type}</td><td style={tdStyle}>{r.title}</td><td style={tdStyle}>v{r.version_no}</td></tr>
            ))}
            {assetRows.length === 0 && <tr><td colSpan={4} style={tdStyle}>素材はありません。</td></tr>}
          </tbody>
        </table>
      </div>
    </ProjectSection>
  )

  const changesView = (
    <ProjectSection title="変更履歴">
      <Link href={`/changes?projectId=${encodeURIComponent(project.id)}`} style={{ ...buttonSecondaryStyle, textDecoration: "none" }}>変更履歴を開く</Link>
      <div style={{ marginTop: 12, overflowX: "auto" }}>
        <table style={{ ...tableStyle, minWidth: 980 }}>
          <thead><tr><th style={thStyle}>作成日</th><th style={thStyle}>種別</th><th style={thStyle}>概要</th><th style={thStyle}>影響</th><th style={thStyle}>ステータス</th></tr></thead>
          <tbody>
            {changeRows.slice(0, 20).map((r) => (
              <tr key={r.id}><td style={tdStyle}>{formatDateTime(r.created_at)}</td><td style={tdStyle}>{changeType[r.request_type] ?? r.request_type}</td><td style={tdStyle}>{r.summary}</td><td style={tdStyle}>{impactLabels[r.impact_level] ?? r.impact_level}</td><td style={tdStyle}>{r.status}</td></tr>
            ))}
            {changeRows.length === 0 && <tr><td colSpan={5} style={tdStyle}>変更履歴はありません。</td></tr>}
          </tbody>
        </table>
      </div>
    </ProjectSection>
  )

  const financeView = canViewFinance ? (
    <ProjectSection title="収支">
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12 }}>
        <ProjectInfoCard label="売上" value={formatCurrency(summary.monthlySales)} />
        <ProjectInfoCard label="外注原価" value={formatCurrency(summary.monthlyVendorCost)} />
        <ProjectInfoCard label="経費" value={formatCurrency(summary.monthlyExpenses)} />
        <ProjectInfoCard label="粗利" value={formatCurrency(summary.grossProfit)} accent={summary.grossProfit < 0 ? "var(--error-text)" : undefined} />
        <ProjectInfoCard label="粗利率" value={pct(summary.marginRate)} accent={(summary.marginRate ?? 1) < 0.35 ? "var(--warning-text)" : undefined} />
      </div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 12 }}>
        <Link href={`/profitability?projectId=${encodeURIComponent(project.id)}`} style={{ ...buttonSecondaryStyle, textDecoration: "none" }}>収支ダッシュボードを開く</Link>
      </div>
      <div style={{ marginTop: 14, overflowX: "auto" }}>
        <table style={{ ...tableStyle, minWidth: 680 }}>
          <thead><tr><th style={thStyle}>月</th><th style={thStyle}>売上</th><th style={thStyle}>原価</th><th style={thStyle}>経費</th><th style={thStyle}>粗利</th></tr></thead>
          <tbody>
            {monthlyTrend.map((r) => (
              <tr key={r.month}><td style={tdStyle}>{r.month}</td><td style={tdStyle}>{formatCurrency(r.sales)}</td><td style={tdStyle}>{formatCurrency(r.cost)}</td><td style={tdStyle}>{formatCurrency(r.expense)}</td><td style={{ ...tdStyle, color: r.gross < 0 ? "var(--error-text)" : tdStyle.color }}>{formatCurrency(r.gross)}</td></tr>
            ))}
            {monthlyTrend.length === 0 && <tr><td colSpan={5} style={tdStyle}>収支データはありません。</td></tr>}
          </tbody>
        </table>
      </div>
      <div style={{ marginTop: 14, overflowX: "auto" }}>
        <table style={{ ...tableStyle, minWidth: 980 }}>
          <thead><tr><th style={thStyle}>コンテンツ</th><th style={thStyle}>納期</th><th style={thStyle}>ステータス</th><th style={thStyle}>売上</th><th style={thStyle}>原価</th><th style={thStyle}>経費</th><th style={thStyle}>粗利</th><th style={thStyle}>粗利率</th><th style={thStyle}>修正回数</th><th style={thStyle}>健全性</th></tr></thead>
          <tbody>
            {profitRows.map((r) => (
              <tr key={r.id}>
                <td style={tdStyle}>{r.title}</td><td style={tdStyle}>{r.due}</td><td style={tdStyle}>{r.status}</td>
                <td style={tdStyle}>{formatCurrency(r.sales)}</td><td style={tdStyle}>{formatCurrency(r.cost)}</td><td style={tdStyle}>{formatCurrency(r.expense)}</td>
                <td style={{ ...tdStyle, color: r.gross < 0 ? "var(--error-text)" : tdStyle.color }}>{formatCurrency(r.gross)}</td>
                <td style={{ ...tdStyle, color: (r.margin ?? 1) < 0.35 ? "var(--warning-text)" : tdStyle.color }}>{pct(r.margin)}</td>
                <td style={tdStyle}>{r.revision}</td><td style={tdStyle}>{r.health}</td>
              </tr>
            ))}
            {profitRows.length === 0 && <tr><td colSpan={10} style={tdStyle}>コンテンツ別収支データはありません。</td></tr>}
          </tbody>
        </table>
      </div>
    </ProjectSection>
  ) : (
    <ProjectSection title="収支">オーナー / 経営補佐のみ閲覧できます。</ProjectSection>
  )

  const integrationsView = (
    <ProjectSection title="連携" description="保存だけでなく、その場で開く・コピーする・共有する操作をここで行えます。">
      <div style={{ display: "grid", gap: 10, gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))" }}>
        <label style={{ display: "grid", gap: 6 }}><span>Chatwork ルーム</span><input value={d.chatworkRoomId} onChange={(e) => setDraft((p) => ({ ...p, chatworkRoomId: e.target.value }))} disabled={!canEdit} style={{ ...inputStyle, opacity: !canEdit ? 0.85 : 1 }} /></label>
        <label style={{ display: "grid", gap: 6 }}><span>Google カレンダー</span><input value={d.googleCalendarId} onChange={(e) => setDraft((p) => ({ ...p, googleCalendarId: e.target.value }))} disabled={!canEdit} style={{ ...inputStyle, opacity: !canEdit ? 0.85 : 1 }} /></label>
        <label style={{ display: "grid", gap: 6 }}><span>Slack チャンネル</span><input value={d.slackChannelId} onChange={(e) => setDraft((p) => ({ ...p, slackChannelId: e.target.value }))} disabled={!canEdit} style={{ ...inputStyle, opacity: !canEdit ? 0.85 : 1 }} /></label>
        <label style={{ display: "grid", gap: 6 }}><span>Discord チャンネル</span><input value={d.discordChannelId} onChange={(e) => setDraft((p) => ({ ...p, discordChannelId: e.target.value }))} disabled={!canEdit} style={{ ...inputStyle, opacity: !canEdit ? 0.85 : 1 }} /></label>
        <label style={{ display: "grid", gap: 6, gridColumn: "1 / -1" }}><span>ドライブフォルダURL</span><input value={d.driveFolderUrl} onChange={(e) => setDraft((p) => ({ ...p, driveFolderUrl: e.target.value }))} disabled={!canEdit} style={{ ...inputStyle, opacity: !canEdit ? 0.85 : 1 }} /></label>
      </div>
      <div style={{ display: "grid", gap: 10, marginTop: 14 }}>
        {/* Chatwork */}
        <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap", padding: "12px 14px", borderRadius: 16, border: "1px solid var(--border)", background: "var(--surface-2)" }}>
          <div style={{ display: "grid", gap: 4 }}><strong>Chatwork</strong><span style={{ fontSize: 13, color: "var(--muted)" }}>{d.chatworkRoomId.trim() || "未設定"}</span></div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button type="button" onClick={() => void copyToClipboard(d.chatworkRoomId, "Chatwork ルームIDをコピーしました。")} disabled={!d.chatworkRoomId.trim()} style={quickActionStyle(Boolean(d.chatworkRoomId.trim()))}>IDをコピー</button>
            <button type="button" onClick={() => openExternal(chatworkRoomUrl)} disabled={!chatworkRoomUrl} style={quickActionStyle(Boolean(chatworkRoomUrl))}>ルームを開く</button>
          </div>
        </div>
        {/* Google Calendar */}
        <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap", padding: "12px 14px", borderRadius: 16, border: "1px solid var(--border)", background: "var(--surface-2)" }}>
          <div style={{ display: "grid", gap: 4 }}><strong>Google カレンダー</strong><span style={{ fontSize: 13, color: "var(--muted)" }}>{d.googleCalendarId.trim() || "未設定"} / 予定 {eventRows.length} 件</span></div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button type="button" onClick={() => void copyToClipboard(d.googleCalendarId, "Google カレンダーIDをコピーしました。")} disabled={!d.googleCalendarId.trim()} style={quickActionStyle(Boolean(d.googleCalendarId.trim()))}>IDをコピー</button>
            <button type="button" onClick={() => openExternal(googleCalendarUrl)} disabled={!googleCalendarUrl} style={quickActionStyle(Boolean(googleCalendarUrl))}>Google を開く</button>
            <button type="button" onClick={exportProjectIcs} disabled={eventRows.length === 0} style={quickActionStyle(eventRows.length > 0)}>ICSを書き出す</button>
            <Link href={`/calendar?projectId=${encodeURIComponent(project.id)}`} style={{ ...buttonSecondaryStyle, textDecoration: "none" }}>カレンダーを開く</Link>
          </div>
        </div>
        {/* Slack / Discord */}
        <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap", padding: "12px 14px", borderRadius: 16, border: "1px solid var(--border)", background: "var(--surface-2)" }}>
          <div style={{ display: "grid", gap: 4 }}><strong>Slack / Discord</strong><span style={{ fontSize: 13, color: "var(--muted)" }}>チャンネルIDをそのまま共有に使えます。</span></div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button type="button" onClick={() => void copyToClipboard(d.slackChannelId, "Slack チャンネルIDをコピーしました。")} disabled={!d.slackChannelId.trim()} style={quickActionStyle(Boolean(d.slackChannelId.trim()))}>Slack をコピー</button>
            <button type="button" onClick={() => void copyToClipboard(d.discordChannelId, "Discord チャンネルIDをコピーしました。")} disabled={!d.discordChannelId.trim()} style={quickActionStyle(Boolean(d.discordChannelId.trim()))}>Discord をコピー</button>
          </div>
        </div>
        {/* Drive */}
        <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap", padding: "12px 14px", borderRadius: 16, border: "1px solid var(--border)", background: "var(--surface-2)" }}>
          <div style={{ display: "grid", gap: 4 }}><strong>Drive</strong><span style={{ fontSize: 13, color: "var(--muted)" }}>{driveFolderUrl || "未設定"}</span></div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button type="button" onClick={() => void copyToClipboard(d.driveFolderUrl, "Drive フォルダURLをコピーしました。")} disabled={!driveFolderUrl} style={quickActionStyle(Boolean(driveFolderUrl))}>URLをコピー</button>
            <button type="button" onClick={() => openExternal(driveFolderUrl || null)} disabled={!driveFolderUrl} style={quickActionStyle(Boolean(driveFolderUrl))}>フォルダを開く</button>
          </div>
        </div>
        {/* Sharing Templates */}
        <div style={{ display: "grid", gap: 10, padding: "12px 14px", borderRadius: 16, border: "1px solid var(--border)", background: "var(--surface-2)" }}>
          <div style={{ display: "grid", gap: 4 }}>
            <strong>共有テンプレ</strong>
            <span style={{ fontSize: 13, color: "var(--muted)" }}>
              {selectedIds.length > 0 ? `選択中 ${selectedIds.length} 件を優先して作成します。` : "案件全体の進行状況から作成します。"} 遅延 {delayedRows.length} 件 / 本日提出 {todayDueRows.length} 件
            </span>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button type="button" onClick={() => void copyToClipboard(delayedNoticeTemplate, "遅延連絡テンプレをコピーしました。")} disabled={delayedRows.length === 0} style={quickActionStyle(delayedRows.length > 0)}>遅延連絡をコピー</button>
            <button type="button" onClick={() => void copyToClipboard(submitCheckTemplate, "提出確認テンプレをコピーしました。")} disabled={todayDueRows.length === 0} style={quickActionStyle(todayDueRows.length > 0)}>提出確認をコピー</button>
          </div>
        </div>
      </div>
      {canEdit && (
        <div style={{ marginTop: 12 }}>
          <button type="button" onClick={() => void saveProject()} disabled={busy} style={buttonPrimaryStyle}>{busy ? "保存中..." : "連携を保存"}</button>
        </div>
      )}
    </ProjectSection>
  )

  const logView = (
    <ProjectSection title="例外・ログ">
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <Link href={`/exceptions?projectId=${encodeURIComponent(project.id)}`} style={{ ...buttonSecondaryStyle, textDecoration: "none" }}>例外管理を開く</Link>
      </div>
      <div style={{ marginTop: 12, overflowX: "auto" }}>
        <table style={{ ...tableStyle, minWidth: 980 }}>
          <thead><tr><th style={thStyle}>種別</th><th style={thStyle}>タイトル</th><th style={thStyle}>内容</th><th style={thStyle}>重要度</th><th style={thStyle}>ステータス</th><th style={thStyle}>検知日時</th></tr></thead>
          <tbody>
            {runtimeRows.map((r) => (
              <tr key={r.key}>
                <td style={tdStyle}>{exceptionLabels[r.exceptionType] ?? r.exceptionType}</td>
                <td style={tdStyle}>{exceptionLabels[r.exceptionType] ?? r.title}</td>
                <td style={tdStyle}>{r.description && !looksMojibake(r.description) ? r.description : `${exceptionLabels[r.exceptionType] ?? r.exceptionType} を確認してください。`}</td>
                <td style={tdStyle}>{severityLabels[r.severity] ?? r.severity}</td>
                <td style={tdStyle}>{recordStatusLabels.runtime}</td>
                <td style={tdStyle}>{todayYmd}</td>
              </tr>
            ))}
            {storedRows.map((r) => (
              <tr key={r.id}>
                <td style={tdStyle}>{exceptionLabels[r.exception_type] ?? r.exception_type}</td>
                <td style={tdStyle}>{r.title}</td>
                <td style={tdStyle}>{textOrDash(r.description)}</td>
                <td style={tdStyle}>{severityLabels[r.severity] ?? r.severity}</td>
                <td style={tdStyle}>{recordStatusLabels[r.status] ?? r.status}</td>
                <td style={tdStyle}>{formatDateTime(r.detected_at)}</td>
              </tr>
            ))}
            {runtimeRows.length === 0 && storedRows.length === 0 && <tr><td colSpan={6} style={tdStyle}>ログはありません。</td></tr>}
          </tbody>
        </table>
      </div>
    </ProjectSection>
  )

  /* ─── Tab Router ─── */
  const tabViewMap: Record<TabKey, React.ReactNode> = {
    overview: overviewView,
    contents: contentsView,
    tasks: tasksView,
    calendar: calendarView,
    materials: materialsView,
    changes: changesView,
    finance: financeView,
    integrations: integrationsView,
    log: logView,
  }

  /* ================================================================ */
  /* Render                                                           */
  /* ================================================================ */

  return (
    <ProjectShell
      title={project.name}
      description={`${summary.clientName} / 案件詳細`}
      action={
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <Link href="/projects" style={{ ...buttonSecondaryStyle, textDecoration: "none" }}>案件一覧へ戻る</Link>
          <Link href={`/projects/${encodeURIComponent(project.id)}?tab=contents`} style={{ ...buttonSecondaryStyle, textDecoration: "none" }}>コンテンツを開く</Link>
        </div>
      }
    >
      {/* ── KPI Cards ── */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12 }}>
        <ProjectInfoCard label="ステータス" value={PROJECT_STATUS_LABELS[project.status] ?? project.status} />
        <ProjectInfoCard label="契約" value={contractLabels[project.contract_type] ?? project.contract_type} />
        <ProjectInfoCard label="コード" value={textOrDash(project.code)} />
        <ProjectInfoCard label="当月本数" value={`${summary.monthlyContentCount}`} />
        <ProjectInfoCard label="遅延" value={`${summary.delayCount}`} accent={summary.delayCount > 0 ? "var(--error-text)" : undefined} />
        <ProjectInfoCard label="素材不足" value={`${summary.missingMaterialCount}`} accent={summary.missingMaterialCount > 0 ? "var(--warning-text)" : undefined} />
        <ProjectInfoCard label="健全性" value={`${summary.healthAverage}`} accent={summary.healthAverage < 80 ? "var(--error-text)" : undefined} />
        {canViewFinance && <ProjectInfoCard label="粗利" value={formatCurrency(summary.grossProfit)} accent={summary.grossProfit < 0 ? "var(--error-text)" : undefined} />}
        {canViewFinance && <ProjectInfoCard label="粗利率" value={pct(summary.marginRate)} accent={(summary.marginRate ?? 1) < 0.35 ? "var(--warning-text)" : undefined} />}
      </div>

      {/* ── Notifications ── */}
      {(error || uiError || uiSuccess) && (
        <ProjectSection title="お知らせ">
          {error && <div style={{ color: "var(--error-text)" }}>{error}</div>}
          {uiError && <div style={{ color: "var(--error-text)" }}>{uiError}</div>}
          {uiSuccess && <div style={{ color: "var(--success-text)" }}>{uiSuccess}</div>}
        </ProjectSection>
      )}

      {/* ── Tabs ── */}
      <nav className="nav-scroll-hide" style={{
        display: "flex",
        gap: 0,
        border: "1px solid var(--border)",
        borderRadius: 16,
        background: "var(--surface)",
        padding: "0 16px",
        boxShadow: "var(--shadow-lg)",
        overflowX: "auto",
        WebkitOverflowScrolling: "touch",
      }}>
        {tabs.map((name) => {
          const active = tab === name
          return (
            <button
              key={name}
              type="button"
              onClick={() => setTab(name)}
              style={{
                padding: "12px 16px",
                border: "none",
                borderBottom: active ? "2px solid var(--primary)" : "2px solid transparent",
                background: "transparent",
                color: active ? "var(--text)" : "var(--muted)",
                fontWeight: active ? 700 : 500,
                fontSize: 13,
                cursor: "pointer",
                whiteSpace: "nowrap",
                transition: "color 0.15s, border-color 0.15s",
              }}
            >
              {tabLabels[name]}
            </button>
          )
        })}
      </nav>

      {/* ── Active Tab View ── */}
      {tabViewMap[tab]}
    </ProjectShell>
  )
}
