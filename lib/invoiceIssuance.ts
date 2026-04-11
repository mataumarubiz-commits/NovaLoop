import type { SupabaseClient } from "@supabase/supabase-js"

export type InvoiceIssueCandidate = {
  id: string
  request_id?: string | null
  status: string
  invoice_no: string | null
  issue_date: string | null
  issued_at: string | null
}

export type PlannedInvoiceIssue = {
  invoiceId: string
  invoiceNo: string
  issueDate: string
  issuedAt: string
  needsUpdate: boolean
  assignedNewNumber: boolean
}

const YMD_PATTERN = /^\d{4}-\d{2}-\d{2}$/

function normalizeText(value: string | null | undefined) {
  return typeof value === "string" ? value.trim() : ""
}

export function buildInvoiceNo(issueDate: string, seq: number) {
  return `INV-${issueDate.slice(0, 4)}-${String(seq).padStart(7, "0")}`
}

export function planInvoiceIssue(params: {
  invoices: InvoiceIssueCandidate[]
  initialSeq: number
  nowIso?: string
}) {
  const nowIso = params.nowIso ?? new Date().toISOString()
  const todayYmd = nowIso.slice(0, 10)
  let nextSeq = Number.isFinite(params.initialSeq) && params.initialSeq > 0 ? Math.floor(params.initialSeq) : 1

  const updates: PlannedInvoiceIssue[] = []
  for (const invoice of params.invoices) {
    if (invoice.status === "void") {
      throw new Error("無効化された請求書は発行できません。")
    }

    const issueDate = YMD_PATTERN.test(normalizeText(invoice.issue_date))
      ? normalizeText(invoice.issue_date)
      : todayYmd
    const existingInvoiceNo = normalizeText(invoice.invoice_no)
    const assignedNewNumber = existingInvoiceNo.length === 0
    const invoiceNo = assignedNewNumber ? buildInvoiceNo(issueDate, nextSeq) : existingInvoiceNo
    if (assignedNewNumber) nextSeq += 1

    const issuedAt = normalizeText(invoice.issued_at) || nowIso
    const needsUpdate =
      invoice.status !== "issued" ||
      normalizeText(invoice.invoice_no) !== invoiceNo ||
      normalizeText(invoice.issue_date) !== issueDate ||
      normalizeText(invoice.issued_at) !== issuedAt

    updates.push({
      invoiceId: invoice.id,
      invoiceNo,
      issueDate,
      issuedAt,
      needsUpdate,
      assignedNewNumber,
    })
  }

  return { updates, nextSeq }
}

export async function issueInvoices(params: {
  admin: SupabaseClient
  orgId: string
  invoiceIds: string[]
  nowIso?: string
}) {
  const nowIso = params.nowIso ?? new Date().toISOString()
  const uniqueInvoiceIds = Array.from(
    new Set(params.invoiceIds.map((invoiceId) => invoiceId.trim()).filter(Boolean))
  )
  if (uniqueInvoiceIds.length === 0) {
    return { updatedCount: 0, assignedCount: 0, updates: [] as PlannedInvoiceIssue[] }
  }

  const { data: invoiceRows, error: invoiceError } = await params.admin
    .from("invoices")
    .select("id, request_id, status, invoice_no, issue_date, issued_at")
    .eq("org_id", params.orgId)
    .in("id", uniqueInvoiceIds)

  if (invoiceError) {
    throw new Error(invoiceError.message)
  }

  const invoicesById = new Map(
    ((invoiceRows ?? []) as InvoiceIssueCandidate[]).map((invoice) => [invoice.id, invoice])
  )
  const orderedInvoices = uniqueInvoiceIds
    .map((invoiceId) => invoicesById.get(invoiceId))
    .filter((invoice): invoice is InvoiceIssueCandidate => Boolean(invoice))

  if (orderedInvoices.length === 0) {
    throw new Error("Invoices not found")
  }

  const { data: settings, error: settingsError } = await params.admin
    .from("org_settings")
    .select("invoice_seq")
    .eq("org_id", params.orgId)
    .maybeSingle()

  if (settingsError) {
    throw new Error(settingsError.message)
  }

  const initialSeq = Number((settings as { invoice_seq?: number } | null)?.invoice_seq ?? 1)
  const planned = planInvoiceIssue({
    invoices: orderedInvoices,
    initialSeq,
    nowIso,
  })

  let updatedCount = 0
  for (const update of planned.updates) {
    if (!update.needsUpdate) continue
    const { error: updateError } = await params.admin
      .from("invoices")
      .update({
        status: "issued",
        invoice_no: update.invoiceNo,
        issue_date: update.issueDate,
        issued_at: update.issuedAt,
        updated_at: nowIso,
      })
      .eq("org_id", params.orgId)
      .eq("id", update.invoiceId)

    if (updateError) {
      throw new Error(updateError.message)
    }
    updatedCount += 1
  }

  for (const update of planned.updates) {
    const requestId = invoicesById.get(update.invoiceId)?.request_id?.trim()
    if (!requestId) continue
    const { error: requestUpdateError } = await params.admin
      .from("invoice_requests")
      .update({
        status: "issued",
        issued_invoice_id: update.invoiceId,
        updated_at: nowIso,
      })
      .eq("org_id", params.orgId)
      .eq("id", requestId)

    if (requestUpdateError) {
      throw new Error(requestUpdateError.message)
    }
  }

  if (planned.nextSeq !== initialSeq) {
    const { error: saveSeqError } = await params.admin
      .from("org_settings")
      .upsert({ org_id: params.orgId, invoice_seq: planned.nextSeq }, { onConflict: "org_id" })
    if (saveSeqError) {
      throw new Error(saveSeqError.message)
    }
  }

  return {
    updatedCount,
    assignedCount: planned.updates.filter((update) => update.assignedNewNumber).length,
    updates: planned.updates,
  }
}
