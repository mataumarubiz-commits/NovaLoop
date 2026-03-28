import { buildContentHealthScore, normalizeContentLinks } from "@/lib/contentWorkflow"

export type AutomationProject = {
  id: string
  name: string
  chatwork_room_id?: string | null
  google_calendar_id?: string | null
  slack_channel_id?: string | null
  discord_channel_id?: string | null
  drive_folder_url?: string | null
}

export type AutomationContent = {
  id: string
  org_id: string
  project_id?: string | null
  project_name: string
  title: string
  due_client_at: string
  due_editor_at: string
  publish_at?: string | null
  status: string
  billable_flag: boolean
  delivery_month: string
  unit_price: number
  invoice_id?: string | null
  assignee_editor_user_id?: string | null
  assignee_checker_user_id?: string | null
  revision_count?: number | null
  estimated_cost?: number | null
  next_action?: string | null
  blocked_reason?: string | null
  material_status?: string | null
  draft_status?: string | null
  final_status?: string | null
  health_score?: number | null
  links_json?: unknown
  editor_submitted_at?: string | null
  client_submitted_at?: string | null
}

export type ExpectedException = {
  exception_type: string
  severity: "low" | "medium" | "high"
  title: string
  description: string
}

export type AutoChangeRequestDraft = {
  request_type: "deadline_change" | "spec_change" | "revision_additional" | "asset_replace" | "publish_reschedule" | "extra_deliverable"
  summary: string
  impact_level: "low" | "medium" | "high"
  due_shift_days: number
  extra_sales_amount: number
  extra_cost_amount: number
}

const CLOSED_CONTENT_STATUSES = new Set(["delivered", "published", "canceled", "cancelled"])

const CLIENT_SUBMITTED_RANK: Record<string, number> = {
  not_started: 0,
  materials_checked: 1,
  editing: 2,
  internal_revision: 3,
  editing_revision: 4,
  submitted_to_client: 5,
  client_revision: 6,
  scheduling: 7,
  delivered: 8,
  published: 9,
  canceled: 10,
  cancelled: 10,
}

function safeNumber(value: unknown) {
  const num = Number(value ?? 0)
  return Number.isFinite(num) ? num : 0
}

function toLocalDate(value: string) {
  return new Date(`${value}T00:00:00`)
}

function toDateOnly(value: string | null | undefined) {
  if (!value) return null
  const trimmed = value.trim()
  if (!trimmed) return null
  return trimmed.includes("T") ? trimmed.slice(0, 10) : trimmed
}

function isWeekend(date: Date) {
  const day = date.getDay()
  return day === 0 || day === 6
}

export function alignYmdToNextBusinessDay(value: string) {
  const date = toLocalDate(value)
  while (isWeekend(date)) {
    date.setDate(date.getDate() + 1)
  }
  return date.toISOString().slice(0, 10)
}

export function shiftYmdByDays(value: string, days: number) {
  const date = toLocalDate(value)
  date.setDate(date.getDate() + days)
  return date.toISOString().slice(0, 10)
}

export function shiftYmdByDaysAligned(value: string, days: number) {
  return alignYmdToNextBusinessDay(shiftYmdByDays(value, days))
}

export function shiftIsoDateTimeByDays(value: string, days: number) {
  const date = new Date(value)
  date.setDate(date.getDate() + days)
  return date.toISOString()
}

export function diffCalendarDays(from: string, to: string) {
  const fromDate = toLocalDate(from)
  const toDate = toLocalDate(to)
  const diffMs = toDate.getTime() - fromDate.getTime()
  return Math.round(diffMs / 86_400_000)
}

export function appendDetail(base: string | null | undefined, detail: string) {
  const trimmedBase = String(base ?? "").trim()
  const trimmedDetail = detail.trim()
  if (!trimmedDetail) return trimmedBase || null
  if (!trimmedBase) return trimmedDetail
  if (trimmedBase.includes(trimmedDetail)) return trimmedBase
  return `${trimmedBase}\n${trimmedDetail}`
}

function hasIntegrationGap(project?: AutomationProject | null) {
  if (!project) return false
  return [
    project.chatwork_room_id,
    project.google_calendar_id,
    project.slack_channel_id || project.discord_channel_id,
    project.drive_folder_url,
  ].some((value) => !String(value ?? "").trim())
}

export function computeAutomationHealthScore(content: AutomationContent, project?: AutomationProject | null, todayYmd?: string) {
  return buildContentHealthScore({
    dueClientAt: content.due_client_at,
    dueEditorAt: content.due_editor_at,
    status: content.status,
    unitPrice: safeNumber(content.unit_price),
    billable: Boolean(content.billable_flag),
    materialStatus: content.material_status,
    draftStatus: content.draft_status,
    finalStatus: content.final_status,
    assigneeEditorUserId: content.assignee_editor_user_id,
    assigneeCheckerUserId: content.assignee_checker_user_id,
    nextAction: content.next_action,
    revisionCount: content.revision_count,
    estimatedCost: content.estimated_cost,
    links: normalizeContentLinks(content.links_json),
    integrationMissing: hasIntegrationGap(project),
    todayYmd,
  })
}

export function normalizeAutomationContentDates(params: {
  previous?: AutomationContent | null
  next: AutomationContent
  todayYmd?: string
  project?: AutomationProject | null
}) {
  const { previous, project, todayYmd } = params
  const next = { ...params.next }

  let dueClientAt = next.due_client_at
  let dueEditorAt = next.due_editor_at
  let publishAt = next.publish_at ?? null
  let derivedFromPublish = false

  const prevPublishYmd = toDateOnly(previous?.publish_at ?? null)
  const nextPublishYmd = toDateOnly(next.publish_at ?? null)
  if (
    previous &&
    prevPublishYmd &&
    nextPublishYmd &&
    prevPublishYmd !== nextPublishYmd &&
    next.due_client_at === previous.due_client_at &&
    next.due_editor_at === previous.due_editor_at
  ) {
    const delta = diffCalendarDays(prevPublishYmd, nextPublishYmd)
    if (delta !== 0) {
      dueClientAt = shiftYmdByDaysAligned(previous.due_client_at, delta)
      dueEditorAt = shiftYmdByDaysAligned(previous.due_editor_at, delta)
      derivedFromPublish = true
    }
  }

  if (!previous || previous.due_client_at !== dueClientAt || derivedFromPublish) {
    dueClientAt = alignYmdToNextBusinessDay(dueClientAt)
  }
  if (!previous || previous.due_editor_at !== dueEditorAt || derivedFromPublish) {
    dueEditorAt = alignYmdToNextBusinessDay(dueEditorAt)
  }

  if (publishAt && previous?.publish_at && publishAt !== previous.publish_at) {
    const originalDay = new Date(previous.publish_at).getDate()
    const nextDay = new Date(publishAt).getDate()
    if (!Number.isNaN(originalDay) && !Number.isNaN(nextDay) && originalDay !== nextDay) {
      publishAt = shiftIsoDateTimeByDays(publishAt, 0)
    }
  }

  const normalized = {
    ...next,
    publish_at: publishAt,
    due_client_at: dueClientAt,
    due_editor_at: dueEditorAt,
    delivery_month: dueClientAt.slice(0, 7),
  }

  return {
    ...normalized,
    health_score: computeAutomationHealthScore(normalized, project, todayYmd),
  }
}

export function buildAutoChangeRequestDrafts(params: {
  previous?: AutomationContent | null
  next: AutomationContent
}) {
  const { previous, next } = params
  if (!previous || !next.project_id) return [] as AutoChangeRequestDraft[]

  const drafts: AutoChangeRequestDraft[] = []
  const extraSales = Math.max(0, safeNumber(next.unit_price) - safeNumber(previous.unit_price))
  const extraCost = Math.max(0, safeNumber(next.estimated_cost) - safeNumber(previous.estimated_cost))
  const revisionDelta = Math.max(0, safeNumber(next.revision_count) - safeNumber(previous.revision_count))

  const dueShiftDays = diffCalendarDays(previous.due_client_at, next.due_client_at)
  if (dueShiftDays !== 0 || previous.due_editor_at !== next.due_editor_at) {
    drafts.push({
      request_type: "deadline_change",
      summary: `deadline change: ${previous.due_editor_at} / ${previous.due_client_at} -> ${next.due_editor_at} / ${next.due_client_at}`,
      impact_level: Math.abs(dueShiftDays) >= 3 ? "high" : "medium",
      due_shift_days: dueShiftDays,
      extra_sales_amount: 0,
      extra_cost_amount: 0,
    })
  }

  const previousPublish = toDateOnly(previous.publish_at ?? null)
  const nextPublish = toDateOnly(next.publish_at ?? null)
  if (previousPublish && nextPublish && previousPublish !== nextPublish) {
    drafts.push({
      request_type: "publish_reschedule",
      summary: `publish reschedule: ${previousPublish} -> ${nextPublish}`,
      impact_level: "medium",
      due_shift_days: diffCalendarDays(previousPublish, nextPublish),
      extra_sales_amount: 0,
      extra_cost_amount: 0,
    })
  }

  if (
    previous.material_status &&
    next.material_status &&
    previous.material_status !== next.material_status &&
    (next.material_status === "collecting" || next.material_status === "not_ready")
  ) {
    drafts.push({
      request_type: "asset_replace",
      summary: `asset replace: ${previous.material_status} -> ${next.material_status}`,
      impact_level: "medium",
      due_shift_days: 0,
      extra_sales_amount: 0,
      extra_cost_amount: 0,
    })
  }

  if (revisionDelta > 0) {
    drafts.push({
      request_type: "revision_additional",
      summary: `revision increase: ${safeNumber(previous.revision_count)} -> ${safeNumber(next.revision_count)}`,
      impact_level: revisionDelta >= 2 ? "high" : "medium",
      due_shift_days: 0,
      extra_sales_amount: extraSales,
      extra_cost_amount: extraCost,
    })
  } else if (extraSales > 0 || extraCost > 0 || previous.blocked_reason !== next.blocked_reason) {
    const details = [
      extraSales > 0 ? `sales +${extraSales.toLocaleString("ja-JP")}` : "",
      extraCost > 0 ? `cost +${extraCost.toLocaleString("ja-JP")}` : "",
    ]
      .filter(Boolean)
      .join(" / ")
    drafts.push({
      request_type: "spec_change",
      summary: details ? `spec change: ${details}` : "spec change requested",
      impact_level: extraCost > 0 || extraSales > 0 ? "medium" : "low",
      due_shift_days: 0,
      extra_sales_amount: extraSales,
      extra_cost_amount: extraCost,
    })
  }

  return drafts
}

export function buildExpectedExceptions(params: {
  content: AutomationContent
  project?: AutomationProject | null
  todayYmd: string
  currentMonth?: string
}) {
  const { content, project, todayYmd } = params
  const currentMonth = params.currentMonth ?? todayYmd.slice(0, 7)
  const expected: ExpectedException[] = []
  const unitPrice = safeNumber(content.unit_price)
  const estimatedCost = safeNumber(content.estimated_cost)
  const revisionCount = safeNumber(content.revision_count)
  const closed = CLOSED_CONTENT_STATUSES.has(content.status)
  const label = content.project_name || project?.name || "project"

  if (!content.assignee_editor_user_id) {
    expected.push({
      exception_type: "missing_assignee",
      severity: "medium",
      title: "missing assignee",
      description: `${label} / ${content.title} has no editor assignee.`,
    })
  }

  if ((content.material_status ?? "not_ready") === "not_ready") {
    expected.push({
      exception_type: "material_missing",
      severity: "medium",
      title: "material missing",
      description: `${label} / ${content.title} has no ready material.`,
    })
  }

  if (!closed && !String(content.next_action ?? "").trim()) {
    expected.push({
      exception_type: "stagnation",
      severity: "medium",
      title: "missing next action",
      description: `${label} / ${content.title} has no next action.`,
    })
  }

  if (content.due_editor_at > content.due_client_at) {
    expected.push({
      exception_type: "due_reverse",
      severity: "high",
      title: "due date order",
      description: `${label} / ${content.title} has editor due after client due.`,
    })
  }

  if (
    !["submitted_to_client", "client_revision", "scheduling", "delivered", "published"].includes(content.status) &&
    content.due_client_at < todayYmd
  ) {
    expected.push({
      exception_type: "client_overdue",
      severity: "high",
      title: "client overdue",
      description: `${label} / ${content.title} is past the client due date.`,
    })
  }

  if (revisionCount >= 3) {
    expected.push({
      exception_type: "revision_heavy",
      severity: revisionCount >= 5 ? "high" : "medium",
      title: "revision heavy",
      description: `${label} / ${content.title} has ${revisionCount} revisions.`,
    })
  }

  if (content.billable_flag && (content.status === "delivered" || content.status === "published") && !content.invoice_id && content.delivery_month <= currentMonth) {
    expected.push({
      exception_type: "invoice_missing",
      severity: "high",
      title: "invoice missing",
      description: `${label} / ${content.title} is billable but not invoiced.`,
    })
  }

  if (content.billable_flag && unitPrice <= 0) {
    expected.push({
      exception_type: "price_missing",
      severity: "high",
      title: "missing price",
      description: `${label} / ${content.title} is billable but has no unit price.`,
    })
  }

  if (unitPrice > 0 && estimatedCost > unitPrice) {
    expected.push({
      exception_type: "cost_over",
      severity: "high",
      title: "cost over",
      description: `${label} / ${content.title} has cost above price.`,
    })
  }

  if (hasIntegrationGap(project)) {
    expected.push({
      exception_type: "integration_missing",
      severity: "low",
      title: "integration gap",
      description: `${project?.name ?? label} is missing one or more integrations.`,
    })
  }

  return expected
}

export async function syncAutomationArtifacts(params: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any
  orgId: string
  previous?: AutomationContent | null
  next: AutomationContent
  project?: AutomationProject | null
  todayYmd: string
  actorUserId?: string | null
}) {
  const { db, orgId, previous, next, project, todayYmd, actorUserId } = params

  if (next.project_id) {
    const autoChanges = buildAutoChangeRequestDrafts({ previous, next })
    if (autoChanges.length > 0) {
      const { data: existingRows } = await db
        .from("change_requests")
        .select("request_type, summary, due_shift_days, extra_sales_amount, extra_cost_amount, status")
        .eq("org_id", orgId)
        .eq("content_id", next.id)
        .in("status", ["open", "approved", "applied"])

      const existingKeys = new Set(
        ((existingRows as Array<Record<string, unknown>> | null) ?? []).map(
          (row) =>
            [
              String(row.request_type ?? ""),
              String(row.summary ?? ""),
              safeNumber(row.due_shift_days),
              safeNumber(row.extra_sales_amount),
              safeNumber(row.extra_cost_amount),
            ].join("|")
        )
      )

      const inserts = autoChanges
        .filter(
          (row) =>
            !existingKeys.has(
              [
                row.request_type,
                row.summary,
                safeNumber(row.due_shift_days),
                safeNumber(row.extra_sales_amount),
                safeNumber(row.extra_cost_amount),
              ].join("|")
            )
        )
        .map((row) => ({
          id: crypto.randomUUID(),
          org_id: orgId,
          project_id: next.project_id,
          content_id: next.id,
          request_type: row.request_type,
          summary: row.summary,
          requested_by: "system:auto",
          impact_level: row.impact_level,
          due_shift_days: row.due_shift_days,
          extra_sales_amount: row.extra_sales_amount,
          extra_cost_amount: row.extra_cost_amount,
          status: "applied",
          approved_by_user_id: actorUserId ?? null,
          approved_at: new Date().toISOString(),
        }))

      if (inserts.length > 0) {
        const { error } = await db.from("change_requests").insert(inserts)
        if (error) throw new Error(error.message)
      }
    }
  }

  const expected = buildExpectedExceptions({
    content: next,
    project,
    todayYmd,
  })
  const expectedMap = new Map(expected.map((row) => [row.exception_type, row]))

  const { data: contentExceptionRows, error: contentExceptionError } = await db
    .from("exceptions")
    .select("id, exception_type, status, project_id, content_id")
    .eq("org_id", orgId)
    .eq("source_type", "system")
    .eq("content_id", next.id)
  if (contentExceptionError) throw new Error(contentExceptionError.message)

  let projectExceptionRows: Array<Record<string, unknown>> = []
  if (project?.id) {
    const { data: projectRows, error: projectError } = await db
      .from("exceptions")
      .select("id, exception_type, status, project_id, content_id")
      .eq("org_id", orgId)
      .eq("source_type", "system")
      .eq("project_id", project.id)
      .is("content_id", null)
      .eq("exception_type", "integration_missing")
    if (projectError) throw new Error(projectError.message)
    projectExceptionRows = (projectRows as Array<Record<string, unknown>> | null) ?? []
  }

  const existingRows = [
    ...(((contentExceptionRows as Array<Record<string, unknown>> | null) ?? []).filter((row) => String(row.exception_type ?? "") !== "integration_missing")),
    ...projectExceptionRows,
  ]

  const existingByType = new Map(existingRows.map((row) => [String(row.exception_type ?? ""), row]))
  const inserts = expected
    .filter((row) => !existingByType.has(row.exception_type))
    .map((row) => ({
      id: crypto.randomUUID(),
      org_id: orgId,
      project_id: row.exception_type === "integration_missing" ? project?.id ?? next.project_id ?? null : next.project_id ?? null,
      content_id: row.exception_type === "integration_missing" ? null : next.id,
      source_type: "system",
      exception_type: row.exception_type,
      severity: row.severity,
      title: row.title,
      description: row.description,
      status: "open",
      detected_at: new Date().toISOString(),
    }))

  if (inserts.length > 0) {
    const { error } = await db.from("exceptions").insert(inserts)
    if (error) throw new Error(error.message)
  }

  for (const row of existingRows) {
    const exceptionType = String(row.exception_type ?? "")
    const status = String(row.status ?? "")
    if (status !== "open") continue
    if (expectedMap.has(exceptionType)) continue

    const { error } = await db
      .from("exceptions")
      .update({
        status: "resolved",
        resolved_at: new Date().toISOString(),
        resolved_by_user_id: actorUserId ?? null,
      })
      .eq("id", String(row.id ?? ""))
      .eq("org_id", orgId)
    if (error) throw new Error(error.message)
  }
}

export function applyProgressSignal(params: {
  content: AutomationContent
  signal:
    | "editor_submitted"
    | "client_submitted"
    | "material_received"
    | "published"
    | "slack_reaction_submitted"
    | "discord_material_received"
    | "chatwork_client_submitted"
    | "drive_material_uploaded"
  occurredAt: string
  sourceLabel?: string | null
}) {
  const { signal, occurredAt } = params
  const sourceLabel = String(params.sourceLabel ?? "").trim()
  const content = { ...params.content }

  if (signal === "material_received" || signal === "discord_material_received" || signal === "drive_material_uploaded") {
    content.material_status = "ready"
    if (content.status === "not_started") content.status = "materials_checked"
    content.next_action = appendDetail(content.next_action, sourceLabel ? `${sourceLabel}: material received` : "material received")
  }

  if (signal === "editor_submitted" || signal === "slack_reaction_submitted") {
    content.editor_submitted_at = occurredAt
    if ((CLIENT_SUBMITTED_RANK[content.status] ?? 0) < CLIENT_SUBMITTED_RANK.internal_revision) {
      content.status = "internal_revision"
    }
    content.next_action = appendDetail(content.next_action, sourceLabel ? `${sourceLabel}: editor submitted` : "editor submitted")
  }

  if (signal === "client_submitted" || signal === "chatwork_client_submitted") {
    content.client_submitted_at = occurredAt
    if (!content.editor_submitted_at) content.editor_submitted_at = occurredAt
    if ((CLIENT_SUBMITTED_RANK[content.status] ?? 0) < CLIENT_SUBMITTED_RANK.submitted_to_client) {
      content.status = "submitted_to_client"
    }
    content.next_action = appendDetail(content.next_action, sourceLabel ? `${sourceLabel}: client submitted` : "client submitted")
  }

  if (signal === "published") {
    content.status = "published"
    content.final_status = "delivered"
    content.next_action = appendDetail(content.next_action, sourceLabel ? `${sourceLabel}: published` : "published")
  }

  return content
}
