"use client"

import { useCallback, useEffect, useState } from "react"
import { useAuthOrg } from "@/hooks/useAuthOrg"
import {
  ensureContentLinksJsonRows,
  isMissingContentsLinksJsonColumn,
  removeLinksJsonFromSelect,
} from "@/lib/contentsCompat"
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

type ProjectWorkspaceSnapshot = Omit<ProjectWorkspaceState, "refresh">

type WorkspaceCacheEntry = {
  snapshot: ProjectWorkspaceSnapshot
  cachedAt: number
}

const WORKSPACE_CACHE_TTL_MS = 30_000

function emptyWorkspaceSnapshot(): ProjectWorkspaceSnapshot {
  const now = new Date()
  return {
    loading: true,
    error: null,
    canEdit: false,
    canViewFinance: false,
    orgId: null,
    role: null,
    needsOnboarding: false,
    month: toYm(now),
    todayYmd: toYmd(now),
    clients: [],
    members: [],
    projects: [],
    contents: [],
    tasks: [],
    events: [],
    assets: [],
    changes: [],
    expenses: [],
    rateCards: [],
    storedExceptions: [],
    invoices: [],
    invoiceLines: [],
    vendorInvoices: [],
    vendorInvoiceLines: [],
    projectSummaries: [],
    runtimeExceptions: [],
  }
}

function toErrorMessage(label: string, message?: string) {
  return `${label}の読み込みに失敗しました${message ? `: ${message}` : ""}`
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

const workspaceCache = new Map<string, WorkspaceCacheEntry>()
const workspaceInflight = new Map<string, Promise<ProjectWorkspaceSnapshot>>()
const workspaceContentSelect =
  "id, org_id, client_id, project_id, project_name, title, due_client_at, due_editor_at, publish_at, status, thumbnail_done, billable_flag, delivery_month, unit_price, invoice_id, sequence_no, assignee_editor_user_id, assignee_checker_user_id, revision_count, workload_points, estimated_cost, next_action, blocked_reason, material_status, draft_status, final_status, health_score, links_json, editor_submitted_at, client_submitted_at"
const workspaceContentSelectLegacy = removeLinksJsonFromSelect(workspaceContentSelect)

function getWorkspaceKey(orgId: string, role: string | null, canViewFinance: boolean) {
  return `${orgId}:${role ?? "none"}:${canViewFinance ? "finance" : "base"}`
}

function readWorkspaceCache(key: string) {
  const entry = workspaceCache.get(key)
  if (!entry) return null
  return {
    snapshot: entry.snapshot,
    stale: Date.now() - entry.cachedAt > WORKSPACE_CACHE_TTL_MS,
  }
}

function writeWorkspaceCache(key: string, snapshot: ProjectWorkspaceSnapshot) {
  workspaceCache.set(key, {
    snapshot,
    cachedAt: Date.now(),
  })
}

async function fetchWorkspaceSnapshot(params: {
  orgId: string
  role: string | null
  canViewFinance: boolean
}): Promise<ProjectWorkspaceSnapshot> {
  const { orgId, role, canViewFinance } = params
  const now = new Date()
  const todayYmd = toYmd(now)
  const month = toYm(now)
  const loadContents = async (): Promise<{
    data: Array<Record<string, unknown>>
    error: { message: string } | null
  }> => {
    const result = await supabase
      .from("contents")
      .select(workspaceContentSelect)
      .eq("org_id", orgId)
      .order("due_client_at", { ascending: true })

    if (result.error && isMissingContentsLinksJsonColumn(result.error.message)) {
      const legacyResult = await supabase
        .from("contents")
        .select(workspaceContentSelectLegacy)
        .eq("org_id", orgId)
        .order("due_client_at", { ascending: true })
      return {
        data: ensureContentLinksJsonRows((legacyResult.data ?? []) as unknown as Array<Record<string, unknown>>),
        error: legacyResult.error ? { message: legacyResult.error.message } : null,
      }
    }

    return {
      data: ensureContentLinksJsonRows((result.data ?? []) as Array<Record<string, unknown>>),
      error: result.error ? { message: result.error.message } : null,
    }
  }

  const queries = await Promise.all([
    supabase.from("clients").select("id, name").eq("org_id", orgId).order("name"),
    loadMembers(orgId),
    supabase.from("projects").select("*").eq("org_id", orgId).order("created_at", { ascending: false }),
    loadContents(),
    supabase.from("project_tasks").select("*").eq("org_id", orgId).order("planned_end_date", { ascending: true }),
    supabase.from("schedule_events").select("*").eq("org_id", orgId).order("start_at", { ascending: true }),
    supabase.from("material_assets").select("*").eq("org_id", orgId).order("created_at", { ascending: false }),
    supabase.from("change_requests").select("*").eq("org_id", orgId).order("created_at", { ascending: false }),
    canViewFinance
      ? supabase.from("expenses").select("*").eq("org_id", orgId).order("occurred_on", { ascending: false })
      : Promise.resolve({ data: [], error: null }),
    canViewFinance
      ? supabase.from("rate_cards").select("*").eq("org_id", orgId).order("effective_from", { ascending: false })
      : Promise.resolve({ data: [], error: null }),
    supabase.from("exceptions").select("*").eq("org_id", orgId).order("detected_at", { ascending: false }),
    canViewFinance
      ? supabase.from("invoices").select("id, org_id, client_id, invoice_month, status").eq("org_id", orgId)
      : Promise.resolve({ data: [], error: null }),
    canViewFinance
      ? supabase.from("invoice_lines").select("id, invoice_id, content_id, amount")
      : Promise.resolve({ data: [], error: null }),
    canViewFinance
      ? supabase.from("vendor_invoices").select("id, org_id, billing_month, status").eq("org_id", orgId)
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
    tasksRes.error ? toErrorMessage("タスク", tasksRes.error.message) : null,
    eventsRes.error ? toErrorMessage("カレンダー", eventsRes.error.message) : null,
    assetsRes.error ? toErrorMessage("素材", assetsRes.error.message) : null,
    changesRes.error ? toErrorMessage("変更申請", changesRes.error.message) : null,
    expensesRes.error ? toErrorMessage("経費", expensesRes.error.message) : null,
    rateCardsRes.error ? toErrorMessage("単価DB", rateCardsRes.error.message) : null,
    storedExceptionsRes.error ? toErrorMessage("例外", storedExceptionsRes.error.message) : null,
    invoicesRes.error ? toErrorMessage("請求", invoicesRes.error.message) : null,
    invoiceLinesRes.error ? toErrorMessage("請求明細", invoiceLinesRes.error.message) : null,
    vendorInvoicesRes.error ? toErrorMessage("外注請求", vendorInvoicesRes.error.message) : null,
    vendorInvoiceLinesRes.error ? toErrorMessage("外注請求明細", vendorInvoiceLinesRes.error.message) : null,
  ].filter(Boolean)

  const clients = ((clientsRes.data ?? []) as WorkspaceClient[]) || []
  const members = (membersRes ?? []) as ProjectMember[]
  const projects = ((projectsRes.data ?? []) as ProjectRow[]) || []
  const contents = ((contentsRes.data ?? []) as WorkspaceContent[]) || []
  const tasks = ((tasksRes.data ?? []) as ProjectTaskRow[]) || []
  const events = ((eventsRes.data ?? []) as ScheduleEventRow[]) || []
  const assets = ((assetsRes.data ?? []) as MaterialAssetRow[]) || []
  const changes = ((changesRes.data ?? []) as ChangeRequestRow[]) || []
  const expenses = ((expensesRes.data ?? []) as ExpenseRow[]) || []
  const rateCards = ((rateCardsRes.data ?? []) as RateCardRow[]) || []
  const storedExceptions = ((storedExceptionsRes.data ?? []) as StoredExceptionRow[]) || []
  const invoices = ((invoicesRes.data ?? []) as InvoiceRowLite[]) || []
  const invoiceLines = ((invoiceLinesRes.data ?? []) as InvoiceLineLite[]) || []
  const vendorInvoices = ((vendorInvoicesRes.data ?? []) as VendorInvoiceRowLite[]) || []
  const vendorInvoiceLines = ((vendorInvoiceLinesRes.data ?? []) as VendorInvoiceLineLite[]) || []

  const projectSummaries = buildProjectSummaries({
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
  })

  const runtimeExceptions = buildRuntimeExceptionCandidates({
    projects,
    contents,
    storedExceptions,
    month,
    todayYmd,
  })

  return {
    loading: false,
    error: errors[0] ?? null,
    canEdit: role === "owner" || role === "executive_assistant",
    canViewFinance,
    orgId,
    role,
    needsOnboarding: false,
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
  }
}

async function refreshWorkspaceSnapshot(params: {
  orgId: string
  role: string | null
  canViewFinance: boolean
}) {
  const key = getWorkspaceKey(params.orgId, params.role, params.canViewFinance)
  const inflight = workspaceInflight.get(key)
  if (inflight) return inflight

  const promise = fetchWorkspaceSnapshot(params)
    .then((snapshot) => {
      writeWorkspaceCache(key, snapshot)
      return snapshot
    })
    .finally(() => {
      if (workspaceInflight.get(key) === promise) {
        workspaceInflight.delete(key)
      }
    })

  workspaceInflight.set(key, promise)
  return promise
}

export function useProjectWorkspace(): ProjectWorkspaceState {
  const { activeOrgId, role, loading: authLoading, needsOnboarding } = useAuthOrg({ redirectToOnboarding: true })
  const canEdit = role === "owner" || role === "executive_assistant"
  const canViewFinance = canEdit
  const [snapshot, setSnapshot] = useState<ProjectWorkspaceSnapshot>(() => emptyWorkspaceSnapshot())

  const load = useCallback(
    async (options?: { force?: boolean }) => {
      if (!activeOrgId) {
        setSnapshot({
          ...emptyWorkspaceSnapshot(),
          loading: false,
          needsOnboarding,
          role: role ?? null,
          canEdit,
          canViewFinance,
          orgId: null,
        })
        return
      }

      const key = getWorkspaceKey(activeOrgId, role, canViewFinance)
      const cached = options?.force ? null : readWorkspaceCache(key)
      if (cached) {
        setSnapshot(cached.snapshot)
        if (cached.stale) {
          void refreshWorkspaceSnapshot({
            orgId: activeOrgId,
            role,
            canViewFinance,
          })
            .then((next) => {
              setSnapshot(next)
            })
            .catch((error) => {
              if (process.env.NODE_ENV === "development") {
                console.error("[useProjectWorkspace] background refresh error", error)
              }
            })
        }
        return
      }

      setSnapshot((prev) => ({
        ...prev,
        loading: true,
        error: null,
        orgId: activeOrgId,
        role: role ?? null,
        canEdit,
        canViewFinance,
        needsOnboarding: false,
      }))

      try {
        const nextSnapshot = await refreshWorkspaceSnapshot({
          orgId: activeOrgId,
          role,
          canViewFinance,
        })
        setSnapshot(nextSnapshot)
      } catch (error) {
        if (process.env.NODE_ENV === "development") {
          console.error("[useProjectWorkspace] load error", error)
        }
        setSnapshot((prev) => ({
          ...prev,
          loading: false,
          error: "ワークスペースの読み込みに失敗しました",
          orgId: activeOrgId,
          role: role ?? null,
          canEdit,
          canViewFinance,
          needsOnboarding: false,
        }))
      }
    },
    [activeOrgId, canEdit, canViewFinance, needsOnboarding, role]
  )

  useEffect(() => {
    if (authLoading) return

    if (!activeOrgId || needsOnboarding) {
      queueMicrotask(() =>
        setSnapshot({
          ...emptyWorkspaceSnapshot(),
          loading: false,
          needsOnboarding,
          role: role ?? null,
          canEdit,
          canViewFinance,
          orgId: activeOrgId ?? null,
        })
      )
      return
    }

    const key = getWorkspaceKey(activeOrgId, role, canViewFinance)
    const cached = readWorkspaceCache(key)
    if (cached) {
      queueMicrotask(() => setSnapshot(cached.snapshot))
      if (cached.stale) {
        void refreshWorkspaceSnapshot({
          orgId: activeOrgId,
          role,
          canViewFinance,
        })
          .then((next) => {
            setSnapshot(next)
          })
          .catch((error) => {
            if (process.env.NODE_ENV === "development") {
              console.error("[useProjectWorkspace] background refresh error", error)
            }
          })
      }
      return
    }

    queueMicrotask(() => {
      void load({ force: true })
    })
  }, [activeOrgId, authLoading, canEdit, canViewFinance, load, needsOnboarding, role])

  const refresh = useCallback(async () => {
    if (!activeOrgId) return
    setSnapshot((prev) => ({
      ...prev,
      loading: true,
      error: null,
      orgId: activeOrgId,
      role: role ?? null,
      canEdit,
      canViewFinance,
      needsOnboarding: false,
    }))

    try {
      const nextSnapshot = await refreshWorkspaceSnapshot({
        orgId: activeOrgId,
        role,
        canViewFinance,
      })
      setSnapshot(nextSnapshot)
    } catch (error) {
      if (process.env.NODE_ENV === "development") {
        console.error("[useProjectWorkspace] refresh error", error)
      }
      setSnapshot((prev) => ({
        ...prev,
        loading: false,
        error: "ワークスペースの再取得に失敗しました",
        orgId: activeOrgId,
        role: role ?? null,
        canEdit,
        canViewFinance,
        needsOnboarding: false,
      }))
    }
  }, [activeOrgId, canEdit, canViewFinance, role])

  return {
    ...snapshot,
    refresh,
  }
}
