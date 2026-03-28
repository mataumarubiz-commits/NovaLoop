"use client"

import { useMemo, useState } from "react"
import Link from "next/link"
import { useSearchParams } from "next/navigation"
import { ProjectInfoCard, ProjectSection, ProjectShell } from "@/components/project/ProjectShell"
import {
  buttonPrimaryStyle,
  buttonSecondaryStyle,
  formatDateTime,
  inputStyle,
  tableStyle,
  tdStyle,
  textOrDash,
  thStyle,
} from "@/components/project/projectPageStyles"
import { useProjectWorkspace } from "@/hooks/useProjectWorkspace"
import { EVENT_TYPE_LABELS } from "@/lib/projectWorkspace"
import { supabase } from "@/lib/supabase"

type ViewMode = "day" | "week" | "month"

function toIcsTimestamp(value: string, allDay: boolean) {
  const date = new Date(value)
  if (allDay) {
    const y = date.getUTCFullYear()
    const m = String(date.getUTCMonth() + 1).padStart(2, "0")
    const d = String(date.getUTCDate()).padStart(2, "0")
    return `${y}${m}${d}`
  }
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z")
}

function escapeIcsText(value: string) {
  return value.replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/,/g, "\\,").replace(/;/g, "\\;")
}

function startOfToday() {
  const date = new Date()
  date.setHours(0, 0, 0, 0)
  return date
}

function addDays(base: Date, days: number) {
  const next = new Date(base)
  next.setDate(next.getDate() + days)
  return next
}

function addMonths(base: Date, months: number) {
  const next = new Date(base)
  next.setMonth(next.getMonth() + months)
  return next
}

function buildViewRange(viewMode: ViewMode) {
  const start = startOfToday()
  if (viewMode === "day") return { start, end: addDays(start, 1) }
  if (viewMode === "week") return { start, end: addDays(start, 7) }
  return { start, end: addMonths(start, 1) }
}

function buildGoogleCalendarUrl(value: string | null | undefined) {
  const trimmed = String(value ?? "").trim()
  if (!trimmed) return null
  if (/^https?:\/\//i.test(trimmed)) return trimmed
  return `https://calendar.google.com/calendar/u/0/r?cid=${encodeURIComponent(trimmed)}`
}

function buildAssigneeLabel(names: string[]) {
  if (names.length === 0) return "-"
  return names.join(" / ")
}

export default function CalendarPage() {
  const searchParams = useSearchParams()
  const initialProjectId = searchParams.get("projectId") ?? ""
  const { loading, error, canEdit, orgId, clients, projects, contents, members, events, refresh } = useProjectWorkspace()

  const [projectFilter, setProjectFilter] = useState(initialProjectId)
  const [clientFilter, setClientFilter] = useState("")
  const [assigneeFilter, setAssigneeFilter] = useState("")
  const [typeFilter, setTypeFilter] = useState("")
  const [viewMode, setViewMode] = useState<ViewMode>("week")
  const [busy, setBusy] = useState(false)
  const [uiError, setUiError] = useState<string | null>(null)
  const [uiSuccess, setUiSuccess] = useState<string | null>(null)
  const [form, setForm] = useState({
    projectId: initialProjectId,
    contentId: "",
    eventType: "editor_due",
    title: "",
    startDate: "",
    endDate: "",
    allDay: true,
  })

  const projectById = useMemo(() => new Map(projects.map((project) => [project.id, project])), [projects])
  const contentById = useMemo(() => new Map(contents.map((content) => [content.id, content])), [contents])
  const clientNameById = useMemo(() => new Map(clients.map((client) => [client.id, client.name])), [clients])
  const projectNameById = useMemo(() => new Map(projects.map((project) => [project.id, project.name])), [projects])
  const contentTitleById = useMemo(() => new Map(contents.map((content) => [content.id, content.title])), [contents])
  const memberNameById = useMemo(
    () => new Map(members.map((member) => [member.userId, member.displayName || member.email || member.userId])),
    [members]
  )

  const range = useMemo(() => buildViewRange(viewMode), [viewMode])

  const filteredEvents = useMemo(() => {
    return events
      .filter((event) => !projectFilter || event.project_id === projectFilter)
      .filter((event) => {
        if (!clientFilter) return true
        const project = event.project_id ? projectById.get(event.project_id) : null
        const content = event.content_id ? contentById.get(event.content_id) : null
        return project?.client_id === clientFilter || content?.client_id === clientFilter
      })
      .filter((event) => !typeFilter || event.event_type === typeFilter)
      .filter((event) => {
        if (!assigneeFilter) return true
        const content = event.content_id ? contentById.get(event.content_id) : null
        return (
          content?.assignee_editor_user_id === assigneeFilter || content?.assignee_checker_user_id === assigneeFilter
        )
      })
      .filter((event) => {
        const startAt = new Date(event.start_at)
        return startAt >= range.start && startAt < range.end
      })
      .sort((a, b) => a.start_at.localeCompare(b.start_at))
  }, [assigneeFilter, clientFilter, contentById, events, projectById, projectFilter, range.end, range.start, typeFilter])

  const summary = useMemo(
    () =>
      filteredEvents.reduce(
        (acc, event) => {
          acc.total += 1
          if (event.event_type === "editor_due") acc.editor += 1
          if (event.event_type === "client_due") acc.client += 1
          if (event.event_type === "publish") acc.publish += 1
          if (event.event_type === "meeting") acc.meeting += 1
          return acc
        },
        { total: 0, editor: 0, client: 0, publish: 0, meeting: 0 }
      ),
    [filteredEvents]
  )

  const projectContents = useMemo(
    () => contents.filter((content) => content.project_id === form.projectId),
    [contents, form.projectId]
  )

  const visibleProjects = useMemo(
    () => projects.filter((project) => !clientFilter || project.client_id === clientFilter),
    [clientFilter, projects]
  )

  const assigneeOptions = useMemo(() => {
    const userIds = new Set<string>()
    for (const content of contents) {
      if (projectFilter && content.project_id !== projectFilter) continue
      if (clientFilter) {
        const project = content.project_id ? projectById.get(content.project_id) : null
        if (content.client_id !== clientFilter && project?.client_id !== clientFilter) continue
      }
      if (content.assignee_editor_user_id) userIds.add(content.assignee_editor_user_id)
      if (content.assignee_checker_user_id) userIds.add(content.assignee_checker_user_id)
    }
    return Array.from(userIds).map((userId) => ({
      userId,
      label: memberNameById.get(userId) ?? userId,
    }))
  }, [clientFilter, contents, memberNameById, projectById, projectFilter])

  const selectedProject = projectFilter ? projectById.get(projectFilter) ?? null : null
  const selectedProjectCalendarUrl = buildGoogleCalendarUrl(selectedProject?.google_calendar_id)

  const createEvent = async () => {
    if (!canEdit || !orgId) return
    if (!form.title.trim() || !form.startDate) {
      setUiError("タイトルと開始日を入力してください。")
      return
    }

    const startAt = new Date(`${form.startDate}T09:00:00+09:00`).toISOString()
    const endAt = form.endDate ? new Date(`${form.endDate}T18:00:00+09:00`).toISOString() : null

    setBusy(true)
    setUiError(null)
    setUiSuccess(null)

    const { error: insertError } = await supabase.from("schedule_events").insert({
      id: crypto.randomUUID(),
      org_id: orgId,
      project_id: form.projectId || null,
      content_id: form.contentId || null,
      event_type: form.eventType,
      title: form.title.trim(),
      start_at: startAt,
      end_at: endAt,
      all_day: form.allDay,
    })

    setBusy(false)

    if (insertError) {
      setUiError(`イベント追加に失敗しました: ${insertError.message}`)
      return
    }

    setUiSuccess("イベントを追加しました。")
    setForm((prev) => ({
      ...prev,
      contentId: "",
      title: "",
      startDate: "",
      endDate: "",
      allDay: true,
    }))
    await refresh()
  }

  const exportIcs = () => {
    const lines = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//NovaLoop//Project Calendar//JA",
      "CALSCALE:GREGORIAN",
      ...filteredEvents.flatMap((event) => {
        const start = toIcsTimestamp(event.start_at, event.all_day)
        const endValue = event.end_at || event.start_at
        const end = toIcsTimestamp(endValue, event.all_day)
        const project = event.project_id ? projectNameById.get(event.project_id) : null
        const content = event.content_id ? contentTitleById.get(event.content_id) : null
        const description = [EVENT_TYPE_LABELS[event.event_type] ?? event.event_type, project, content]
          .filter(Boolean)
          .join(" / ")

        return [
          "BEGIN:VEVENT",
          `UID:${event.id}@novaloop.local`,
          `DTSTAMP:${toIcsTimestamp(new Date().toISOString(), false)}`,
          event.all_day ? `DTSTART;VALUE=DATE:${start}` : `DTSTART:${start}`,
          event.all_day ? `DTEND;VALUE=DATE:${end}` : `DTEND:${end}`,
          `SUMMARY:${escapeIcsText(event.title)}`,
          `DESCRIPTION:${escapeIcsText(description)}`,
          "END:VEVENT",
        ]
      }),
      "END:VCALENDAR",
    ]
    const blob = new Blob([lines.join("\r\n")], { type: "text/calendar;charset=utf-8" })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement("a")
    anchor.href = url
    anchor.download = "novaloop-calendar.ics"
    anchor.click()
    URL.revokeObjectURL(url)
  }

  return (
    <ProjectShell
      title="案件カレンダー"
      description="編集締切、先方提出、公開、会議、支払、請求発行、リマインドを案件単位で管理します。"
      action={
        <nav className="page-tab-bar">
          <Link href={`/calendar${initialProjectId ? `?projectId=${encodeURIComponent(initialProjectId)}` : ""}`} data-active="true">カレンダー</Link>
          <Link href={`/timeline${initialProjectId ? `?projectId=${encodeURIComponent(initialProjectId)}` : ""}`} data-active="false">タイムライン</Link>
        </nav>
      }
    >
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12 }}>
        <ProjectInfoCard label="表示イベント" value={`${summary.total}件`} />
        <ProjectInfoCard label="編集締切" value={`${summary.editor}件`} />
        <ProjectInfoCard label="先方提出" value={`${summary.client}件`} />
        <ProjectInfoCard label="公開" value={`${summary.publish}件`} />
        <ProjectInfoCard label="会議" value={`${summary.meeting}件`} />
      </div>

      <ProjectSection
        title="絞り込み"
        description={`表示範囲: ${viewMode === "day" ? "Day" : viewMode === "week" ? "Week" : "Month"}`}
      >
        <div style={{ display: "grid", gap: 10, gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))" }}>
          <label style={{ display: "grid", gap: 6 }}>
            <span>クライアント</span>
            <select value={clientFilter} onChange={(event) => setClientFilter(event.target.value)} style={inputStyle}>
              <option value="">すべて</option>
              {Array.from(new Map(projects.map((project) => [project.client_id, project.client_id])).keys()).map((clientId) => {
                return (
                  <option key={clientId} value={clientId}>
                    {clientNameById.get(clientId) ?? clientId}
                  </option>
                )
              })}
            </select>
          </label>

          <label style={{ display: "grid", gap: 6 }}>
            <span>案件</span>
            <select value={projectFilter} onChange={(event) => setProjectFilter(event.target.value)} style={inputStyle}>
              <option value="">すべて</option>
              {visibleProjects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))}
            </select>
          </label>

          <label style={{ display: "grid", gap: 6 }}>
            <span>担当者</span>
            <select value={assigneeFilter} onChange={(event) => setAssigneeFilter(event.target.value)} style={inputStyle}>
              <option value="">すべて</option>
              {assigneeOptions.map((option) => (
                <option key={option.userId} value={option.userId}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          <label style={{ display: "grid", gap: 6 }}>
            <span>種別</span>
            <select value={typeFilter} onChange={(event) => setTypeFilter(event.target.value)} style={inputStyle}>
              <option value="">すべて</option>
              {Object.entries(EVENT_TYPE_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>

          <div style={{ display: "grid", gap: 6 }}>
            <span>表示範囲</span>
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

          <div style={{ display: "grid", gap: 6, alignContent: "end" }}>
            <span>書き出し</span>
            <button type="button" onClick={exportIcs} style={buttonPrimaryStyle}>
              ICS export
            </button>
          </div>
        </div>

        {selectedProject ? (
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 12 }}>
            <span style={{ ...inputStyle, display: "inline-flex", alignItems: "center", width: "auto" }}>
              Google Calendar ID: {textOrDash(selectedProject.google_calendar_id)}
            </span>
            <button
              type="button"
              onClick={() => {
                if (!selectedProjectCalendarUrl) return
                window.open(selectedProjectCalendarUrl, "_blank", "noopener,noreferrer")
              }}
              disabled={!selectedProjectCalendarUrl}
              style={buttonSecondaryStyle}
            >
              Google Calendar を開く
            </button>
          </div>
        ) : null}
      </ProjectSection>

      {canEdit ? (
        <ProjectSection
          title="イベント追加"
          description="案件に紐づく予定を明示登録し、ICS export や Google Calendar 連携の起点にします。"
        >
          <div style={{ display: "grid", gap: 10, gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))" }}>
            <label style={{ display: "grid", gap: 6 }}>
              <span>案件</span>
              <select
                value={form.projectId}
                onChange={(event) => setForm((prev) => ({ ...prev, projectId: event.target.value, contentId: "" }))}
                style={inputStyle}
              >
                <option value="">未設定</option>
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
                value={form.eventType}
                onChange={(event) => setForm((prev) => ({ ...prev, eventType: event.target.value }))}
                style={inputStyle}
              >
                {Object.entries(EVENT_TYPE_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>

            <label style={{ display: "grid", gap: 6 }}>
              <span>開始日</span>
              <input
                type="date"
                value={form.startDate}
                onChange={(event) => setForm((prev) => ({ ...prev, startDate: event.target.value }))}
                style={inputStyle}
              />
            </label>

            <label style={{ display: "grid", gap: 6 }}>
              <span>終了日</span>
              <input
                type="date"
                value={form.endDate}
                onChange={(event) => setForm((prev) => ({ ...prev, endDate: event.target.value }))}
                style={inputStyle}
              />
            </label>

            <label style={{ display: "grid", gap: 6 }}>
              <span>終日</span>
              <select
                value={form.allDay ? "true" : "false"}
                onChange={(event) => setForm((prev) => ({ ...prev, allDay: event.target.value === "true" }))}
                style={inputStyle}
              >
                <option value="true">終日</option>
                <option value="false">時間あり</option>
              </select>
            </label>

            <label style={{ display: "grid", gap: 6, gridColumn: "1 / -1" }}>
              <span>タイトル</span>
              <input
                value={form.title}
                onChange={(event) => setForm((prev) => ({ ...prev, title: event.target.value }))}
                style={inputStyle}
              />
            </label>
          </div>

          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center", marginTop: 12 }}>
            <button type="button" onClick={() => void createEvent()} disabled={busy} style={buttonPrimaryStyle}>
              {busy ? "保存中..." : "イベントを追加"}
            </button>
            {uiError ? <span style={{ color: "var(--error-text)", fontSize: 13 }}>{uiError}</span> : null}
            {uiSuccess ? <span style={{ color: "var(--success-text)", fontSize: 13 }}>{uiSuccess}</span> : null}
          </div>
        </ProjectSection>
      ) : null}

      <ProjectSection title="イベント一覧" description="案件、クライアント、担当者に紐づく予定を横断で確認します。">
        {loading ? <div>読み込み中...</div> : null}
        {error ? <div style={{ color: "var(--error-text)" }}>{error}</div> : null}
        {!loading ? (
          <div style={{ overflowX: "auto" }}>
            <table style={{ ...tableStyle, minWidth: 1320 }}>
              <thead>
                <tr>
                  <th style={thStyle}>開始</th>
                  <th style={thStyle}>終了</th>
                  <th style={thStyle}>種別</th>
                  <th style={thStyle}>タイトル</th>
                  <th style={thStyle}>クライアント</th>
                  <th style={thStyle}>案件</th>
                  <th style={thStyle}>コンテンツ</th>
                  <th style={thStyle}>担当者</th>
                </tr>
              </thead>
              <tbody>
                {filteredEvents.map((event) => {
                  const project = event.project_id ? projectById.get(event.project_id) ?? null : null
                  const content = event.content_id ? contentById.get(event.content_id) ?? null : null
                  const assigneeNames = [
                    content?.assignee_editor_user_id ? memberNameById.get(content.assignee_editor_user_id) ?? content.assignee_editor_user_id : null,
                    content?.assignee_checker_user_id ? memberNameById.get(content.assignee_checker_user_id) ?? content.assignee_checker_user_id : null,
                  ].filter((value): value is string => Boolean(value))

                  return (
                    <tr key={event.id}>
                      <td style={tdStyle}>{formatDateTime(event.start_at, event.all_day)}</td>
                      <td style={tdStyle}>{formatDateTime(event.end_at, event.all_day)}</td>
                      <td style={tdStyle}>{EVENT_TYPE_LABELS[event.event_type] ?? event.event_type}</td>
                      <td style={tdStyle}>{event.title}</td>
                      <td style={tdStyle}>{textOrDash(clientNameById.get(project?.client_id ?? content?.client_id ?? "") ?? null)}</td>
                      <td style={tdStyle}>{textOrDash(projectNameById.get(event.project_id ?? ""))}</td>
                      <td style={tdStyle}>{textOrDash(contentTitleById.get(event.content_id ?? ""))}</td>
                      <td style={tdStyle}>{buildAssigneeLabel(assigneeNames)}</td>
                    </tr>
                  )
                })}
                {filteredEvents.length === 0 ? (
                  <tr>
                    <td colSpan={8} style={tdStyle}>
                      条件に合うイベントはありません。
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
