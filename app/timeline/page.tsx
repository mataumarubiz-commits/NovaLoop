"use client"

import Link from "next/link"
import { useMemo, useState } from "react"
import { useSearchParams } from "next/navigation"
import { ProjectInfoCard, ProjectSection, ProjectShell } from "@/components/project/ProjectShell"
import {
  buttonPrimaryStyle,
  inputStyle,
  tableStyle,
  tdStyle,
  textOrDash,
  thStyle,
} from "@/components/project/projectPageStyles"
import { useProjectWorkspace } from "@/hooks/useProjectWorkspace"
import { supabase } from "@/lib/supabase"

type ViewMode = "day" | "week" | "month"

const TASK_TYPE_LABELS: Record<string, string> = {
  materials: "素材確認",
  script: "台本",
  editing: "編集",
  internal_review: "内部確認",
  client_review: "先方確認",
  revision: "修正",
  publishing: "公開準備",
  publish: "公開",
}

const TASK_STATUS_LABELS: Record<string, string> = {
  not_started: "未着手",
  in_progress: "進行中",
  blocked: "ブロック",
  done: "完了",
}

function parseYmd(value: string) {
  return new Date(`${value}T00:00:00`)
}

function toYmd(value: Date) {
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`
}

function addDays(value: string, days: number) {
  const next = parseYmd(value)
  next.setDate(next.getDate() + days)
  return toYmd(next)
}

function startOfWeek(value: string) {
  const date = parseYmd(value)
  const diff = (date.getDay() + 6) % 7
  date.setDate(date.getDate() - diff)
  return toYmd(date)
}

function endOfWeek(value: string) {
  return addDays(startOfWeek(value), 6)
}

function startOfMonth(value: string) {
  const date = parseYmd(value)
  date.setDate(1)
  return toYmd(date)
}

function endOfMonth(value: string) {
  const date = parseYmd(startOfMonth(value))
  date.setMonth(date.getMonth() + 1)
  date.setDate(0)
  return toYmd(date)
}

function daysBetween(start: string, end: string) {
  return Math.max(0, Math.round((parseYmd(end).getTime() - parseYmd(start).getTime()) / 86400000))
}

function formatRangeLabel(start: string, end: string) {
  return `${start} - ${end}`
}

function formatTickLabel(value: string, viewMode: ViewMode) {
  const date = parseYmd(value)
  if (viewMode === "month") {
    return `${date.getMonth() + 1}/${date.getDate()}`
  }
  const weekday = ["日", "月", "火", "水", "木", "金", "土"][date.getDay()]
  return `${date.getMonth() + 1}/${date.getDate()} ${weekday}`
}

function buildRangeMarkers(start: string, end: string, viewMode: ViewMode) {
  const span = Math.max(1, daysBetween(start, end) + 1)
  const markers: Array<{ value: string; left: number }> = []
  const step = viewMode === "day" ? 1 : viewMode === "week" ? 1 : 7

  for (let index = 0; index < span; index += step) {
    const value = addDays(start, index)
    markers.push({
      value,
      left: span === 1 ? 0 : (index / (span - 1)) * 100,
    })
  }

  if (markers[markers.length - 1]?.value !== end) {
    markers.push({ value: end, left: 100 })
  }

  return markers
}

function taskWindow(start?: string | null, end?: string | null) {
  const safeStart = start || end || null
  const safeEnd = end || start || null
  if (!safeStart || !safeEnd) return null
  return { start: safeStart, end: safeEnd }
}

function overlapsRange(window: { start: string; end: string }, range: { start: string; end: string }) {
  return window.start <= range.end && window.end >= range.start
}

function buildViewRange(viewMode: ViewMode, todayYmd: string) {
  if (viewMode === "day") {
    return {
      start: todayYmd,
      end: todayYmd,
      span: 1,
      label: "本日",
      markers: [{ value: todayYmd, left: 0 }],
    }
  }

  if (viewMode === "week") {
    const start = startOfWeek(todayYmd)
    const end = endOfWeek(todayYmd)
    const span = daysBetween(start, end) + 1
    return {
      start,
      end,
      span,
      label: "今週",
      markers: buildRangeMarkers(start, end, viewMode),
    }
  }

  const start = startOfMonth(todayYmd)
  const end = endOfMonth(todayYmd)
  const span = daysBetween(start, end) + 1
  return {
    start,
    end,
    span,
    label: "今月",
    markers: buildRangeMarkers(start, end, viewMode),
  }
}

export default function TimelinePage() {
  const searchParams = useSearchParams()
  const initialProjectId = searchParams.get("projectId") ?? ""
  const {
    loading,
    error,
    canEdit,
    orgId,
    todayYmd,
    members,
    projects,
    contents,
    tasks,
    refresh,
  } = useProjectWorkspace()

  const [projectFilter, setProjectFilter] = useState(initialProjectId)
  const [statusFilter, setStatusFilter] = useState("")
  const [assigneeFilter, setAssigneeFilter] = useState("")
  const [viewMode, setViewMode] = useState<ViewMode>("week")
  const [busy, setBusy] = useState(false)
  const [uiError, setUiError] = useState<string | null>(null)
  const [uiSuccess, setUiSuccess] = useState<string | null>(null)
  const [form, setForm] = useState({
    projectId: initialProjectId,
    contentId: "",
    taskType: "materials",
    title: "",
    assigneeUserId: "",
    plannedStartDate: "",
    plannedEndDate: "",
    status: "not_started",
    dependencyTaskId: "",
    workloadPoints: "1",
  })

  const range = useMemo(() => buildViewRange(viewMode, todayYmd), [todayYmd, viewMode])

  const memberNameById = useMemo(
    () => new Map(members.map((member) => [member.userId, member.displayName || member.email || member.userId])),
    [members]
  )
  const projectNameById = useMemo(() => new Map(projects.map((project) => [project.id, project.name])), [projects])
  const contentTitleById = useMemo(() => new Map(contents.map((content) => [content.id, content.title])), [contents])
  const taskTitleById = useMemo(() => new Map(tasks.map((task) => [task.id, task.title])), [tasks])

  const filteredTasks = useMemo(() => {
    return tasks
      .filter((task) => !projectFilter || task.project_id === projectFilter)
      .filter((task) => !statusFilter || task.status === statusFilter)
      .filter((task) => !assigneeFilter || task.assignee_user_id === assigneeFilter)
      .filter((task) => {
        const window = taskWindow(task.planned_start_date, task.planned_end_date)
        return !window || overlapsRange(window, range)
      })
      .sort((left, right) => {
        const leftKey = left.planned_start_date || left.planned_end_date || left.created_at
        const rightKey = right.planned_start_date || right.planned_end_date || right.created_at
        return leftKey.localeCompare(rightKey) || left.title.localeCompare(right.title)
      })
  }, [assigneeFilter, projectFilter, range, statusFilter, tasks])

  const summary = useMemo(() => {
    return filteredTasks.reduce(
      (acc, task) => {
        const due = task.planned_end_date || task.planned_start_date
        acc.total += 1
        if (task.status === "done") acc.done += 1
        if (task.status === "blocked") acc.blocked += 1
        if (!task.planned_start_date && !task.planned_end_date) acc.unscheduled += 1
        if (task.dependency_task_id) acc.dependency += 1
        if (due && task.status !== "done" && due < todayYmd) acc.overdue += 1
        acc.workload += Number(task.workload_points || 0)
        return acc
      },
      { total: 0, done: 0, blocked: 0, overdue: 0, unscheduled: 0, dependency: 0, workload: 0 }
    )
  }, [filteredTasks, todayYmd])

  const projectContents = useMemo(
    () => contents.filter((content) => content.project_id === form.projectId),
    [contents, form.projectId]
  )

  const dependencyCandidates = useMemo(
    () =>
      tasks
        .filter((task) => task.project_id === form.projectId)
        .sort((left, right) => {
          const leftKey = left.planned_start_date || left.planned_end_date || left.created_at
          const rightKey = right.planned_start_date || right.planned_end_date || right.created_at
          return leftKey.localeCompare(rightKey) || left.title.localeCompare(right.title)
        }),
    [form.projectId, tasks]
  )

  const createTask = async () => {
    if (!canEdit || !orgId) return

    if (!form.projectId || !form.title.trim()) {
      setUiError("案件とタスク名を入力してください。")
      return
    }

    if (form.plannedStartDate && form.plannedEndDate && form.plannedStartDate > form.plannedEndDate) {
      setUiError("開始日は終了日以前で設定してください。")
      return
    }

    setBusy(true)
    setUiError(null)
    setUiSuccess(null)

    const { error: insertError } = await supabase.from("project_tasks").insert({
      id: crypto.randomUUID(),
      org_id: orgId,
      project_id: form.projectId,
      content_id: form.contentId || null,
      task_type: form.taskType,
      title: form.title.trim(),
      assignee_user_id: form.assigneeUserId || null,
      planned_start_date: form.plannedStartDate || null,
      planned_end_date: form.plannedEndDate || null,
      status: form.status,
      dependency_task_id: form.dependencyTaskId || null,
      workload_points: Number(form.workloadPoints || 1),
    })

    setBusy(false)

    if (insertError) {
      setUiError(`タスクの作成に失敗しました: ${insertError.message}`)
      return
    }

    setUiSuccess("タスクを追加しました。")
    setForm((prev) => ({
      ...prev,
      contentId: "",
      title: "",
      assigneeUserId: "",
      plannedStartDate: "",
      plannedEndDate: "",
      status: "not_started",
      dependencyTaskId: "",
      workloadPoints: "1",
    }))
    await refresh()
  }

  const todayOffset =
    todayYmd >= range.start && todayYmd <= range.end && range.span > 1
      ? (daysBetween(range.start, todayYmd) / (range.span - 1)) * 100
      : range.span === 1
        ? 50
        : null

  return (
    <ProjectShell
      title="タイムライン"
      description="案件単位でタスク、担当、依存関係、日程レンジをまとめて確認できます。"
    >
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12 }}>
        <ProjectInfoCard label="表示タスク" value={`${summary.total}件`} />
        <ProjectInfoCard label="完了" value={`${summary.done}件`} accent={summary.done > 0 ? "#166534" : undefined} />
        <ProjectInfoCard label="ブロック" value={`${summary.blocked}件`} accent={summary.blocked > 0 ? "#b45309" : undefined} />
        <ProjectInfoCard label="期限超過" value={`${summary.overdue}件`} accent={summary.overdue > 0 ? "#b91c1c" : undefined} />
        <ProjectInfoCard label="日程未設定" value={`${summary.unscheduled}件`} accent={summary.unscheduled > 0 ? "#475569" : undefined} />
        <ProjectInfoCard label="依存あり" value={`${summary.dependency}件`} />
        <ProjectInfoCard label="工数ポイント" value={`${summary.workload}`} />
      </div>

      <ProjectSection
        title="絞り込み"
        description={`${range.label}: ${formatRangeLabel(range.start, range.end)}`}
      >
        <div style={{ display: "grid", gap: 10, gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))" }}>
          <label style={{ display: "grid", gap: 6 }}>
            <span>案件</span>
            <select value={projectFilter} onChange={(event) => setProjectFilter(event.target.value)} style={inputStyle}>
              <option value="">すべて</option>
              {projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))}
            </select>
          </label>
          <label style={{ display: "grid", gap: 6 }}>
            <span>担当</span>
            <select value={assigneeFilter} onChange={(event) => setAssigneeFilter(event.target.value)} style={inputStyle}>
              <option value="">すべて</option>
              {members.map((member) => (
                <option key={member.userId} value={member.userId}>
                  {member.displayName || member.email || member.userId}
                </option>
              ))}
            </select>
          </label>
          <label style={{ display: "grid", gap: 6 }}>
            <span>状態</span>
            <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} style={inputStyle}>
              <option value="">すべて</option>
              {Object.entries(TASK_STATUS_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <div style={{ display: "grid", gap: 6 }}>
            <span>表示レンジ</span>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {(["day", "week", "month"] as const).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => setViewMode(mode)}
                  style={{
                    ...buttonPrimaryStyle,
                    padding: "8px 12px",
                    background: viewMode === mode ? "var(--button-primary-bg)" : "var(--surface-2)",
                    borderColor: viewMode === mode ? "var(--button-primary-bg)" : "var(--border)",
                    color: viewMode === mode ? "var(--primary-contrast)" : "var(--text)",
                  }}
                >
                  {mode === "day" ? "Day" : mode === "week" ? "Week" : "Month"}
                </button>
              ))}
            </div>
          </div>
        </div>
      </ProjectSection>

      {canEdit ? (
        <ProjectSection
          title="タスク追加"
          description="案件、コンテンツ、依存タスクまで指定して新規タスクを登録します。"
        >
          <div style={{ display: "grid", gap: 10, gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))" }}>
            <label style={{ display: "grid", gap: 6 }}>
              <span>案件</span>
              <select
                value={form.projectId}
                onChange={(event) =>
                  setForm((prev) => ({
                    ...prev,
                    projectId: event.target.value,
                    contentId: "",
                    dependencyTaskId: "",
                  }))
                }
                style={inputStyle}
              >
                <option value="">選択してください</option>
                {projects.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.name}
                  </option>
                ))}
              </select>
            </label>
            <label style={{ display: "grid", gap: 6 }}>
              <span>コンテンツ</span>
              <select
                value={form.contentId}
                onChange={(event) => setForm((prev) => ({ ...prev, contentId: event.target.value }))}
                style={inputStyle}
              >
                <option value="">未設定</option>
                {projectContents.map((content) => (
                  <option key={content.id} value={content.id}>
                    {content.title}
                  </option>
                ))}
              </select>
            </label>
            <label style={{ display: "grid", gap: 6 }}>
              <span>種別</span>
              <select
                value={form.taskType}
                onChange={(event) => setForm((prev) => ({ ...prev, taskType: event.target.value }))}
                style={inputStyle}
              >
                {Object.entries(TASK_TYPE_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label style={{ display: "grid", gap: 6 }}>
              <span>担当</span>
              <select
                value={form.assigneeUserId}
                onChange={(event) => setForm((prev) => ({ ...prev, assigneeUserId: event.target.value }))}
                style={inputStyle}
              >
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
              <input
                type="date"
                value={form.plannedStartDate}
                onChange={(event) => setForm((prev) => ({ ...prev, plannedStartDate: event.target.value }))}
                style={inputStyle}
              />
            </label>
            <label style={{ display: "grid", gap: 6 }}>
              <span>終了日</span>
              <input
                type="date"
                value={form.plannedEndDate}
                onChange={(event) => setForm((prev) => ({ ...prev, plannedEndDate: event.target.value }))}
                style={inputStyle}
              />
            </label>
            <label style={{ display: "grid", gap: 6 }}>
              <span>状態</span>
              <select
                value={form.status}
                onChange={(event) => setForm((prev) => ({ ...prev, status: event.target.value }))}
                style={inputStyle}
              >
                {Object.entries(TASK_STATUS_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label style={{ display: "grid", gap: 6 }}>
              <span>依存タスク</span>
              <select
                value={form.dependencyTaskId}
                onChange={(event) => setForm((prev) => ({ ...prev, dependencyTaskId: event.target.value }))}
                style={inputStyle}
              >
                <option value="">なし</option>
                {dependencyCandidates.map((task) => (
                  <option key={task.id} value={task.id}>
                    {task.title}
                  </option>
                ))}
              </select>
            </label>
            <label style={{ display: "grid", gap: 6 }}>
              <span>工数ポイント</span>
              <input
                type="number"
                min="1"
                value={form.workloadPoints}
                onChange={(event) => setForm((prev) => ({ ...prev, workloadPoints: event.target.value }))}
                style={inputStyle}
              />
            </label>
            <label style={{ display: "grid", gap: 6, gridColumn: "1 / -1" }}>
              <span>タスク名</span>
              <input
                value={form.title}
                onChange={(event) => setForm((prev) => ({ ...prev, title: event.target.value }))}
                style={inputStyle}
              />
            </label>
          </div>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center", marginTop: 12 }}>
            <button type="button" onClick={() => void createTask()} disabled={busy} style={buttonPrimaryStyle}>
              {busy ? "登録中..." : "タスクを追加"}
            </button>
            {uiError ? <span style={{ color: "#b91c1c", fontSize: 13 }}>{uiError}</span> : null}
            {uiSuccess ? <span style={{ color: "#166534", fontSize: 13 }}>{uiSuccess}</span> : null}
          </div>
        </ProjectSection>
      ) : null}

      <ProjectSection
        title="タスク一覧"
        description={`${range.label}のレンジに重なるタスクを表示します。日程未設定のタスクは常に表示します。`}
      >
        {loading ? <div>読み込み中...</div> : null}
        {error ? <div style={{ color: "#b91c1c" }}>{error}</div> : null}
        {!loading ? (
          <div style={{ overflowX: "auto" }}>
            <table style={{ ...tableStyle, minWidth: 1240 }}>
              <thead>
                <tr>
                  <th style={thStyle}>案件</th>
                  <th style={thStyle}>コンテンツ</th>
                  <th style={thStyle}>タスク</th>
                  <th style={thStyle}>担当</th>
                  <th style={thStyle}>日程</th>
                  <th style={thStyle}>状態</th>
                  <th style={thStyle}>依存</th>
                  <th style={thStyle}>タイムライン</th>
                </tr>
              </thead>
              <tbody>
                {filteredTasks.map((task) => {
                  const window = taskWindow(task.planned_start_date, task.planned_end_date)
                  const due = task.planned_end_date || task.planned_start_date
                  const isOverdue = Boolean(due && task.status !== "done" && due < todayYmd)
                  let bar: { left: number; width: number } | null = null

                  if (window) {
                    const visibleStart = window.start < range.start ? range.start : window.start
                    const visibleEnd = window.end > range.end ? range.end : window.end
                    if (visibleStart <= visibleEnd) {
                      const leftBase = range.span === 1 ? 0 : (daysBetween(range.start, visibleStart) / (range.span - 1)) * 100
                      const widthBase = range.span === 1 ? 100 : (Math.max(1, daysBetween(visibleStart, visibleEnd) + 1) / range.span) * 100
                      bar = { left: leftBase, width: Math.min(100 - leftBase, widthBase) }
                    }
                  }

                  return (
                    <tr key={task.id}>
                      <td style={tdStyle}>
                        <Link
                          href={`/projects/${encodeURIComponent(task.project_id)}`}
                          style={{ color: "var(--primary)", textDecoration: "none", fontWeight: 700 }}
                        >
                          {projectNameById.get(task.project_id) ?? task.project_id}
                        </Link>
                      </td>
                      <td style={tdStyle}>{task.content_id ? textOrDash(contentTitleById.get(task.content_id)) : "-"}</td>
                      <td style={tdStyle}>
                        <div style={{ fontWeight: 700 }}>{task.title}</div>
                        <div style={{ color: "var(--muted)", fontSize: 12 }}>
                          {TASK_TYPE_LABELS[task.task_type] ?? task.task_type}
                        </div>
                      </td>
                      <td style={tdStyle}>{textOrDash(memberNameById.get(task.assignee_user_id ?? ""))}</td>
                      <td style={tdStyle}>
                        <div>{textOrDash(task.planned_start_date)}</div>
                        <div style={{ color: "var(--muted)", fontSize: 12 }}>{textOrDash(task.planned_end_date)}</div>
                      </td>
                      <td style={{ ...tdStyle, color: isOverdue ? "#b91c1c" : tdStyle.color }}>
                        {TASK_STATUS_LABELS[task.status] ?? task.status}
                        {isOverdue ? <div style={{ fontSize: 11, marginTop: 4 }}>期限超過</div> : null}
                      </td>
                      <td style={tdStyle}>{textOrDash(taskTitleById.get(task.dependency_task_id ?? ""))}</td>
                      <td style={tdStyle}>
                        {bar ? (
                          <div style={{ minWidth: 320 }}>
                            <div
                              style={{
                                display: "flex",
                                justifyContent: "space-between",
                                color: "var(--muted)",
                                fontSize: 11,
                                marginBottom: 6,
                              }}
                            >
                              <span>{range.start}</span>
                              <span>{range.label}</span>
                              <span>{range.end}</span>
                            </div>
                            <div
                              style={{
                                position: "relative",
                                height: 38,
                                borderRadius: 12,
                                background: "rgba(148, 163, 184, 0.12)",
                                border: "1px solid var(--border)",
                                overflow: "hidden",
                              }}
                            >
                              {range.markers.map((marker) => (
                                <div
                                  key={`${task.id}-${marker.value}`}
                                  style={{
                                    position: "absolute",
                                    top: 0,
                                    bottom: 0,
                                    left: `${marker.left}%`,
                                    borderLeft: "1px dashed rgba(100, 116, 139, 0.28)",
                                  }}
                                >
                                  <span
                                    style={{
                                      position: "absolute",
                                      top: 2,
                                      left: 4,
                                      fontSize: 10,
                                      color: "var(--muted)",
                                      whiteSpace: "nowrap",
                                    }}
                                  >
                                    {formatTickLabel(marker.value, viewMode)}
                                  </span>
                                </div>
                              ))}
                              {todayOffset != null ? (
                                <div
                                  style={{
                                    position: "absolute",
                                    top: 0,
                                    bottom: 0,
                                    left: `${todayOffset}%`,
                                    borderLeft: "2px solid rgba(220, 38, 38, 0.5)",
                                  }}
                                />
                              ) : null}
                              <div
                                style={{
                                  position: "absolute",
                                  top: 18,
                                  left: `${bar.left}%`,
                                  width: `${Math.max(bar.width, 6)}%`,
                                  height: 12,
                                  minWidth: 16,
                                  borderRadius: 999,
                                  background:
                                    task.status === "done"
                                      ? "#16a34a"
                                      : task.status === "blocked"
                                        ? "#f59e0b"
                                        : "#4f46e5",
                                }}
                              />
                            </div>
                          </div>
                        ) : (
                          <span style={{ color: "var(--muted)" }}>日程未設定</span>
                        )}
                      </td>
                    </tr>
                  )
                })}
                {filteredTasks.length === 0 ? (
                  <tr>
                    <td colSpan={8} style={tdStyle}>
                      条件に一致するタスクはありません。
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        ) : null}
      </ProjectSection>
    </ProjectShell>
  )
}
