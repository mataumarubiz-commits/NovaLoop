import type { SupabaseClient } from "@supabase/supabase-js"
import { buildWorkItemDescription, isBillableWorkItemStatus } from "@/lib/workItems"

export type BillingDuplicateMode = "skip_existing" | "allow_additional"

export type BillingContentRow = {
  id: string
  client_id: string
  project_name: string
  title: string
  service_name: string
  quantity: number
  unit_price: number
  amount: number
  billing_model: string | null
  service_category: string | null
  status: string
  due_client_at: string
  delivery_month: string
  invoice_id: string | null
}

export type BillingExistingInvoice = {
  id: string
  client_id: string | null
  invoice_no: string | null
  invoice_title: string | null
  status: string
  issue_date: string
  due_date: string
  subtotal: number | null
  total: number | null
}

export type BillingPreviewClient = {
  client_id: string
  client_name: string
  billing_month: string
  target_count: number
  total_amount: number
  existing_invoice_count: number
  existing_invoice_ids: string[]
  existing_invoice_labels: string[]
  can_generate: boolean
  warning: string | null
  content_ids: string[]
  contents: BillingContentRow[]
}

export type BillingPreviewResult = {
  billing_month: string
  total_count: number
  total_amount: number
  total_clients: number
  clients: BillingPreviewClient[]
}

type ClientRow = { id: string; name: string }
type ExistingInvoiceRow = BillingExistingInvoice

const WORK_ITEM_SELECT =
  "id, client_id, project_name, title, service_name, quantity, amount, billing_model, service_category, unit_price, status, due_client_at, delivery_month, invoice_id"
const LEGACY_SELECT = "id, client_id, project_name, title, unit_price, status, due_client_at, delivery_month, invoice_id"

const isMissingWorkItemColumnsError = (message?: string | null) =>
  message?.includes("column contents.service_name does not exist") ||
  message?.includes("column contents.quantity does not exist") ||
  message?.includes("column contents.amount does not exist") ||
  message?.includes("column contents.billing_model does not exist") ||
  message?.includes("column contents.service_category does not exist")

export function issueDateYmd(date = new Date()): string {
  return date.toISOString().slice(0, 10)
}

export function nextMonthEndFromBillingMonth(ym: string): string {
  const [year, month] = ym.split("-").map(Number)
  const nextMonth = month === 12 ? 1 : month + 1
  const nextYear = month === 12 ? year + 1 : year
  const d = new Date(nextYear, nextMonth, 0)
  return d.toISOString().slice(0, 10)
}

export async function loadBillingPreview(params: {
  admin: SupabaseClient
  orgId: string
  billingMonth: string
  clientId?: string | null
}): Promise<BillingPreviewResult> {
  const { admin, orgId, billingMonth, clientId } = params

  let contentsQuery = admin
    .from("contents")
    .select(WORK_ITEM_SELECT)
    .eq("org_id", orgId)
    .eq("delivery_month", billingMonth)
    .eq("billable_flag", true)
    .is("invoice_id", null)
    .order("due_client_at", { ascending: true })

  if (clientId) {
    contentsQuery = contentsQuery.eq("client_id", clientId)
  }

  const { data: contentsData, error: initialContentsError } = await contentsQuery
  let contentsError = initialContentsError
  let normalizedContentsData = (contentsData ?? null) as Array<Record<string, unknown>> | null
  let usedLegacyShape = false
  if (contentsError && isMissingWorkItemColumnsError(contentsError.message)) {
    usedLegacyShape = true
    let legacyQuery = admin
      .from("contents")
      .select(LEGACY_SELECT)
      .eq("org_id", orgId)
      .eq("delivery_month", billingMonth)
      .eq("billable_flag", true)
      .is("invoice_id", null)
      .order("due_client_at", { ascending: true })

    if (clientId) {
      legacyQuery = legacyQuery.eq("client_id", clientId)
    }

    const legacyResult = await legacyQuery
    normalizedContentsData = (legacyResult.data ?? null) as Array<Record<string, unknown>> | null
    contentsError = legacyResult.error
  }

  if (contentsError) {
    throw new Error(`請求対象コンテンツの取得に失敗しました: ${contentsError.message}`)
  }

  const contents = (normalizedContentsData ?? [])
    .map((row) => ({
      id: String(row.id),
      client_id: String(row.client_id),
      project_name: String(row.project_name ?? ""),
      title: String(row.title ?? ""),
      service_name: String(row.service_name ?? row.title ?? row.project_name ?? ""),
      quantity: Number(row.quantity ?? 1),
      unit_price: Number(row.unit_price ?? 0),
      amount: Number(row.amount ?? Number(row.quantity ?? 1) * Number(row.unit_price ?? 0)),
      billing_model: typeof row.billing_model === "string" ? row.billing_model : usedLegacyShape ? "per_unit" : null,
      service_category:
        typeof row.service_category === "string" ? row.service_category : usedLegacyShape ? "video_editing" : null,
      status: String(row.status ?? ""),
      due_client_at: String(row.due_client_at ?? ""),
      delivery_month: String(row.delivery_month ?? ""),
      invoice_id: row.invoice_id ? String(row.invoice_id) : null,
    }))
    .filter((row) => isBillableWorkItemStatus(row.status, row.billing_model) && Number(row.amount) > 0)

  const contentClientIds = Array.from(new Set(contents.map((row) => row.client_id)))

  let clients: ClientRow[] = []
  if (contentClientIds.length > 0) {
    const { data: clientsData, error: clientsError } = await admin
      .from("clients")
      .select("id, name")
      .in("id", contentClientIds)
    if (clientsError) {
      throw new Error(`クライアント情報の取得に失敗しました: ${clientsError.message}`)
    }
    clients = (clientsData ?? []) as ClientRow[]
  }

  let existingInvoicesQuery = admin
    .from("invoices")
    .select("id, client_id, invoice_no, invoice_title, status, issue_date, due_date, subtotal, total")
    .eq("org_id", orgId)
    .eq("invoice_month", billingMonth)
    .order("created_at", { ascending: false })

  if (clientId) {
    existingInvoicesQuery = existingInvoicesQuery.eq("client_id", clientId)
  } else if (contentClientIds.length > 0) {
    existingInvoicesQuery = existingInvoicesQuery.in("client_id", contentClientIds)
  }

  const { data: existingInvoicesData, error: existingInvoicesError } = await existingInvoicesQuery
  if (existingInvoicesError) {
    throw new Error(`既存請求書の取得に失敗しました: ${existingInvoicesError.message}`)
  }

  const existingInvoices = (existingInvoicesData ?? []) as ExistingInvoiceRow[]
  const existingByClient = new Map<string, ExistingInvoiceRow[]>()
  for (const invoice of existingInvoices) {
    if (!invoice.client_id) continue
    const list = existingByClient.get(invoice.client_id) ?? []
    list.push(invoice)
    existingByClient.set(invoice.client_id, list)
  }

  const clientNameMap = new Map(clients.map((row) => [row.id, row.name]))
  const grouped = new Map<string, BillingContentRow[]>()
  for (const row of contents) {
    const list = grouped.get(row.client_id) ?? []
    list.push(row)
    grouped.set(row.client_id, list)
  }

  const previewClients: BillingPreviewClient[] = Array.from(grouped.entries())
    .map(([groupClientId, rows]) => {
      const subtotal = rows.reduce((sum, row) => sum + Number(row.amount), 0)
      const existing = existingByClient.get(groupClientId) ?? []
      const warning =
        existing.length > 0
          ? `同月の請求書が ${existing.length} 件あります。通常はスキップし、必要時のみ追加発行してください。`
          : null

      return {
        client_id: groupClientId,
        client_name: clientNameMap.get(groupClientId) ?? groupClientId,
        billing_month: billingMonth,
        target_count: rows.length,
        total_amount: subtotal,
        existing_invoice_count: existing.length,
        existing_invoice_ids: existing.map((row) => row.id),
        existing_invoice_labels: existing.map((row) => row.invoice_no || row.invoice_title || row.id),
        can_generate: rows.length > 0,
        warning,
        content_ids: rows.map((row) => row.id),
        contents: rows,
      }
    })
    .sort((a, b) => a.client_name.localeCompare(b.client_name, "ja"))

  return {
    billing_month: billingMonth,
    total_count: previewClients.reduce((sum, row) => sum + row.target_count, 0),
    total_amount: previewClients.reduce((sum, row) => sum + row.total_amount, 0),
    total_clients: previewClients.length,
    clients: previewClients,
  }
}

export function buildInvoiceTitle(billingMonth: string): string {
  return `${billingMonth}分ご請求書`
}

export function buildInvoiceLineDescription(content: BillingContentRow): string {
  return buildWorkItemDescription(content.service_name, content.title, content.project_name)
}
