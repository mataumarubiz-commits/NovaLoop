"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { useAuthOrg } from "@/hooks/useAuthOrg"
import { supabase } from "@/lib/supabase"
import {
  buildProjectSummaries,
  buildRuntimeExceptionCandidates,
  toYm,
  toYmd,
  type ChangeRequestRow,
  type ExpenseRow,
  type InvoiceLineLite,
  type InvoiceRowLite,
  type MaterialAssetRow,
  type ProjectMember,
  type ProjectRow,
  type ProjectSummary,
  type ProjectTaskRow,
  type RateCardRow,
  type RuntimeExceptionCandidate,
  type ScheduleEventRow,
  type StoredExceptionRow,
  type VendorInvoiceLineLite,
  type VendorInvoiceRowLite,
  type WorkspaceClient,
  type WorkspaceContent,
} from "@/lib/projectWorkspace"

type ProjectWorkspaceState = {
  loading: boolean
  error: string | null
  canEdit: boolean
  canViewFinance: boolean
  orgId: string | null
  role: string | null
  needsOnboarding: boolean
  month: string
  todayYmd: string
  clients: WorkspaceClient[]
  members: ProjectMember[]
  projects: ProjectRow[]
  contents: WorkspaceContent[]
  tasks: ProjectTaskRow[]
  events: ScheduleEventRow[]
  assets: MaterialAssetRow[]
  changes: ChangeRequestRow[]
  expenses: ExpenseRow[]
  rateCards: RateCardRow[]
  storedExceptions: StoredExceptionRow[]
  invoices: InvoiceRowLite[]
  invoiceLines: InvoiceLineLite[]
  vendorInvoices: VendorInvoiceRowLite[]
  vendorInvoiceLines: VendorInvoiceLineLite[]
  projectSummaries: ProjectSummary[]
  runtimeExceptions: RuntimeExceptionCandidate[]
  refresh: () => Promise<void>
}

function toErrorMessage(label: string, message?: string) {
  return `${label}の取得に失敗しました${message ? `: ${message}` : ""}`
}

function isMissingProjectSchema(message?: string | null) {
  const raw = String(message ?? "").toLowerCase()
  return raw.includes("does not exist") || raw.includes("schema cache") || raw.includes("column")
}

async function getAccessToken() {
  const { data } = await supabase.auth.getSession()
  return data.session?.access_token ?? null
}

async function loadMembers(orgId: string) {
  const token = await getAccessToken()
  if (!token) return []
  const res = await fetch(`/api/org/members?orgId=${encodeURIComponent(orgId)}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  const json = (await res.json().catch(() => null)) as { ok?: boolean; members?: ProjectMember[] } | null
  return res.ok && json?.ok && Array.isArray(json.members) ? json.members : []
}

export function useProjectWorkspace(): ProjectWorkspaceState {
  const { activeOrgId, role, loading: authLoading, needsOnboarding } = useAuthOrg({ redirectToOnboarding: true })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [clients, setClients] = useState<WorkspaceClient[]>([])
  const [members, setMembers] = useState<ProjectMember[]>([])
  const [projects, setProjects] = useState<ProjectRow[]>([])
  const [contents, setContents] = useState<WorkspaceContent[]>([])
  const [tasks, setTasks] = useState<ProjectTaskRow[]>([])
  const [events, setEvents] = useState<ScheduleEventRow[]>([])
  const [assets, setAssets] = useState<MaterialAssetRow[]>([])
  const [changes, setChanges] = useState<ChangeRequestRow[]>([])
  const [expenses, setExpenses] = useState<ExpenseRow[]>([])
  const [rateCards, setRateCards] = useState<RateCardRow[]>([])
  const [storedExceptions, setStoredExceptions] = useState<StoredExceptionRow[]>([])
  const [invoices, setInvoices] = useState<InvoiceRowLite[]>([])
  const [invoiceLines, setInvoiceLines] = useState<InvoiceLineLite[]>([])
  const [vendorInvoices, setVendorInvoices] = useState<VendorInvoiceRowLite[]>([])
  const [vendorInvoiceLines, setVendorInvoiceLines] = useState<VendorInvoiceLineLite[]>([])

  const canEdit = role === "owner" || role === "executive_assistant"
  const canViewFinance = canEdit
  const todayYmd = useMemo(() => toYmd(new Date()), [])
  const month = useMemo(() => toYm(new Date()), [])

  const load = useCallback(async () => {
    if (!activeOrgId) {
      setLoading(false)
      return
    }

    setLoading(true)
    setError(null)

    const queries = await Promise.all([
      supabase.from("clients").select("id, name").eq("org_id", activeOrgId).order("name"),
      loadMembers(activeOrgId),
      supabase.from("projects").select("*").eq("org_id", activeOrgId).order("created_at", { ascending: false }),
      supabase
        .from("contents")
        .select(
          "id, org_id, client_id, project_id, project_name, title, due_client_at, due_editor_at, publish_at, status, thumbnail_done, billable_flag, delivery_month, unit_price, invoice_id, sequence_no, assignee_editor_user_id, assignee_checker_user_id, revision_count, workload_points, estimated_cost, next_action, blocked_reason, material_status, draft_status, final_status, health_score, links_json, editor_submitted_at, client_submitted_at"
        )
        .eq("org_id", activeOrgId)
        .order("due_client_at", { ascending: true }),
      supabase.from("project_tasks").select("*").eq("org_id", activeOrgId).order("planned_end_date", { ascending: true }),
      supabase.from("schedule_events").select("*").eq("org_id", activeOrgId).order("start_at", { ascending: true }),
      supabase.from("material_assets").select("*").eq("org_id", activeOrgId).order("created_at", { ascending: false }),
      supabase.from("change_requests").select("*").eq("org_id", activeOrgId).order("created_at", { ascending: false }),
      canViewFinance
        ? supabase.from("expenses").select("*").eq("org_id", activeOrgId).order("occurred_on", { ascending: false })
        : Promise.resolve({ data: [], error: null }),
      canViewFinance
        ? supabase.from("rate_cards").select("*").eq("org_id", activeOrgId).order("effective_from", { ascending: false })
        : Promise.resolve({ data: [], error: null }),
      supabase.from("exceptions").select("*").eq("org_id", activeOrgId).order("detected_at", { ascending: false }),
      canViewFinance
        ? supabase.from("invoices").select("id, org_id, client_id, invoice_month, status").eq("org_id", activeOrgId)
        : Promise.resolve({ data: [], error: null }),
      canViewFinance
        ? supabase.from("invoice_lines").select("id, invoice_id, content_id, amount")
        : Promise.resolve({ data: [], error: null }),
      canViewFinance
        ? supabase.from("vendor_invoices").select("id, org_id, billing_month, status").eq("org_id", activeOrgId)
        : Promise.resolve({ data: [], error: null }),
      canViewFinance
        ? supabase.from("vendor_invoice_lines").select("id, vendor_invoice_id, content_id, amount")
        : Promise.resolve({ data: [], error: null }),
    ])

    const [
      clientsRes,
      membersRes,
      projectsRes,
      contentsRes,
      tasksRes,
      eventsRes,
      assetsRes,
      changesRes,
      expensesRes,
      rateCardsRes,
      storedExceptionsRes,
      invoicesRes,
      invoiceLinesRes,
      vendorInvoicesRes,
      vendorInvoiceLinesRes,
    ] = queries

    const errors = [
      clientsRes.error ? toErrorMessage("クライアント", clientsRes.error.message) : null,
      projectsRes.error
        ? isMissingProjectSchema(projectsRes.error.message)
          ? "案件レイヤー用のDB migrationが未適用です。`supabase/sql/055_competitor_project_layer.sql` を適用してください。"
          : toErrorMessage("案件", projectsRes.error.message)
        : null,
      contentsRes.error ? toErrorMessage("コンテンツ", contentsRes.error.message) : null,
      tasksRes.error ? toErrorMessage("工程", tasksRes.error.message) : null,
      eventsRes.error ? toErrorMessage("カレンダー", eventsRes.error.message) : null,
      assetsRes.error ? toErrorMessage("素材", assetsRes.error.message) : null,
      changesRes.error ? toErrorMessage("変更依頼", changesRes.error.message) : null,
      expensesRes.error ? toErrorMessage("経費", expensesRes.error.message) : null,
      rateCardsRes.error ? toErrorMessage("単価DB", rateCardsRes.error.message) : null,
      storedExceptionsRes.error ? toErrorMessage("例外", storedExceptionsRes.error.message) : null,
      invoicesRes.error ? toErrorMessage("請求書", invoicesRes.error.message) : null,
      invoiceLinesRes.error ? toErrorMessage("請求明細", invoiceLinesRes.error.message) : null,
      vendorInvoicesRes.error ? toErrorMessage("外注請求", vendorInvoicesRes.error.message) : null,
      vendorInvoiceLinesRes.error ? toErrorMessage("外注明細", vendorInvoiceLinesRes.error.message) : null,
    ].filter(Boolean)

    if (errors.length > 0) {
      setError(errors[0] ?? "案件レイヤーの取得に失敗しました。")
    }

    setClients(((clientsRes.data ?? []) as WorkspaceClient[]) || [])
    setMembers(membersRes)
    setProjects(((projectsRes.data ?? []) as ProjectRow[]) || [])
    setContents(((contentsRes.data ?? []) as WorkspaceContent[]) || [])
    setTasks(((tasksRes.data ?? []) as ProjectTaskRow[]) || [])
    setEvents(((eventsRes.data ?? []) as ScheduleEventRow[]) || [])
    setAssets(((assetsRes.data ?? []) as MaterialAssetRow[]) || [])
    setChanges(((changesRes.data ?? []) as ChangeRequestRow[]) || [])
    setExpenses(((expensesRes.data ?? []) as ExpenseRow[]) || [])
    setRateCards(((rateCardsRes.data ?? []) as RateCardRow[]) || [])
    setStoredExceptions(((storedExceptionsRes.data ?? []) as StoredExceptionRow[]) || [])
    setInvoices(((invoicesRes.data ?? []) as InvoiceRowLite[]) || [])
    setInvoiceLines(((invoiceLinesRes.data ?? []) as InvoiceLineLite[]) || [])
    setVendorInvoices(((vendorInvoicesRes.data ?? []) as VendorInvoiceRowLite[]) || [])
    setVendorInvoiceLines(((vendorInvoiceLinesRes.data ?? []) as VendorInvoiceLineLite[]) || [])
    setLoading(false)
  }, [activeOrgId, canViewFinance])

  useEffect(() => {
    if (authLoading) return
    if (!activeOrgId || needsOnboarding) return
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load()
  }, [activeOrgId, authLoading, load, needsOnboarding])

  const projectSummaries = useMemo(
    () =>
      buildProjectSummaries({
        projects,
        clients,
        members,
        contents,
        tasks,
        changes,
        expenses,
        storedExceptions,
        invoices,
        invoiceLines,
        vendorInvoices,
        vendorInvoiceLines,
        month,
        todayYmd,
      }),
    [
      changes,
      clients,
      contents,
      expenses,
      invoiceLines,
      invoices,
      members,
      month,
      projects,
      storedExceptions,
      tasks,
      todayYmd,
      vendorInvoiceLines,
      vendorInvoices,
    ]
  )

  const runtimeExceptions = useMemo(
    () =>
      buildRuntimeExceptionCandidates({
        projects,
        contents,
        storedExceptions,
        month,
        todayYmd,
      }),
    [contents, month, projects, storedExceptions, todayYmd]
  )

  return {
    loading,
    error,
    canEdit,
    canViewFinance,
    orgId: activeOrgId,
    role,
    needsOnboarding,
    month,
    todayYmd,
    clients,
    members,
    projects,
    contents,
    tasks,
    events,
    assets,
    changes,
    expenses,
    rateCards,
    storedExceptions,
    invoices,
    invoiceLines,
    vendorInvoices,
    vendorInvoiceLines,
    projectSummaries,
    runtimeExceptions,
    refresh: load,
  }
}
