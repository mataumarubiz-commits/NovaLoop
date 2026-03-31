import {
  buildContentHealthScore,
  isBillableDoneStatus,
  isContentClientOverdue,
  isContentClosedStatus,
  normalizeContentLinks,
  type ContentLinks,
} from "@/lib/contentWorkflow"

export type ProjectMember = {
  userId: string
  displayName?: string
  email?: string
  role: string
  status?: string
}

export type ProjectRow = {
  id: string
  org_id: string
  client_id: string
  name: string
  code?: string | null
  /** projects.status（065_project_status_workflow.sql 参照） */
  status: string
  contract_type: "per_content" | "retainer" | "fixed_fee" | "monthly"
  start_date?: string | null
  end_date?: string | null
  owner_user_id?: string | null
  chatwork_room_id?: string | null
  google_calendar_id?: string | null
  slack_channel_id?: string | null
  discord_channel_id?: string | null
  drive_folder_url?: string | null
  notes?: string | null
  created_at: string
  updated_at: string
}

/** legacy `active`（055 の DEFAULT / 未移行行）を一覧・集計では `internal_production` として扱う */
export function normalizeProjectRowStatus(row: ProjectRow): ProjectRow {
  if (row.status !== "active") return row
  return { ...row, status: "internal_production" }
}

export type WorkspaceClient = {
  id: string
  name: string
}

export type WorkspaceContent = {
  id: string
  org_id: string
  client_id: string
  project_id?: string | null
  project_name: string
  title: string
  due_client_at: string
  due_editor_at: string
  publish_at?: string | null
  status: string
  thumbnail_done: boolean
  billable_flag: boolean
  delivery_month: string
  unit_price: number
  invoice_id?: string | null
  sequence_no?: number | null
  assignee_editor_user_id?: string | null
  assignee_checker_user_id?: string | null
  revision_count?: number | null
  workload_points?: number | null
  estimated_cost?: number | null
  next_action?: string | null
  blocked_reason?: string | null
  material_status?: string | null
  draft_status?: string | null
  final_status?: string | null
  health_score?: number | null
  links_json?: ContentLinks | unknown
  editor_submitted_at?: string | null
  client_submitted_at?: string | null
}

export type ProjectTaskRow = {
  id: string
  org_id: string
  project_id: string
  content_id?: string | null
  task_type: string
  title: string
  assignee_user_id?: string | null
  planned_start_date?: string | null
  planned_end_date?: string | null
  actual_start_at?: string | null
  actual_end_at?: string | null
  status: string
  dependency_task_id?: string | null
  workload_points?: number | null
  created_at: string
  updated_at: string
}

export type ScheduleEventRow = {
  id: string
  org_id: string
  project_id?: string | null
  content_id?: string | null
  event_type: string
  title: string
  start_at: string
  end_at?: string | null
  all_day: boolean
  external_source?: string | null
  external_event_id?: string | null
  created_at: string
  updated_at: string
}

export type MaterialAssetRow = {
  id: string
  org_id: string
  project_id: string
  content_id?: string | null
  asset_type: string
  title: string
  storage_path?: string | null
  external_url?: string | null
  version_no: number
  review_status: string
  uploaded_by_user_id?: string | null
  note?: string | null
  created_at: string
  updated_at?: string
}

export type ChangeRequestRow = {
  id: string
  org_id: string
  project_id: string
  content_id?: string | null
  request_type: string
  summary: string
  requested_by?: string | null
  impact_level: string
  due_shift_days: number
  extra_sales_amount: number
  extra_cost_amount: number
  status: string
  approved_by_user_id?: string | null
  approved_at?: string | null
  created_at: string
  updated_at?: string
}

export type ExpenseRow = {
  id: string
  org_id: string
  project_id?: string | null
  content_id?: string | null
  category: string
  description: string
  amount: number
  occurred_on: string
  receipt_path?: string | null
  created_by_user_id?: string | null
  created_at: string
  updated_at?: string
}

export type RateCardRow = {
  id: string
  org_id: string
  project_id?: string | null
  client_id?: string | null
  item_type: string
  unit_label: string
  sales_unit_price: number
  standard_cost: number
  effective_from: string
  effective_to?: string | null
}

export type StoredExceptionRow = {
  id: string
  org_id: string
  project_id?: string | null
  content_id?: string | null
  source_type: string
  exception_type: string
  severity: "low" | "medium" | "high"
  title: string
  description?: string | null
  status: "open" | "resolved" | "ignored"
  detected_at: string
  resolved_at?: string | null
}

export type InvoiceRowLite = {
  id: string
  org_id: string
  client_id?: string | null
  invoice_month: string
  status: string
}

export type InvoiceLineLite = {
  id: string
  invoice_id: string
  content_id?: string | null
  amount: number
}

export type VendorInvoiceRowLite = {
  id: string
  org_id: string
  billing_month: string
  status: string
}

export type VendorInvoiceLineLite = {
  id: string
  vendor_invoice_id: string
  content_id?: string | null
  amount: number
}

export type ProjectSummary = {
  project: ProjectRow
  clientName: string
  ownerName: string
  monthlyContentCount: number
  monthlySales: number
  monthlyVendorCost: number
  monthlyExpenses: number
  grossProfit: number
  marginRate: number | null
  delayCount: number
  revisionHeavyCount: number
  stagnationCount: number
  missingMaterialCount: number
  openExceptionCount: number
  healthAverage: number
  integrationMissingCount: number
}

export type RuntimeExceptionCandidate = {
  key: string
  projectId?: string | null
  contentId?: string | null
  exceptionType: string
  severity: "low" | "medium" | "high"
  title: string
  description: string
  sourceType: "system"
  status: "runtime"
}

export const PROJECT_STATUS_LABELS: Record<string, string> = {
  active: "稼働中",
  paused: "停止",
  completed: "完了",
}

export const CONTRACT_TYPE_LABELS: Record<string, string> = {
  per_content: "本数契約",
  retainer: "運用保守",
  fixed_fee: "固定費",
  monthly: "月額",
}

export const TASK_TYPE_LABELS: Record<string, string> = {
  materials: "素材待ち",
  script: "台本",
  editing: "編集",
  internal_review: "内部確認",
  client_review: "先方確認",
  revision: "修正",
  publishing: "投稿設定",
  publish: "公開",
}

export const EVENT_TYPE_LABELS: Record<string, string> = {
  editor_due: "編集締切",
  client_due: "先方提出",
  publish: "公開",
  meeting: "MTG",
  payout: "支払日",
  invoice_issue: "請求日",
  reminder: "リマインド",
  custom: "予定",
}

export const ASSET_TYPE_LABELS: Record<string, string> = {
  raw: "素材",
  script: "台本",
  draft: "修正稿",
  revision: "再修正版",
  final: "完成稿",
  thumbnail: "サムネ",
  reference: "参考資料",
  proof: "証憑",
}

export const CHANGE_TYPE_LABELS: Record<string, string> = {
  deadline_change: "納期変更",
  spec_change: "仕様変更",
  revision_additional: "修正追加",
  asset_replace: "素材差し替え",
  publish_reschedule: "公開日変更",
  extra_deliverable: "追加納品",
}

export function isContentClosed(status: string) {
  return isContentClosedStatus(status)
}

export function toYmd(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`
}

export function toYm(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`
}

function safeNumber(value: unknown) {
  const num = Number(value ?? 0)
  return Number.isFinite(num) ? num : 0
}

function createContentSalesMap(invoiceLines: InvoiceLineLite[], validInvoiceIds: Set<string>) {
  const salesByContentId = new Map<string, number>()
  for (const line of invoiceLines) {
    if (!line.content_id || !validInvoiceIds.has(line.invoice_id)) continue
    salesByContentId.set(line.content_id, (salesByContentId.get(line.content_id) ?? 0) + safeNumber(line.amount))
  }
  return salesByContentId
}

function createContentCostMap(vendorInvoiceLines: VendorInvoiceLineLite[], validVendorInvoiceIds: Set<string>) {
  const costByContentId = new Map<string, number>()
  for (const line of vendorInvoiceLines) {
    if (!line.content_id || !validVendorInvoiceIds.has(line.vendor_invoice_id)) continue
    costByContentId.set(line.content_id, (costByContentId.get(line.content_id) ?? 0) + safeNumber(line.amount))
  }
  return costByContentId
}

export function buildProjectSummaries(params: {
  projects: ProjectRow[]
  clients: WorkspaceClient[]
  members: ProjectMember[]
  contents: WorkspaceContent[]
  tasks: ProjectTaskRow[]
  changes: ChangeRequestRow[]
  expenses: ExpenseRow[]
  storedExceptions: StoredExceptionRow[]
  invoices: InvoiceRowLite[]
  invoiceLines: InvoiceLineLite[]
  vendorInvoices: VendorInvoiceRowLite[]
  vendorInvoiceLines: VendorInvoiceLineLite[]
  month: string
  todayYmd: string
}) {
  const {
    projects,
    clients,
    members,
    contents,
    expenses,
    storedExceptions,
    invoices,
    invoiceLines,
    vendorInvoices,
    vendorInvoiceLines,
    month,
    todayYmd,
  } = params

  const clientNameById = new Map(clients.map((client) => [client.id, client.name]))
  const memberNameById = new Map(members.map((member) => [member.userId, member.displayName || member.email || "未設定"]))
  const validInvoiceIds = new Set(invoices.filter((invoice) => invoice.status !== "void").map((invoice) => invoice.id))
  const validVendorInvoiceIds = new Set(vendorInvoices.filter((invoice) => invoice.status !== "void").map((invoice) => invoice.id))
  const salesByContentId = createContentSalesMap(invoiceLines, validInvoiceIds)
  const costByContentId = createContentCostMap(vendorInvoiceLines, validVendorInvoiceIds)

  return projects.map((project) => {
    const projectContents = contents.filter((content) => content.project_id === project.id)
    const monthlyContents = projectContents.filter((content) => content.delivery_month === month)
    const projectExpenses = expenses.filter((expense) => expense.project_id === project.id && expense.occurred_on.startsWith(month))
    const openExceptions = storedExceptions.filter((exceptionRow) => exceptionRow.project_id === project.id && exceptionRow.status === "open")

    const monthlySales = monthlyContents.reduce(
      (sum, content) => sum + (salesByContentId.get(content.id) ?? safeNumber(content.unit_price)),
      0
    )
    const monthlyVendorCost = monthlyContents.reduce(
      (sum, content) => sum + (costByContentId.get(content.id) ?? safeNumber(content.estimated_cost)),
      0
    )
    const monthlyExpenses = projectExpenses.reduce((sum, expense) => sum + safeNumber(expense.amount), 0)
    const grossProfit = monthlySales - monthlyVendorCost - monthlyExpenses
    const delayCount = projectContents.filter(
      (content) =>
        isContentClientOverdue(content.status, content.due_client_at, todayYmd, content.client_submitted_at)
    ).length
    const revisionHeavyCount = projectContents.filter((content) => safeNumber(content.revision_count) >= 3).length
    const stagnationCount = projectContents.filter(
      (content) => !isContentClosed(content.status) && !String(content.next_action ?? "").trim()
    ).length
    const missingMaterialCount = projectContents.filter((content) => (content.material_status ?? "not_ready") === "not_ready").length
    const integrationMissingCount = [
      project.chatwork_room_id,
      project.google_calendar_id,
      project.slack_channel_id || project.discord_channel_id,
      project.drive_folder_url,
    ].filter((value) => !String(value ?? "").trim()).length
    const healthAverage =
      projectContents.length === 0
        ? 100
        : Math.round(
            projectContents.reduce((sum, content) => {
              const links = normalizeContentLinks(content.links_json)
              return (
                sum +
                buildContentHealthScore({
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
                  links,
                  todayYmd,
                })
              )
            }, 0) / projectContents.length
          )

    return {
      project,
      clientName: clientNameById.get(project.client_id) ?? "未設定",
      ownerName: memberNameById.get(project.owner_user_id ?? "") ?? "未設定",
      monthlyContentCount: monthlyContents.length,
      monthlySales,
      monthlyVendorCost,
      monthlyExpenses,
      grossProfit,
      marginRate: monthlySales > 0 ? grossProfit / monthlySales : null,
      delayCount,
      revisionHeavyCount,
      stagnationCount,
      missingMaterialCount,
      openExceptionCount: openExceptions.length,
      healthAverage,
      integrationMissingCount,
    } satisfies ProjectSummary
  })
}

export function buildRuntimeExceptionCandidates(params: {
  projects: ProjectRow[]
  contents: WorkspaceContent[]
  storedExceptions: StoredExceptionRow[]
  month: string
  todayYmd: string
}) {
  const { projects, contents, storedExceptions, month, todayYmd } = params
  const candidates: RuntimeExceptionCandidate[] = []

  const pushCandidate = (candidate: RuntimeExceptionCandidate) => {
    if (
      storedExceptions.some(
        (row) =>
          row.status === "open" &&
          row.project_id === candidate.projectId &&
          row.content_id === candidate.contentId &&
          row.exception_type === candidate.exceptionType
      )
    ) {
      return
    }
    candidates.push(candidate)
  }

  for (const content of contents) {
    const contentId = content.id
    const projectId = content.project_id ?? null
    const estimatedCost = safeNumber(content.estimated_cost)
    const unitPrice = safeNumber(content.unit_price)
    const revisionCount = safeNumber(content.revision_count)
    const materialStatus = content.material_status ?? "not_ready"
    if (!content.assignee_editor_user_id) {
      pushCandidate({
        key: `${contentId}:missing_editor`,
        projectId,
        contentId,
        exceptionType: "missing_assignee",
        severity: "medium",
        title: "担当未設定",
        description: `${content.project_name} / ${content.title} の編集担当が未設定です。`,
        sourceType: "system",
        status: "runtime",
      })
    }

    if (materialStatus === "not_ready") {
      pushCandidate({
        key: `${contentId}:missing_material`,
        projectId,
        contentId,
        exceptionType: "material_missing",
        severity: "medium",
        title: "素材未回収",
        description: `${content.project_name} / ${content.title} の素材が未回収です。`,
        sourceType: "system",
        status: "runtime",
      })
    }

    if (!isContentClosed(content.status) && !String(content.next_action ?? "").trim()) {
      pushCandidate({
        key: `${contentId}:stagnation`,
        projectId,
        contentId,
        exceptionType: "stagnation",
        severity: "medium",
        title: "停滞",
        description: `${content.project_name} / ${content.title} の次アクションが未設定です。`,
        sourceType: "system",
        status: "runtime",
      })
    }

    if (content.due_editor_at > content.due_client_at) {
      pushCandidate({
        key: `${contentId}:due_reverse`,
        projectId,
        contentId,
        exceptionType: "due_reverse",
        severity: "high",
        title: "納期逆転",
        description: `${content.project_name} / ${content.title} の編集者提出日が先方提出日より後です。`,
        sourceType: "system",
        status: "runtime",
      })
    }

    if (
      isContentClientOverdue(content.status, content.due_client_at, todayYmd, content.client_submitted_at)
    ) {
      pushCandidate({
        key: `${contentId}:client_overdue`,
        projectId,
        contentId,
        exceptionType: "client_overdue",
        severity: "high",
        title: "納期遅れ",
        description: `${content.project_name} / ${content.title} が先方提出日を超過しています。`,
        sourceType: "system",
        status: "runtime",
      })
    }

    if (revisionCount >= 3) {
      pushCandidate({
        key: `${contentId}:revision_heavy`,
        projectId,
        contentId,
        exceptionType: "revision_heavy",
        severity: revisionCount >= 5 ? "high" : "medium",
        title: "修正過多",
        description: `${content.project_name} / ${content.title} の修正回数が ${revisionCount} 回です。`,
        sourceType: "system",
        status: "runtime",
      })
    }

    if (content.billable_flag && isBillableDoneStatus(content.status) && !content.invoice_id && content.delivery_month <= month) {
      pushCandidate({
        key: `${contentId}:invoice_missing`,
        projectId,
        contentId,
        exceptionType: "invoice_missing",
        severity: "high",
        title: "請求漏れ候補",
        description: `${content.project_name} / ${content.title} が請求対象のまま未請求です。`,
        sourceType: "system",
        status: "runtime",
      })
    }

    if (unitPrice <= 0 && content.billable_flag) {
      pushCandidate({
        key: `${contentId}:price_missing`,
        projectId,
        contentId,
        exceptionType: "price_missing",
        severity: "high",
        title: "単価未設定",
        description: `${content.project_name} / ${content.title} は請求対象ですが単価が未設定です。`,
        sourceType: "system",
        status: "runtime",
      })
    }

    if (estimatedCost > unitPrice && unitPrice > 0) {
      pushCandidate({
        key: `${contentId}:cost_over`,
        projectId,
        contentId,
        exceptionType: "cost_over",
        severity: "high",
        title: "原価超過",
        description: `${content.project_name} / ${content.title} は見積原価が単価を超えています。`,
        sourceType: "system",
        status: "runtime",
      })
    }

  }

  for (const project of projects) {
    const missingIntegrations = [
      !project.chatwork_room_id,
      !project.google_calendar_id,
      !project.slack_channel_id && !project.discord_channel_id,
      !project.drive_folder_url,
    ].filter(Boolean).length

    if (missingIntegrations > 0) {
      pushCandidate({
        key: `${project.id}:integration_missing`,
        projectId: project.id,
        contentId: null,
        exceptionType: "integration_missing",
        severity: "low",
        title: "連携未設定",
        description: `${project.name} は ${missingIntegrations} 件の外部連携が未設定です。`,
        sourceType: "system",
        status: "runtime",
      })
    }
  }

  return candidates
}



