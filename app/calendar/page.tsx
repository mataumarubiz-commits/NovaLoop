"use client"

import { useMemo, useState } from "react"
import { useSearchParams } from "next/navigation"
import { ProjectInfoCard, ProjectSection, ProjectShell } from "@/components/project/ProjectShell"
import {
  buttonPrimaryStyle,
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

export default function CalendarPage() {
  const searchParams = useSearchParams()
  const initialProjectId = searchParams.get("projectId") ?? ""
  const {
    loading,
    error,
    canEdit,
    orgId,
    projects,
    contents,
    events,
    refresh,
  } = useProjectWorkspace()

  const [projectFilter, setProjectFilter] = useState(initialProjectId)
  const [typeFilter, setTypeFilter] = useState("")
  const [viewMode, setViewMode] = useState<"day" | "week" | "month">("week")
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

  const projectNameById = useMemo(() => new Map(projects.map((project) => [project.id, project.name])), [projects])
  const contentTitleById = useMemo(() => new Map(contents.map((content) => [content.id, content.title])), [contents])

  const filteredEvents = useMemo(() => {
    const now = new Date()
    const start = new Date(now)
    const end = new Date(now)
    if (viewMode === "day") {
      end.setDate(end.getDate() + 1)
    } else if (viewMode === "week") {
      end.setDate(end.getDate() + 7)
    } else {
      end.setMonth(end.getMonth() + 1)
    }

    return events
      .filter((event) => !projectFilter || event.project_id === projectFilter)
      .filter((event) => !typeFilter || event.event_type === typeFilter)
      .filter((event) => {
        const startAt = new Date(event.start_at)
        return startAt >= start && startAt <= end
      })
      .sort((a, b) => a.start_at.localeCompare(b.start_at))
  }, [events, projectFilter, typeFilter, viewMode])

  const summary = useMemo(() => {
    return filteredEvents.reduce(
      (acc, event) => {
        acc.total += 1
        if (event.event_type === "editor_due") acc.editor += 1
        if (event.event_type === "client_due") acc.client += 1
        if (event.event_type === "publish") acc.publish += 1
        if (event.event_type === "meeting") acc.meeting += 1
        return acc
      },
      { total: 0, editor: 0, client: 0, publish: 0, meeting: 0 }
    )
  }, [filteredEvents])

  const projectContents = useMemo(
    () => contents.filter((content) => content.project_id === form.projectId),
    [contents, form.projectId]
  )

  const createEvent = async () => {
    if (!canEdit || !orgId) return
    if (!form.title.trim() || !form.startDate) {
      setUiError("タイトルと開始日を入力してください。")
      return
    }

    const startAt = new Date(`${form.startDate}T09:00:00+09:00`).toISOString()
    const endAt = form.endDate
      ? new Date(`${form.endDate}T18:00:00+09:00`).toISOString()
      : null

    setBusy(true)
    setUiError(null)
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
      setUiError(`イベントの作成に失敗しました: ${insertError.message}`)
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
        return [
          "BEGIN:VEVENT",
          `UID:${event.id}@novaloop.local`,
          `DTSTAMP:${toIcsTimestamp(new Date().toISOString(), false)}`,
          event.all_day ? `DTSTART;VALUE=DATE:${start}` : `DTSTART:${start}`,
          event.all_day ? `DTEND;VALUE=DATE:${end}` : `DTEND:${end}`,
          `SUMMARY:${escapeIcsText(event.title)}`,
          `DESCRIPTION:${escapeIcsText(EVENT_TYPE_LABELS[event.event_type] ?? event.event_type)}`,
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
    <ProjectShell title="案件カレンダー" description="編集提出、先方提出、公開、MTG などの予定を案件横断で管理します。">
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12 }}>
        <ProjectInfoCard label="対象イベント" value={`${summary.total}件`} />
        <ProjectInfoCard label="編集提出" value={`${summary.editor}件`} />
        <ProjectInfoCard label="先方提出" value={`${summary.client}件`} />
        <ProjectInfoCard label="公開" value={`${summary.publish}件`} />
        <ProjectInfoCard label="MTG" value={`${summary.meeting}件`} />
      </div>

      <ProjectSection title="絞り込み" description="表示期間は当日から Day / Week / Month の範囲で切り替えます。">
        <div style={{ display: "grid", gap: 10, gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))" }}>
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
            <span>表示期間</span>
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
      </ProjectSection>

      {canEdit ? (
        <ProjectSection title="イベント追加" description="Google Calendar 本連携前の運用として、案件側で予定を明示的に持てるようにします。">
          <div style={{ display: "grid", gap: 10, gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))" }}>
            <label style={{ display: "grid", gap: 6 }}>
              <span>案件</span>
              <select value={form.projectId} onChange={(event) => setForm((prev) => ({ ...prev, projectId: event.target.value, contentId: "" }))} style={inputStyle}>
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
              <select value={form.contentId} onChange={(event) => setForm((prev) => ({ ...prev, contentId: event.target.value }))} style={inputStyle}>
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
              <select value={form.eventType} onChange={(event) => setForm((prev) => ({ ...prev, eventType: event.target.value }))} style={inputStyle}>
                {Object.entries(EVENT_TYPE_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
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
              <span>終日</span>
              <select value={form.allDay ? "true" : "false"} onChange={(event) => setForm((prev) => ({ ...prev, allDay: event.target.value === "true" }))} style={inputStyle}>
                <option value="true">終日</option>
                <option value="false">時刻付き扱い</option>
              </select>
            </label>
            <label style={{ display: "grid", gap: 6, gridColumn: "1 / -1" }}>
              <span>タイトル</span>
              <input value={form.title} onChange={(event) => setForm((prev) => ({ ...prev, title: event.target.value }))} style={inputStyle} />
            </label>
          </div>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center", marginTop: 12 }}>
            <button type="button" onClick={() => void createEvent()} disabled={busy} style={buttonPrimaryStyle}>
              {busy ? "保存中..." : "イベントを追加"}
            </button>
            {uiError ? <span style={{ color: "#b91c1c", fontSize: 13 }}>{uiError}</span> : null}
            {uiSuccess ? <span style={{ color: "#166534", fontSize: 13 }}>{uiSuccess}</span> : null}
          </div>
        </ProjectSection>
      ) : null}

      <ProjectSection title="イベント一覧" description="案件 / コンテンツ単位の予定を時系列で確認できます。">
        {loading ? <div>読み込み中...</div> : null}
        {error ? <div style={{ color: "#b91c1c" }}>{error}</div> : null}
        {!loading ? (
          <div style={{ overflowX: "auto" }}>
            <table style={{ ...tableStyle, minWidth: 1080 }}>
              <thead>
                <tr>
                  <th style={thStyle}>開始</th>
                  <th style={thStyle}>終了</th>
                  <th style={thStyle}>種別</th>
                  <th style={thStyle}>タイトル</th>
                  <th style={thStyle}>案件</th>
                  <th style={thStyle}>コンテンツ</th>
                </tr>
              </thead>
              <tbody>
                {filteredEvents.map((event) => (
                  <tr key={event.id}>
                    <td style={tdStyle}>{formatDateTime(event.start_at, event.all_day)}</td>
                    <td style={tdStyle}>{formatDateTime(event.end_at, event.all_day)}</td>
                    <td style={tdStyle}>{EVENT_TYPE_LABELS[event.event_type] ?? event.event_type}</td>
                    <td style={tdStyle}>{event.title}</td>
                    <td style={tdStyle}>{textOrDash(projectNameById.get(event.project_id ?? ""))}</td>
                    <td style={tdStyle}>{textOrDash(contentTitleById.get(event.content_id ?? ""))}</td>
                  </tr>
                ))}
                {filteredEvents.length === 0 ? (
                  <tr>
                    <td colSpan={6} style={tdStyle}>
                      該当するイベントはありません。
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
