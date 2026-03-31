"use client"

import { useMemo, useState, type CSSProperties } from "react"
import Link from "next/link"
import { ProjectInfoCard, ProjectSection, ProjectShell } from "@/components/project/ProjectShell"
import { inputStyle } from "@/components/project/projectPageStyles"
import { useProjectWorkspace } from "@/hooks/useProjectWorkspace"

type AssigneeLoadRow = {
  userId: string
  name: string
  taskCount: number
  openTaskCount: number
  overdueTaskCount: number
  workloadPoints: number
  contentCount: number
  revisionHeavyCount: number
  nextActionMissingCount: number
}

function safeNumber(value: unknown) {
  const next = Number(value ?? 0)
  return Number.isFinite(next) ? next : 0
}

function cardSurfaceStyle(background = "var(--surface-2)"): CSSProperties {
  return {
    border: "1px solid var(--border)",
    borderRadius: 16,
    padding: 16,
    background,
  }
}

function ratio(value: number, total: number) {
  if (total <= 0) return 0
  return Math.max(0, Math.min(100, Math.round((value / total) * 100)))
}

export default function ResourcesPage() {
  const { loading, error, todayYmd, members, projects, contents, tasks } = useProjectWorkspace()
  const [projectFilter, setProjectFilter] = useState("")

  const filteredTasks = useMemo(
    () => tasks.filter((task) => !projectFilter || task.project_id === projectFilter),
    [projectFilter, tasks]
  )
  const filteredContents = useMemo(
    () => contents.filter((content) => !projectFilter || content.project_id === projectFilter),
    [contents, projectFilter]
  )

  const assigneeRows = useMemo<AssigneeLoadRow[]>(() => {
    const memberNameById = new Map(members.map((member) => [member.userId, member.displayName || member.email || member.userId]))
    const rowsByUserId = new Map<string, AssigneeLoadRow>()

    const ensureRow = (userId: string) => {
      if (!rowsByUserId.has(userId)) {
        rowsByUserId.set(userId, {
          userId,
          name: memberNameById.get(userId) ?? "未設定ユーザー",
          taskCount: 0,
          openTaskCount: 0,
          overdueTaskCount: 0,
          workloadPoints: 0,
          contentCount: 0,
          revisionHeavyCount: 0,
          nextActionMissingCount: 0,
        })
      }
      return rowsByUserId.get(userId)!
    }

    for (const task of filteredTasks) {
      if (!task.assignee_user_id) continue
      const row = ensureRow(task.assignee_user_id)
      row.taskCount += 1
      row.workloadPoints += safeNumber(task.workload_points || 1)
      if (task.status !== "done") row.openTaskCount += 1
      const edge = task.planned_end_date || task.planned_start_date || ""
      if (edge && edge < todayYmd && task.status !== "done") row.overdueTaskCount += 1
    }

    for (const content of filteredContents) {
      if (!content.assignee_editor_user_id) continue
      const row = ensureRow(content.assignee_editor_user_id)
      row.contentCount += 1
      if (safeNumber(content.revision_count) >= 3) row.revisionHeavyCount += 1
      if (!String(content.next_action ?? "").trim()) row.nextActionMissingCount += 1
    }

    return Array.from(rowsByUserId.values()).sort((a, b) => {
      if (b.workloadPoints !== a.workloadPoints) return b.workloadPoints - a.workloadPoints
      if (b.overdueTaskCount !== a.overdueTaskCount) return b.overdueTaskCount - a.overdueTaskCount
      return a.name.localeCompare(b.name, "ja")
    })
  }, [filteredContents, filteredTasks, members, todayYmd])

  const maxLoad = useMemo(
    () => assigneeRows.reduce((max, row) => Math.max(max, row.workloadPoints), 0),
    [assigneeRows]
  )

  const unassignedTasks = useMemo(
    () => filteredTasks.filter((task) => !task.assignee_user_id),
    [filteredTasks]
  )

  const workloadSummary = useMemo(
    () =>
      assigneeRows.reduce(
        (acc, row) => {
          acc.assignees += 1
          acc.taskCount += row.taskCount
          acc.workloadPoints += row.workloadPoints
          if (row.workloadPoints >= 12 || row.overdueTaskCount >= 2) acc.overloaded += 1
          return acc
        },
        { assignees: 0, taskCount: 0, workloadPoints: 0, overloaded: 0 }
      ),
    [assigneeRows]
  )

  return (
    <ProjectShell
      title="稼働管理"
      description="担当ごとの負荷、未割当、修正過多をまとめて見ます。画面を増やさず、必要な判断だけを拾うビューです。"
      action={
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <Link href="/timeline" style={{ textDecoration: "none", color: "var(--primary)", fontWeight: 700 }}>
            タイムラインへ
          </Link>
          <Link href="/contents" style={{ textDecoration: "none", color: "var(--primary)", fontWeight: 700 }}>
            制作一覧へ
          </Link>
        </div>
      }
    >
      <div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))" }}>
        <ProjectInfoCard label="担当者" value={`${workloadSummary.assignees}人`} />
        <ProjectInfoCard label="タスク" value={`${workloadSummary.taskCount}件`} />
        <ProjectInfoCard label="負荷ポイント" value={`${workloadSummary.workloadPoints}`} />
        <ProjectInfoCard label="要調整" value={`${workloadSummary.overloaded}人`} accent={workloadSummary.overloaded > 0 ? "var(--warning-text)" : undefined} />
        <ProjectInfoCard label="未割当" value={`${unassignedTasks.length}件`} accent={unassignedTasks.length > 0 ? "var(--error-text)" : undefined} />
      </div>

      <ProjectSection title="絞り込み" description="案件単位で負荷を切り替えられます。">
        <div style={{ display: "grid", gap: 10, gridTemplateColumns: "minmax(220px, 360px)" }}>
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
        </div>
      </ProjectSection>

      {error ? (
        <ProjectSection title="状態">
          <div style={{ color: "var(--error-text)" }}>{error}</div>
        </ProjectSection>
      ) : null}

      <ProjectSection title="担当別の負荷" description="負荷ポイントを主軸に、遅延と修正過多を横に並べて確認します。">
        {loading ? <div>読み込み中...</div> : null}
        {!loading && assigneeRows.length === 0 ? (
          <div style={cardSurfaceStyle()}>担当付きのタスクがまだありません。</div>
        ) : null}
        {!loading ? (
          <div style={{ display: "grid", gap: 12 }}>
            {assigneeRows.map((row) => {
              const loadWidth = ratio(row.workloadPoints, maxLoad || 1)
              const riskCount = row.overdueTaskCount + row.revisionHeavyCount + row.nextActionMissingCount
              const tone =
                row.overdueTaskCount > 0
                  ? "linear-gradient(135deg, rgba(254, 226, 226, 0.86), rgba(255, 247, 237, 0.92))"
                  : row.workloadPoints >= 12
                    ? "linear-gradient(135deg, rgba(255, 247, 237, 0.9), rgba(254, 249, 195, 0.92))"
                    : "linear-gradient(135deg, rgba(239, 246, 255, 0.82), rgba(240, 253, 250, 0.92))"
              return (
                <div key={row.userId} style={cardSurfaceStyle(tone)}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
                    <div>
                      <div style={{ fontSize: 18, fontWeight: 800, color: "var(--text)" }}>{row.name}</div>
                      <div style={{ marginTop: 4, fontSize: 13, color: "var(--muted)" }}>
                        タスク {row.taskCount}件 / コンテンツ {row.contentCount}件
                      </div>
                    </div>
                    <div style={{ textAlign: "right" }}>
                      <div style={{ fontSize: 28, fontWeight: 800, color: "var(--text)" }}>{row.workloadPoints}</div>
                      <div style={{ fontSize: 12, color: riskCount > 0 ? "var(--warning-text)" : "var(--muted)" }}>
                        要確認 {riskCount}件
                      </div>
                    </div>
                  </div>
                  <div style={{ marginTop: 14 }}>
                    <div style={{ height: 12, borderRadius: 999, overflow: "hidden", background: "rgba(148, 163, 184, 0.18)" }}>
                      <div
                        style={{
                          width: `${Math.max(loadWidth, 8)}%`,
                          height: "100%",
                          borderRadius: 999,
                          background:
                            row.overdueTaskCount > 0
                              ? "linear-gradient(90deg, #ef4444, #f97316)"
                              : row.workloadPoints >= 12
                                ? "linear-gradient(90deg, #f59e0b, #facc15)"
                                : "linear-gradient(90deg, #2563eb, #14b8a6)",
                        }}
                      />
                    </div>
                  </div>
                  <div style={{ marginTop: 14, display: "grid", gap: 8, gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))" }}>
                    <MetricCell label="進行中" value={`${row.openTaskCount}件`} />
                    <MetricCell label="期限超過" value={`${row.overdueTaskCount}件`} tone={row.overdueTaskCount > 0 ? "danger" : "neutral"} />
                    <MetricCell label="修正多め" value={`${row.revisionHeavyCount}件`} tone={row.revisionHeavyCount > 0 ? "warning" : "neutral"} />
                    <MetricCell label="次アクション未記入" value={`${row.nextActionMissingCount}件`} tone={row.nextActionMissingCount > 0 ? "warning" : "neutral"} />
                  </div>
                </div>
              )
            })}
          </div>
        ) : null}
      </ProjectSection>

      <ProjectSection title="未割当タスク" description="割り当て漏れをここだけで拾えます。">
        {unassignedTasks.length === 0 ? (
          <div style={cardSurfaceStyle()}>未割当はありません。</div>
        ) : (
          <div style={{ display: "grid", gap: 10 }}>
            {unassignedTasks.map((task) => {
              const project = projects.find((row) => row.id === task.project_id)
              return (
                <div key={task.id} style={cardSurfaceStyle()}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                    <div>
                      <div style={{ fontWeight: 800, color: "var(--text)" }}>{task.title}</div>
                      <div style={{ marginTop: 4, fontSize: 13, color: "var(--muted)" }}>
                        {project?.name ?? task.project_id} / {task.planned_end_date || task.planned_start_date || "日程未設定"}
                      </div>
                    </div>
                    <div style={{ fontSize: 13, color: "var(--warning-text)", fontWeight: 700 }}>
                      工数 {safeNumber(task.workload_points || 1)}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </ProjectSection>
    </ProjectShell>
  )
}

function MetricCell({
  label,
  value,
  tone = "neutral",
}: {
  label: string
  value: string
  tone?: "neutral" | "warning" | "danger"
}) {
  const color =
    tone === "danger" ? "var(--error-text)" : tone === "warning" ? "var(--warning-text)" : "var(--text)"
  return (
    <div
      style={{
        borderRadius: 12,
        border: "1px solid var(--border)",
        padding: "10px 12px",
        background: "rgba(255,255,255,0.56)",
      }}
    >
      <div style={{ fontSize: 12, color: "var(--muted)" }}>{label}</div>
      <div style={{ marginTop: 4, fontSize: 18, fontWeight: 800, color }}>{value}</div>
    </div>
  )
}
