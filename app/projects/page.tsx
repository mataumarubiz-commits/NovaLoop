"use client"

import Link from "next/link"
import { useEffect, useMemo, useState } from "react"
import { ProjectInfoCard, ProjectSection, ProjectShell } from "@/components/project/ProjectShell"
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
import { supabase } from "@/lib/supabase"
import { getContentBillingMonthYm, isContentClosedStatus, isContentWithoutProject } from "@/lib/contentWorkflow"
import { getProjectStatusBadgeStyle, PROJECT_STATUS_LABELS, PROJECT_STATUS_OPTIONS } from "@/lib/projectStatus"

type PresetKey = "all" | "risk" | "margin" | "revision" | "integration" | "delay" | "material" | "exception"
type SavedView = {
  id: string
  name: string
  search: string
  clientFilter: string
  ownerFilter: string
  statusFilter: string
  preset: PresetKey
}

const STORAGE_KEY = "novaloop:projects:saved-views"

const CONTRACT_TYPE_LABELS: Record<string, string> = {
  per_content: "本数×単価",
  retainer: "月額固定（顧問型）",
  fixed_fee: "一括請求",
  monthly: "月額定額",
}

function percent(value: number | null) {
  return value == null ? "-" : `${Math.round(value * 100)}%`
}

const PRESET_LABELS: Record<PresetKey, string> = {
  all: "すべて",
  risk: "リスク",
  margin: "粗利",
  revision: "修正多",
  integration: "連携",
  delay: "遅延",
  material: "素材不足",
  exception: "例外",
}

function loadSavedViews() {
  if (typeof window === "undefined") return []
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    return raw ? (JSON.parse(raw) as SavedView[]) : []
  } catch {
    window.localStorage.removeItem(STORAGE_KEY)
    return []
  }
}

export default function ProjectsPage() {
  const { loading, error, canEdit, canViewFinance, orgId, month, clients, members, projectSummaries, contents, refresh } = useProjectWorkspace()
  const [search, setSearch] = useState("")
  const [clientFilter, setClientFilter] = useState("")
  const [ownerFilter, setOwnerFilter] = useState("")
  const [statusFilter, setStatusFilter] = useState("")
  const [preset, setPreset] = useState<PresetKey>("all")
  const [savedViews, setSavedViews] = useState<SavedView[]>(loadSavedViews)
  const [creating, setCreating] = useState(false)
  const [busy, setBusy] = useState(false)
  const [savingProjectIds, setSavingProjectIds] = useState<Set<string>>(new Set())
  /** クイック変更中の表示用（RLS で .select が空でも更新成功したときに UI が戻らないのを防ぐ） */
  const [projectStatusDraft, setProjectStatusDraft] = useState<Record<string, string>>({})
  const [uiError, setUiError] = useState<string | null>(null)
  const [uiSuccess, setUiSuccess] = useState<string | null>(null)
  const [lastCreatedId, setLastCreatedId] = useState<string | null>(null)
  const [form, setForm] = useState({
    clientId: "",
    code: "",
    name: "",
    status: "internal_production",
    contractType: "per_content",
    notes: "",
    chatworkRoomId: "",
    googleCalendarId: "",
    slackChannelId: "",
    discordChannelId: "",
    driveFolderUrl: "",
    // 単価設定（レートカード初期値）
    rateItemType: "",
    rateUnitLabel: "本",
    rateSalesUnitPrice: "",
  })

  useEffect(() => {
    if (typeof window === "undefined") return
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(savedViews))
  }, [savedViews])

  useEffect(() => {
    setProjectStatusDraft((draft) => {
      const next = { ...draft }
      let changed = false
      for (const id of Object.keys(next)) {
        const row = projectSummaries.find((s) => s.project.id === id)
        if (row && row.project.status === next[id]) {
          delete next[id]
          changed = true
        }
      }
      return changed ? next : draft
    })
  }, [projectSummaries])

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase()
    return projectSummaries.filter((summary) => {
      if (clientFilter && summary.project.client_id !== clientFilter) return false
      if (ownerFilter && (summary.project.owner_user_id ?? "") !== ownerFilter) return false
      if (statusFilter && summary.project.status !== statusFilter) return false
      if (
        query &&
        ![summary.project.name, summary.clientName, summary.ownerName, summary.project.notes ?? ""]
          .join(" ")
          .toLowerCase()
          .includes(query)
      ) {
        return false
      }

      if (preset === "risk") return summary.delayCount > 0 || summary.healthAverage < 80 || summary.openExceptionCount > 0 || summary.missingMaterialCount > 0
      if (preset === "margin") return summary.grossProfit < 0 || (summary.marginRate ?? 1) < 0.35
      if (preset === "revision") return summary.revisionHeavyCount > 0
      if (preset === "integration") return summary.integrationMissingCount > 0
      if (preset === "delay") return summary.delayCount > 0 || summary.stagnationCount > 0
      if (preset === "material") return summary.missingMaterialCount > 0
      if (preset === "exception") return summary.openExceptionCount > 0
      return true
    })
  }, [clientFilter, ownerFilter, preset, projectSummaries, search, statusFilter])

  const totals = useMemo(
    () =>
      filtered.reduce(
        (acc, summary) => {
          acc.projects += 1
          acc.delay += summary.delayCount
          acc.exception += summary.openExceptionCount
          acc.missingMaterial += summary.missingMaterialCount
          acc.contents += summary.monthlyContentCount
          acc.sales += summary.monthlySales
          acc.cost += summary.monthlyVendorCost + summary.monthlyExpenses
          acc.health += summary.healthAverage
          return acc
        },
        { projects: 0, delay: 0, exception: 0, missingMaterial: 0, contents: 0, sales: 0, cost: 0, health: 0 }
      ),
    [filtered]
  )

  const avgHealth = filtered.length > 0 ? Math.round(totals.health / filtered.length) : 100

  /** 制作シートのデフォルト（今月の対象月）に表示される未紐付けのみ。YYYY-MM vs YYYY-MM-DD のズレで誤検知しない */
  const orphanContents = useMemo(
    () =>
      contents.filter((c) => {
        if (!isContentWithoutProject(c.project_id) || isContentClosedStatus(c.status)) return false
        return getContentBillingMonthYm(c.delivery_month, c.due_client_at) === month
      }),
    [contents, month],
  )
  const orphanCount = orphanContents.length

  const createProject = async () => {
    if (!canEdit || !orgId) return
    if (!form.clientId || !form.name.trim()) {
      setUiError("クライアントと案件名を入力してください。")
      return
    }

    setBusy(true)
    setUiError(null)
    setUiSuccess(null)
    const newId = crypto.randomUUID()
    const { error: insertError } = await supabase.from("projects").insert({
      id: newId,
      org_id: orgId,
      client_id: form.clientId,
      code: form.code.trim() || null,
      name: form.name.trim(),
      status: form.status,
      contract_type: form.contractType,
      owner_user_id: null,
      start_date: null,
      end_date: null,
      notes: form.notes.trim() || null,
      chatwork_room_id: form.chatworkRoomId.trim() || null,
      google_calendar_id: form.googleCalendarId.trim() || null,
      slack_channel_id: form.slackChannelId.trim() || null,
      discord_channel_id: form.discordChannelId.trim() || null,
      drive_folder_url: form.driveFolderUrl.trim() || null,
    })

    if (insertError) {
      setBusy(false)
      setUiError(insertError.message)
      return
    }

    // レートカードも同時作成（単価が入力されている場合）
    const hasRateCard = form.rateItemType.trim() && Number(form.rateSalesUnitPrice) > 0
    if (hasRateCard) {
      const todayYmd = new Date().toISOString().slice(0, 10)
      await supabase.from("rate_cards").insert({
        id: crypto.randomUUID(),
        org_id: orgId,
        project_id: newId,
        client_id: form.clientId,
        item_type: form.rateItemType.trim(),
        unit_label: form.rateUnitLabel.trim() || "本",
        sales_unit_price: Number(form.rateSalesUnitPrice) || 0,
        standard_cost: 0,
        effective_from: todayYmd,
        effective_to: null,
      })
    }

    setBusy(false)
    setUiSuccess(hasRateCard ? "案件と単価を登録しました。" : "案件を登録しました。詳細ページで単価表を設定してください。")
    setLastCreatedId(newId)
    setCreating(false)
    setForm({
      clientId: clients[0]?.id ?? "",
      code: "",
      name: "",
      status: "internal_production",
      contractType: "per_content",
      notes: "",
      chatworkRoomId: "",
      googleCalendarId: "",
      slackChannelId: "",
      discordChannelId: "",
      driveFolderUrl: "",
      rateItemType: "",
      rateUnitLabel: "本",
      rateSalesUnitPrice: "",
    })
    await refresh()
  }

  const saveView = () => {
    const name = window.prompt("保存ビュー名", preset === "all" ? "案件一覧" : preset)
    if (!name?.trim()) return
    setSavedViews((prev) => [
      {
        id: crypto.randomUUID(),
        name: name.trim(),
        search,
        clientFilter,
        ownerFilter,
        statusFilter,
        preset,
      },
      ...prev,
    ].slice(0, 8))
  }

  const [formStep, setFormStep] = useState<"basic" | "integration">("basic")
  const [showGuide, setShowGuide] = useState(false)

  type EditProjectDraft = {
    code: string
    name: string
    status: string
    contractType: string
    ownerUserId: string
    startDate: string
    endDate: string
    notes: string
    chatworkRoomId: string
    googleCalendarId: string
    slackChannelId: string
    discordChannelId: string
    driveFolderUrl: string
  }

  const emptyEditDraft = (): EditProjectDraft => ({
    code: "",
    name: "",
    status: "internal_production",
    contractType: "per_content",
    ownerUserId: "",
    startDate: "",
    endDate: "",
    notes: "",
    chatworkRoomId: "",
    googleCalendarId: "",
    slackChannelId: "",
    discordChannelId: "",
    driveFolderUrl: "",
  })

  const [editingProjectId, setEditingProjectId] = useState<string | null>(null)
  const [editingClientName, setEditingClientName] = useState("")
  const [editDraft, setEditDraft] = useState<EditProjectDraft>(emptyEditDraft)
  const [editBusy, setEditBusy] = useState(false)
  const [editFormStep, setEditFormStep] = useState<"basic" | "integration">("basic")
  const [editUiError, setEditUiError] = useState<string | null>(null)
  const [editUiSuccess, setEditUiSuccess] = useState<string | null>(null)
  const [deleteBusyId, setDeleteBusyId] = useState<string | null>(null)
  const [deleteUiError, setDeleteUiError] = useState<string | null>(null)

  const openProjectEditor = (summary: (typeof projectSummaries)[number]) => {
    const p = summary.project
    setEditingProjectId(p.id)
    setEditingClientName(summary.clientName)
    setEditDraft({
      code: p.code ?? "",
      name: p.name,
      status: p.status,
      contractType: p.contract_type,
      ownerUserId: p.owner_user_id ?? "",
      startDate: p.start_date ?? "",
      endDate: p.end_date ?? "",
      notes: p.notes ?? "",
      chatworkRoomId: p.chatwork_room_id ?? "",
      googleCalendarId: p.google_calendar_id ?? "",
      slackChannelId: p.slack_channel_id ?? "",
      discordChannelId: p.discord_channel_id ?? "",
      driveFolderUrl: p.drive_folder_url ?? "",
    })
    setEditFormStep("basic")
    setEditUiError(null)
    setEditUiSuccess(null)
  }

  const closeProjectEditor = () => {
    setEditingProjectId(null)
    setEditingClientName("")
    setEditDraft(emptyEditDraft())
    setEditUiError(null)
    setEditUiSuccess(null)
    setEditFormStep("basic")
  }

  const saveEditedProject = async () => {
    if (!canEdit || !orgId || !editingProjectId) return
    if (!editDraft.name.trim()) {
      setEditUiError("案件名を入力してください。")
      setEditUiSuccess(null)
      return
    }
    setEditBusy(true)
    setEditUiError(null)
    setEditUiSuccess(null)
    const { error: e } = await supabase
      .from("projects")
      .update({
        code: editDraft.code.trim() || null,
        name: editDraft.name.trim(),
        status: editDraft.status,
        contract_type: editDraft.contractType,
        owner_user_id: editDraft.ownerUserId || null,
        start_date: editDraft.startDate || null,
        end_date: editDraft.endDate || null,
        notes: editDraft.notes.trim() || null,
        chatwork_room_id: editDraft.chatworkRoomId.trim() || null,
        google_calendar_id: editDraft.googleCalendarId.trim() || null,
        slack_channel_id: editDraft.slackChannelId.trim() || null,
        discord_channel_id: editDraft.discordChannelId.trim() || null,
        drive_folder_url: editDraft.driveFolderUrl.trim() || null,
      })
      .eq("id", editingProjectId)
      .eq("org_id", orgId)
    setEditBusy(false)
    if (e) {
      setEditUiError(e.message)
      return
    }
    setEditUiSuccess("保存しました。")
    setTimeout(() => setEditUiSuccess(null), 3000)
    await refresh()
  }

  const handleQuickStatusUpdate = async (projectId: string, newStatus: string) => {
    if (!canEdit || !orgId) return
    setProjectStatusDraft((d) => ({ ...d, [projectId]: newStatus }))
    setSavingProjectIds((prev) => new Set(prev).add(projectId))
    setUiError(null)
    setUiSuccess(null)

    const { error: updateError } = await supabase
      .from("projects")
      .update({ status: newStatus })
      .eq("id", projectId)
      .eq("org_id", orgId)

    if (updateError) {
      setProjectStatusDraft((d) => {
        const n = { ...d }
        delete n[projectId]
        return n
      })
      setUiError(`ステータス更新に失敗しました: ${updateError.message}`)
    } else {
      await refresh({ silent: true })
      // draft はサーバー値と一致したときだけ useEffect で消す（ここで消すと再取得が 1 フレーム遅いと古い status に戻る）
      setUiSuccess("ステータスを更新しました")
      setTimeout(() => setUiSuccess(null), 2500)
    }

    setSavingProjectIds((prev) => {
      const next = new Set(prev)
      next.delete(projectId)
      return next
    })
  }

  const deleteProject = async (projectId: string) => {
    if (!canEdit || !orgId) return
    if (typeof window !== "undefined" && !window.confirm("この案件を削除しますか？関連する案件データは組織の設定に従って削除または更新されます。")) return
    setDeleteBusyId(projectId)
    setDeleteUiError(null)
    const { error: delErr } = await supabase.from("projects").delete().eq("id", projectId).eq("org_id", orgId)
    setDeleteBusyId(null)
    if (delErr) {
      setDeleteUiError(delErr.message)
      return
    }
    if (editingProjectId === projectId) closeProjectEditor()
    await refresh()
  }

  const hasAlerts = totals.delay > 0 || totals.exception > 0 || totals.missingMaterial > 0

  return (
    <ProjectShell
      title="案件管理"
      description="案件の土台を管理。日々の制作進行はコンテンツで更新します。"
      action={
        canEdit ? (
          <button type="button" onClick={() => setCreating((prev) => !prev)} style={buttonPrimaryStyle}>
            {creating ? "閉じる" : "+ 案件を作成"}
          </button>
        ) : null
      }
    >
      {/* ── KPI Summary ── */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 10 }}>
        <ProjectInfoCard label="対象月" value={month} />
        <ProjectInfoCard label="案件数" value={`${totals.projects}`} />
        <ProjectInfoCard label="健全度" value={`${avgHealth}%`} accent={avgHealth < 80 ? "#b91c1c" : undefined} />
        <ProjectInfoCard label="コンテンツ" value={`${totals.contents}`} />
        {hasAlerts ? (
          <div style={{
            border: "1px solid var(--border)",
            borderRadius: 16,
            background: "var(--surface)",
            padding: 14,
            boxShadow: "var(--shadow-lg)",
            display: "grid",
            gap: 4,
          }}>
            <div style={{ fontSize: 12, color: "var(--muted)" }}>注意</div>
            <div style={{ display: "flex", gap: 10, fontSize: 13, fontWeight: 600 }}>
              {totals.delay > 0 && <span style={{ color: "#b91c1c" }}>遅延 {totals.delay}</span>}
              {totals.exception > 0 && <span style={{ color: "#b45309" }}>例外 {totals.exception}</span>}
              {totals.missingMaterial > 0 && <span style={{ color: "#b45309" }}>素材不足 {totals.missingMaterial}</span>}
            </div>
          </div>
        ) : null}
        {canViewFinance ? <ProjectInfoCard label="売上" value={formatCurrency(totals.sales)} /> : null}
        {canViewFinance ? <ProjectInfoCard label="原価+経費" value={formatCurrency(totals.cost)} /> : null}
      </div>

      {/* ── Collapsible guide ── */}
      <button
        type="button"
        onClick={() => setShowGuide((v) => !v)}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "10px 16px",
          borderRadius: 12,
          border: "1px solid var(--border)",
          background: "var(--surface)",
          color: "var(--muted)",
          fontSize: 13,
          fontWeight: 500,
          cursor: "pointer",
          textAlign: "left",
          width: "100%",
        }}
      >
        <span style={{ transform: showGuide ? "rotate(90deg)" : "rotate(0deg)", transition: "transform 0.15s", fontSize: 11 }}>&#9654;</span>
        案件管理とコンテンツ運用の使い分け
      </button>
      {showGuide && (
        <div style={{ display: "grid", gap: 12, gridTemplateColumns: "1fr 1fr" }}>
          <div style={{ padding: "14px 16px", borderRadius: 14, border: "1px solid var(--border)", background: "var(--surface)" }}>
            <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.06em", color: "var(--muted)", marginBottom: 6 }}>PROJECT MASTER</div>
            <div style={{ fontSize: 14, fontWeight: 700, color: "var(--text)", marginBottom: 4 }}>このページ</div>
            <div style={{ color: "var(--muted)", fontSize: 13, lineHeight: 1.6 }}>案件名、責任者、期間、契約、連携先の土台を整えます。</div>
          </div>
          <div style={{ padding: "14px 16px", borderRadius: 14, border: "1px solid var(--border)", background: "var(--surface)" }}>
            <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.06em", color: "var(--muted)", marginBottom: 6 }}>DAILY EXECUTION</div>
            <div style={{ fontSize: 14, fontWeight: 700, color: "var(--text)", marginBottom: 4 }}>コンテンツ</div>
            <div style={{ color: "var(--muted)", fontSize: 13, lineHeight: 1.6 }}>
              1本ごとの納期・担当・進捗を更新。
              <Link href="/contents" style={{ color: "var(--primary)", textDecoration: "none", fontWeight: 600, marginLeft: 4 }}>開く &rarr;</Link>
            </div>
          </div>
        </div>
      )}

      {/* ── Create form ── */}
      {creating && (
        <ProjectSection title="案件を新規作成">
          <div style={{ display: "grid", gap: 16, gridTemplateColumns: "repeat(6, 1fr)" }}>
            {/* Row 1 */}
            <label style={{ display: "grid", gap: 4, gridColumn: "span 2" }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: "var(--muted)" }}>クライアント *</span>
              <select value={form.clientId} onChange={(e) => setForm((p) => ({ ...p, clientId: e.target.value }))} style={inputStyle}>
                <option value="">選択してください</option>
                {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </label>
            <label style={{ display: "grid", gap: 4, gridColumn: "span 4" }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: "var(--muted)" }}>案件名 *</span>
              <input value={form.name} onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))} placeholder="例: A社 Instagram運用 2026年4月" style={inputStyle} />
            </label>

            {/* Row 2 */}
            <label style={{ display: "grid", gap: 4, gridColumn: "span 2" }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: "var(--muted)" }}>案件コード</span>
              <input value={form.code} onChange={(e) => setForm((p) => ({ ...p, code: e.target.value }))} placeholder="例: A-IG-2604" style={inputStyle} />
            </label>
            <label style={{ display: "grid", gap: 4, gridColumn: "span 2" }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: "var(--muted)" }}>契約形態</span>
              <select value={form.contractType} onChange={(e) => setForm((p) => ({ ...p, contractType: e.target.value }))} style={inputStyle}>
                {Object.entries(CONTRACT_TYPE_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </label>
            <label style={{ display: "grid", gap: 4, gridColumn: "span 2" }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: "var(--muted)" }}>ステータス</span>
              <select value={form.status} onChange={(e) => setForm((p) => ({ ...p, status: e.target.value }))} style={inputStyle}>
                {PROJECT_STATUS_OPTIONS.map(({ value: v, label: l }) => (
                  <option key={v} value={v}>{l}</option>
                ))}
              </select>
            </label>

            {/* Row 3: 単価 */}
            <label style={{ display: "grid", gap: 4, gridColumn: "span 2" }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: "var(--muted)" }}>単価の項目名</span>
              <input value={form.rateItemType} onChange={(e) => setForm((p) => ({ ...p, rateItemType: e.target.value }))} placeholder="例: ショート動画編集" style={inputStyle} />
            </label>
            <label style={{ display: "grid", gap: 4, gridColumn: "span 2" }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: "var(--muted)" }}>単位</span>
              <input value={form.rateUnitLabel} onChange={(e) => setForm((p) => ({ ...p, rateUnitLabel: e.target.value }))} placeholder="本" style={inputStyle} />
            </label>
            <label style={{ display: "grid", gap: 4, gridColumn: "span 2" }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: "var(--muted)" }}>単価（税抜）</span>
              <input type="number" min="0" value={form.rateSalesUnitPrice} onChange={(e) => setForm((p) => ({ ...p, rateSalesUnitPrice: e.target.value }))} placeholder="¥30,000" style={inputStyle} />
            </label>

            {/* メモ */}
            <label style={{ display: "grid", gap: 4, gridColumn: "1 / -1" }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: "var(--muted)" }}>メモ</span>
              <textarea value={form.notes} onChange={(e) => setForm((p) => ({ ...p, notes: e.target.value }))} rows={2} placeholder="案件の補足情報があれば入力" style={{ ...inputStyle, resize: "vertical" }} />
            </label>

            {/* 連携設定（折り畳み） */}
            <div style={{ gridColumn: "1 / -1" }}>
              <button
                type="button"
                onClick={() => setFormStep(formStep === "integration" ? "basic" : "integration")}
                style={{ display: "flex", alignItems: "center", gap: 6, border: "none", background: "transparent", color: "var(--muted)", fontSize: 13, fontWeight: 600, cursor: "pointer", padding: 0 }}
              >
                <span style={{ transform: formStep === "integration" ? "rotate(90deg)" : "rotate(0deg)", transition: "transform 0.15s", fontSize: 11 }}>&#9654;</span>
                連携設定（Chatwork / Google / Slack / Discord）
              </button>
              {formStep === "integration" && (
                <div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", marginTop: 12 }}>
                  {([
                    { key: "chatworkRoomId" as const, label: "Chatwork Room ID" },
                    { key: "googleCalendarId" as const, label: "Google Calendar ID" },
                    { key: "slackChannelId" as const, label: "Slack Channel ID" },
                    { key: "discordChannelId" as const, label: "Discord Channel ID" },
                  ]).map((field) => (
                    <label key={field.key} style={{ display: "grid", gap: 4 }}>
                      <span style={{ fontSize: 12, fontWeight: 600, color: "var(--muted)" }}>{field.label}</span>
                      <input value={form[field.key]} onChange={(e) => setForm((p) => ({ ...p, [field.key]: e.target.value }))} style={inputStyle} />
                    </label>
                  ))}
                  <label style={{ display: "grid", gap: 4, gridColumn: "1 / -1" }}>
                    <span style={{ fontSize: 12, fontWeight: 600, color: "var(--muted)" }}>Google Drive URL</span>
                    <input value={form.driveFolderUrl} onChange={(e) => setForm((p) => ({ ...p, driveFolderUrl: e.target.value }))} style={inputStyle} />
                  </label>
                </div>
              )}
            </div>

            {/* アクション */}
            <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", gridColumn: "1 / -1" }}>
              <button type="button" onClick={() => void createProject()} disabled={busy} style={buttonPrimaryStyle}>
                {busy ? "作成中..." : "案件を作成"}
              </button>
              <button type="button" onClick={() => setCreating(false)} style={buttonSecondaryStyle}>キャンセル</button>
              {uiError && <span style={{ color: "var(--error-text)", fontSize: 12 }}>{uiError}</span>}
              {uiSuccess && (
                <span style={{ color: "var(--success-text)", fontSize: 12 }}>
                  {uiSuccess}
                  {lastCreatedId && (
                    <Link href={`/projects/${lastCreatedId}`} style={{ color: "var(--primary)", marginLeft: 8, fontWeight: 700, textDecoration: "none" }}>
                      詳細を開く &rarr;
                    </Link>
                  )}
                </span>
              )}
            </div>
          </div>
        </ProjectSection>
      )}

      {orphanCount > 0 && (
        <ProjectSection title="" description="">
          <div style={{
            padding: 16,
            borderRadius: 12,
            background: "rgba(254, 240, 138, 0.2)",
            border: "1px solid var(--warning-border, #fde68a)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            flexWrap: "wrap",
            gap: 12
          }}>
            <div>
              <div style={{ fontWeight: 700, color: "var(--warning-text, #854d0e)", fontSize: 14, marginBottom: 4 }}>
                未紐付けのコンテンツがあります
              </div>
              <div style={{ fontSize: 13, color: "var(--muted)" }}>
                今月の対象月で表示される範囲に、案件未紐付けのコンテンツが <strong>{orphanCount}件</strong> あります（制作シートの「対象月」を変えると表示が変わります）。売上や遅延の集計に含まれないため、案件への紐付けを推奨します。
              </div>
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button
                type="button"
                onClick={() => void refresh()}
                disabled={loading}
                style={{
                  ...buttonSecondaryStyle,
                  fontSize: 13,
                  padding: "6px 12px",
                  borderColor: "var(--warning-text, #854d0e)",
                  color: "var(--warning-text, #854d0e)",
                  background: "transparent"
                }}
              >
                {loading ? "更新中..." : "最新に更新"}
              </button>
              <Link
                href="/contents?filter=unlinked"
                style={{
                  ...buttonPrimaryStyle,
                  background: "var(--warning-text, #854d0e)",
                  borderColor: "var(--warning-text, #854d0e)",
                  textDecoration: "none",
                  fontSize: 13,
                  padding: "6px 12px"
                }}
              >
                制作シートで確認する &rarr;
              </Link>
            </div>
          </div>
        </ProjectSection>
      )}

      {/* ── Filter bar (compact) ── */}
      <section style={{
        border: "1px solid var(--border)",
        borderRadius: 16,
        background: "var(--surface)",
        padding: "14px 16px",
        boxShadow: "var(--shadow-lg)",
        display: "grid",
        gap: 10,
      }}>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="検索..."
            style={{ ...inputStyle, flex: 1, minWidth: 180, padding: "8px 12px" }}
          />
          <select value={clientFilter} onChange={(e) => setClientFilter(e.target.value)} style={{ ...inputStyle, padding: "8px 12px" }}>
            <option value="">クライアント</option>
            {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <select value={ownerFilter} onChange={(e) => setOwnerFilter(e.target.value)} style={{ ...inputStyle, padding: "8px 12px" }}>
            <option value="">担当者</option>
            {members.map((m) => <option key={m.userId} value={m.userId}>{m.displayName || m.email || m.userId}</option>)}
          </select>
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} style={{ ...inputStyle, padding: "8px 12px" }}>
            <option value="">ステータス</option>
            {PROJECT_STATUS_OPTIONS.map(({ value: v, label: l }) => (
              <option key={v} value={v}>{l}</option>
            ))}
          </select>
        </div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
          {(["all", "risk", "margin", "revision", "delay", "material", "exception"] as const).map((v) => {
            const active = preset === v
            return (
              <button
                key={v}
                type="button"
                onClick={() => setPreset(v)}
                style={{
                  padding: "5px 12px",
                  borderRadius: 999,
                  border: active ? "1px solid var(--primary)" : "1px solid var(--border)",
                  background: active ? "color-mix(in srgb, var(--primary) 12%, var(--surface))" : "transparent",
                  color: active ? "var(--primary)" : "var(--muted)",
                  fontWeight: active ? 700 : 500,
                  fontSize: 12,
                  cursor: "pointer",
                }}
              >
                {PRESET_LABELS[v]}
              </button>
            )
          })}
          <button
            type="button"
            onClick={saveView}
            style={{ marginLeft: "auto", padding: "5px 12px", borderRadius: 999, border: "1px solid var(--border)", background: "transparent", color: "var(--muted)", fontSize: 12, fontWeight: 500, cursor: "pointer" }}
          >
            ビューを保存
          </button>
        </div>
        {savedViews.length > 0 && (
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {savedViews.map((view) => (
              <div key={view.id} style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "3px 8px", borderRadius: 999, background: "var(--surface-2)", border: "1px solid var(--border)", fontSize: 12 }}>
                <button
                  type="button"
                  onClick={() => { setSearch(view.search); setClientFilter(view.clientFilter); setOwnerFilter(view.ownerFilter); setStatusFilter(view.statusFilter); setPreset(view.preset) }}
                  style={{ border: "none", background: "transparent", color: "var(--text)", fontWeight: 600, cursor: "pointer", fontSize: 12 }}
                >
                  {view.name}
                </button>
                <button
                  type="button"
                  onClick={() => setSavedViews((p) => p.filter((r) => r.id !== view.id))}
                  style={{ border: "none", background: "transparent", color: "var(--muted)", cursor: "pointer", fontSize: 11, padding: "0 2px" }}
                >
                  &times;
                </button>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* ── Inline edit (一覧から基本情報を更新) ── */}
      {canEdit && editingProjectId && (
        <ProjectSection
          title="案件の基本情報を編集"
          description={editingClientName ? `${editingClientName} の案件を編集しています。` : "案件を編集しています。"}
        >
          <div style={{ marginBottom: 12, fontSize: 13 }}>
            <Link href={`/projects/${editingProjectId}`} style={{ color: "var(--primary)", fontWeight: 600, textDecoration: "none" }}>
              詳細ページを開く
            </Link>
            <span style={{ color: "var(--muted)", marginLeft: 8 }}>（単価表・タブ別の操作はこちら）</span>
          </div>
          <div style={{ display: "grid", gap: 16, gridTemplateColumns: "repeat(6, 1fr)" }}>
            <label style={{ display: "grid", gap: 4, gridColumn: "span 2" }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: "var(--muted)" }}>クライアント</span>
              <input value={editingClientName} disabled style={{ ...inputStyle, opacity: 0.85 }} />
            </label>
            <label style={{ display: "grid", gap: 4, gridColumn: "span 4" }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: "var(--muted)" }}>案件名 *</span>
              <input value={editDraft.name} onChange={(e) => setEditDraft((p) => ({ ...p, name: e.target.value }))} style={inputStyle} />
            </label>
            <label style={{ display: "grid", gap: 4, gridColumn: "span 2" }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: "var(--muted)" }}>案件コード</span>
              <input value={editDraft.code} onChange={(e) => setEditDraft((p) => ({ ...p, code: e.target.value }))} style={inputStyle} />
            </label>
            <label style={{ display: "grid", gap: 4, gridColumn: "span 2" }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: "var(--muted)" }}>契約形態</span>
              <select value={editDraft.contractType} onChange={(e) => setEditDraft((p) => ({ ...p, contractType: e.target.value }))} style={inputStyle}>
                {Object.entries(CONTRACT_TYPE_LABELS).map(([v, l]) => (
                  <option key={v} value={v}>{l}</option>
                ))}
              </select>
            </label>
            <label style={{ display: "grid", gap: 4, gridColumn: "span 2" }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: "var(--muted)" }}>ステータス</span>
              <select value={editDraft.status} onChange={(e) => setEditDraft((p) => ({ ...p, status: e.target.value }))} style={inputStyle}>
                {PROJECT_STATUS_OPTIONS.map(({ value: v, label: l }) => (
                  <option key={v} value={v}>{l}</option>
                ))}
              </select>
            </label>
            <label style={{ display: "grid", gap: 4, gridColumn: "span 2" }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: "var(--muted)" }}>責任者</span>
              <select value={editDraft.ownerUserId} onChange={(e) => setEditDraft((p) => ({ ...p, ownerUserId: e.target.value }))} style={inputStyle}>
                <option value="">未設定</option>
                {members.map((m) => (
                  <option key={m.userId} value={m.userId}>{m.displayName || m.email || m.userId}</option>
                ))}
              </select>
            </label>
            <label style={{ display: "grid", gap: 4, gridColumn: "span 2" }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: "var(--muted)" }}>開始日</span>
              <input type="date" value={editDraft.startDate} onChange={(e) => setEditDraft((p) => ({ ...p, startDate: e.target.value }))} style={inputStyle} />
            </label>
            <label style={{ display: "grid", gap: 4, gridColumn: "span 2" }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: "var(--muted)" }}>終了日</span>
              <input type="date" value={editDraft.endDate} onChange={(e) => setEditDraft((p) => ({ ...p, endDate: e.target.value }))} style={inputStyle} />
            </label>
            <label style={{ display: "grid", gap: 4, gridColumn: "1 / -1" }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: "var(--muted)" }}>メモ</span>
              <textarea value={editDraft.notes} onChange={(e) => setEditDraft((p) => ({ ...p, notes: e.target.value }))} rows={3} style={{ ...inputStyle, resize: "vertical" }} />
            </label>
            <div style={{ gridColumn: "1 / -1" }}>
              <button
                type="button"
                onClick={() => setEditFormStep(editFormStep === "integration" ? "basic" : "integration")}
                style={{ display: "flex", alignItems: "center", gap: 6, border: "none", background: "transparent", color: "var(--muted)", fontSize: 13, fontWeight: 600, cursor: "pointer", padding: 0 }}
              >
                <span style={{ transform: editFormStep === "integration" ? "rotate(90deg)" : "rotate(0deg)", transition: "transform 0.15s", fontSize: 11 }}>&#9654;</span>
                連携設定（Chatwork / Google / Slack / Discord / Drive）
              </button>
              {editFormStep === "integration" && (
                <div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", marginTop: 12 }}>
                  {([
                    { key: "chatworkRoomId" as const, label: "Chatwork Room ID" },
                    { key: "googleCalendarId" as const, label: "Google Calendar ID" },
                    { key: "slackChannelId" as const, label: "Slack Channel ID" },
                    { key: "discordChannelId" as const, label: "Discord Channel ID" },
                  ]).map((field) => (
                    <label key={field.key} style={{ display: "grid", gap: 4 }}>
                      <span style={{ fontSize: 12, fontWeight: 600, color: "var(--muted)" }}>{field.label}</span>
                      <input value={editDraft[field.key]} onChange={(e) => setEditDraft((p) => ({ ...p, [field.key]: e.target.value }))} style={inputStyle} />
                    </label>
                  ))}
                  <label style={{ display: "grid", gap: 4, gridColumn: "1 / -1" }}>
                    <span style={{ fontSize: 12, fontWeight: 600, color: "var(--muted)" }}>Google Drive URL</span>
                    <input value={editDraft.driveFolderUrl} onChange={(e) => setEditDraft((p) => ({ ...p, driveFolderUrl: e.target.value }))} style={inputStyle} />
                  </label>
                </div>
              )}
            </div>
            <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", gridColumn: "1 / -1" }}>
              <button type="button" onClick={() => void saveEditedProject()} disabled={editBusy} style={buttonPrimaryStyle}>
                {editBusy ? "保存中..." : "保存する"}
              </button>
              <button type="button" onClick={closeProjectEditor} disabled={editBusy} style={buttonSecondaryStyle}>
                閉じる
              </button>
              {editUiError && <span style={{ color: "var(--error-text)", fontSize: 12 }}>{editUiError}</span>}
              {editUiSuccess && <span style={{ color: "var(--success-text)", fontSize: 12 }}>{editUiSuccess}</span>}
            </div>
          </div>
        </ProjectSection>
      )}

      {/* ── Project list ── */}
      <section style={{
        border: "1px solid var(--border)",
        borderRadius: 16,
        background: "var(--surface)",
        padding: 16,
        boxShadow: "var(--shadow-lg)",
      }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
          <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: "var(--text)" }}>案件一覧</h2>
          <span style={{ fontSize: 12, color: "var(--muted)" }}>{filtered.length} 件</span>
        </div>
        {deleteUiError && (
          <div style={{ color: "var(--error-text)", marginBottom: 12, fontSize: 13 }}>{deleteUiError}</div>
        )}

        {loading && <div style={{ color: "var(--muted)", padding: "20px 0", textAlign: "center" }}>読み込み中...</div>}
        {!loading && error && <div style={{ color: "#b91c1c", padding: "20px 0", textAlign: "center" }}>{error}</div>}
        {!loading && !error && filtered.length === 0 && <div style={{ color: "var(--muted)", padding: "20px 0", textAlign: "center" }}>条件に一致する案件がありません。</div>}
        {!loading && !error && filtered.length > 0 && (
          <div style={{ overflowX: "auto" }}>
            <table
              style={{
                ...tableStyle,
                minWidth: canViewFinance ? (canEdit ? 1220 : 1180) : canEdit ? 980 : 920,
              }}
            >
              <thead>
                <tr>
                  {[
                    "案件名",
                    "クライアント",
                    "ステータス",
                    "担当者",
                    "契約形態",
                    "件数",
                    ...(canViewFinance ? ["売り上げ", "外注費", "粗利", "利益率"] : []),
                    ...(canEdit ? ["操作"] : []),
                  ].map((label) => (
                    <th key={label} style={thStyle}>{label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map((summary) => {
                  const isWarning =
                    summary.delayCount > 0 ||
                    summary.openExceptionCount > 0 ||
                    summary.healthAverage < 80 ||
                    summary.grossProfit < 0
                  const isEditingRow = summary.project.id === editingProjectId
                  return (
                    <tr
                      key={summary.project.id}
                      style={{
                        background: isEditingRow
                          ? "color-mix(in srgb, var(--primary) 10%, var(--surface))"
                          : isWarning
                            ? "rgba(254, 242, 242, 0.6)"
                            : undefined,
                      }}
                    >
                      <td style={tdStyle}>
                        <Link href={`/projects/${summary.project.id}`} style={{ color: "var(--primary)", textDecoration: "none", fontWeight: 700 }}>
                          {summary.project.name}
                        </Link>
                        {summary.project.code && <div style={{ color: "var(--muted)", fontSize: 11 }}>{summary.project.code}</div>}
                      </td>
                      <td style={tdStyle}>{summary.clientName}</td>
                      <td style={tdStyle}>
                        {canEdit ? (
                          <div
                            style={{
                              display: "inline-flex",
                              alignItems: "center",
                              borderRadius: 10,
                              padding: 2,
                              background: "color-mix(in srgb, var(--border) 35%, transparent)",
                              border: "1px solid color-mix(in srgb, var(--border) 80%, transparent)",
                            }}
                          >
                          <select
                            value={projectStatusDraft[summary.project.id] ?? summary.project.status}
                            disabled={savingProjectIds.has(summary.project.id)}
                            onChange={(e) => void handleQuickStatusUpdate(summary.project.id, e.target.value)}
                            onMouseDown={(e) => e.stopPropagation()}
                            style={{
                              ...inputStyle,
                              minWidth: 160,
                              maxWidth: 280,
                              fontSize: 12,
                              fontWeight: 600,
                              padding: "8px 32px 8px 12px",
                              cursor: savingProjectIds.has(summary.project.id) ? "wait" : "pointer",
                              color: "var(--text)",
                              border: "none",
                              background: "var(--surface)",
                              borderRadius: 8,
                              boxShadow: "0 1px 2px rgba(0,0,0,0.04)",
                            }}
                          >
                            {summary.project.status &&
                            !PROJECT_STATUS_OPTIONS.some((o) => o.value === summary.project.status) ? (
                              <option value={summary.project.status}>
                                {PROJECT_STATUS_LABELS[summary.project.status] ?? summary.project.status}
                              </option>
                            ) : null}
                            {PROJECT_STATUS_OPTIONS.map(({ value, label }) => (
                              <option key={value} value={value}>{label}</option>
                            ))}
                          </select>
                          </div>
                        ) : (
                          <span
                            style={{
                              display: "inline-flex",
                              alignItems: "center",
                              padding: "4px 10px",
                              borderRadius: 8,
                              fontSize: 12,
                              fontWeight: 600,
                              ...getProjectStatusBadgeStyle(summary.project.status),
                            }}
                          >
                            {PROJECT_STATUS_LABELS[summary.project.status] ?? summary.project.status}
                          </span>
                        )}
                      </td>
                      <td style={tdStyle}>{summary.ownerName}</td>
                      <td style={tdStyle}>
                        {CONTRACT_TYPE_LABELS[summary.project.contract_type] ?? summary.project.contract_type}
                      </td>
                      <td style={tdStyle}>
                        <Link
                          href={`/contents?projectId=${summary.project.id}`}
                          className="hover-underline"
                          style={{
                            color: "var(--primary)",
                            textDecoration: "none",
                            fontWeight: 600,
                            display: "inline-block",
                            padding: "4px 8px",
                            background: "color-mix(in srgb, var(--primary) 10%, transparent)",
                            borderRadius: 6
                          }}
                        >
                          {summary.monthlyContentCount}
                        </Link>
                      </td>
                      {canViewFinance && <td style={tdStyle}>{formatCurrency(summary.monthlySales)}</td>}
                      {canViewFinance && <td style={tdStyle}>{formatCurrency(summary.monthlyVendorCost)}</td>}
                      {canViewFinance && (
                        <td style={{ ...tdStyle, color: summary.grossProfit < 0 ? "#b91c1c" : tdStyle.color }}>
                          {formatCurrency(summary.grossProfit)}
                        </td>
                      )}
                      {canViewFinance && (
                        <td style={{ ...tdStyle, color: (summary.marginRate ?? 1) < 0.35 ? "#b45309" : tdStyle.color }}>
                          {percent(summary.marginRate)}
                        </td>
                      )}
                      {canEdit && (
                        <td
                          style={{
                            ...tdStyle,
                            verticalAlign: "middle",
                            padding: "8px 10px",
                            width: 1,
                          }}
                        >
                          <div
                            style={{
                              display: "flex",
                              alignItems: "center",
                              gap: 6,
                              flexWrap: "nowrap",
                            }}
                          >
                            <button
                              type="button"
                              onClick={() => openProjectEditor(summary)}
                              disabled={deleteBusyId === summary.project.id}
                              style={{
                                padding: "5px 10px",
                                borderRadius: 8,
                                fontSize: 12,
                                fontWeight: 600,
                                lineHeight: 1.25,
                                border: "1px solid var(--button-secondary-border)",
                                background: "var(--button-secondary-bg)",
                                color: "var(--button-secondary-text)",
                                cursor: deleteBusyId === summary.project.id ? "not-allowed" : "pointer",
                                whiteSpace: "nowrap",
                                opacity: deleteBusyId === summary.project.id ? 0.45 : 1,
                              }}
                            >
                              編集
                            </button>
                            <button
                              type="button"
                              onClick={() => void deleteProject(summary.project.id)}
                              disabled={deleteBusyId === summary.project.id}
                              style={{
                                padding: "5px 10px",
                                borderRadius: 8,
                                fontSize: 12,
                                fontWeight: 600,
                                lineHeight: 1.25,
                                border: "1px solid color-mix(in srgb, var(--error-text) 35%, var(--border))",
                                background: "var(--surface)",
                                color: "var(--error-text)",
                                cursor: deleteBusyId === summary.project.id ? "not-allowed" : "pointer",
                                whiteSpace: "nowrap",
                                opacity: deleteBusyId === summary.project.id ? 0.45 : 1,
                              }}
                            >
                              {deleteBusyId === summary.project.id ? "削除中..." : "削除"}
                            </button>
                          </div>
                        </td>
                      )}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </ProjectShell>
  )
}
