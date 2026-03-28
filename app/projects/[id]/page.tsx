"use client"

import Link from "next/link"
import { useParams } from "next/navigation"
import { useMemo, useState } from "react"
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
import {
  buildContentHealthScore,
  isContentClientOverdue,
  normalizeContentLinks,
  validateContentRules,
} from "@/lib/contentWorkflow"
import {
  normalizeAutomationContentDates,
  shiftIsoDateTimeByDays,
  shiftYmdByDaysAligned,
  syncAutomationArtifacts,
  type AutomationContent,
  type AutomationProject,
} from "@/lib/projectAutomation"
import { supabase } from "@/lib/supabase"

const tabs = ["overview", "contents", "tasks", "calendar", "materials", "changes", "finance", "integrations", "log"] as const
type TabKey = (typeof tabs)[number]

const tabLabels: Record<TabKey, string> = {
  overview: "概要",
  contents: "タスク",
  tasks: "工程",
  calendar: "カレンダー",
  materials: "素材",
  changes: "変更履歴",
  finance: "収支",
  integrations: "連携",
  log: "例外・ログ",
}

const projectStatus: Record<string, string> = {
  active: "進行中",
  paused: "停止中",
  completed: "完了",
}

const contractLabels: Record<string, string> = {
  per_content: "タスク単価",
  retainer: "リテナー",
  fixed_fee: "固定費",
  monthly: "月額",
}

const contentStatus: Record<string, string> = {
  not_started: "未着手",
  materials_checked: "素材確認済み",
  editing: "編集中",
  internal_revision: "社内確認",
  editing_revision: "編集修正中",
  submitted_to_client: "先方提出済み",
  client_revision: "先方修正中",
  scheduling: "公開調整中",
  delivered: "納品済み",
  published: "公開済み",
  canceled: "キャンセル",
  cancelled: "キャンセル",
}

const taskStatus: Record<string, string> = {
  not_started: "未着手",
  in_progress: "進行中",
  blocked: "ブロック",
  done: "完了",
}

const taskType: Record<string, string> = {
  materials: "素材",
  script: "台本",
  editing: "編集",
  internal_review: "社内確認",
  client_review: "先方確認",
  revision: "修正",
  publishing: "公開準備",
  publish: "公開",
}

const eventType: Record<string, string> = {
  editor_due: "編集納期",
  client_due: "先方納期",
  publish: "公開",
  meeting: "打ち合わせ",
  payout: "振込",
  invoice_issue: "請求",
  reminder: "リマインド",
  custom: "カスタム",
}

const assetType: Record<string, string> = {
  raw: "原本",
  script: "台本",
  draft: "ドラフト",
  revision: "修正版",
  final: "最終版",
  thumbnail: "サムネイル",
  reference: "参考資料",
  proof: "校正",
}

const changeType: Record<string, string> = {
  deadline_change: "納期変更",
  spec_change: "仕様変更",
  revision_additional: "追加修正",
  asset_replace: "素材差し替え",
  publish_reschedule: "公開日変更",
  extra_deliverable: "追加納品",
}

const impactLabels: Record<string, string> = {
  low: "小",
  medium: "中",
  high: "大",
}

const exceptionLabels: Record<string, string> = {
  missing_assignee: "担当者未設定",
  material_missing: "素材不足",
  due_reverse: "納期逆転",
  stagnation: "停滞",
  revision_heavy: "修正過多",
  price_missing: "単価未設定",
  cost_over: "原価超過",
  integration_missing: "連携不足",
  invoice_missing: "請求漏れ",
  client_overdue: "先方納期遅延",
  required_link_missing: "必須リンク不足",
  manual_check: "手動確認",
}

const severityLabels: Record<string, string> = {
  low: "低",
  medium: "中",
  high: "高",
}

const recordStatusLabels: Record<string, string> = {
  runtime: "実行時",
  open: "未対応",
  resolved: "解消済み",
  ignored: "無視",
}

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

const buildChatworkRoomUrl = (roomId: string) => {
  const trimmed = roomId.trim()
  return /^\d+$/.test(trimmed) ? `https://www.chatwork.com/#!rid${trimmed}` : null
}

const buildGoogleCalendarUrl = (calendarId: string) => {
  const trimmed = calendarId.trim()
  return trimmed ? `https://calendar.google.com/calendar/u/0/r?cid=${encodeURIComponent(trimmed)}` : null
}

function toAutomationProject(project: {
  id: string
  name: string
  chatwork_room_id?: string | null
  google_calendar_id?: string | null
  slack_channel_id?: string | null
  discord_channel_id?: string | null
  drive_folder_url?: string | null
}): AutomationProject {
  return {
    id: project.id,
    name: project.name,
    chatwork_room_id: project.chatwork_room_id,
    google_calendar_id: project.google_calendar_id,
    slack_channel_id: project.slack_channel_id,
    discord_channel_id: project.discord_channel_id,
    drive_folder_url: project.drive_folder_url,
  }
}

function toAutomationContent(content: {
  id: string
  org_id: string
  project_id?: string | null
  project_name: string
  title: string
  due_client_at: string
  due_editor_at: string
  publish_at?: string | null
  status: string
  billable_flag: boolean
  delivery_month: string
  unit_price: number
  invoice_id?: string | null
  assignee_editor_user_id?: string | null
  assignee_checker_user_id?: string | null
  revision_count?: number | null
  estimated_cost?: number | null
  next_action?: string | null
  blocked_reason?: string | null
  material_status?: string | null
  draft_status?: string | null
  final_status?: string | null
  health_score?: number | null
  links_json?: unknown
  editor_submitted_at?: string | null
  client_submitted_at?: string | null
}): AutomationContent {
  return { ...content }
}

export default function ProjectDetailPage() {
  const params = useParams<{ id: string }>()
  const id = typeof params?.id === "string" ? params.id : ""
  const {
    loading,
    error,
    canEdit,
    canViewFinance,
    orgId,
    todayYmd,
    members,
    projects,
    contents,
    tasks,
    events,
    assets,
    changes,
    expenses,
    rateCards,
    storedExceptions,
    runtimeExceptions,
    invoices,
    invoiceLines,
    vendorInvoices,
    vendorInvoiceLines,
    projectSummaries,
    refresh,
  } = useProjectWorkspace()

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
    [id, project, rateCards]
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
      if (row.content_id) {
        map.set(row.content_id, (map.get(row.content_id) ?? 0) + Number(row.amount ?? 0))
      }
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
          return {
            id: r.id,
            title: r.title,
            due: r.due_client_at,
            status: contentStatus[r.status] ?? r.status,
            sales,
            cost,
            expense,
            gross,
            margin: sales > 0 ? gross / sales : null,
            revision: Number(r.revision_count ?? 0),
            health: Number(r.health_score ?? 100),
          }
        })
        .sort((a, b) => (a.margin ?? -1) - (b.margin ?? -1)),
    [costByContent, expenseByContent, rows, salesByContent]
  )
  const monthlyTrend = useMemo(() => {
    const map = new Map<string, { sales: number; cost: number; expense: number }>()
    for (const r of rows) {
      const month = r.delivery_month || r.due_client_at.slice(0, 7)
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

  const [tab, setTab] = useState<TabKey>("overview")
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

  if (loading) return <ProjectShell title="案件詳細" description="読み込み中です。">読み込み中...</ProjectShell>
  if (!project || !summary) return <ProjectShell title="案件詳細" description="案件が見つかりません。"><ProjectSection title="案件が見つかりません"><Link href="/projects">案件一覧へ戻る</Link></ProjectSection></ProjectShell>

  const d = { code: draft.code ?? project.code ?? "", name: draft.name ?? project.name, status: draft.status ?? project.status, contractType: draft.contractType ?? project.contract_type, ownerUserId: draft.ownerUserId ?? project.owner_user_id ?? "", startDate: draft.startDate ?? project.start_date ?? "", endDate: draft.endDate ?? project.end_date ?? "", notes: draft.notes ?? project.notes ?? "", chatworkRoomId: draft.chatworkRoomId ?? project.chatwork_room_id ?? "", googleCalendarId: draft.googleCalendarId ?? project.google_calendar_id ?? "", slackChannelId: draft.slackChannelId ?? project.slack_channel_id ?? "", discordChannelId: draft.discordChannelId ?? project.discord_channel_id ?? "", driveFolderUrl: draft.driveFolderUrl ?? project.drive_folder_url ?? "" }
  const saveProject = async () => { if (!canEdit || !orgId) return; setBusy(true); setUiError(null); setUiSuccess(null); const { error: e } = await supabase.from("projects").update({ code: d.code.trim() || null, name: d.name.trim(), status: d.status, contract_type: d.contractType, owner_user_id: d.ownerUserId || null, start_date: d.startDate || null, end_date: d.endDate || null, notes: d.notes.trim() || null, chatwork_room_id: d.chatworkRoomId.trim() || null, google_calendar_id: d.googleCalendarId.trim() || null, slack_channel_id: d.slackChannelId.trim() || null, discord_channel_id: d.discordChannelId.trim() || null, drive_folder_url: d.driveFolderUrl.trim() || null }).eq("id", project.id).eq("org_id", orgId); setBusy(false); if (e) return setUiError(e.message); setUiSuccess("保存しました。"); setDraft({}); await refresh() }
  const scopedRows = selectedIds.length > 0 ? rows.filter((row) => selectedIds.includes(row.id)) : rows
  const delayedRows = scopedRows.filter((row) =>
    isContentClientOverdue(row.status, row.due_client_at, todayYmd, row.client_submitted_at)
  )
  const todayDueRows = scopedRows.filter((row) => row.due_client_at === todayYmd)
  const quickActionStyle = (enabled: boolean) => ({ ...buttonSecondaryStyle, opacity: enabled ? 1 : 0.55, cursor: enabled ? "pointer" : "not-allowed" })
  const buildTemplateLine = (row: typeof rows[number]) => {
    const assignee = memberName.get(row.assignee_editor_user_id ?? "") ?? "未設定"
    return `- ${row.title} / 先方納期 ${row.due_client_at} / 編集担当 ${assignee} / ステータス ${contentStatus[row.status] ?? row.status}`
  }
  const delayedNoticeTemplate = `【進行確認】${summary.clientName} / ${project.name}
遅延案件の状況確認をお願いします。
${delayedRows.slice(0, 5).map(buildTemplateLine).join("\n")}
必要であれば ETA と次アクションをこのスレッドに返信してください。${delayedRows.length > 5 ? `\nほか ${delayedRows.length - 5} 件あり。` : ""}`
  const submitCheckTemplate = `【本日提出確認】${summary.clientName} / ${project.name}
本日確認したい案件です。
${todayDueRows.slice(0, 5).map(buildTemplateLine).join("\n")}
提出可否と懸念点があればこのまま返信してください。${todayDueRows.length > 5 ? `\nほか ${todayDueRows.length - 5} 件あり。` : ""}`
  const chatworkRoomUrl = buildChatworkRoomUrl(d.chatworkRoomId)
  const googleCalendarUrl = buildGoogleCalendarUrl(d.googleCalendarId)
  const driveFolderUrl = d.driveFolderUrl.trim()
  const copyToClipboard = async (text: string, successMessage: string) => {
    if (!text.trim()) return
    if (typeof navigator === "undefined" || !navigator.clipboard?.writeText) {
      setUiError("この環境ではコピーできません。")
      return
    }
    try {
      await navigator.clipboard.writeText(text)
      setUiError(null)
      setUiSuccess(successMessage)
    } catch {
      setUiSuccess(null)
      setUiError("コピーに失敗しました。")
    }
  }
  const openExternal = (url: string | null) => {
    if (!url || typeof window === "undefined") return
    window.open(url, "_blank", "noopener,noreferrer")
  }
  const exportProjectIcs = () => {
    if (eventRows.length === 0) {
      setUiSuccess(null)
      setUiError("書き出す予定がありません。")
      return
    }
    const lines = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//NovaLoop//Project Detail Calendar//JA",
      "CALSCALE:GREGORIAN",
      ...eventRows.flatMap((event) => {
        const start = toIcsTimestamp(event.start_at, event.all_day)
        const end = toIcsTimestamp(event.end_at || event.start_at, event.all_day)
        return [
          "BEGIN:VEVENT",
          `UID:${event.id}@novaloop.local`,
          `DTSTAMP:${toIcsTimestamp(new Date().toISOString(), false)}`,
          event.all_day ? `DTSTART;VALUE=DATE:${start}` : `DTSTART:${start}`,
          event.all_day ? `DTEND;VALUE=DATE:${end}` : `DTEND:${end}`,
          `SUMMARY:${escapeIcsText(event.title)}`,
          `DESCRIPTION:${escapeIcsText(eventType[event.event_type] ?? event.event_type)}`,
          "END:VEVENT",
        ]
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
    setUiError(null)
    setUiSuccess("プロジェクトの ICS を書き出しました。")
  }
  const integrationsView = (
    <ProjectSection title="連携" description="保存だけでなく、その場で開く・コピーする・共有する操作をここで行えます。">
      <div style={{ display: "grid", gap: 10, gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))" }}>
        <label style={{ display: "grid", gap: 6 }}>
          <span>Chatwork ルーム</span>
          <input value={d.chatworkRoomId} onChange={(e) => setDraft((p) => ({ ...p, chatworkRoomId: e.target.value }))} style={inputStyle} />
        </label>
        <label style={{ display: "grid", gap: 6 }}>
          <span>Google カレンダー</span>
          <input value={d.googleCalendarId} onChange={(e) => setDraft((p) => ({ ...p, googleCalendarId: e.target.value }))} style={inputStyle} />
        </label>
        <label style={{ display: "grid", gap: 6 }}>
          <span>Slack チャンネル</span>
          <input value={d.slackChannelId} onChange={(e) => setDraft((p) => ({ ...p, slackChannelId: e.target.value }))} style={inputStyle} />
        </label>
        <label style={{ display: "grid", gap: 6 }}>
          <span>Discord チャンネル</span>
          <input value={d.discordChannelId} onChange={(e) => setDraft((p) => ({ ...p, discordChannelId: e.target.value }))} style={inputStyle} />
        </label>
        <label style={{ display: "grid", gap: 6, gridColumn: "1 / -1" }}>
          <span>ドライブフォルダURL</span>
          <input value={d.driveFolderUrl} onChange={(e) => setDraft((p) => ({ ...p, driveFolderUrl: e.target.value }))} style={inputStyle} />
        </label>
      </div>
      <div style={{ display: "grid", gap: 10, marginTop: 14 }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap", padding: "12px 14px", borderRadius: 16, border: "1px solid var(--border)", background: "var(--surface-2)" }}>
          <div style={{ display: "grid", gap: 4 }}>
            <strong>Chatwork</strong>
            <span style={{ fontSize: 13, color: "var(--muted)" }}>{d.chatworkRoomId.trim() || "未設定"}</span>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button type="button" onClick={() => void copyToClipboard(d.chatworkRoomId, "Chatwork ルームIDをコピーしました。")} disabled={!d.chatworkRoomId.trim()} style={quickActionStyle(Boolean(d.chatworkRoomId.trim()))}>IDをコピー</button>
            <button type="button" onClick={() => openExternal(chatworkRoomUrl)} disabled={!chatworkRoomUrl} style={quickActionStyle(Boolean(chatworkRoomUrl))}>ルームを開く</button>
          </div>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap", padding: "12px 14px", borderRadius: 16, border: "1px solid var(--border)", background: "var(--surface-2)" }}>
          <div style={{ display: "grid", gap: 4 }}>
            <strong>Google カレンダー</strong>
            <span style={{ fontSize: 13, color: "var(--muted)" }}>{d.googleCalendarId.trim() || "未設定"} / 予定 {eventRows.length} 件</span>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button type="button" onClick={() => void copyToClipboard(d.googleCalendarId, "Google カレンダーIDをコピーしました。")} disabled={!d.googleCalendarId.trim()} style={quickActionStyle(Boolean(d.googleCalendarId.trim()))}>IDをコピー</button>
            <button type="button" onClick={() => openExternal(googleCalendarUrl)} disabled={!googleCalendarUrl} style={quickActionStyle(Boolean(googleCalendarUrl))}>Google を開く</button>
            <button type="button" onClick={exportProjectIcs} disabled={eventRows.length === 0} style={quickActionStyle(eventRows.length > 0)}>ICSを書き出す</button>
            <Link href={`/calendar?projectId=${encodeURIComponent(project.id)}`} style={{ ...buttonSecondaryStyle, textDecoration: "none" }}>/calendar を開く</Link>
          </div>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap", padding: "12px 14px", borderRadius: 16, border: "1px solid var(--border)", background: "var(--surface-2)" }}>
          <div style={{ display: "grid", gap: 4 }}>
            <strong>Slack / Discord</strong>
            <span style={{ fontSize: 13, color: "var(--muted)" }}>チャンネルIDをそのまま共有に使えます。</span>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button type="button" onClick={() => void copyToClipboard(d.slackChannelId, "Slack チャンネルIDをコピーしました。")} disabled={!d.slackChannelId.trim()} style={quickActionStyle(Boolean(d.slackChannelId.trim()))}>Slack をコピー</button>
            <button type="button" onClick={() => void copyToClipboard(d.discordChannelId, "Discord チャンネルIDをコピーしました。")} disabled={!d.discordChannelId.trim()} style={quickActionStyle(Boolean(d.discordChannelId.trim()))}>Discord をコピー</button>
          </div>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap", padding: "12px 14px", borderRadius: 16, border: "1px solid var(--border)", background: "var(--surface-2)" }}>
          <div style={{ display: "grid", gap: 4 }}>
            <strong>Drive</strong>
            <span style={{ fontSize: 13, color: "var(--muted)" }}>{driveFolderUrl || "未設定"}</span>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button type="button" onClick={() => void copyToClipboard(d.driveFolderUrl, "Drive フォルダURLをコピーしました。")} disabled={!driveFolderUrl} style={quickActionStyle(Boolean(driveFolderUrl))}>URLをコピー</button>
            <button type="button" onClick={() => openExternal(driveFolderUrl || null)} disabled={!driveFolderUrl} style={quickActionStyle(Boolean(driveFolderUrl))}>フォルダを開く</button>
          </div>
        </div>
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
      {canEdit ? <div style={{ marginTop: 12 }}><button type="button" onClick={() => void saveProject()} disabled={busy} style={buttonPrimaryStyle}>{busy ? "保存中..." : "連携を保存"}</button></div> : null}
    </ProjectSection>
  )
  const applyBulk = async () => {
    if (!canEdit || !orgId) return
    if (selectedIds.length === 0) return setUiError("対象行を選択してください。")

    const shiftDays = Number(bulkShift || 0)
    const selectedRows = rows.filter((row) => selectedIds.includes(row.id))
    const automationProject = toAutomationProject(project)

    setBusy(true)
    setUiError(null)
    setUiSuccess(null)

    for (const row of selectedRows) {
      const editorId = bulkEditor || row.assignee_editor_user_id || null
      const checkerId = bulkChecker || row.assignee_checker_user_id || null
      const billable = bulkBillable === "keep" ? row.billable_flag : bulkBillable === "true"
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
      if (errs.length > 0) {
        setBusy(false)
        return setUiError(`${row.title}: ${errs[0]}`)
      }

      const { error: contentError } = await supabase
        .from("contents")
        .update({
          due_client_at: normalized.due_client_at,
          due_editor_at: normalized.due_editor_at,
          publish_at: normalized.publish_at,
          status: normalized.status,
          assignee_editor_user_id: normalized.assignee_editor_user_id,
          assignee_checker_user_id: normalized.assignee_checker_user_id,
          billable_flag: normalized.billable_flag,
          delivery_month: normalized.delivery_month,
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
        })
        .eq("id", row.id)
        .eq("org_id", orgId)
      if (contentError) {
        setBusy(false)
        return setUiError(contentError.message)
      }

      await syncAutomationArtifacts({
        db: supabase,
        orgId,
        previous: toAutomationContent(row),
        next: normalized,
        project: automationProject,
        todayYmd,
      })

      if (shiftDays === 0) continue

      for (const task of taskRows.filter((task) => task.content_id === row.id)) {
        const { error: taskError } = await supabase
          .from("project_tasks")
          .update({
            planned_start_date: task.planned_start_date ? shiftYmdByDaysAligned(task.planned_start_date, shiftDays) : null,
            planned_end_date: task.planned_end_date ? shiftYmdByDaysAligned(task.planned_end_date, shiftDays) : null,
          })
          .eq("id", task.id)
          .eq("org_id", orgId)
        if (taskError) {
          setBusy(false)
          return setUiError(taskError.message)
        }
      }

      for (const event of eventRows.filter((event) => event.content_id === row.id)) {
        const { error: eventError } = await supabase
          .from("schedule_events")
          .update({
            start_at: shiftIsoDateTimeByDays(event.start_at, shiftDays),
            end_at: event.end_at ? shiftIsoDateTimeByDays(event.end_at, shiftDays) : null,
          })
          .eq("id", event.id)
          .eq("org_id", orgId)
        if (eventError) {
          setBusy(false)
          return setUiError(eventError.message)
        }
      }
    }

    setBusy(false)
    setUiSuccess(shiftDays !== 0 ? "タスクと関連日程を更新しました。" : "タスクを更新しました。")
    setSelectedIds([])
    await refresh()
  }

  const view = tab === "overview" ? <><ProjectSection title="概要"><div style={{ display: "grid", gap: 10, gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))" }}><label style={{ display: "grid", gap: 6 }}><span>コード</span><input value={d.code} onChange={(e) => setDraft((p) => ({ ...p, code: e.target.value }))} style={inputStyle} /></label><label style={{ display: "grid", gap: 6 }}><span>案件名</span><input value={d.name} onChange={(e) => setDraft((p) => ({ ...p, name: e.target.value }))} style={inputStyle} /></label><label style={{ display: "grid", gap: 6 }}><span>クライアント</span><input value={summary.clientName} disabled style={{ ...inputStyle, opacity: 0.8 }} /></label><label style={{ display: "grid", gap: 6 }}><span>ステータス</span><select value={d.status} onChange={(e) => setDraft((p) => ({ ...p, status: e.target.value }))} style={inputStyle}>{Object.entries(projectStatus).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label><label style={{ display: "grid", gap: 6 }}><span>契約</span><select value={d.contractType} onChange={(e) => setDraft((p) => ({ ...p, contractType: e.target.value }))} style={inputStyle}>{Object.entries(contractLabels).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label><label style={{ display: "grid", gap: 6 }}><span>責任者</span><select value={d.ownerUserId} onChange={(e) => setDraft((p) => ({ ...p, ownerUserId: e.target.value }))} style={inputStyle}><option value="">未設定</option>{members.map((m) => <option key={m.userId} value={m.userId}>{m.displayName || m.email || m.userId}</option>)}</select></label><label style={{ display: "grid", gap: 6 }}><span>開始日</span><input type="date" value={d.startDate} onChange={(e) => setDraft((p) => ({ ...p, startDate: e.target.value }))} style={inputStyle} /></label><label style={{ display: "grid", gap: 6 }}><span>終了日</span><input type="date" value={d.endDate} onChange={(e) => setDraft((p) => ({ ...p, endDate: e.target.value }))} style={inputStyle} /></label><label style={{ display: "grid", gap: 6, gridColumn: "1 / -1" }}><span>メモ</span><textarea value={d.notes} onChange={(e) => setDraft((p) => ({ ...p, notes: e.target.value }))} rows={4} style={{ ...inputStyle, resize: "vertical" }} /></label></div>{canEdit ? <div style={{ marginTop: 12 }}><button type="button" onClick={() => void saveProject()} disabled={busy} style={buttonPrimaryStyle}>{busy ? "保存中..." : "保存する"}</button></div> : null}</ProjectSection><ProjectSection title="単価表"><div style={{ overflowX: "auto" }}><table style={{ ...tableStyle, minWidth: 720 }}><thead><tr><th style={thStyle}>項目</th><th style={thStyle}>単位</th><th style={thStyle}>売上</th><th style={thStyle}>原価</th><th style={thStyle}>適用開始</th><th style={thStyle}>適用終了</th></tr></thead><tbody>{cardRows.map((r) => <tr key={r.id}><td style={tdStyle}>{r.item_type}</td><td style={tdStyle}>{r.unit_label}</td><td style={tdStyle}>{formatCurrency(Number(r.sales_unit_price ?? 0))}</td><td style={tdStyle}>{formatCurrency(Number(r.standard_cost ?? 0))}</td><td style={tdStyle}>{r.effective_from}</td><td style={tdStyle}>{r.effective_to || "-"}</td></tr>)}{cardRows.length === 0 ? <tr><td colSpan={6} style={tdStyle}>単価表はありません。</td></tr> : null}</tbody></table></div></ProjectSection></> : tab === "contents" ? <ProjectSection title="コンテンツ"><div style={{ display: "grid", gap: 10, gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))" }}><label style={{ display: "grid", gap: 6 }}><span>日程調整(日)</span><input type="number" value={bulkShift} onChange={(e) => setBulkShift(e.target.value)} style={inputStyle} /></label><label style={{ display: "grid", gap: 6 }}><span>ステータス</span><select value={bulkStatus} onChange={(e) => setBulkStatus(e.target.value)} style={inputStyle}><option value="">変更しない</option>{Object.entries(contentStatus).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label><label style={{ display: "grid", gap: 6 }}><span>編集担当</span><select value={bulkEditor} onChange={(e) => setBulkEditor(e.target.value)} style={inputStyle}><option value="">変更しない</option>{members.map((m) => <option key={m.userId} value={m.userId}>{m.displayName || m.email || m.userId}</option>)}</select></label><label style={{ display: "grid", gap: 6 }}><span>確認担当</span><select value={bulkChecker} onChange={(e) => setBulkChecker(e.target.value)} style={inputStyle}><option value="">変更しない</option>{members.map((m) => <option key={m.userId} value={m.userId}>{m.displayName || m.email || m.userId}</option>)}</select></label><label style={{ display: "grid", gap: 6 }}><span>請求対象</span><select value={bulkBillable} onChange={(e) => setBulkBillable(e.target.value as typeof bulkBillable)} style={inputStyle}><option value="keep">変更しない</option><option value="true">対象</option><option value="false">対象外</option></select></label></div><div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 12 }}><button type="button" onClick={() => void applyBulk()} disabled={busy} style={buttonPrimaryStyle}>{busy ? "更新中..." : "一括更新"}</button><Link href={`/contents?projectId=${encodeURIComponent(project.id)}`} style={{ ...buttonSecondaryStyle, textDecoration: "none" }}>/contents を開く</Link></div><div style={{ marginTop: 14, overflowX: "auto" }}><table style={{ ...tableStyle, minWidth: 1180 }}><thead><tr>{["", "タイトル", "先方納期", "編集納期", "公開日", "編集担当", "確認担当", "素材", "修正回数", "次アクション", "請求対象", "健全性"].map((l) => <th key={l} style={thStyle}>{l}</th>)}</tr></thead><tbody>{rows.map((r) => <tr key={r.id}><td style={tdStyle}><input type="checkbox" checked={selectedIds.includes(r.id)} onChange={() => setSelectedIds((p) => p.includes(r.id) ? p.filter((x) => x !== r.id) : [...p, r.id])} /></td><td style={tdStyle}>{r.title}</td><td style={tdStyle}>{r.due_client_at}</td><td style={tdStyle}>{r.due_editor_at}</td><td style={tdStyle}>{r.publish_at ? r.publish_at.slice(0, 10) : "-"}</td><td style={tdStyle}>{memberName.get(r.assignee_editor_user_id ?? "") ?? "-"}</td><td style={tdStyle}>{memberName.get(r.assignee_checker_user_id ?? "") ?? "-"}</td><td style={tdStyle}>{textOrDash(r.material_status)}</td><td style={tdStyle}>{Number(r.revision_count ?? 0)}</td><td style={tdStyle}>{textOrDash(r.next_action)}</td><td style={tdStyle}>{r.billable_flag ? "対象" : "対象外"}</td><td style={tdStyle}>{Number(r.health_score ?? 100)}</td></tr>)}{rows.length === 0 ? <tr><td colSpan={12} style={tdStyle}>コンテンツはありません。</td></tr> : null}</tbody></table></div></ProjectSection> : tab === "tasks" ? <ProjectSection title="タスク"><div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}><Link href={`/timeline?projectId=${encodeURIComponent(project.id)}`} style={{ ...buttonSecondaryStyle, textDecoration: "none" }}>/timeline を開く</Link></div><div style={{ marginTop: 12, overflowX: "auto" }}><table style={{ ...tableStyle, minWidth: 960 }}><thead><tr><th style={thStyle}>タスク</th><th style={thStyle}>種別</th><th style={thStyle}>担当者</th><th style={thStyle}>開始</th><th style={thStyle}>終了</th><th style={thStyle}>依存</th><th style={thStyle}>ステータス</th></tr></thead><tbody>{taskRows.map((r) => <tr key={r.id}><td style={tdStyle}>{r.title}</td><td style={tdStyle}>{taskType[r.task_type] ?? r.task_type}</td><td style={tdStyle}>{memberName.get(r.assignee_user_id ?? "") ?? "-"}</td><td style={tdStyle}>{r.planned_start_date || "-"}</td><td style={{ ...tdStyle, color: (r.planned_end_date || r.planned_start_date || "") < todayYmd && r.status !== "done" ? "var(--error-text)" : tdStyle.color }}>{r.planned_end_date || "-"}</td><td style={tdStyle}>{taskName.get(r.dependency_task_id ?? "") ?? "-"}</td><td style={tdStyle}>{taskStatus[r.status] ?? r.status}</td></tr>)}{taskRows.length === 0 ? <tr><td colSpan={7} style={tdStyle}>タスクはありません。</td></tr> : null}</tbody></table></div></ProjectSection> : tab === "calendar" ? <ProjectSection title="カレンダー"><Link href={`/calendar?projectId=${encodeURIComponent(project.id)}`} style={{ ...buttonSecondaryStyle, textDecoration: "none" }}>/calendar を開く</Link><div style={{ marginTop: 12, overflowX: "auto" }}><table style={{ ...tableStyle, minWidth: 860 }}><thead><tr><th style={thStyle}>開始</th><th style={thStyle}>終了</th><th style={thStyle}>種別</th><th style={thStyle}>タイトル</th></tr></thead><tbody>{eventRows.slice(0, 20).map((r) => <tr key={r.id}><td style={tdStyle}>{formatDateTime(r.start_at, r.all_day)}</td><td style={tdStyle}>{formatDateTime(r.end_at, r.all_day)}</td><td style={tdStyle}>{eventType[r.event_type] ?? r.event_type}</td><td style={tdStyle}>{r.title}</td></tr>)}{eventRows.length === 0 ? <tr><td colSpan={4} style={tdStyle}>予定はありません。</td></tr> : null}</tbody></table></div></ProjectSection> : tab === "materials" ? <ProjectSection title="素材"><Link href={`/materials?projectId=${encodeURIComponent(project.id)}`} style={{ ...buttonSecondaryStyle, textDecoration: "none" }}>/materials を開く</Link><div style={{ marginTop: 12, overflowX: "auto" }}><table style={{ ...tableStyle, minWidth: 860 }}><thead><tr><th style={thStyle}>作成日</th><th style={thStyle}>種別</th><th style={thStyle}>タイトル</th><th style={thStyle}>版</th></tr></thead><tbody>{assetRows.slice(0, 20).map((r) => <tr key={r.id}><td style={tdStyle}>{formatDateTime(r.created_at)}</td><td style={tdStyle}>{assetType[r.asset_type] ?? r.asset_type}</td><td style={tdStyle}>{r.title}</td><td style={tdStyle}>v{r.version_no}</td></tr>)}{assetRows.length === 0 ? <tr><td colSpan={4} style={tdStyle}>素材はありません。</td></tr> : null}</tbody></table></div></ProjectSection> : tab === "changes" ? <ProjectSection title="変更履歴"><Link href={`/changes?projectId=${encodeURIComponent(project.id)}`} style={{ ...buttonSecondaryStyle, textDecoration: "none" }}>/changes を開く</Link><div style={{ marginTop: 12, overflowX: "auto" }}><table style={{ ...tableStyle, minWidth: 980 }}><thead><tr><th style={thStyle}>作成日</th><th style={thStyle}>種別</th><th style={thStyle}>概要</th><th style={thStyle}>影響</th><th style={thStyle}>ステータス</th></tr></thead><tbody>{changeRows.slice(0, 20).map((r) => <tr key={r.id}><td style={tdStyle}>{formatDateTime(r.created_at)}</td><td style={tdStyle}>{changeType[r.request_type] ?? r.request_type}</td><td style={tdStyle}>{r.summary}</td><td style={tdStyle}>{impactLabels[r.impact_level] ?? r.impact_level}</td><td style={tdStyle}>{r.status}</td></tr>)}{changeRows.length === 0 ? <tr><td colSpan={5} style={tdStyle}>変更履歴はありません。</td></tr> : null}</tbody></table></div></ProjectSection> : tab === "finance" ? (canViewFinance ? <ProjectSection title="収支"><div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12 }}><ProjectInfoCard label="売上" value={formatCurrency(summary.monthlySales)} /><ProjectInfoCard label="外注原価" value={formatCurrency(summary.monthlyVendorCost)} /><ProjectInfoCard label="経費" value={formatCurrency(summary.monthlyExpenses)} /><ProjectInfoCard label="粗利" value={formatCurrency(summary.grossProfit)} accent={summary.grossProfit < 0 ? "var(--error-text)" : undefined} /><ProjectInfoCard label="粗利率" value={pct(summary.marginRate)} accent={(summary.marginRate ?? 1) < 0.35 ? "var(--warning-text)" : undefined} /></div><div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 12 }}><Link href={`/finance-lite?projectId=${encodeURIComponent(project.id)}`} style={{ ...buttonSecondaryStyle, textDecoration: "none" }}>/finance-lite を開く</Link></div><div style={{ marginTop: 14, overflowX: "auto" }}><table style={{ ...tableStyle, minWidth: 680 }}><thead><tr><th style={thStyle}>月</th><th style={thStyle}>売上</th><th style={thStyle}>原価</th><th style={thStyle}>経費</th><th style={thStyle}>粗利</th></tr></thead><tbody>{monthlyTrend.map((r) => <tr key={r.month}><td style={tdStyle}>{r.month}</td><td style={tdStyle}>{formatCurrency(r.sales)}</td><td style={tdStyle}>{formatCurrency(r.cost)}</td><td style={tdStyle}>{formatCurrency(r.expense)}</td><td style={{ ...tdStyle, color: r.gross < 0 ? "var(--error-text)" : tdStyle.color }}>{formatCurrency(r.gross)}</td></tr>)}{monthlyTrend.length === 0 ? <tr><td colSpan={5} style={tdStyle}>収支データはありません。</td></tr> : null}</tbody></table></div><div style={{ marginTop: 14, overflowX: "auto" }}><table style={{ ...tableStyle, minWidth: 980 }}><thead><tr><th style={thStyle}>コンテンツ</th><th style={thStyle}>納期</th><th style={thStyle}>ステータス</th><th style={thStyle}>売上</th><th style={thStyle}>原価</th><th style={thStyle}>経費</th><th style={thStyle}>粗利</th><th style={thStyle}>粗利率</th><th style={thStyle}>修正回数</th><th style={thStyle}>健全性</th></tr></thead><tbody>{profitRows.map((r) => <tr key={r.id}><td style={tdStyle}>{r.title}</td><td style={tdStyle}>{r.due}</td><td style={tdStyle}>{contentStatus[r.status] ?? r.status}</td><td style={tdStyle}>{formatCurrency(r.sales)}</td><td style={tdStyle}>{formatCurrency(r.cost)}</td><td style={tdStyle}>{formatCurrency(r.expense)}</td><td style={{ ...tdStyle, color: r.gross < 0 ? "var(--error-text)" : tdStyle.color }}>{formatCurrency(r.gross)}</td><td style={{ ...tdStyle, color: (r.margin ?? 1) < 0.35 ? "var(--warning-text)" : tdStyle.color }}>{pct(r.margin)}</td><td style={tdStyle}>{r.revision}</td><td style={tdStyle}>{r.health}</td></tr>)}{profitRows.length === 0 ? <tr><td colSpan={10} style={tdStyle}>コンテンツ別収支データはありません。</td></tr> : null}</tbody></table></div></ProjectSection> : <ProjectSection title="収支">オーナー / 経営補佐のみ閲覧できます。</ProjectSection>) : tab === "integrations" ? integrationsView : <ProjectSection title="例外・ログ"><div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}><Link href={`/exceptions?projectId=${encodeURIComponent(project.id)}`} style={{ ...buttonSecondaryStyle, textDecoration: "none" }}>/exceptions を開く</Link></div><div style={{ marginTop: 12, overflowX: "auto" }}><table style={{ ...tableStyle, minWidth: 980 }}><thead><tr><th style={thStyle}>種別</th><th style={thStyle}>タイトル</th><th style={thStyle}>内容</th><th style={thStyle}>重要度</th><th style={thStyle}>ステータス</th><th style={thStyle}>検知日時</th></tr></thead><tbody>{runtimeRows.map((r) => <tr key={r.key}><td style={tdStyle}>{exceptionLabels[r.exceptionType] ?? r.exceptionType}</td><td style={tdStyle}>{exceptionLabels[r.exceptionType] ?? r.title}</td><td style={tdStyle}>{r.description && !looksMojibake(r.description) ? r.description : `${exceptionLabels[r.exceptionType] ?? r.exceptionType} を確認してください。`}</td><td style={tdStyle}>{severityLabels[r.severity] ?? r.severity}</td><td style={tdStyle}>{recordStatusLabels.runtime}</td><td style={tdStyle}>{todayYmd}</td></tr>)}{storedRows.map((r) => <tr key={r.id}><td style={tdStyle}>{exceptionLabels[r.exception_type] ?? r.exception_type}</td><td style={tdStyle}>{r.title}</td><td style={tdStyle}>{textOrDash(r.description)}</td><td style={tdStyle}>{severityLabels[r.severity] ?? r.severity}</td><td style={tdStyle}>{recordStatusLabels[r.status] ?? r.status}</td><td style={tdStyle}>{formatDateTime(r.detected_at)}</td></tr>)}{runtimeRows.length === 0 && storedRows.length === 0 ? <tr><td colSpan={6} style={tdStyle}>ログはありません。</td></tr> : null}</tbody></table></div></ProjectSection>

  return <ProjectShell title={project.name} description={`${summary.clientName} / 案件詳細`} action={<div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}><Link href="/projects" style={{ ...buttonSecondaryStyle, textDecoration: "none" }}>案件一覧へ戻る</Link><Link href={`/contents?projectId=${encodeURIComponent(project.id)}`} style={{ ...buttonSecondaryStyle, textDecoration: "none" }}>/contents を開く</Link></div>}><div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12 }}><ProjectInfoCard label="ステータス" value={projectStatus[project.status] ?? project.status} /><ProjectInfoCard label="契約" value={contractLabels[project.contract_type] ?? project.contract_type} /><ProjectInfoCard label="コード" value={textOrDash(project.code)} /><ProjectInfoCard label="当月本数" value={`${summary.monthlyContentCount}`} /><ProjectInfoCard label="遅延" value={`${summary.delayCount}`} accent={summary.delayCount > 0 ? "var(--error-text)" : undefined} /><ProjectInfoCard label="素材不足" value={`${summary.missingMaterialCount}`} accent={summary.missingMaterialCount > 0 ? "var(--warning-text)" : undefined} /><ProjectInfoCard label="健全性" value={`${summary.healthAverage}`} accent={summary.healthAverage < 80 ? "var(--error-text)" : undefined} />{canViewFinance ? <ProjectInfoCard label="粗利" value={formatCurrency(summary.grossProfit)} accent={summary.grossProfit < 0 ? "var(--error-text)" : undefined} /> : null}{canViewFinance ? <ProjectInfoCard label="粗利率" value={pct(summary.marginRate)} accent={(summary.marginRate ?? 1) < 0.35 ? "var(--warning-text)" : undefined} /> : null}</div>{error || uiError || uiSuccess ? <ProjectSection title="お知らせ">{error ? <div style={{ color: "var(--error-text)" }}>{error}</div> : null}{uiError ? <div style={{ color: "var(--error-text)" }}>{uiError}</div> : null}{uiSuccess ? <div style={{ color: "var(--success-text)" }}>{uiSuccess}</div> : null}</ProjectSection> : null}<ProjectSection title="タブ"><div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>{tabs.map((name) => <button key={name} type="button" onClick={() => setTab(name)} style={{ padding: "8px 12px", borderRadius: 999, border: `1px solid ${tab === name ? "var(--primary)" : "var(--border)"}`, background: tab === name ? "rgba(99, 102, 241, 0.12)" : "var(--surface-2)", color: tab === name ? "var(--primary)" : "var(--text)", fontWeight: 700, cursor: "pointer" }}>{tabLabels[name]}</button>)}</div></ProjectSection>{view}</ProjectShell>
}
