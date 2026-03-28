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
const PROJECT_STATUS_LABELS: Record<string, string> = {
  active: "進行中",
  paused: "停止中",
  completed: "完了",
}

const CONTRACT_TYPE_LABELS: Record<string, string> = {
  per_content: "コンテンツ単価",
  retainer: "リテナー",
  fixed_fee: "固定費",
  monthly: "月額",
}

function percent(value: number | null) {
  return value == null ? "-" : `${Math.round(value * 100)}%`
}

function statusBadge(enabled: boolean) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        padding: "2px 8px",
        borderRadius: 999,
        fontSize: 11,
        fontWeight: 700,
        background: enabled ? "#ecfdf5" : "#f8fafc",
        color: enabled ? "#166534" : "#475569",
        border: enabled ? "1px solid #86efac" : "1px solid #cbd5e1",
      }}
    >
      {enabled ? "済" : "未設定"}
    </span>
  )
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
  const { loading, error, canEdit, canViewFinance, orgId, month, clients, members, projectSummaries, refresh } = useProjectWorkspace()
  const [search, setSearch] = useState("")
  const [clientFilter, setClientFilter] = useState("")
  const [ownerFilter, setOwnerFilter] = useState("")
  const [statusFilter, setStatusFilter] = useState("")
  const [preset, setPreset] = useState<PresetKey>("all")
  const [savedViews, setSavedViews] = useState<SavedView[]>(loadSavedViews)
  const [creating, setCreating] = useState(false)
  const [busy, setBusy] = useState(false)
  const [uiError, setUiError] = useState<string | null>(null)
  const [uiSuccess, setUiSuccess] = useState<string | null>(null)
  const [form, setForm] = useState({
    clientId: "",
    code: "",
    name: "",
    status: "active",
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

  useEffect(() => {
    if (typeof window === "undefined") return
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(savedViews))
  }, [savedViews])

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

  const createProject = async () => {
    if (!canEdit || !orgId) return
    if (!form.clientId || !form.name.trim()) {
      setUiError("クライアントと案件名を入力してください。")
      return
    }

    setBusy(true)
    setUiError(null)
    setUiSuccess(null)
    const { error: insertError } = await supabase.from("projects").insert({
      id: crypto.randomUUID(),
      org_id: orgId,
      client_id: form.clientId,
      code: form.code.trim() || null,
      name: form.name.trim(),
      status: form.status,
      contract_type: form.contractType,
      owner_user_id: form.ownerUserId || null,
      start_date: form.startDate || null,
      end_date: form.endDate || null,
      notes: form.notes.trim() || null,
      chatwork_room_id: form.chatworkRoomId.trim() || null,
      google_calendar_id: form.googleCalendarId.trim() || null,
      slack_channel_id: form.slackChannelId.trim() || null,
      discord_channel_id: form.discordChannelId.trim() || null,
      drive_folder_url: form.driveFolderUrl.trim() || null,
    })
    setBusy(false)

    if (insertError) {
      setUiError(insertError.message)
      return
    }

    setUiSuccess("案件を登録しました。")
    setCreating(false)
    setForm({
      clientId: clients[0]?.id ?? "",
      code: "",
      name: "",
      status: "active",
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

  return (
    <ProjectShell
      title="案件管理"
      description="案件マスタ、担当、期間、収支、連携設定をまとめて管理します。日々の1本ごとの進行更新はコンテンツで回します。"
      action={
        canEdit ? (
          <button type="button" onClick={() => setCreating((prev) => !prev)} style={buttonPrimaryStyle}>
            {creating ? "閉じる" : "+ 案件マスタを作成"}
          </button>
        ) : null
      }
    >
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12 }}>
        <ProjectInfoCard label="対象月" value={month} />
        <ProjectInfoCard label="案件数" value={`${totals.projects}`} />
        <ProjectInfoCard label="遅延" value={`${totals.delay}`} accent={totals.delay > 0 ? "#b91c1c" : undefined} />
        <ProjectInfoCard label="例外" value={`${totals.exception}`} accent={totals.exception > 0 ? "#b45309" : undefined} />
        <ProjectInfoCard label="素材不足" value={`${totals.missingMaterial}`} accent={totals.missingMaterial > 0 ? "#b45309" : undefined} />
        <ProjectInfoCard label="コンテンツ数" value={`${totals.contents}`} />
        <ProjectInfoCard label="健全度" value={`${avgHealth}`} accent={avgHealth < 80 ? "#b91c1c" : undefined} />
        {canViewFinance ? <ProjectInfoCard label="売上" value={formatCurrency(totals.sales)} /> : null}
        {canViewFinance ? <ProjectInfoCard label="原価+経費" value={formatCurrency(totals.cost)} /> : null}
      </div>

      <ProjectSection title="使い分け" description="迷ったら、案件の箱はここで作成し、日々の制作進行はコンテンツで更新します。">
        <div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))" }}>
          <div
            style={{
              display: "grid",
              gap: 8,
              padding: 16,
              borderRadius: 18,
              border: "1px solid var(--border)",
              background: "var(--surface)",
            }}
          >
            <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: "0.06em", color: "var(--muted)" }}>PROJECT MASTER</div>
            <div style={{ fontSize: 18, fontWeight: 800, color: "var(--text)" }}>このページでやること</div>
            <div style={{ color: "var(--muted)", lineHeight: 1.7 }}>
              案件名、責任者、期間、契約、連携先、収支の土台をここで整えます。継続運用する案件の正式な入口です。
            </div>
            <div style={{ fontSize: 12, color: "var(--muted)" }}>向いている場面: 新規案件の立ち上げ / 継続案件の整理 / 全体の見直し</div>
          </div>
          <div
            style={{
              display: "grid",
              gap: 8,
              padding: 16,
              borderRadius: 18,
              border: "1px solid var(--border)",
              background: "var(--surface)",
            }}
          >
            <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: "0.06em", color: "var(--muted)" }}>DAILY EXECUTION</div>
            <div style={{ fontSize: 18, fontWeight: 800, color: "var(--text)" }}>コンテンツへ回すこと</div>
            <div style={{ color: "var(--muted)", lineHeight: 1.7 }}>
              1本ごとの納期、担当、進捗、請求対象の更新はコンテンツで回します。案件の箱を作ったら、実作業はそちらで動かします。
            </div>
            <div>
              <Link href="/contents" style={{ ...buttonSecondaryStyle, display: "inline-flex", textDecoration: "none" }}>
                コンテンツ運用を開く
              </Link>
            </div>
          </div>
        </div>
      </ProjectSection>

      {creating ? (
        <ProjectSection title="案件マスタを作成" description="まず案件の箱を作成し、その後にコンテンツ・タスク・素材を紐づけます。">
          <div style={{ display: "grid", gap: 10, gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))" }}>
            <label style={{ display: "grid", gap: 6 }}>
              <span>クライアント</span>
              <select value={form.clientId} onChange={(event) => setForm((prev) => ({ ...prev, clientId: event.target.value }))} style={inputStyle}>
                <option value="">選択してください</option>
                {clients.map((client) => (
                  <option key={client.id} value={client.id}>
                    {client.name}
                  </option>
                ))}
              </select>
            </label>
            <label style={{ display: "grid", gap: 6 }}>
              <span>案件コード</span>
              <input value={form.code} onChange={(event) => setForm((prev) => ({ ...prev, code: event.target.value }))} style={inputStyle} />
            </label>
            <label style={{ display: "grid", gap: 6 }}>
              <span>案件名</span>
              <input value={form.name} onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))} style={inputStyle} />
            </label>
            <label style={{ display: "grid", gap: 6 }}>
              <span>ステータス</span>
              <select value={form.status} onChange={(event) => setForm((prev) => ({ ...prev, status: event.target.value }))} style={inputStyle}>
                {Object.entries(PROJECT_STATUS_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label style={{ display: "grid", gap: 6 }}>
              <span>契約形態</span>
              <select value={form.contractType} onChange={(event) => setForm((prev) => ({ ...prev, contractType: event.target.value }))} style={inputStyle}>
                {Object.entries(CONTRACT_TYPE_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label style={{ display: "grid", gap: 6 }}>
              <span>担当者</span>
              <select value={form.ownerUserId} onChange={(event) => setForm((prev) => ({ ...prev, ownerUserId: event.target.value }))} style={inputStyle}>
                <option value="">未設定</option>
                {members.map((member) => (
                  <option key={member.userId} value={member.userId}>
                    {member.displayName || member.email || member.userId}
                  </option>
                ))}
              </select>
            </label>
            <label style={{ display: "grid", gap: 6 }}>
              <span>開始日</span>
              <input type="date" value={form.startDate} onChange={(event) => setForm((prev) => ({ ...prev, startDate: event.target.value }))} style={inputStyle} />
            </label>
            <label style={{ display: "grid", gap: 6 }}>
              <span>終了日</span>
              <input type="date" value={form.endDate} onChange={(event) => setForm((prev) => ({ ...prev, endDate: event.target.value }))} style={inputStyle} />
            </label>
            <label style={{ display: "grid", gap: 6 }}>
              <span>chatwork</span>
              <input value={form.chatworkRoomId} onChange={(event) => setForm((prev) => ({ ...prev, chatworkRoomId: event.target.value }))} style={inputStyle} />
            </label>
            <label style={{ display: "grid", gap: 6 }}>
              <span>google calendar</span>
              <input value={form.googleCalendarId} onChange={(event) => setForm((prev) => ({ ...prev, googleCalendarId: event.target.value }))} style={inputStyle} />
            </label>
            <label style={{ display: "grid", gap: 6 }}>
              <span>slack</span>
              <input value={form.slackChannelId} onChange={(event) => setForm((prev) => ({ ...prev, slackChannelId: event.target.value }))} style={inputStyle} />
            </label>
            <label style={{ display: "grid", gap: 6 }}>
              <span>discord</span>
              <input value={form.discordChannelId} onChange={(event) => setForm((prev) => ({ ...prev, discordChannelId: event.target.value }))} style={inputStyle} />
            </label>
            <label style={{ display: "grid", gap: 6, gridColumn: "1 / -1" }}>
              <span>Google Drive</span>
              <input value={form.driveFolderUrl} onChange={(event) => setForm((prev) => ({ ...prev, driveFolderUrl: event.target.value }))} style={inputStyle} />
            </label>
            <label style={{ display: "grid", gap: 6, gridColumn: "1 / -1" }}>
              <span>メモ</span>
              <textarea value={form.notes} onChange={(event) => setForm((prev) => ({ ...prev, notes: event.target.value }))} rows={3} style={{ ...inputStyle, resize: "vertical" }} />
            </label>
          </div>
          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginTop: 12 }}>
            <button type="button" onClick={() => void createProject()} disabled={busy} style={buttonPrimaryStyle}>
              {busy ? "作成中..." : "案件マスタを作成"}
            </button>
            {uiError ? <span style={{ color: "#b91c1c", fontSize: 12 }}>{uiError}</span> : null}
            {uiSuccess ? <span style={{ color: "#166534", fontSize: 12 }}>{uiSuccess}</span> : null}
          </div>
        </ProjectSection>
      ) : null}

      <ProjectSection title="絞り込み" description="クライアント、担当者、ステータス、保存ビューで絞り込みます。">
        <div style={{ display: "grid", gap: 10, gridTemplateColumns: "minmax(220px, 1.4fr) repeat(3, minmax(180px, 0.8fr))" }}>
          <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="案件名 / クライアント / 担当者 / メモ で検索" style={inputStyle} />
          <select value={clientFilter} onChange={(event) => setClientFilter(event.target.value)} style={inputStyle}>
            <option value="">すべてのクライアント</option>
            {clients.map((client) => (
              <option key={client.id} value={client.id}>
                {client.name}
              </option>
            ))}
          </select>
          <select value={ownerFilter} onChange={(event) => setOwnerFilter(event.target.value)} style={inputStyle}>
            <option value="">すべての担当者</option>
            {members.map((member) => (
              <option key={member.userId} value={member.userId}>
                {member.displayName || member.email || member.userId}
              </option>
            ))}
          </select>
          <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} style={inputStyle}>
            <option value="">すべてのステータス</option>
            {Object.entries(PROJECT_STATUS_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </div>

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 12 }}>
          {(["all", "risk", "margin", "revision", "integration", "delay", "material", "exception"] as const).map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => setPreset(value)}
              style={{
                padding: "8px 12px",
                borderRadius: 999,
                border: `1px solid ${preset === value ? "var(--primary)" : "var(--border)"}`,
                background: preset === value ? "rgba(99, 102, 241, 0.12)" : "var(--surface-2)",
                color: preset === value ? "var(--primary)" : "var(--text)",
                fontWeight: 700,
                cursor: "pointer",
              }}
            >
              {PRESET_LABELS[value]}
            </button>
          ))}
          <button type="button" onClick={saveView} style={{ ...buttonSecondaryStyle, padding: "8px 12px", borderRadius: 999, marginLeft: "auto" }}>
            ビューを保存
          </button>
        </div>

        {savedViews.length > 0 ? (
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 12 }}>
            {savedViews.map((view) => (
              <div key={view.id} style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "4px 6px", borderRadius: 999, background: "var(--surface-2)", border: "1px solid var(--border)" }}>
                <button
                  type="button"
                  onClick={() => {
                    setSearch(view.search)
                    setClientFilter(view.clientFilter)
                    setOwnerFilter(view.ownerFilter)
                    setStatusFilter(view.statusFilter)
                    setPreset(view.preset)
                  }}
                  style={{ border: "none", background: "transparent", color: "var(--text)", fontWeight: 700, cursor: "pointer" }}
                >
                  {view.name}
                </button>
                <button
                  type="button"
                  onClick={() => setSavedViews((prev) => prev.filter((row) => row.id !== view.id))}
                  style={{ border: "none", background: "transparent", color: "#b91c1c", cursor: "pointer" }}
                >
                  削除
                </button>
              </div>
            ))}
          </div>
        ) : null}
      </ProjectSection>

      <ProjectSection title="案件一覧" description="粗利、遅延、素材不足、停滞、例外、連携状況を一覧で見ます。">
        {loading ? <div style={{ color: "var(--muted)" }}>読み込み中...</div> : null}
        {!loading && error ? <div style={{ color: "#b91c1c" }}>{error}</div> : null}
        {!loading && !error && filtered.length === 0 ? <div style={{ color: "var(--muted)" }}>条件に一致する案件がありません。</div> : null}
        {!loading && !error && filtered.length > 0 ? (
          <div style={{ overflowX: "auto" }}>
            <table style={{ ...tableStyle, minWidth: canViewFinance ? 1800 : 1460 }}>
              <thead>
                <tr>
                  {[
                    "案件名",
                    "コード",
                    "クライアント",
                    "ステータス",
                    "契約形態",
                    "担当者",
                    "期間",
                    "当月件数",
                    ...(canViewFinance ? ["売上", "外注費", "経費", "粗利", "利益率"] : []),
                    "遅延",
                    "修正多",
                    "素材不足",
                    "停滞",
                    "例外",
                    "Chatwork",
                    "Google",
                    "Slack/Discord",
                    "Drive",
                    "健全度",
                  ].map((label) => (
                    <th key={label} style={thStyle}>
                      {label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map((summary) => (
                  <tr
                    key={summary.project.id}
                    style={{
                      background:
                        summary.delayCount > 0 ||
                        summary.openExceptionCount > 0 ||
                        summary.healthAverage < 80 ||
                        summary.grossProfit < 0
                          ? "rgba(254, 242, 242, 0.9)"
                          : undefined,
                    }}
                  >
                    <td style={tdStyle}>
                      <Link href={`/projects/${summary.project.id}`} style={{ color: "var(--primary)", textDecoration: "none", fontWeight: 700 }}>
                        {summary.project.name}
                      </Link>
                    </td>
                    <td style={tdStyle}>{summary.project.code || "-"}</td>
                    <td style={tdStyle}>{summary.clientName}</td>
                    <td style={tdStyle}>{PROJECT_STATUS_LABELS[summary.project.status] ?? summary.project.status}</td>
                    <td style={tdStyle}>{CONTRACT_TYPE_LABELS[summary.project.contract_type] ?? summary.project.contract_type}</td>
                    <td style={tdStyle}>{summary.ownerName}</td>
                    <td style={tdStyle}>
                      <div>{summary.project.start_date || "-"}</div>
                      <div style={{ color: "var(--muted)", fontSize: 12 }}>{summary.project.end_date || "-"}</div>
                    </td>
                    <td style={tdStyle}>{summary.monthlyContentCount}</td>
                    {canViewFinance ? <td style={tdStyle}>{formatCurrency(summary.monthlySales)}</td> : null}
                    {canViewFinance ? <td style={tdStyle}>{formatCurrency(summary.monthlyVendorCost)}</td> : null}
                    {canViewFinance ? <td style={tdStyle}>{formatCurrency(summary.monthlyExpenses)}</td> : null}
                    {canViewFinance ? <td style={{ ...tdStyle, color: summary.grossProfit < 0 ? "#b91c1c" : tdStyle.color }}>{formatCurrency(summary.grossProfit)}</td> : null}
                    {canViewFinance ? <td style={{ ...tdStyle, color: (summary.marginRate ?? 1) < 0.35 ? "#b45309" : tdStyle.color }}>{percent(summary.marginRate)}</td> : null}
                    <td style={tdStyle}>{summary.delayCount}</td>
                    <td style={tdStyle}>{summary.revisionHeavyCount}</td>
                    <td style={tdStyle}>{summary.missingMaterialCount}</td>
                    <td style={tdStyle}>{summary.stagnationCount}</td>
                    <td style={tdStyle}>{summary.openExceptionCount}</td>
                    <td style={tdStyle}>{statusBadge(Boolean(summary.project.chatwork_room_id))}</td>
                    <td style={tdStyle}>{statusBadge(Boolean(summary.project.google_calendar_id))}</td>
                    <td style={tdStyle}>{statusBadge(Boolean(summary.project.slack_channel_id || summary.project.discord_channel_id))}</td>
                    <td style={tdStyle}>{statusBadge(Boolean(summary.project.drive_folder_url))}</td>
                    <td style={{ ...tdStyle, color: summary.healthAverage < 80 ? "#b91c1c" : tdStyle.color }}>{summary.healthAverage}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </ProjectSection>
    </ProjectShell>
  )
}
