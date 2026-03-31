"use client"

import Link from "next/link"
import { useMemo, useState } from "react"
import { useSearchParams } from "next/navigation"
import { ProjectInfoCard, ProjectSection, ProjectShell } from "@/components/project/ProjectShell"
import { buttonPrimaryStyle, buttonSecondaryStyle, inputStyle, tableStyle, tdStyle, textOrDash, thStyle } from "@/components/project/projectPageStyles"
import { useProjectWorkspace } from "@/hooks/useProjectWorkspace"
import { supabase } from "@/lib/supabase"

type ViewMode = "day" | "week" | "month"
const TASK_TYPE_LABELS: Record<string, string> = { materials: "素材確認", script: "台本", editing: "編集", internal_review: "内部確認", client_review: "先方確認", revision: "修正", publishing: "投稿設定", publish: "公開" }
const TASK_STATUS_LABELS: Record<string, string> = { not_started: "未着手", in_progress: "進行中", blocked: "ブロック", done: "完了" }
const parseYmd = (v: string) => new Date(`${v}T00:00:00`)
const toYmd = (v: Date) => `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, "0")}-${String(v.getDate()).padStart(2, "0")}`
const addDays = (v: string, d: number) => { const n = parseYmd(v); n.setDate(n.getDate() + d); return toYmd(n) }
const daysBetween = (s: string, e: string) => Math.max(0, Math.round((parseYmd(e).getTime() - parseYmd(s).getTime()) / 86400000))
const shiftNullableYmd = (v: string | null | undefined, d: number) => (v ? addDays(v, d) : null)
const taskDurationDays = (s?: string | null, e?: string | null) => (!s || !e ? 0 : daysBetween(s, e))
const taskWindow = (s?: string | null, e?: string | null) => { const start = s || e || null; const end = e || s || null; return start && end ? { start, end } : null }
const overlapsRange = (w: { start: string; end: string }, r: { start: string; end: string }) => w.start <= r.end && w.end >= r.start
const startOfWeek = (v: string) => { const d = parseYmd(v); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return toYmd(d) }
const endOfWeek = (v: string) => addDays(startOfWeek(v), 6)
const startOfMonth = (v: string) => { const d = parseYmd(v); d.setDate(1); return toYmd(d) }
const endOfMonth = (v: string) => { const d = parseYmd(startOfMonth(v)); d.setMonth(d.getMonth() + 1); d.setDate(0); return toYmd(d) }
const isTaskOverdue = (task: { planned_start_date?: string | null; planned_end_date?: string | null; status: string }, todayYmd: string) => Boolean((task.planned_end_date || task.planned_start_date) && task.status !== "done" && (task.planned_end_date || task.planned_start_date)! < todayYmd)

function buildViewRange(viewMode: ViewMode, todayYmd: string) {
  if (viewMode === "day") return { start: todayYmd, end: todayYmd, span: 1, label: "Day" }
  if (viewMode === "week") { const start = startOfWeek(todayYmd); const end = endOfWeek(todayYmd); return { start, end, span: daysBetween(start, end) + 1, label: "Week" } }
  const start = startOfMonth(todayYmd); const end = endOfMonth(todayYmd); return { start, end, span: daysBetween(start, end) + 1, label: "Month" }
}

export default function TimelinePage() {
  const searchParams = useSearchParams()
  const initialProjectId = searchParams.get("projectId") ?? ""
  const { loading, error, canEdit, orgId, todayYmd, members, projects, contents, tasks, refresh } = useProjectWorkspace()
  const [projectFilter, setProjectFilter] = useState(initialProjectId)
  const [statusFilter, setStatusFilter] = useState("")
  const [typeFilter, setTypeFilter] = useState("")
  const [assigneeFilter, setAssigneeFilter] = useState("")
  const [onlyOverdue, setOnlyOverdue] = useState(false)
  const [onlyUnassigned, setOnlyUnassigned] = useState(false)
  const [viewMode, setViewMode] = useState<ViewMode>("week")
  const [busy, setBusy] = useState(false)
  const [uiError, setUiError] = useState<string | null>(null)
  const [uiSuccess, setUiSuccess] = useState<string | null>(null)
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [bulkShiftDays, setBulkShiftDays] = useState("0")
  const [bulkStatus, setBulkStatus] = useState("")
  const [bulkAssigneeUserId, setBulkAssigneeUserId] = useState("")
  const [form, setForm] = useState({ projectId: initialProjectId, contentId: "", taskType: "materials", title: "", assigneeUserId: "", plannedStartDate: "", plannedEndDate: "", status: "not_started", dependencyTaskId: "", workloadPoints: "1" })

  const range = useMemo(() => buildViewRange(viewMode, todayYmd), [todayYmd, viewMode])
  const memberNameById = useMemo(() => new Map(members.map((m) => [m.userId, m.displayName || m.email || m.userId])), [members])
  const projectNameById = useMemo(() => new Map(projects.map((p) => [p.id, p.name])), [projects])
  const contentTitleById = useMemo(() => new Map(contents.map((c) => [c.id, c.title])), [contents])
  const taskById = useMemo(() => new Map(tasks.map((t) => [t.id, t])), [tasks])
  const filteredTasks = useMemo(() => tasks.filter((t) => !projectFilter || t.project_id === projectFilter).filter((t) => !statusFilter || t.status === statusFilter).filter((t) => !typeFilter || t.task_type === typeFilter).filter((t) => !assigneeFilter || t.assignee_user_id === assigneeFilter).filter((t) => !onlyUnassigned || !t.assignee_user_id).filter((t) => !onlyOverdue || isTaskOverdue(t, todayYmd)).filter((t) => { const w = taskWindow(t.planned_start_date, t.planned_end_date); return !w || overlapsRange(w, range) }).sort((a, b) => (a.planned_start_date || a.planned_end_date || a.created_at).localeCompare(b.planned_start_date || b.planned_end_date || b.created_at) || a.title.localeCompare(b.title)), [assigneeFilter, onlyOverdue, onlyUnassigned, projectFilter, range, statusFilter, tasks, todayYmd, typeFilter])
  const summary = useMemo(() => filteredTasks.reduce((acc, t) => { acc.total += 1; if (t.status === "done") acc.done += 1; if (t.status === "blocked") acc.blocked += 1; if (!t.planned_start_date && !t.planned_end_date) acc.unscheduled += 1; if (!t.assignee_user_id) acc.unassigned += 1; if (t.dependency_task_id) acc.dependency += 1; if (isTaskOverdue(t, todayYmd)) acc.overdue += 1; acc.workload += Number(t.workload_points || 0); return acc }, { total: 0, done: 0, blocked: 0, overdue: 0, unscheduled: 0, unassigned: 0, dependency: 0, workload: 0 }), [filteredTasks, todayYmd])
  
  const workloadByAssignee = useMemo(() => {
    const map = new Map<string, { userId: string; name: string; workload: number; taskCount: number }>()
    for (const t of filteredTasks) {
      if (!t.assignee_user_id) continue
      const name = memberNameById.get(t.assignee_user_id) || t.assignee_user_id
      const current = map.get(t.assignee_user_id) || { userId: t.assignee_user_id, name, workload: 0, taskCount: 0 }
      current.workload += Number(t.workload_points || 0)
      current.taskCount += 1
      map.set(t.assignee_user_id, current)
    }
    return Array.from(map.values()).sort((a, b) => b.workload - a.workload)
  }, [filteredTasks, memberNameById])

  const projectContents = useMemo(() => contents.filter((c) => c.project_id === form.projectId), [contents, form.projectId])
  const dependencyCandidates = useMemo(() => tasks.filter((t) => t.project_id === form.projectId).sort((a, b) => a.title.localeCompare(b.title)), [form.projectId, tasks])

  const shiftDependentTasks = async (taskId: string, shiftDays: number, skipIds: Set<string>, visited = new Set<string>()) => {
    if (!orgId || shiftDays === 0 || visited.has(taskId)) return
    visited.add(taskId)
    const dependents = tasks.filter((t) => t.dependency_task_id === taskId && !skipIds.has(t.id))
    for (const dependent of dependents) {
      const { error: dependentError } = await supabase.from("project_tasks").update({ planned_start_date: shiftNullableYmd(dependent.planned_start_date, shiftDays), planned_end_date: shiftNullableYmd(dependent.planned_end_date, shiftDays) }).eq("id", dependent.id).eq("org_id", orgId)
      if (dependentError) throw new Error(dependentError.message)
      await shiftDependentTasks(dependent.id, shiftDays, skipIds, visited)
    }
  }

  const alignTaskToDependency = async (taskId: string) => {
    if (!canEdit || !orgId) return
    const task = taskById.get(taskId); const dependency = task?.dependency_task_id ? taskById.get(task.dependency_task_id) : null
    if (!task || !dependency) return setUiError("依存タスクが見つかりません。")
    const dependencyEdge = dependency.planned_end_date || dependency.planned_start_date
    if (!dependencyEdge) return setUiError("依存タスクに日程がありません。")
    const nextStart = addDays(dependencyEdge, 1)
    const nextEnd = task.planned_end_date ? addDays(nextStart, taskDurationDays(task.planned_start_date, task.planned_end_date)) : task.planned_end_date ?? null
    const shiftDays = task.planned_start_date ? daysBetween(task.planned_start_date, nextStart) : 0
    setBusy(true); setUiError(null); setUiSuccess(null)
    try {
      const { error: updateError } = await supabase.from("project_tasks").update({ planned_start_date: nextStart, planned_end_date: nextEnd }).eq("id", task.id).eq("org_id", orgId)
      if (updateError) throw new Error(updateError.message)
      await shiftDependentTasks(task.id, shiftDays, new Set([task.id]))
      setUiSuccess("依存タスクに合わせて更新しました。"); await refresh()
    } catch (e) { setUiError(e instanceof Error ? e.message : "依存追従に失敗しました。") } finally { setBusy(false) }
  }

  const createTask = async () => {
    if (!canEdit || !orgId) return
    if (!form.projectId || !form.title.trim()) return setUiError("案件とタスク名を入力してください。")
    if (form.plannedStartDate && form.plannedEndDate && form.plannedStartDate > form.plannedEndDate) return setUiError("開始日は終了日以前で設定してください。")
    setBusy(true); setUiError(null); setUiSuccess(null)
    const { error: insertError } = await supabase.from("project_tasks").insert({ id: crypto.randomUUID(), org_id: orgId, project_id: form.projectId, content_id: form.contentId || null, task_type: form.taskType, title: form.title.trim(), assignee_user_id: form.assigneeUserId || null, planned_start_date: form.plannedStartDate || null, planned_end_date: form.plannedEndDate || null, status: form.status, dependency_task_id: form.dependencyTaskId || null, workload_points: Number(form.workloadPoints || 1) })
    setBusy(false)
    if (insertError) return setUiError(insertError.message)
    setUiSuccess("タスクを追加しました。")
    setForm((p) => ({ ...p, contentId: "", title: "", assigneeUserId: "", plannedStartDate: "", plannedEndDate: "", status: "not_started", dependencyTaskId: "", workloadPoints: "1" }))
    await refresh()
  }

  const applyBulk = async () => {
    if (!canEdit || !orgId) return
    if (selectedIds.length === 0) return setUiError("更新するタスクを選択してください。")
    const shiftDays = Number(bulkShiftDays || 0); const selectedTasks = tasks.filter((t) => selectedIds.includes(t.id)); const selectedSet = new Set(selectedIds)
    setBusy(true); setUiError(null); setUiSuccess(null)
    try {
      for (const task of selectedTasks) {
        const nextStart = shiftDays !== 0 ? shiftNullableYmd(task.planned_start_date, shiftDays) : task.planned_start_date ?? null
        const nextEnd = shiftDays !== 0 ? shiftNullableYmd(task.planned_end_date, shiftDays) : task.planned_end_date ?? null
        const nextStatus = bulkStatus || task.status
        const nextAssignee = bulkAssigneeUserId === "__clear__" ? null : bulkAssigneeUserId ? bulkAssigneeUserId : task.assignee_user_id ?? null
        if (nextStart && nextEnd && nextStart > nextEnd) throw new Error(`${task.title}: 開始日は終了日以前で設定してください。`)
        const { error: updateError } = await supabase.from("project_tasks").update({ planned_start_date: nextStart, planned_end_date: nextEnd, status: nextStatus, assignee_user_id: nextAssignee }).eq("id", task.id).eq("org_id", orgId)
        if (updateError) throw new Error(updateError.message)
        if (shiftDays !== 0) await shiftDependentTasks(task.id, shiftDays, selectedSet)
      }
      setUiSuccess("選択タスクを更新しました。"); setSelectedIds([]); await refresh()
    } catch (e) { setUiError(e instanceof Error ? e.message : "一括更新に失敗しました。") } finally { setBusy(false) }
  }

  const todayOffset = todayYmd >= range.start && todayYmd <= range.end && range.span > 1 ? (daysBetween(range.start, todayYmd) / (range.span - 1)) * 100 : range.span === 1 ? 50 : null

  return (
    <ProjectShell title="タイムライン" description="工程の開始・終了・依存関係を確認し、遅延と負荷を追跡します。" action={
        <nav className="page-tab-bar">
          <Link href={`/calendar${initialProjectId ? `?projectId=${encodeURIComponent(initialProjectId)}` : ""}`} data-active="false">カレンダー</Link>
          <Link href={`/timeline${initialProjectId ? `?projectId=${encodeURIComponent(initialProjectId)}` : ""}`} data-active="true">タイムライン</Link>
        </nav>
      }>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12 }}>
        <ProjectInfoCard label="表示タスク" value={`${summary.total}件`} /><ProjectInfoCard label="完了" value={`${summary.done}件`} /><ProjectInfoCard label="ブロック" value={`${summary.blocked}件`} /><ProjectInfoCard label="期限超過" value={`${summary.overdue}件`} accent={summary.overdue > 0 ? "var(--error-text)" : undefined} /><ProjectInfoCard label="未設定日程" value={`${summary.unscheduled}件`} /><ProjectInfoCard label="依存あり" value={`${summary.dependency}件`} /><ProjectInfoCard label="工数合計" value={`${summary.workload}`} /><ProjectInfoCard label="未担当" value={`${summary.unassigned}件`} accent={summary.unassigned > 0 ? "var(--warning-text)" : undefined} />
      </div>

      <ProjectSection title="担当者別の負荷状況" description="表示期間中の担当者ごとの工数とタスク数を可視化します。特定のメンバーに負荷が集中していないか確認してください。">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 12 }}>
          {workloadByAssignee.map((item) => (
            <div key={item.userId} style={{ border: "1px solid var(--border)", borderRadius: 12, padding: 16, background: "var(--surface)" }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
                <div style={{ fontWeight: 700, fontSize: 13, color: "var(--text)" }}>{item.name}</div>
                <div style={{ fontSize: 13, color: "var(--muted)" }}>タスク: {item.taskCount}件</div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <div style={{ flex: 1, background: "var(--surface-2)", height: 8, borderRadius: 999, overflow: "hidden" }}>
                  <div style={{ background: item.workload > 20 ? "var(--error-text)" : item.workload > 12 ? "var(--warning-text)" : "var(--primary)", height: "100%", width: `${Math.min(100, (item.workload / 30) * 100)}%` }} />
                </div>
                <div style={{ fontWeight: 700, fontSize: 15, color: item.workload > 20 ? "var(--error-text)" : "var(--text)", width: 40, textAlign: "right" }}>
                  {item.workload}
                </div>
              </div>
            </div>
          ))}
          {workloadByAssignee.length === 0 && (
            <div style={{ color: "var(--muted)", fontSize: 13 }}>表示範囲に担当が割り当てられたタスクはありません。</div>
          )}
        </div>
      </ProjectSection>

      <ProjectSection title="絞り込み" description={`${range.label}: ${range.start} - ${range.end}`}>
        <div style={{ display: "grid", gap: 10, gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))" }}>
          <label style={{ display: "grid", gap: 6 }}><span>案件</span><select value={projectFilter} onChange={(e) => setProjectFilter(e.target.value)} style={inputStyle}><option value="">すべて</option>{projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
          <label style={{ display: "grid", gap: 6 }}><span>担当</span><select value={assigneeFilter} onChange={(e) => setAssigneeFilter(e.target.value)} style={inputStyle}><option value="">すべて</option>{members.map((m) => <option key={m.userId} value={m.userId}>{m.displayName || m.email || m.userId}</option>)}</select></label>
          <label style={{ display: "grid", gap: 6 }}><span>状態</span><select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} style={inputStyle}><option value="">すべて</option>{Object.entries(TASK_STATUS_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
          <label style={{ display: "grid", gap: 6 }}><span>種別</span><select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} style={inputStyle}><option value="">すべて</option>{Object.entries(TASK_TYPE_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
          <div style={{ display: "grid", gap: 6 }}><span>表示範囲</span><div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>{(["day", "week", "month"] as const).map((m) => <button key={m} type="button" onClick={() => setViewMode(m)} style={{ ...buttonPrimaryStyle, padding: "8px 12px", background: viewMode === m ? "var(--button-primary-bg)" : "var(--surface-2)", borderColor: viewMode === m ? "var(--button-primary-bg)" : "var(--border)", color: viewMode === m ? "var(--primary-contrast)" : "var(--text)" }}>{m === "day" ? "Day" : m === "week" ? "Week" : "Month"}</button>)}</div></div>
          <div style={{ display: "flex", gap: 8, alignItems: "end", flexWrap: "wrap", gridColumn: "1 / -1" }}>
            <button type="button" onClick={() => setOnlyUnassigned((p) => !p)} style={buttonSecondaryStyle}>{onlyUnassigned ? "未担当のみ: ON" : "未担当のみ"}</button>
            <button type="button" onClick={() => setOnlyOverdue((p) => !p)} style={buttonSecondaryStyle}>{onlyOverdue ? "期限超過のみ: ON" : "期限超過のみ"}</button>
            <button type="button" onClick={() => { setOnlyUnassigned(false); setOnlyOverdue(false) }} style={buttonSecondaryStyle}>リセット</button>
          </div>
        </div>
      </ProjectSection>

      {(error || uiError || uiSuccess) ? <ProjectSection title="状況">{error ? <div style={{ color: "var(--error-text)" }}>{error}</div> : null}{uiError ? <div style={{ color: "var(--error-text)" }}>{uiError}</div> : null}{uiSuccess ? <div style={{ color: "var(--success-text)" }}>{uiSuccess}</div> : null}</ProjectSection> : null}

      {canEdit ? <ProjectSection title="一括更新"><div style={{ display: "grid", gap: 10, gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))" }}><label style={{ display: "grid", gap: 6 }}><span>日程シフト(日)</span><input type="number" value={bulkShiftDays} onChange={(e) => setBulkShiftDays(e.target.value)} style={inputStyle} /></label><label style={{ display: "grid", gap: 6 }}><span>状態</span><select value={bulkStatus} onChange={(e) => setBulkStatus(e.target.value)} style={inputStyle}><option value="">変更しない</option>{Object.entries(TASK_STATUS_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label><label style={{ display: "grid", gap: 6 }}><span>担当</span><select value={bulkAssigneeUserId} onChange={(e) => setBulkAssigneeUserId(e.target.value)} style={inputStyle}><option value="">変更しない</option><option value="__clear__">担当を外す</option>{members.map((m) => <option key={m.userId} value={m.userId}>{m.displayName || m.email || m.userId}</option>)}</select></label></div><div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 12 }}><button type="button" onClick={() => setSelectedIds(filteredTasks.map((t) => t.id))} style={buttonSecondaryStyle}>表示中を全選択</button><button type="button" onClick={() => setSelectedIds([])} style={buttonSecondaryStyle}>選択解除</button><button type="button" onClick={() => void applyBulk()} disabled={busy} style={buttonPrimaryStyle}>{busy ? "更新中..." : `選択 ${selectedIds.length} 件を更新`}</button></div></ProjectSection> : null}

      {canEdit ? <ProjectSection title="タスク追加"><div style={{ display: "grid", gap: 10, gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))" }}><label style={{ display: "grid", gap: 6 }}><span>案件</span><select value={form.projectId} onChange={(e) => setForm((p) => ({ ...p, projectId: e.target.value, contentId: "", dependencyTaskId: "" }))} style={inputStyle}><option value="">選択してください</option>{projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label><label style={{ display: "grid", gap: 6 }}><span>コンテンツ</span><select value={form.contentId} onChange={(e) => setForm((p) => ({ ...p, contentId: e.target.value }))} style={inputStyle}><option value="">未指定</option>{projectContents.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}</select></label><label style={{ display: "grid", gap: 6 }}><span>種別</span><select value={form.taskType} onChange={(e) => setForm((p) => ({ ...p, taskType: e.target.value }))} style={inputStyle}>{Object.entries(TASK_TYPE_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label><label style={{ display: "grid", gap: 6 }}><span>担当</span><select value={form.assigneeUserId} onChange={(e) => setForm((p) => ({ ...p, assigneeUserId: e.target.value }))} style={inputStyle}><option value="">未設定</option>{members.map((m) => <option key={m.userId} value={m.userId}>{m.displayName || m.email || m.userId}</option>)}</select></label><label style={{ display: "grid", gap: 6 }}><span>開始日</span><input type="date" value={form.plannedStartDate} onChange={(e) => setForm((p) => ({ ...p, plannedStartDate: e.target.value }))} style={inputStyle} /></label><label style={{ display: "grid", gap: 6 }}><span>終了日</span><input type="date" value={form.plannedEndDate} onChange={(e) => setForm((p) => ({ ...p, plannedEndDate: e.target.value }))} style={inputStyle} /></label><label style={{ display: "grid", gap: 6 }}><span>状態</span><select value={form.status} onChange={(e) => setForm((p) => ({ ...p, status: e.target.value }))} style={inputStyle}>{Object.entries(TASK_STATUS_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label><label style={{ display: "grid", gap: 6 }}><span>依存タスク</span><select value={form.dependencyTaskId} onChange={(e) => setForm((p) => ({ ...p, dependencyTaskId: e.target.value }))} style={inputStyle}><option value="">なし</option>{dependencyCandidates.map((t) => <option key={t.id} value={t.id}>{t.title}</option>)}</select></label><label style={{ display: "grid", gap: 6 }}><span>工数</span><input type="number" min="1" value={form.workloadPoints} onChange={(e) => setForm((p) => ({ ...p, workloadPoints: e.target.value }))} style={inputStyle} /></label><label style={{ display: "grid", gap: 6, gridColumn: "1 / -1" }}><span>タスク名</span><input value={form.title} onChange={(e) => setForm((p) => ({ ...p, title: e.target.value }))} style={inputStyle} /></label></div><div style={{ marginTop: 12 }}><button type="button" onClick={() => void createTask()} disabled={busy} style={buttonPrimaryStyle}>{busy ? "追加中..." : "タスクを追加"}</button></div></ProjectSection> : null}

      <ProjectSection title="タスク一覧">
        {loading ? <div>読み込み中...</div> : null}
        {!loading ? <div style={{ overflowX: "auto" }}><table style={{ ...tableStyle, minWidth: 1380 }}><thead><tr><th style={thStyle}></th><th style={thStyle}>案件</th><th style={thStyle}>コンテンツ</th><th style={thStyle}>タスク</th><th style={thStyle}>担当</th><th style={thStyle}>日程</th><th style={thStyle}>状態</th><th style={thStyle}>依存</th><th style={thStyle}>操作</th><th style={thStyle}>タイムライン</th></tr></thead><tbody>{filteredTasks.map((task) => { const window = taskWindow(task.planned_start_date, task.planned_end_date); const dependency = task.dependency_task_id ? taskById.get(task.dependency_task_id) : null; const due = task.planned_end_date || task.planned_start_date; const overdue = Boolean(due && task.status !== "done" && due < todayYmd); let bar: { left: number; width: number } | null = null; if (window) { const visibleStart = window.start < range.start ? range.start : window.start; const visibleEnd = window.end > range.end ? range.end : window.end; if (visibleStart <= visibleEnd) { const left = range.span === 1 ? 0 : (daysBetween(range.start, visibleStart) / (range.span - 1)) * 100; const width = range.span === 1 ? 100 : (Math.max(1, daysBetween(visibleStart, visibleEnd) + 1) / range.span) * 100; bar = { left, width: Math.min(100 - left, width) } } } return <tr key={task.id}><td style={tdStyle}><input type="checkbox" checked={selectedIds.includes(task.id)} onChange={() => setSelectedIds((p) => p.includes(task.id) ? p.filter((v) => v !== task.id) : [...p, task.id])} /></td><td style={tdStyle}><Link href={`/projects/${encodeURIComponent(task.project_id)}`} style={{ color: "var(--primary)", textDecoration: "none", fontWeight: 700 }}>{projectNameById.get(task.project_id) ?? task.project_id}</Link></td><td style={tdStyle}>{task.content_id ? textOrDash(contentTitleById.get(task.content_id)) : "-"}</td><td style={tdStyle}><div style={{ fontWeight: 700 }}>{task.title}</div><div style={{ color: "var(--muted)", fontSize: 12 }}>{TASK_TYPE_LABELS[task.task_type] ?? task.task_type}</div></td><td style={tdStyle}>{textOrDash(memberNameById.get(task.assignee_user_id ?? ""))}</td><td style={tdStyle}><div>{textOrDash(task.planned_start_date)}</div><div style={{ color: "var(--muted)", fontSize: 12 }}>{textOrDash(task.planned_end_date)}</div></td><td style={{ ...tdStyle, color: overdue ? "var(--error-text)" : tdStyle.color }}>{TASK_STATUS_LABELS[task.status] ?? task.status}{overdue ? <div style={{ fontSize: 11, marginTop: 4 }}>期限超過</div> : null}</td><td style={tdStyle}>{dependency ? dependency.title : "-"}</td><td style={tdStyle}>{canEdit && dependency ? <button type="button" onClick={() => void alignTaskToDependency(task.id)} style={buttonSecondaryStyle}>依存に追従</button> : <span style={{ color: "var(--muted)" }}>-</span>}</td><td style={tdStyle}>{bar ? <div style={{ minWidth: 320 }}><div style={{ display: "flex", justifyContent: "space-between", color: "var(--muted)", fontSize: 11, marginBottom: 6 }}><span>{range.start}</span><span>{range.label}</span><span>{range.end}</span></div><div style={{ position: "relative", height: 38, borderRadius: 12, background: "rgba(148, 163, 184, 0.12)", border: "1px solid var(--border)", overflow: "hidden" }}>{todayOffset != null ? <div style={{ position: "absolute", top: 0, bottom: 0, left: `${todayOffset}%`, borderLeft: "2px solid rgba(220, 38, 38, 0.5)" }} /> : null}<div style={{ position: "absolute", top: 13, left: `${bar.left}%`, width: `${Math.max(bar.width, 6)}%`, height: 12, minWidth: 16, borderRadius: 999, background: task.status === "done" ? "#16a34a" : task.status === "blocked" ? "#f59e0b" : "#4f46e5" }} /></div></div> : <span style={{ color: "var(--muted)" }}>日程未設定</span>}</td></tr> })}{filteredTasks.length === 0 ? <tr><td colSpan={10} style={tdStyle}>該当するタスクはありません。</td></tr> : null}</tbody></table></div> : null}
      </ProjectSection>
    </ProjectShell>
  )
}
