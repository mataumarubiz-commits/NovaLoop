import { createSupabaseAdmin } from "@/lib/supabaseAdmin"
import { selectWithColumnFallback } from "@/lib/postgrestCompat"

export const DOCUMENT_SCOPE_OPTIONS = ["sales", "vendor"] as const
export const DOCUMENT_PDF_FILTER_OPTIONS = ["all", "with_pdf", "missing_pdf"] as const
export const DOCUMENT_SORT_OPTIONS = ["newest", "oldest", "amount_desc", "amount_asc"] as const

export type DocumentScope = (typeof DOCUMENT_SCOPE_OPTIONS)[number]
export type DocumentPdfFilter = (typeof DOCUMENT_PDF_FILTER_OPTIONS)[number]
export type DocumentSort = (typeof DOCUMENT_SORT_OPTIONS)[number]

export type DocumentsArchiveQuery = {
  orgId: string
  month: string | null
  status: string | null
  pdfFilter: DocumentPdfFilter
  query: string
  sort: DocumentSort
  monthLimit: number
  monthOffset: number
}

export type DocumentsArchiveStatusOption = {
  value: string
  label: string
}

export type DocumentsArchiveItem = {
  id: string
  scope: DocumentScope
  month: string
  title: string
  partyName: string
  amount: number
  status: string
  statusLabel: string
  hasPdf: boolean
  pdfPath: string | null
  primaryDate: string | null
  primaryDateLabel: string
  secondaryDate: string | null
  secondaryDateLabel: string
  detailHref: string
  pdfEndpoint: string
  pdfActionLabel: string | null
  pdfActionKind: "regenerate" | "upload" | "replace" | null
  documentNumber: string | null
  subtitle: string | null
  actionRequired: boolean
  vendorId: string | null
}

export type DocumentsArchiveMonthGroup = {
  month: string
  count: number
  totalAmount: number
  pdfSavedCount: number
  pdfMissingCount: number
  actionRequiredCount: number
  items: DocumentsArchiveItem[]
}

export type DocumentsArchiveSection = {
  totalDocuments: number
  totalMonths: number
  hasMore: boolean
  monthGroups: DocumentsArchiveMonthGroup[]
}

export type DocumentsArchiveResponse = {
  generatedAt: string
  filters: {
    month: string | null
    status: string | null
    pdfFilter: DocumentPdfFilter
    query: string
    sort: DocumentSort
    monthLimit: number
    monthOffset: number
    availableMonths: string[]
    statusOptions: {
      sales: DocumentsArchiveStatusOption[]
      vendor: DocumentsArchiveStatusOption[]
    }
  }
  summary: {
    currentMonth: string
    currentMonthSalesCount: number
    currentMonthVendorCount: number
    pdfMissingCount: number
    actionRequiredCount: number
  }
  sales: DocumentsArchiveSection
  vendor: DocumentsArchiveSection
}

type InvoiceArchiveRow = {
  id: string
  invoice_month: string
  invoice_title: string | null
  invoice_no: string | null
  status: string
  issue_date: string | null
  due_date: string | null
  total: number | null
  subtotal: number | null
  created_at: string | null
  client_id: string | null
  guest_client_name: string | null
  guest_company_name: string | null
  pdf_path: string | null
}

type VendorInvoiceArchiveRow = {
  id: string
  vendor_id: string
  billing_month: string
  invoice_number?: string | null
  status: string
  total: number | null
  pdf_path: string | null
  submitted_at?: string | null
  first_submitted_at?: string | null
  resubmitted_at?: string | null
  approved_at?: string | null
  confirmed_at?: string | null
  created_at: string | null
}

const VENDOR_ARCHIVE_COLUMNS = [
  "id",
  "vendor_id",
  "billing_month",
  "invoice_number",
  "status",
  "total",
  "pdf_path",
  "submitted_at",
  "first_submitted_at",
  "resubmitted_at",
  "approved_at",
  "confirmed_at",
  "created_at",
]

const SALES_STATUS_OPTIONS: DocumentsArchiveStatusOption[] = [
  { value: "draft", label: "Draft" },
  { value: "issued", label: "発行済み" },
  { value: "void", label: "無効" },
]

const VENDOR_STATUS_OPTIONS: DocumentsArchiveStatusOption[] = [
  { value: "draft", label: "下書き" },
  { value: "submitted", label: "提出済み" },
  { value: "approved", label: "承認済み" },
  { value: "rejected", label: "差し戻し" },
  { value: "paid", label: "支払済み" },
]

function normalizeMonth(value: string | null | undefined) {
  return typeof value === "string" && /^\d{4}-\d{2}$/.test(value) ? value : null
}

function normalizeDate(value: unknown) {
  if (typeof value !== "string") return null
  return value.trim() || null
}

function toAmount(value: number | string | null | undefined) {
  if (typeof value === "number") return value
  if (typeof value === "string" && value.trim()) return Number(value)
  return 0
}

function currentMonth() {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`
}

function normalizeSearchTarget(parts: Array<string | null | undefined>) {
  return parts
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    .join(" ")
    .toLowerCase()
}

function salesStatusLabel(status: string) {
  return SALES_STATUS_OPTIONS.find((option) => option.value === status)?.label ?? status
}

function vendorStatusLabel(status: string) {
  return VENDOR_STATUS_OPTIONS.find((option) => option.value === status)?.label ?? status
}

function sortItems(items: DocumentsArchiveItem[], sort: DocumentSort) {
  const sorted = [...items]
  const getTimestamp = (value: string | null) => (value ? new Date(value).getTime() : 0)

  sorted.sort((left, right) => {
    if (sort === "amount_desc") {
      if (right.amount !== left.amount) return right.amount - left.amount
      return getTimestamp(right.primaryDate ?? right.secondaryDate) - getTimestamp(left.primaryDate ?? left.secondaryDate)
    }
    if (sort === "amount_asc") {
      if (left.amount !== right.amount) return left.amount - right.amount
      return getTimestamp(right.primaryDate ?? right.secondaryDate) - getTimestamp(left.primaryDate ?? left.secondaryDate)
    }
    if (sort === "oldest") {
      return getTimestamp(left.primaryDate ?? left.secondaryDate) - getTimestamp(right.primaryDate ?? right.secondaryDate)
    }
    return getTimestamp(right.primaryDate ?? right.secondaryDate) - getTimestamp(left.primaryDate ?? left.secondaryDate)
  })

  return sorted
}

function buildSection(items: DocumentsArchiveItem[], monthLimit: number, monthOffset: number): DocumentsArchiveSection {
  const months = Array.from(new Set(items.map((item) => item.month))).sort().reverse()
  const visibleMonths = months.slice(monthOffset, monthOffset + monthLimit)

  return {
    totalDocuments: items.length,
    totalMonths: months.length,
    hasMore: monthOffset + monthLimit < months.length,
    monthGroups: visibleMonths.map((month) => {
      const monthItems = items.filter((item) => item.month === month)
      return {
        month,
        count: monthItems.length,
        totalAmount: monthItems.reduce((sum, item) => sum + item.amount, 0),
        pdfSavedCount: monthItems.filter((item) => item.hasPdf).length,
        pdfMissingCount: monthItems.filter((item) => !item.hasPdf).length,
        actionRequiredCount: monthItems.filter((item) => item.actionRequired).length,
        items: monthItems,
      }
    }),
  }
}

type CurrentMonthSummary = {
  currentMonthSalesCount: number
  currentMonthVendorCount: number
  pdfMissingCount: number
  actionRequiredCount: number
}

async function loadSalesItems(query: DocumentsArchiveQuery) {
  const admin = createSupabaseAdmin()
  let request = admin
    .from("invoices")
    .select(
      "id, invoice_month, invoice_title, invoice_no, status, issue_date, due_date, total, subtotal, created_at, client_id, guest_client_name, guest_company_name, pdf_path"
    )
    .eq("org_id", query.orgId)

  if (query.month) request = request.eq("invoice_month", query.month)
  if (query.status) request = request.eq("status", query.status)
  if (query.pdfFilter === "with_pdf") request = request.not("pdf_path", "is", null)
  if (query.pdfFilter === "missing_pdf") request = request.is("pdf_path", null)

  request = request.order("invoice_month", { ascending: false }).order("created_at", { ascending: false })

  const { data, error } = await request
  if (error) throw new Error(`請求書アーカイブの取得に失敗しました: ${error.message}`)

  const rows = (data ?? []) as InvoiceArchiveRow[]
  const clientIds = Array.from(new Set(rows.map((row) => row.client_id).filter(Boolean))) as string[]
  const clientNameMap = new Map<string, string>()

  if (clientIds.length > 0) {
    const { data: clients, error: clientsError } = await admin
      .from("clients")
      .select("id, name, billing_name")
      .in("id", clientIds)
    if (clientsError) throw new Error(`請求先の取得に失敗しました: ${clientsError.message}`)
    for (const client of (clients ?? []) as Array<{ id: string; name: string | null; billing_name?: string | null }>) {
      clientNameMap.set(client.id, client.billing_name?.trim() || client.name?.trim() || "請求先未設定")
    }
  }

  const normalized = rows
    .map<DocumentsArchiveItem>((row) => {
      const partyName =
        (row.client_id ? clientNameMap.get(row.client_id) : null) ??
        row.guest_company_name?.trim() ??
        row.guest_client_name?.trim() ??
        "請求先未設定"
      const hasPdf = Boolean(row.pdf_path)
      return {
        id: row.id,
        scope: "sales",
        month: row.invoice_month,
        title: row.invoice_title?.trim() || row.invoice_no?.trim() || "請求書",
        partyName,
        amount: toAmount(row.total ?? row.subtotal),
        status: row.status,
        statusLabel: salesStatusLabel(row.status),
        hasPdf,
        pdfPath: row.pdf_path,
        primaryDate: normalizeDate(row.issue_date),
        primaryDateLabel: "発行日",
        secondaryDate: normalizeDate(row.created_at),
        secondaryDateLabel: "登録日",
        detailHref: `/invoices/${row.id}`,
        pdfEndpoint: `/api/invoices/${row.id}/pdf`,
        pdfActionLabel: hasPdf ? null : "PDF再生成",
        pdfActionKind: hasPdf ? null : "regenerate",
        documentNumber: row.invoice_no?.trim() || null,
        subtitle: row.invoice_no?.trim() || null,
        actionRequired: !hasPdf || row.status !== "issued",
        vendorId: null,
      }
    })
    .filter((item) => {
      if (!query.query.trim()) return true
      return normalizeSearchTarget([item.title, item.partyName, item.month, item.documentNumber, item.subtitle]).includes(
        query.query.trim().toLowerCase()
      )
    })

  return sortItems(normalized, query.sort)
}

async function loadVendorItems(query: DocumentsArchiveQuery) {
  const admin = createSupabaseAdmin()
  const { data } = await selectWithColumnFallback<VendorInvoiceArchiveRow[]>({
    table: "vendor_invoices",
    columns: VENDOR_ARCHIVE_COLUMNS,
    execute: async (columnsCsv) => {
      let request = admin.from("vendor_invoices").select(columnsCsv).eq("org_id", query.orgId)
      if (query.month) request = request.eq("billing_month", query.month)
      if (query.status) request = request.eq("status", query.status)
      if (query.pdfFilter === "with_pdf") request = request.not("pdf_path", "is", null)
      if (query.pdfFilter === "missing_pdf") request = request.is("pdf_path", null)
      const result = await request.order("billing_month", { ascending: false }).order("created_at", { ascending: false })
      return {
        data: (result.data ?? []) as unknown as VendorInvoiceArchiveRow[],
        error: result.error,
      }
    },
  })

  const rows = (data ?? []) as VendorInvoiceArchiveRow[]
  const vendorIds = Array.from(new Set(rows.map((row) => row.vendor_id).filter(Boolean))) as string[]
  const vendorNameMap = new Map<string, string>()

  if (vendorIds.length > 0) {
    const { data: vendors, error: vendorsError } = await admin.from("vendors").select("id, name").in("id", vendorIds)
    if (vendorsError) throw new Error(`外注先の取得に失敗しました: ${vendorsError.message}`)
    for (const vendor of (vendors ?? []) as Array<{ id: string; name: string | null }>) {
      vendorNameMap.set(vendor.id, vendor.name?.trim() || "外注先未設定")
    }
  }

  const normalized = rows
    .map<DocumentsArchiveItem>((row) => {
      const hasPdf = Boolean(row.pdf_path)
      return {
        id: row.id,
        scope: "vendor",
        month: row.billing_month,
        title: row.invoice_number?.trim() || `${row.billing_month} 外注請求書`,
        partyName: vendorNameMap.get(row.vendor_id) ?? "外注先未設定",
        amount: toAmount(row.total),
        status: row.status,
        statusLabel: vendorStatusLabel(row.status),
        hasPdf,
        pdfPath: row.pdf_path,
        primaryDate: normalizeDate(row.submitted_at ?? row.first_submitted_at ?? row.created_at),
        primaryDateLabel: "登録日",
        secondaryDate: normalizeDate(row.approved_at ?? row.confirmed_at ?? row.resubmitted_at ?? row.created_at),
        secondaryDateLabel: "更新日",
        detailHref: `/vendors/${row.vendor_id}/invoices/${row.id}`,
        pdfEndpoint: `/api/vendor-invoices/${row.id}/pdf`,
        pdfActionLabel: hasPdf ? "PDF差し替え" : "PDF添付",
        pdfActionKind: hasPdf ? "replace" : "upload",
        documentNumber: row.invoice_number?.trim() || null,
        subtitle: row.invoice_number?.trim() || null,
        actionRequired: !hasPdf || row.status === "draft" || row.status === "rejected",
        vendorId: row.vendor_id,
      }
    })
    .filter((item) => {
      if (!query.query.trim()) return true
      return normalizeSearchTarget([item.title, item.partyName, item.month, item.documentNumber, item.subtitle]).includes(
        query.query.trim().toLowerCase()
      )
    })

  return sortItems(normalized, query.sort)
}

async function loadCurrentMonthSummary(orgId: string): Promise<CurrentMonthSummary> {
  const admin = createSupabaseAdmin()
  const month = currentMonth()
  const [salesRes, vendorRes] = await Promise.all([
    admin.from("invoices").select("id, status, pdf_path").eq("org_id", orgId).eq("invoice_month", month),
    admin.from("vendor_invoices").select("id, status, pdf_path").eq("org_id", orgId).eq("billing_month", month),
  ])

  if (salesRes.error) throw new Error(`今月の請求書サマリー取得に失敗しました: ${salesRes.error.message}`)
  if (vendorRes.error) throw new Error(`今月の外注請求サマリー取得に失敗しました: ${vendorRes.error.message}`)

  const salesRows = (salesRes.data ?? []) as Array<{ status?: string | null; pdf_path?: string | null }>
  const vendorRows = (vendorRes.data ?? []) as Array<{ status?: string | null; pdf_path?: string | null }>

  return {
    currentMonthSalesCount: salesRows.length,
    currentMonthVendorCount: vendorRows.length,
    pdfMissingCount: [...salesRows, ...vendorRows].filter((row) => !row.pdf_path).length,
    actionRequiredCount:
      salesRows.filter((row) => !row.pdf_path || row.status !== "issued").length +
      vendorRows.filter((row) => !row.pdf_path || row.status === "draft" || row.status === "rejected").length,
  }
}

export async function loadDocumentsArchive(query: DocumentsArchiveQuery): Promise<DocumentsArchiveResponse> {
  const [salesItems, vendorItems, summary] = await Promise.all([
    loadSalesItems(query),
    loadVendorItems(query),
    loadCurrentMonthSummary(query.orgId),
  ])
  const current = currentMonth()
  const availableMonths = Array.from(new Set([...salesItems, ...vendorItems].map((item) => item.month))).sort().reverse()

  return {
    generatedAt: new Date().toISOString(),
    filters: {
      month: query.month,
      status: query.status,
      pdfFilter: query.pdfFilter,
      query: query.query,
      sort: query.sort,
      monthLimit: query.monthLimit,
      monthOffset: query.monthOffset,
      availableMonths,
      statusOptions: {
        sales: SALES_STATUS_OPTIONS,
        vendor: VENDOR_STATUS_OPTIONS,
      },
    },
    summary: {
      currentMonth: current,
      currentMonthSalesCount: summary.currentMonthSalesCount,
      currentMonthVendorCount: summary.currentMonthVendorCount,
      pdfMissingCount: summary.pdfMissingCount,
      actionRequiredCount: summary.actionRequiredCount,
    },
    sales: buildSection(salesItems, query.monthLimit, query.monthOffset),
    vendor: buildSection(vendorItems, query.monthLimit, query.monthOffset),
  }
}

export function parseDocumentsArchiveMonth(value: string | null) {
  return normalizeMonth(value)
}
