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
  textareaStyle,
  textOrDash,
  thStyle,
} from "@/components/project/projectPageStyles"
import { useProjectWorkspace } from "@/hooks/useProjectWorkspace"
import { supabase } from "@/lib/supabase"

type CombinedException =
  | {
      kind: "runtime"
      id: string
      projectId: string | null
      contentId: string | null
      sourceType: string
      exceptionType: string
      severity: "low" | "medium" | "high"
      title: string
      description: string
      status: "runtime"
      detectedAt: string
    }
  | {
      kind: "stored"
      id: string
      projectId: string | null
      contentId: string | null
      sourceType: string
      exceptionType: string
      severity: "low" | "medium" | "high"
      title: string
      description: string
      status: "open" | "resolved" | "ignored"
      detectedAt: string
    }

const SEVERITY_LABELS: Record<string, string> = {
  low: "low",
  medium: "medium",
  high: "high",
}

const EXCEPTION_TYPE_LABELS: Record<string, string> = {
  missing_assignee: "担当者未設定",
  material_missing: "素材不足",
  due_reverse: "納期逆転",
  stagnation: "停滞",
  revision_heavy: "修正過多",
  price_missing: "単価未設定",
  cost_over: "原価超過",
  integration_missing: "連携未設定",
  invoice_missing: "請求漏れ",
  client_overdue: "先方納期遅延",
  required_link_missing: "必須リンク不足",
  manual_check: "手動確認",
}

function exceptionLabel(type: string, title: string) {
  return EXCEPTION_TYPE_LABELS[type] ?? title ?? type
}

function cleanRuntimeDescription(type: string, description: string) {
  if (description && !description.includes("縺") && !description.includes("譛")) return description
  return `${exceptionLabel(type, type)} を確認してください。`
}

export default function ExceptionsPage() {
  const searchParams = useSearchParams()
  const initialProjectId = searchParams.get("projectId") ?? ""
  const {
    loading,
    error,
    canEdit,
    orgId,
    todayYmd,
    projects,
    contents,
    storedExceptions,
    runtimeExceptions,
    refresh,
  } = useProjectWorkspace()

  const [projectFilter, setProjectFilter] = useState(initialProjectId)
  const [severityFilter, setSeverityFilter] = useState("")
  const [statusFilter, setStatusFilter] = useState<"" | "runtime" | "open" | "resolved" | "ignored">("")
  const [busy, setBusy] = useState(false)
  const [uiError, setUiError] = useState<string | null>(null)
  const [uiSuccess, setUiSuccess] = useState<string | null>(null)
  const [form, setForm] = useState({
    projectId: initialProjectId,
    contentId: "",
    exceptionType: "manual_check",
    severity: "medium",
    title: "",
    description: "",
  })

  const projectNameById = useMemo(() => new Map(projects.map((project) => [project.id, project.name])), [projects])
  const contentTitleById = useMemo(() => new Map(contents.map((content) => [content.id, content.title])), [contents])

  const combined = useMemo<CombinedException[]>(() => {
    const runtimeRows: CombinedException[] = runtimeExceptions.map((row) => ({
      kind: "runtime",
      id: row.key,
      projectId: row.projectId ?? null,
      contentId: row.contentId ?? null,
      sourceType: row.sourceType,
      exceptionType: row.exceptionType,
      severity: row.severity,
      title: exceptionLabel(row.exceptionType, row.title),
      description: cleanRuntimeDescription(row.exceptionType, row.description),
      status: "runtime",
      detectedAt: todayYmd,
    }))

    const storedRows: CombinedException[] = storedExceptions.map((row) => ({
      kind: "stored",
      id: row.id,
      projectId: row.project_id ?? null,
      contentId: row.content_id ?? null,
      sourceType: row.source_type,
      exceptionType: row.exception_type,
      severity: row.severity,
      title: exceptionLabel(row.exception_type, row.title),
      description: row.description ?? "",
      status: row.status,
      detectedAt: row.detected_at,
    }))

    return [...runtimeRows, ...storedRows].sort((a, b) => b.detectedAt.localeCompare(a.detectedAt))
  }, [runtimeExceptions, storedExceptions, todayYmd])

  const filtered = useMemo(
    () =>
      combined
        .filter((row) => !projectFilter || row.projectId === projectFilter)
        .filter((row) => !severityFilter || row.severity === severityFilter)
        .filter((row) => !statusFilter || row.status === statusFilter),
    [combined, projectFilter, severityFilter, statusFilter]
  )

  const summary = useMemo(
    () =>
      filtered.reduce(
        (acc, row) => {
          acc.total += 1
          if (row.severity === "high") acc.high += 1
          if (row.kind === "runtime") acc.runtime += 1
          if (row.kind === "stored" && row.status === "resolved") acc.resolved += 1
          return acc
        },
        { total: 0, high: 0, runtime: 0, resolved: 0 }
      ),
    [filtered]
  )

  const projectContents = useMemo(
    () => contents.filter((content) => content.project_id === form.projectId),
    [contents, form.projectId]
  )

  const createManualException = async () => {
    if (!canEdit || !orgId) return
    if (!form.title.trim()) {
      setUiError("タイトルを入力してください。")
      return
    }

    setBusy(true)
    setUiError(null)
    setUiSuccess(null)
    const { error: insertError } = await supabase.from("exceptions").insert({
      id: crypto.randomUUID(),
      org_id: orgId,
      project_id: form.projectId || null,
      content_id: form.contentId || null,
      source_type: "manual",
      exception_type: form.exceptionType.trim(),
      severity: form.severity,
      title: form.title.trim(),
      description: form.description.trim() || null,
      status: "open",
      detected_at: new Date().toISOString(),
    })
    setBusy(false)

    if (insertError) {
      setUiError(`例外登録に失敗しました: ${insertError.message}`)
      return
    }

    setUiSuccess("例外を登録しました。")
    setForm((prev) => ({ ...prev, contentId: "", title: "", description: "" }))
    await refresh()
  }

  const materializeRuntime = async (row: Extract<CombinedException, { kind: "runtime" }>) => {
    if (!canEdit || !orgId) return
    const { error: insertError } = await supabase.from("exceptions").insert({
      id: crypto.randomUUID(),
      org_id: orgId,
      project_id: row.projectId,
      content_id: row.contentId,
      source_type: row.sourceType,
      exception_type: row.exceptionType,
      severity: row.severity,
      title: row.title,
      description: row.description,
      status: "open",
      detected_at: new Date().toISOString(),
    })

    if (insertError) {
      setUiError(`runtime 例外の保存に失敗しました: ${insertError.message}`)
      return
    }

    setUiSuccess("runtime 例外を保存しました。")
    await refresh()
  }

  const updateStoredStatus = async (id: string, status: "open" | "resolved" | "ignored") => {
    if (!canEdit || !orgId) return
    const { error: updateError } = await supabase
      .from("exceptions")
      .update({
        status,
        resolved_at: status === "resolved" ? new Date().toISOString() : null,
      })
      .eq("id", id)
      .eq("org_id", orgId)

    if (updateError) {
      setUiError(`例外更新に失敗しました: ${updateError.message}`)
      return
    }

    setUiSuccess("例外ステータスを更新しました。")
    await refresh()
  }

  return (
    <ProjectShell title="例外一覧" description="未設定、停滞、納期逆転、原価超過、請求漏れなどの例外を案件横断で確認します。">
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12 }}>
        <ProjectInfoCard label="total" value={`${summary.total}`} />
        <ProjectInfoCard label="high severity" value={`${summary.high}`} accent={summary.high > 0 ? "#b91c1c" : undefined} />
        <ProjectInfoCard label="runtime" value={`${summary.runtime}`} accent={summary.runtime > 0 ? "#b45309" : undefined} />
        <ProjectInfoCard label="resolved" value={`${summary.resolved}`} accent={summary.resolved > 0 ? "#166534" : undefined} />
      </div>

      <ProjectSection title="Filters">
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
            <span>severity</span>
            <select value={severityFilter} onChange={(event) => setSeverityFilter(event.target.value)} style={inputStyle}>
              <option value="">すべて</option>
              {Object.entries(SEVERITY_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label style={{ display: "grid", gap: 6 }}>
            <span>status</span>
            <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as typeof statusFilter)} style={inputStyle}>
              <option value="">すべて</option>
              <option value="runtime">runtime</option>
              <option value="open">open</option>
              <option value="resolved">resolved</option>
              <option value="ignored">ignored</option>
            </select>
          </label>
        </div>
      </ProjectSection>

      {(uiError || uiSuccess || error) ? (
        <ProjectSection title="Notice">
          {error ? <div style={{ color: "#b91c1c" }}>{error}</div> : null}
          {uiError ? <div style={{ color: "#b91c1c" }}>{uiError}</div> : null}
          {uiSuccess ? <div style={{ color: "#166534" }}>{uiSuccess}</div> : null}
        </ProjectSection>
      ) : null}

      {canEdit ? (
        <ProjectSection title="Manual Exception" description="運用上の気付きも手動で例外テーブルに残せます。">
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
              <input value={form.exceptionType} onChange={(event) => setForm((prev) => ({ ...prev, exceptionType: event.target.value }))} style={inputStyle} />
            </label>
            <label style={{ display: "grid", gap: 6 }}>
              <span>severity</span>
              <select value={form.severity} onChange={(event) => setForm((prev) => ({ ...prev, severity: event.target.value }))} style={inputStyle}>
                {Object.entries(SEVERITY_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label style={{ display: "grid", gap: 6, gridColumn: "1 / -1" }}>
              <span>title</span>
              <input value={form.title} onChange={(event) => setForm((prev) => ({ ...prev, title: event.target.value }))} style={inputStyle} />
            </label>
            <label style={{ display: "grid", gap: 6, gridColumn: "1 / -1" }}>
              <span>description</span>
              <textarea value={form.description} onChange={(event) => setForm((prev) => ({ ...prev, description: event.target.value }))} style={textareaStyle} />
            </label>
          </div>
          <div style={{ marginTop: 12 }}>
            <button type="button" onClick={() => void createManualException()} disabled={busy} style={buttonPrimaryStyle}>
              {busy ? "Saving..." : "Create exception"}
            </button>
          </div>
        </ProjectSection>
      ) : null}

      <ProjectSection title="Exception List">
        {loading ? <div>読み込み中...</div> : null}
        {!loading ? (
          <div style={{ overflowX: "auto" }}>
            <table style={{ ...tableStyle, minWidth: 1300 }}>
              <thead>
                <tr>
                  <th style={thStyle}>type</th>
                  <th style={thStyle}>severity</th>
                  <th style={thStyle}>title</th>
                  <th style={thStyle}>description</th>
                  <th style={thStyle}>project</th>
                  <th style={thStyle}>content</th>
                  <th style={thStyle}>status</th>
                  <th style={thStyle}>detected</th>
                  <th style={thStyle}>action</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((row) => (
                  <tr key={`${row.kind}:${row.id}`}>
                    <td style={tdStyle}>{row.exceptionType}</td>
                    <td style={tdStyle}>{row.severity}</td>
                    <td style={tdStyle}>{row.title}</td>
                    <td style={tdStyle}>{textOrDash(row.description)}</td>
                    <td style={tdStyle}>{projectNameById.get(row.projectId ?? "") ?? "-"}</td>
                    <td style={tdStyle}>{contentTitleById.get(row.contentId ?? "") ?? "-"}</td>
                    <td style={tdStyle}>{row.status}</td>
                    <td style={tdStyle}>{row.kind === "runtime" ? todayYmd : formatDateTime(row.detectedAt)}</td>
                    <td style={tdStyle}>
                      {row.kind === "runtime" ? (
                        canEdit ? (
                          <button type="button" onClick={() => void materializeRuntime(row)} style={buttonPrimaryStyle}>
                            open として保存
                          </button>
                        ) : (
                          <span style={{ color: "var(--muted)" }}>view only</span>
                        )
                      ) : canEdit ? (
                        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                          {(["open", "resolved", "ignored"] as const).map((status) => (
                            <button
                              key={status}
                              type="button"
                              onClick={() => void updateStoredStatus(row.id, status)}
                              style={{
                                ...buttonPrimaryStyle,
                                padding: "6px 10px",
                                background: row.status === status ? "var(--button-primary-bg)" : "var(--button-secondary-bg)",
                                border: row.status === status ? "1px solid var(--button-primary-bg)" : "1px solid var(--button-secondary-border)",
                                color: row.status === status ? "var(--primary-contrast)" : "var(--button-secondary-text)",
                              }}
                            >
                              {status}
                            </button>
                          ))}
                        </div>
                      ) : (
                        <span style={{ color: "var(--muted)" }}>{row.status}</span>
                      )}
                    </td>
                  </tr>
                ))}
                {filtered.length === 0 ? (
                  <tr>
                    <td colSpan={9} style={tdStyle}>該当する例外はありません。</td>
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
