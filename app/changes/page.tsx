"use client"

import { useMemo, useState } from "react"
import { useSearchParams } from "next/navigation"
import { useAuthOrg } from "@/hooks/useAuthOrg"
import { ProjectInfoCard, ProjectSection, ProjectShell } from "@/components/project/ProjectShell"
import {
  buttonPrimaryStyle,
  formatCurrency,
  formatDateTime,
  inputStyle,
  tableStyle,
  tdStyle,
  textareaStyle,
  textOrDash,
  thStyle,
} from "@/components/project/projectPageStyles"
import { useProjectWorkspace } from "@/hooks/useProjectWorkspace"
import { CHANGE_TYPE_LABELS } from "@/lib/projectWorkspace"
import { supabase } from "@/lib/supabase"

const IMPACT_LABELS: Record<string, string> = {
  low: "低",
  medium: "中",
  high: "高",
}

const CHANGE_STATUS_LABELS: Record<string, string> = {
  open: "オープン",
  approved: "承認",
  rejected: "却下",
  applied: "反映済み",
}

export default function ChangesPage() {
  const searchParams = useSearchParams()
  const { user } = useAuthOrg()
  const initialProjectId = searchParams.get("projectId") ?? ""
  const {
    loading,
    error,
    canEdit,
    orgId,
    projects,
    contents,
    changes,
    refresh,
  } = useProjectWorkspace()

  const [projectFilter, setProjectFilter] = useState(initialProjectId)
  const [statusFilter, setStatusFilter] = useState("")
  const [impactFilter, setImpactFilter] = useState("")
  const [busy, setBusy] = useState(false)
  const [uiError, setUiError] = useState<string | null>(null)
  const [uiSuccess, setUiSuccess] = useState<string | null>(null)
  const [form, setForm] = useState({
    projectId: initialProjectId,
    contentId: "",
    requestType: "deadline_change",
    summary: "",
    requestedBy: "",
    impactLevel: "medium",
    dueShiftDays: "0",
    extraSalesAmount: "0",
    extraCostAmount: "0",
  })

  const projectNameById = useMemo(() => new Map(projects.map((project) => [project.id, project.name])), [projects])
  const contentTitleById = useMemo(() => new Map(contents.map((content) => [content.id, content.title])), [contents])

  const filteredChanges = useMemo(() => {
    return changes
      .filter((change) => !projectFilter || change.project_id === projectFilter)
      .filter((change) => !statusFilter || change.status === statusFilter)
      .filter((change) => !impactFilter || change.impact_level === impactFilter)
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
  }, [changes, impactFilter, projectFilter, statusFilter])

  const summary = useMemo(() => {
    return filteredChanges.reduce(
      (acc, change) => {
        acc.total += 1
        if (change.status === "open") acc.open += 1
        if (change.status === "approved") acc.approved += 1
        acc.extraSales += Number(change.extra_sales_amount || 0)
        acc.extraCost += Number(change.extra_cost_amount || 0)
        return acc
      },
      { total: 0, open: 0, approved: 0, extraSales: 0, extraCost: 0 }
    )
  }, [filteredChanges])

  const projectContents = useMemo(
    () => contents.filter((content) => content.project_id === form.projectId),
    [contents, form.projectId]
  )

  const createChange = async () => {
    if (!canEdit || !orgId) return
    if (!form.projectId || !form.summary.trim()) {
      setUiError("案件と要約を入力してください。")
      return
    }

    setBusy(true)
    setUiError(null)
    const { error: insertError } = await supabase.from("change_requests").insert({
      id: crypto.randomUUID(),
      org_id: orgId,
      project_id: form.projectId,
      content_id: form.contentId || null,
      request_type: form.requestType,
      summary: form.summary.trim(),
      requested_by: form.requestedBy.trim() || null,
      impact_level: form.impactLevel,
      due_shift_days: Number(form.dueShiftDays || 0),
      extra_sales_amount: Number(form.extraSalesAmount || 0),
      extra_cost_amount: Number(form.extraCostAmount || 0),
      status: "open",
    })
    setBusy(false)

    if (insertError) {
      setUiError(`変更依頼の作成に失敗しました: ${insertError.message}`)
      return
    }

    setUiSuccess("変更依頼を追加しました。")
    setForm((prev) => ({
      ...prev,
      contentId: "",
      summary: "",
      requestedBy: "",
      dueShiftDays: "0",
      extraSalesAmount: "0",
      extraCostAmount: "0",
    }))
    await refresh()
  }

  const updateChangeStatus = async (changeId: string, nextStatus: string) => {
    if (!canEdit || !orgId) return
    const payload: Record<string, unknown> = { status: nextStatus }
    if (nextStatus === "approved") {
      payload.approved_by_user_id = user?.id ?? null
      payload.approved_at = new Date().toISOString()
    }
    if (nextStatus !== "approved") {
      payload.approved_by_user_id = null
      payload.approved_at = null
    }
    const { error: updateError } = await supabase
      .from("change_requests")
      .update(payload)
      .eq("id", changeId)
      .eq("org_id", orgId)
    if (updateError) {
      setUiError(`状態更新に失敗しました: ${updateError.message}`)
      return
    }
    await refresh()
  }

  return (
    <ProjectShell title="変更管理" description="納期変更、仕様変更、追加修正などを案件横断で管理し、影響額も追えるようにします。">
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12 }}>
        <ProjectInfoCard label="依頼数" value={`${summary.total}件`} />
        <ProjectInfoCard label="オープン" value={`${summary.open}件`} accent={summary.open > 0 ? "#b45309" : undefined} />
        <ProjectInfoCard label="承認" value={`${summary.approved}件`} accent={summary.approved > 0 ? "#166534" : undefined} />
        <ProjectInfoCard label="追加売上" value={formatCurrency(summary.extraSales)} />
        <ProjectInfoCard label="追加原価" value={formatCurrency(summary.extraCost)} />
      </div>

      <ProjectSection title="絞り込み">
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
            <span>状態</span>
            <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} style={inputStyle}>
              <option value="">すべて</option>
              {Object.entries(CHANGE_STATUS_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label style={{ display: "grid", gap: 6 }}>
            <span>影響度</span>
            <select value={impactFilter} onChange={(event) => setImpactFilter(event.target.value)} style={inputStyle}>
              <option value="">すべて</option>
              {Object.entries(IMPACT_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
        </div>
      </ProjectSection>

      {canEdit ? (
        <ProjectSection title="変更依頼追加" description="案件 / コンテンツに紐づく変更依頼を記録し、追加売上・原価・納期シフトを残します。">
          <div style={{ display: "grid", gap: 10, gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))" }}>
            <label style={{ display: "grid", gap: 6 }}>
              <span>案件</span>
              <select value={form.projectId} onChange={(event) => setForm((prev) => ({ ...prev, projectId: event.target.value, contentId: "" }))} style={inputStyle}>
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
              <select value={form.requestType} onChange={(event) => setForm((prev) => ({ ...prev, requestType: event.target.value }))} style={inputStyle}>
                {Object.entries(CHANGE_TYPE_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label style={{ display: "grid", gap: 6 }}>
              <span>影響度</span>
              <select value={form.impactLevel} onChange={(event) => setForm((prev) => ({ ...prev, impactLevel: event.target.value }))} style={inputStyle}>
                {Object.entries(IMPACT_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label style={{ display: "grid", gap: 6 }}>
              <span>依頼元</span>
              <input value={form.requestedBy} onChange={(event) => setForm((prev) => ({ ...prev, requestedBy: event.target.value }))} style={inputStyle} />
            </label>
            <label style={{ display: "grid", gap: 6 }}>
              <span>納期シフト日数</span>
              <input type="number" value={form.dueShiftDays} onChange={(event) => setForm((prev) => ({ ...prev, dueShiftDays: event.target.value }))} style={inputStyle} />
            </label>
            <label style={{ display: "grid", gap: 6 }}>
              <span>追加売上</span>
              <input type="number" min="0" value={form.extraSalesAmount} onChange={(event) => setForm((prev) => ({ ...prev, extraSalesAmount: event.target.value }))} style={inputStyle} />
            </label>
            <label style={{ display: "grid", gap: 6 }}>
              <span>追加原価</span>
              <input type="number" min="0" value={form.extraCostAmount} onChange={(event) => setForm((prev) => ({ ...prev, extraCostAmount: event.target.value }))} style={inputStyle} />
            </label>
            <label style={{ display: "grid", gap: 6, gridColumn: "1 / -1" }}>
              <span>要約</span>
              <textarea value={form.summary} onChange={(event) => setForm((prev) => ({ ...prev, summary: event.target.value }))} style={textareaStyle} />
            </label>
          </div>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center", marginTop: 12 }}>
            <button type="button" onClick={() => void createChange()} disabled={busy} style={buttonPrimaryStyle}>
              {busy ? "保存中..." : "変更依頼を追加"}
            </button>
            {uiError ? <span style={{ color: "#b91c1c", fontSize: 13 }}>{uiError}</span> : null}
            {uiSuccess ? <span style={{ color: "#166534", fontSize: 13 }}>{uiSuccess}</span> : null}
          </div>
        </ProjectSection>
      ) : null}

      <ProjectSection title="変更依頼一覧">
        {loading ? <div>読み込み中...</div> : null}
        {error ? <div style={{ color: "#b91c1c" }}>{error}</div> : null}
        {!loading ? (
          <div style={{ overflowX: "auto" }}>
            <table style={{ ...tableStyle, minWidth: 1280 }}>
              <thead>
                <tr>
                  <th style={thStyle}>起票日</th>
                  <th style={thStyle}>案件</th>
                  <th style={thStyle}>コンテンツ</th>
                  <th style={thStyle}>種別</th>
                  <th style={thStyle}>要約</th>
                  <th style={thStyle}>影響度</th>
                  <th style={thStyle}>納期シフト</th>
                  <th style={thStyle}>追加売上</th>
                  <th style={thStyle}>追加原価</th>
                  <th style={thStyle}>状態</th>
                </tr>
              </thead>
              <tbody>
                {filteredChanges.map((change) => (
                  <tr key={change.id}>
                    <td style={tdStyle}>{formatDateTime(change.created_at)}</td>
                    <td style={tdStyle}>{textOrDash(projectNameById.get(change.project_id))}</td>
                    <td style={tdStyle}>{textOrDash(contentTitleById.get(change.content_id ?? ""))}</td>
                    <td style={tdStyle}>{CHANGE_TYPE_LABELS[change.request_type] ?? change.request_type}</td>
                    <td style={tdStyle}>
                      <div>{change.summary}</div>
                      <div style={{ color: "var(--muted)", fontSize: 12, marginTop: 4 }}>依頼元: {textOrDash(change.requested_by)}</div>
                    </td>
                    <td style={tdStyle}>{IMPACT_LABELS[change.impact_level] ?? change.impact_level}</td>
                    <td style={tdStyle}>{change.due_shift_days}日</td>
                    <td style={tdStyle}>{formatCurrency(Number(change.extra_sales_amount || 0))}</td>
                    <td style={tdStyle}>{formatCurrency(Number(change.extra_cost_amount || 0))}</td>
                    <td style={tdStyle}>
                      {canEdit ? (
                        <select value={change.status} onChange={(event) => void updateChangeStatus(change.id, event.target.value)} style={{ ...inputStyle, padding: "6px 8px" }}>
                          {Object.entries(CHANGE_STATUS_LABELS).map(([value, label]) => (
                            <option key={value} value={value}>
                              {label}
                            </option>
                          ))}
                        </select>
                      ) : (
                        CHANGE_STATUS_LABELS[change.status] ?? change.status
                      )}
                    </td>
                  </tr>
                ))}
                {filteredChanges.length === 0 ? (
                  <tr>
                    <td colSpan={10} style={tdStyle}>
                      該当する変更依頼はありません。
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
