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
import { buildContentHealthScore, normalizeContentLinks, validateContentRules } from "@/lib/contentWorkflow"
import { CHANGE_TYPE_LABELS } from "@/lib/projectWorkspace"
import {
  appendDetail,
  normalizeAutomationContentDates,
  shiftIsoDateTimeByDays,
  shiftYmdByDaysAligned,
  syncAutomationArtifacts,
} from "@/lib/projectAutomation"
import { supabase } from "@/lib/supabase"

const IMPACT_LABELS: Record<string, string> = {
  low: "低",
  medium: "中",
  high: "高",
}

const CHANGE_STATUS_LABELS: Record<string, string> = {
  open: "未対応",
  approved: "承認",
  rejected: "却下",
  applied: "反映済み",
}

export default function ChangesPage() {
  const searchParams = useSearchParams()
  const { user } = useAuthOrg()
  const initialProjectId = searchParams.get("projectId") ?? ""
  const { loading, error, canEdit, orgId, projects, contents, changes, refresh } = useProjectWorkspace()

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
  const projectById = useMemo(() => new Map(projects.map((project) => [project.id, project])), [projects])
  const contentTitleById = useMemo(() => new Map(contents.map((content) => [content.id, content.title])), [contents])
  const contentById = useMemo(() => new Map(contents.map((content) => [content.id, content])), [contents])

  const filteredChanges = useMemo(
    () =>
      changes
        .filter((change) => !projectFilter || change.project_id === projectFilter)
        .filter((change) => !statusFilter || change.status === statusFilter)
        .filter((change) => !impactFilter || change.impact_level === impactFilter)
        .sort((a, b) => b.created_at.localeCompare(a.created_at)),
    [changes, impactFilter, projectFilter, statusFilter]
  )

  const summary = useMemo(
    () =>
      filteredChanges.reduce(
        (acc, change) => {
          acc.total += 1
          if (change.status === "open") acc.open += 1
          if (change.status === "approved" || change.status === "applied") acc.approved += 1
          acc.extraSales += Number(change.extra_sales_amount || 0)
          acc.extraCost += Number(change.extra_cost_amount || 0)
          return acc
        },
        { total: 0, open: 0, approved: 0, extraSales: 0, extraCost: 0 }
      ),
    [filteredChanges]
  )

  const projectContents = useMemo(
    () => contents.filter((content) => content.project_id === form.projectId),
    [contents, form.projectId]
  )

  const createChange = async () => {
    if (!canEdit || !orgId) return
    if (!form.projectId || !form.summary.trim()) {
      setUiError("案件と内容を入力してください。")
      return
    }

    setBusy(true)
    setUiError(null)
    setUiSuccess(null)

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
      setUiError(`変更登録に失敗しました: ${insertError.message}`)
      return
    }

    setUiSuccess("変更を登録しました。")
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

  const applyChangeToContent = async (changeId: string) => {
    const change = changes.find((row) => row.id === changeId)
    if (!change?.content_id || !orgId) return

    const content = contentById.get(change.content_id)
    if (!content) return

    const shiftDays = Number(change.due_shift_days || 0)
    const nextRevisionCount =
      Number(content.revision_count ?? 0) +
      (change.request_type === "spec_change" || change.request_type === "revision_additional" ? 1 : 0)
    const nextEstimatedCost = Math.max(0, Number(content.estimated_cost ?? 0) + Number(change.extra_cost_amount ?? 0))
    const nextUnitPrice = Math.max(0, Number(content.unit_price ?? 0) + Number(change.extra_sales_amount ?? 0))
    const nextMaterialStatus = change.request_type === "asset_replace" ? "collecting" : content.material_status ?? "not_ready"
    const nextAction = appendDetail(content.next_action, `変更反映: ${change.summary}`)
    const blockedReason =
      change.request_type === "spec_change" || change.request_type === "revision_additional"
        ? appendDetail(content.blocked_reason, `変更承認: ${change.summary}`)
        : content.blocked_reason ?? null
    const normalized = normalizeAutomationContentDates({
      previous: content,
      next: {
        ...content,
        due_client_at: shiftDays !== 0 ? shiftYmdByDaysAligned(content.due_client_at, shiftDays) : content.due_client_at,
        due_editor_at: shiftDays !== 0 ? shiftYmdByDaysAligned(content.due_editor_at, shiftDays) : content.due_editor_at,
        publish_at: shiftDays !== 0 && content.publish_at ? shiftIsoDateTimeByDays(content.publish_at, shiftDays) : content.publish_at,
        unit_price: nextUnitPrice,
        revision_count: nextRevisionCount,
        estimated_cost: nextEstimatedCost,
        next_action: nextAction,
        blocked_reason: blockedReason,
        material_status: nextMaterialStatus,
      },
    })
    const links = normalizeContentLinks(content.links_json)

    const validationErrors = validateContentRules({
      dueClientAt: normalized.due_client_at,
      dueEditorAt: normalized.due_editor_at,
      status: normalized.status,
      unitPrice: normalized.unit_price,
      billable: Boolean(normalized.billable_flag),
      materialStatus: normalized.material_status,
      draftStatus: normalized.draft_status,
      finalStatus: normalized.final_status,
      assigneeEditorUserId: normalized.assignee_editor_user_id,
      assigneeCheckerUserId: normalized.assignee_checker_user_id,
      nextAction: normalized.next_action,
      revisionCount: normalized.revision_count,
      estimatedCost: normalized.estimated_cost,
      links,
    })
    if (validationErrors.length > 0) {
      throw new Error(validationErrors[0])
    }

    const { error: contentError } = await supabase
      .from("contents")
      .update({
        due_client_at: normalized.due_client_at,
        due_editor_at: normalized.due_editor_at,
        publish_at: normalized.publish_at,
        unit_price: normalized.unit_price,
        revision_count: normalized.revision_count,
        estimated_cost: normalized.estimated_cost,
        next_action: normalized.next_action,
        blocked_reason: normalized.blocked_reason,
        material_status: normalized.material_status,
        delivery_month: normalized.delivery_month,
        health_score: normalized.health_score ?? buildContentHealthScore({
          dueClientAt: normalized.due_client_at,
          dueEditorAt: normalized.due_editor_at,
          status: normalized.status,
          unitPrice: normalized.unit_price,
          billable: Boolean(normalized.billable_flag),
          materialStatus: normalized.material_status,
          draftStatus: normalized.draft_status,
          finalStatus: normalized.final_status,
          assigneeEditorUserId: normalized.assignee_editor_user_id,
          assigneeCheckerUserId: normalized.assignee_checker_user_id,
          nextAction: normalized.next_action,
          revisionCount: normalized.revision_count,
          estimatedCost: normalized.estimated_cost,
          links,
        }),
      })
      .eq("id", content.id)
      .eq("org_id", orgId)
    if (contentError) throw new Error(contentError.message)

    await syncAutomationArtifacts({
      db: supabase,
      orgId,
      previous: content,
      next: normalized,
      project: projectById.get(change.project_id) ?? null,
      todayYmd: new Date().toISOString().slice(0, 10),
      actorUserId: user?.id ?? null,
    })

    if (shiftDays === 0) return

    const { error: taskError } = await supabase
      .from("project_tasks")
      .update({
        planned_start_date: content.due_editor_at ? shiftYmdByDaysAligned(content.due_editor_at, shiftDays) : null,
        planned_end_date: content.due_client_at ? shiftYmdByDaysAligned(content.due_client_at, shiftDays) : null,
      })
      .eq("content_id", content.id)
      .eq("org_id", orgId)
    if (taskError) throw new Error(taskError.message)

    const { error: eventError } = await supabase
      .from("schedule_events")
      .update({
        start_at: shiftIsoDateTimeByDays(content.publish_at || `${content.due_client_at}T09:00:00+09:00`, shiftDays),
        end_at: content.publish_at ? shiftIsoDateTimeByDays(content.publish_at, shiftDays) : null,
      })
      .eq("content_id", content.id)
      .eq("org_id", orgId)
    if (eventError) throw new Error(eventError.message)
  }

  const updateChangeStatus = async (changeId: string, nextStatus: string) => {
    if (!canEdit || !orgId) return

    setBusy(true)
    setUiError(null)
    setUiSuccess(null)

    const payload: Record<string, unknown> = { status: nextStatus }
    if (nextStatus === "approved" || nextStatus === "applied") {
      payload.approved_by_user_id = user?.id ?? null
      payload.approved_at = new Date().toISOString()
    } else {
      payload.approved_by_user_id = null
      payload.approved_at = null
    }

    try {
      if (nextStatus === "applied") {
        await applyChangeToContent(changeId)
      }

      const { error: updateError } = await supabase
        .from("change_requests")
        .update(payload)
        .eq("id", changeId)
        .eq("org_id", orgId)
      if (updateError) throw new Error(updateError.message)

      setUiSuccess(nextStatus === "applied" ? "変更内容を案件へ反映しました。" : "変更状態を更新しました。")
      await refresh()
    } catch (updateError) {
      setUiError(updateError instanceof Error ? updateError.message : "変更状態の更新に失敗しました。")
    } finally {
      setBusy(false)
    }
  }

  return (
    <ProjectShell title="変更管理" description="納期変更、仕様変更、修正追加、追加費用を案件単位で記録し、承認と反映を追跡します。">
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12 }}>
        <ProjectInfoCard label="変更件数" value={`${summary.total}件`} />
        <ProjectInfoCard label="未対応" value={`${summary.open}件`} accent={summary.open > 0 ? "var(--warning-text)" : undefined} />
        <ProjectInfoCard label="承認済み" value={`${summary.approved}件`} accent={summary.approved > 0 ? "var(--success-text)" : undefined} />
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

      {(error || uiError || uiSuccess) ? (
        <ProjectSection title="状況">
          {error ? <div style={{ color: "var(--error-text)" }}>{error}</div> : null}
          {uiError ? <div style={{ color: "var(--error-text)" }}>{uiError}</div> : null}
          {uiSuccess ? <div style={{ color: "var(--success-text)" }}>{uiSuccess}</div> : null}
        </ProjectSection>
      ) : null}

      {canEdit ? (
        <ProjectSection title="変更登録" description="案件とコンテンツに紐づけて、納期シフト日数、追加売上、追加原価を登録します。">
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
                <option value="">未指定</option>
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
              <span>依頼者</span>
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
              <span>内容</span>
              <textarea value={form.summary} onChange={(event) => setForm((prev) => ({ ...prev, summary: event.target.value }))} style={textareaStyle} />
            </label>
          </div>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center", marginTop: 12 }}>
            <button type="button" onClick={() => void createChange()} disabled={busy} style={buttonPrimaryStyle}>
              {busy ? "保存中..." : "変更を登録"}
            </button>
          </div>
        </ProjectSection>
      ) : null}

      <ProjectSection title="変更一覧">
        {loading ? <div>読み込み中...</div> : null}
        {!loading ? (
          <div style={{ overflowX: "auto" }}>
            <table style={{ ...tableStyle, minWidth: 1280 }}>
              <thead>
                <tr>
                  <th style={thStyle}>作成日</th>
                  <th style={thStyle}>案件</th>
                  <th style={thStyle}>コンテンツ</th>
                  <th style={thStyle}>種別</th>
                  <th style={thStyle}>内容</th>
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
                      <div style={{ color: "var(--muted)", fontSize: 12, marginTop: 4 }}>依頼者: {textOrDash(change.requested_by)}</div>
                    </td>
                    <td style={tdStyle}>{IMPACT_LABELS[change.impact_level] ?? change.impact_level}</td>
                    <td style={tdStyle}>{change.due_shift_days}日</td>
                    <td style={tdStyle}>{formatCurrency(Number(change.extra_sales_amount || 0))}</td>
                    <td style={tdStyle}>{formatCurrency(Number(change.extra_cost_amount || 0))}</td>
                    <td style={tdStyle}>
                      {canEdit ? (
                        <select
                          value={change.status}
                          onChange={(event) => void updateChangeStatus(change.id, event.target.value)}
                          style={{ ...inputStyle, padding: "6px 8px" }}
                        >
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
                      該当する変更はありません。
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
