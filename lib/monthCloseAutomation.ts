import type { SupabaseClient } from "@supabase/supabase-js"
import { isBillableWorkItemStatus } from "@/lib/workItems"

export type CloseCheckSeverity = "low" | "medium" | "high"
export type CloseCheckStatus = "open" | "ignored" | "resolved"

export type CloseCheckDraft = {
  check_type: string
  entity_type: string
  entity_id: string | null
  severity: CloseCheckSeverity
  title: string
  description: string
  dedupe_key: string
  payload?: Record<string, unknown>
}

export type CloseSummary = {
  targetMonth: string
  openCount: number
  highCount: number
  resolvedCount: number
  ignoredCount: number
  checks: Array<Record<string, unknown>>
}

const CLOSE_BILLABLE_STATUS_SET = new Set([
  "delivered",
  "published",
  "rejected",
  "approved",
  "completed",
  "billable",
  "launched",
])

function isValidMonth(value: string): boolean {
  return /^\d{4}-\d{2}$/.test(value)
}

export function assertTargetMonth(value: unknown): string {
  if (typeof value !== "string" || !isValidMonth(value)) {
    throw new Error("targetMonth must be YYYY-MM")
  }
  return value
}

export function currentTargetMonth(date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`
}

export function monthEndDate(targetMonth: string): string {
  const [year, month] = targetMonth.split("-").map(Number)
  return new Date(year, month, 0).toISOString().slice(0, 10)
}

export function nextMonthPaymentDate(targetMonth: string): string {
  const [year, month] = targetMonth.split("-").map(Number)
  const nextMonth = month === 12 ? 1 : month + 1
  const nextYear = month === 12 ? year + 1 : year
  return `${nextYear}-${String(nextMonth).padStart(2, "0")}-05`
}

function safeNumber(value: unknown): number {
  const num = Number(value ?? 0)
  return Number.isFinite(num) ? num : 0
}

function ymFromDate(value: unknown): string {
  return typeof value === "string" ? value.slice(0, 7) : ""
}

function isTargetBillableContent(row: Record<string, unknown>, targetMonth: string): boolean {
  const status = String(row.status ?? "")
  const billingModel = typeof row.billing_model === "string" ? row.billing_model : null
  const deliveryMonth = typeof row.delivery_month === "string" ? row.delivery_month : ""
  const dueMonth = ymFromDate(row.due_client_at)
  const month = isValidMonth(deliveryMonth) ? deliveryMonth : dueMonth
  const billable = Boolean(row.billable_flag)
  const statusEligible = CLOSE_BILLABLE_STATUS_SET.has(status) || isBillableWorkItemStatus(status, billingModel)
  return month === targetMonth && billable && statusEligible
}

function titleFromContent(row: Record<string, unknown>) {
  return [row.project_name, row.title].filter(Boolean).join(" / ") || String(row.id)
}

function check(
  check_type: string,
  entity_type: string,
  entity_id: string | null,
  severity: CloseCheckSeverity,
  title: string,
  description: string,
  payload?: Record<string, unknown>
): CloseCheckDraft {
  const entityPart = entity_id ?? payload?.dedupe_id ?? title
  return {
    check_type,
    entity_type,
    entity_id,
    severity,
    title,
    description,
    dedupe_key: `${check_type}:${entity_type}:${entityPart}`,
    payload,
  }
}

async function selectAll(
  admin: SupabaseClient,
  table: string,
  columns: string,
  orgId: string
): Promise<Array<Record<string, unknown>>> {
  const { data, error } = await admin.from(table).select(columns).eq("org_id", orgId)
  if (error) throw new Error(`${table}: ${error.message}`)
  return ((data ?? []) as unknown as Array<Record<string, unknown>>) || []
}

async function updateKnownColumns(
  admin: SupabaseClient,
  table: string,
  id: string,
  orgId: string,
  payload: Record<string, unknown>
) {
  const { error } = await admin.from(table).update(payload).eq("id", id).eq("org_id", orgId)
  if (!error) return

  const missingMatch = error.message.match(/column .*\.([a-zA-Z0-9_]+) does not exist/)
  if (!missingMatch) throw error

  const nextPayload = { ...payload }
  delete nextPayload[missingMatch[1]]
  if (Object.keys(nextPayload).length === 0) return

  const retry = await admin.from(table).update(nextPayload).eq("id", id).eq("org_id", orgId)
  if (retry.error) throw retry.error
}

export async function loadCloseSummary(params: {
  admin: SupabaseClient
  orgId: string
  targetMonth: string
}): Promise<CloseSummary> {
  const { admin, orgId, targetMonth } = params
  assertTargetMonth(targetMonth)
  const { data, error } = await admin
    .from("closing_checks")
    .select("*")
    .eq("org_id", orgId)
    .eq("target_month", targetMonth)
    .order("created_at", { ascending: false })

  if (error) throw new Error(error.message)
  const checks = ((data ?? []) as Array<Record<string, unknown>>) || []
  return {
    targetMonth,
    openCount: checks.filter((row) => row.status === "open").length,
    highCount: checks.filter((row) => row.status === "open" && row.severity === "high").length,
    resolvedCount: checks.filter((row) => row.status === "resolved").length,
    ignoredCount: checks.filter((row) => row.status === "ignored").length,
    checks,
  }
}

export async function generateClosingChecks(params: {
  admin: SupabaseClient
  orgId: string
  targetMonth: string
  userId: string
}) {
  const { admin, orgId, targetMonth, userId } = params
  assertTargetMonth(targetMonth)

  const [
    contents,
    invoices,
    invoiceLines,
    vendorInvoices,
    vendorInvoiceLines,
    payouts,
    expenses,
    projects,
    freeeLogs,
  ] = await Promise.all([
    selectAll(
      admin,
      "contents",
      "id, project_id, project_name, title, client_id, status, billable_flag, delivery_month, due_client_at, unit_price, invoice_id, billing_model, estimated_cost",
      orgId
    ),
    selectAll(admin, "invoices", "id, client_id, invoice_month, status, total, freee_sync_status", orgId),
    admin.from("invoice_lines").select("id, invoice_id, content_id, amount"),
    selectAll(admin, "vendor_invoices", "id, vendor_id, billing_month, target_month, status, total, total_amount, freee_sync_status", orgId),
    admin.from("vendor_invoice_lines").select("id, vendor_invoice_id, content_id, amount"),
    selectAll(admin, "payouts", "id, vendor_id, vendor_invoice_id, target_month, pay_date, amount, status, freee_sync_status", orgId),
    selectAll(
      admin,
      "expenses",
      "id, target_month, occurred_on, project_id, content_id, amount, category, description, receipt_path, status, receipt_collection_status, receipt_requested_to_type, freee_sync_status",
      orgId
    ),
    selectAll(admin, "projects", "id, name, client_id", orgId),
    selectAll(admin, "freee_sync_logs", "id, target_month, entity_type, entity_id, status, error_message", orgId).catch(() => []),
  ])

  if ("error" in invoiceLines && invoiceLines.error) throw new Error(invoiceLines.error.message)
  if ("error" in vendorInvoiceLines && vendorInvoiceLines.error) throw new Error(vendorInvoiceLines.error.message)

  const invoiceLineRows = ((invoiceLines.data ?? []) as Array<Record<string, unknown>>) || []
  const vendorInvoiceLineRows = ((vendorInvoiceLines.data ?? []) as Array<Record<string, unknown>>) || []
  const checks: CloseCheckDraft[] = []
  const targetContents = contents.filter((row) => isTargetBillableContent(row, targetMonth))
  const targetInvoices = invoices.filter((row) => row.invoice_month === targetMonth)
  const targetVendorInvoices = vendorInvoices.filter(
    (row) => row.target_month === targetMonth || row.billing_month === targetMonth
  )
  const targetExpenses = expenses.filter((row) => {
    const month = typeof row.target_month === "string" && isValidMonth(row.target_month) ? row.target_month : ymFromDate(row.occurred_on)
    return month === targetMonth
  })
  const targetPayouts = payouts.filter((row) => {
    const month = typeof row.target_month === "string" && isValidMonth(row.target_month) ? row.target_month : ymFromDate(row.pay_date)
    return month === targetMonth
  })

  for (const content of targetContents) {
    const contentId = String(content.id)
    if (!content.invoice_id) {
      checks.push(
        check(
          "unbilled_content",
          "content",
          contentId,
          "high",
          "請求漏れ候補",
          `${titleFromContent(content)} は対象月の請求条件を満たしていますが、invoice_id が未設定です。`,
          { content_id: contentId, unit_price: safeNumber(content.unit_price) }
        )
      )
    }
    if (safeNumber(content.unit_price) <= 0) {
      checks.push(
        check(
          "invoice_price_missing",
          "content",
          contentId,
          "high",
          "請求単価未設定",
          `${titleFromContent(content)} は請求対象ですが単価が 0 です。`,
          { content_id: contentId }
        )
      )
    }
  }

  for (const invoice of targetInvoices) {
    const status = String(invoice.status ?? "")
    if (status === "draft") {
      checks.push(
        check(
          "invoice_draft",
          "invoice",
          String(invoice.id),
          "medium",
          "請求書ドラフト未確定",
          "対象月の請求書が draft のままです。",
          { invoice_id: invoice.id }
        )
      )
    }
    if (invoice.freee_sync_status === "failed") {
      checks.push(
        check(
          "freee_sync_failed",
          "invoice",
          String(invoice.id),
          "high",
          "freee同期失敗",
          "請求書の freee 同期が failed です。",
          { entity_type: "invoice", invoice_id: invoice.id }
        )
      )
    }
  }

  for (const expense of targetExpenses) {
    const expenseId = String(expense.id)
    const hasReceipt = String(expense.receipt_path ?? "").trim().length > 0
    if (!hasReceipt) {
      checks.push(
        check(
          expense.receipt_requested_to_type === "vendor"
            ? "needs_receipt_chase_vendor"
            : expense.receipt_requested_to_type === "internal"
              ? "needs_receipt_chase_internal"
              : "needs_receipt_upload",
          "expense",
          expenseId,
          "high",
          "証憑未回収",
          `${String(expense.description ?? "経費")} の receipt_path が未登録です。`,
          {
            expense_id: expenseId,
            receipt_requested_to_type: expense.receipt_requested_to_type ?? null,
            receipt_collection_status: expense.receipt_collection_status ?? null,
          }
        )
      )
    }
    if (!expense.project_id && !expense.content_id) {
      checks.push(
        check(
          "needs_expense_linking",
          "expense",
          expenseId,
          "medium",
          "経費の案件紐付け未設定",
          `${String(expense.description ?? "経費")} が project/content に紐付いていません。`,
          { expense_id: expenseId }
        )
      )
    }
    if (expense.status === "draft") {
      checks.push(
        check(
          "expense_draft",
          "expense",
          expenseId,
          "medium",
          "経費が draft のままです",
          `${String(expense.description ?? "経費")} を linked / approved まで進めてください。`,
          { expense_id: expenseId }
        )
      )
    }
    if (expense.freee_sync_status === "failed") {
      checks.push(
        check(
          "freee_sync_failed",
          "expense",
          expenseId,
          "high",
          "freee同期失敗",
          "経費の freee 同期が failed です。",
          { entity_type: "expense", expense_id: expenseId }
        )
      )
    }
  }

  const linesByVendorInvoiceId = new Map<string, number>()
  for (const line of vendorInvoiceLineRows) {
    const invoiceId = String(line.vendor_invoice_id ?? "")
    if (!invoiceId) continue
    linesByVendorInvoiceId.set(invoiceId, (linesByVendorInvoiceId.get(invoiceId) ?? 0) + safeNumber(line.amount))
  }

  const payoutsByVendorInvoiceId = new Map<string, Array<Record<string, unknown>>>()
  for (const payout of targetPayouts) {
    const invoiceId = String(payout.vendor_invoice_id ?? "")
    if (!invoiceId) continue
    const list = payoutsByVendorInvoiceId.get(invoiceId) ?? []
    list.push(payout)
    payoutsByVendorInvoiceId.set(invoiceId, list)
  }

  for (const vendorInvoice of targetVendorInvoices) {
    const vendorInvoiceId = String(vendorInvoice.id)
    const status = String(vendorInvoice.status ?? "")
    const total = safeNumber(vendorInvoice.total_amount ?? vendorInvoice.total)
    const lineTotal = linesByVendorInvoiceId.get(vendorInvoiceId) ?? 0
    if (["draft", "submitted", "rejected"].includes(status)) {
      checks.push(
        check(
          "needs_vendor_review",
          "vendor_invoice",
          vendorInvoiceId,
          status === "rejected" ? "high" : "medium",
          "外注請求の確認待ち",
          "外注請求が承認前の状態です。",
          { vendor_invoice_id: vendorInvoiceId, status }
        )
      )
    }
    if (Math.round(total) !== Math.round(lineTotal)) {
      checks.push(
        check(
          "vendor_amount_diff",
          "vendor_invoice",
          vendorInvoiceId,
          "high",
          "外注請求の差分",
          `外注請求合計 ${total} と明細合計 ${lineTotal} が一致していません。`,
          { vendor_invoice_id: vendorInvoiceId, total, line_total: lineTotal }
        )
      )
    }
    if (status === "approved" && (payoutsByVendorInvoiceId.get(vendorInvoiceId) ?? []).length === 0) {
      checks.push(
        check(
          "payout_missing",
          "vendor_invoice",
          vendorInvoiceId,
          "high",
          "支払予定未生成",
          "承認済みの外注請求に payout がありません。",
          { vendor_invoice_id: vendorInvoiceId }
        )
      )
    }
    if (vendorInvoice.freee_sync_status === "failed") {
      checks.push(
        check(
          "freee_sync_failed",
          "vendor_invoice",
          vendorInvoiceId,
          "high",
          "freee同期失敗",
          "外注請求の freee 同期が failed です。",
          { entity_type: "vendor_invoice", vendor_invoice_id: vendorInvoiceId }
        )
      )
    }
  }

  for (const payout of targetPayouts) {
    const payoutId = String(payout.id)
    if (payout.status !== "paid" && String(payout.pay_date ?? "") <= monthEndDate(targetMonth)) {
      checks.push(
        check(
          "payout_not_paid",
          "payout",
          payoutId,
          "medium",
          "支払未完了",
          "支払予定日を過ぎた payout が paid になっていません。",
          { payout_id: payoutId, status: payout.status ?? null }
        )
      )
    }
    if (payout.freee_sync_status === "failed") {
      checks.push(
        check(
          "freee_sync_failed",
          "payout",
          payoutId,
          "high",
          "freee同期失敗",
          "支払の freee 同期が failed です。",
          { entity_type: "payout", payout_id: payoutId }
        )
      )
    }
  }

  const projectNames = new Map(projects.map((row) => [String(row.id), String(row.name ?? row.id)]))
  const invoiceAmountsByContentId = new Map<string, number>()
  const validInvoiceIds = new Set(targetInvoices.filter((row) => row.status !== "void").map((row) => String(row.id)))
  for (const line of invoiceLineRows) {
    if (!line.content_id || !validInvoiceIds.has(String(line.invoice_id))) continue
    invoiceAmountsByContentId.set(String(line.content_id), (invoiceAmountsByContentId.get(String(line.content_id)) ?? 0) + safeNumber(line.amount))
  }
  const vendorCostsByContentId = new Map<string, number>()
  const validVendorInvoiceIds = new Set(targetVendorInvoices.filter((row) => row.status !== "void").map((row) => String(row.id)))
  for (const line of vendorInvoiceLineRows) {
    if (!line.content_id || !validVendorInvoiceIds.has(String(line.vendor_invoice_id))) continue
    vendorCostsByContentId.set(String(line.content_id), (vendorCostsByContentId.get(String(line.content_id)) ?? 0) + safeNumber(line.amount))
  }
  const expensesByProjectId = new Map<string, number>()
  for (const expense of targetExpenses) {
    if (!expense.project_id) continue
    expensesByProjectId.set(String(expense.project_id), (expensesByProjectId.get(String(expense.project_id)) ?? 0) + safeNumber(expense.amount))
  }
  const contentsByProjectId = new Map<string, Array<Record<string, unknown>>>()
  for (const content of targetContents) {
    if (!content.project_id) continue
    const list = contentsByProjectId.get(String(content.project_id)) ?? []
    list.push(content)
    contentsByProjectId.set(String(content.project_id), list)
  }
  for (const [projectId, projectContents] of contentsByProjectId.entries()) {
    const sales = projectContents.reduce(
      (sum, content) => sum + (invoiceAmountsByContentId.get(String(content.id)) ?? safeNumber(content.unit_price)),
      0
    )
    if (sales <= 0) continue
    const vendorCost = projectContents.reduce(
      (sum, content) => sum + (vendorCostsByContentId.get(String(content.id)) ?? safeNumber(content.estimated_cost)),
      0
    )
    const expense = expensesByProjectId.get(projectId) ?? 0
    const gross = sales - vendorCost - expense
    const marginRate = gross / sales
    if (gross < 0 || marginRate < 0.35) {
      checks.push(
        check(
          "profitability_low",
          "project",
          projectId,
          gross < 0 ? "high" : "medium",
          "低粗利案件",
          `${projectNames.get(projectId) ?? projectId} の粗利率が ${Math.round(marginRate * 100)}% です。`,
          { project_id: projectId, sales, vendor_cost: vendorCost, expense, gross, margin_rate: marginRate }
        )
      )
    }
  }

  for (const log of freeeLogs) {
    if (log.target_month !== targetMonth || log.status !== "failed") continue
    checks.push(
      check(
        "freee_sync_failed",
        String(log.entity_type ?? "freee"),
        String(log.entity_id ?? ""),
        "high",
        "freee同期失敗",
        String(log.error_message ?? "freee同期ログが failed です。"),
        { freee_sync_log_id: log.id, entity_type: log.entity_type }
      )
    )
  }

  const { data: existingRows, error: existingError } = await admin
    .from("closing_checks")
    .select("id, dedupe_key, status, payload")
    .eq("org_id", orgId)
    .eq("target_month", targetMonth)

  if (existingError) throw new Error(existingError.message)

  const existing = ((existingRows ?? []) as Array<Record<string, unknown>>) || []
  const ignoredKeys = new Set(existing.filter((row) => row.status === "ignored").map((row) => String(row.dedupe_key)))
  const activeChecks = checks.filter((row) => !ignoredKeys.has(row.dedupe_key))
  const nextKeys = new Set(activeChecks.map((row) => row.dedupe_key))
  const staleOpenIds = existing
    .filter((row) => row.status === "open" && !nextKeys.has(String(row.dedupe_key)))
    .map((row) => String(row.id))

  if (activeChecks.length > 0) {
    const now = new Date().toISOString()
    const rows = activeChecks.map((row) => ({
      org_id: orgId,
      target_month: targetMonth,
      check_type: row.check_type,
      entity_type: row.entity_type,
      entity_id: row.entity_id,
      severity: row.severity,
      status: "open",
      title: row.title,
      description: row.description,
      dedupe_key: row.dedupe_key,
      payload: { source: "month_close_auto", ...(row.payload ?? {}) },
      updated_at: now,
    }))

    const { error: upsertError } = await admin
      .from("closing_checks")
      .upsert(rows, { onConflict: "org_id,target_month,dedupe_key" })
    if (upsertError) throw new Error(upsertError.message)
  }

  if (staleOpenIds.length > 0) {
    const { error: staleError } = await admin
      .from("closing_checks")
      .update({ status: "resolved", resolved_by_user_id: userId, resolved_at: new Date().toISOString() })
      .in("id", staleOpenIds)
      .eq("org_id", orgId)
    if (staleError) throw new Error(staleError.message)
  }

  return loadCloseSummary({ admin, orgId, targetMonth })
}

export async function autoGenerateVendorPayouts(params: {
  admin: SupabaseClient
  orgId: string
  targetMonth: string
  userId: string
  dryRun?: boolean
}) {
  const { admin, orgId, targetMonth, dryRun = false } = params
  assertTargetMonth(targetMonth)

  const [{ data: contentRows, error: contentsError }, { data: assignmentRows, error: assignmentsError }] =
    await Promise.all([
      admin
        .from("contents")
        .select("id, org_id, project_id, project_name, title, status, billable_flag, delivery_month, due_client_at, invoice_id, unit_price, estimated_cost, payout_target_flag")
        .eq("org_id", orgId),
      admin
        .from("content_vendor_assignments")
        .select("id, org_id, content_id, vendor_id, role, pricing_type, unit_price, unit_price_override, quantity, override_amount, option_flags, payout_target_flag, status")
        .eq("org_id", orgId),
    ])

  if (contentsError) throw new Error(contentsError.message)
  if (assignmentsError) throw new Error(assignmentsError.message)

  const contents = (((contentRows ?? []) as Array<Record<string, unknown>>) || []).filter((row) =>
    isTargetBillableContent(row, targetMonth)
  )
  const contentById = new Map(contents.map((row) => [String(row.id), row]))
  const assignments = (((assignmentRows ?? []) as Array<Record<string, unknown>>) || []).filter((row) => {
    if (row.status && row.status !== "active") return false
    if (row.payout_target_flag === false) return false
    return contentById.has(String(row.content_id ?? ""))
  })

  const vendorDrafts = new Map<string, Array<Record<string, unknown>>>()
  const diffs: Array<Record<string, unknown>> = []
  const fixedMonthlyKeys = new Set<string>()

  for (const assignment of assignments) {
    const content = contentById.get(String(assignment.content_id))
    if (!content) continue
    const pricingType = String(assignment.pricing_type ?? "per_content")
    const fixedKey = `${assignment.vendor_id}:${assignment.role}:${pricingType}`
    if (pricingType === "fixed_monthly") {
      if (fixedMonthlyKeys.has(fixedKey)) {
        diffs.push({
          type: "fixed_monthly_duplicate",
          vendor_id: assignment.vendor_id,
          assignment_id: assignment.id,
          content_id: assignment.content_id,
        })
        continue
      }
      fixedMonthlyKeys.add(fixedKey)
    }

    const quantity = Math.max(1, safeNumber(assignment.quantity || 1))
    const unitPrice = safeNumber(assignment.unit_price ?? assignment.unit_price_override ?? content.estimated_cost ?? 0)
    const overrideAmount = assignment.override_amount == null ? null : safeNumber(assignment.override_amount)
    const amount = overrideAmount != null ? overrideAmount : unitPrice * quantity
    if (amount <= 0) {
      diffs.push({
        type: "price_missing",
        vendor_id: assignment.vendor_id,
        assignment_id: assignment.id,
        content_id: assignment.content_id,
      })
      continue
    }

    const vendorId = String(assignment.vendor_id)
    const lines = vendorDrafts.get(vendorId) ?? []
    lines.push({
      assignment_id: assignment.id,
      content_id: content.id,
      work_type: assignment.role ?? pricingType,
      description: `${String(content.project_name ?? "")} / ${String(content.title ?? "")}`.trim(),
      qty: Math.round(quantity),
      unit_price: unitPrice,
      amount,
      source_meta: {
        pricing_type: pricingType,
        override_amount: overrideAmount,
        target_month: targetMonth,
      },
    })
    vendorDrafts.set(vendorId, lines)
  }

  if (dryRun) {
    const totalAmount = [...vendorDrafts.values()].flat().reduce((sum, row) => sum + safeNumber(row.amount), 0)
    return {
      ok: true,
      dryRun: true,
      vendorInvoiceCount: vendorDrafts.size,
      payoutCount: 0,
      totalAmount,
      diffCount: diffs.length,
      diffs,
    }
  }

  const generatedVendorInvoiceIds: string[] = []
  const generatedPayoutIds: string[] = []
  const payDate = nextMonthPaymentDate(targetMonth)

  for (const [vendorId, lines] of vendorDrafts.entries()) {
    const total = lines.reduce((sum, row) => sum + safeNumber(row.amount), 0)
    const { data: existingInvoice } = await admin
      .from("vendor_invoices")
      .select("id, status")
      .eq("org_id", orgId)
      .eq("vendor_id", vendorId)
      .eq("billing_month", targetMonth)
      .neq("status", "void")
      .maybeSingle()

    let vendorInvoiceId = (existingInvoice as { id?: string } | null)?.id ?? null
    if (!vendorInvoiceId) {
      vendorInvoiceId = crypto.randomUUID()
      const { error: insertInvoiceError } = await admin.from("vendor_invoices").insert({
        id: vendorInvoiceId,
        org_id: orgId,
        vendor_id: vendorId,
        billing_month: targetMonth,
        target_month: targetMonth,
        status: "draft",
        source: "auto_draft",
        submit_deadline: `${targetMonth}-25`,
        pay_date: payDate,
        total,
        total_amount: total,
      })
      if (insertInvoiceError) throw new Error(insertInvoiceError.message)
      generatedVendorInvoiceIds.push(vendorInvoiceId)
    }

    const { data: existingLines, error: existingLinesError } = await admin
      .from("vendor_invoice_lines")
      .select("id, content_id, content_vendor_assignment_id")
      .eq("vendor_invoice_id", vendorInvoiceId)

    if (existingLinesError) throw new Error(existingLinesError.message)
    const existingKeys = new Set(
      ((existingLines ?? []) as Array<Record<string, unknown>>).map(
        (row) => `${row.content_id ?? ""}:${row.content_vendor_assignment_id ?? ""}`
      )
    )

    const newLines = lines
      .filter((row) => !existingKeys.has(`${row.content_id ?? ""}:${row.assignment_id ?? ""}`))
      .map((row) => ({
        id: crypto.randomUUID(),
        vendor_invoice_id: vendorInvoiceId,
        content_id: row.content_id,
        content_vendor_assignment_id: row.assignment_id,
        work_type: row.work_type,
        description: row.description,
        qty: row.qty,
        unit_price: row.unit_price,
        amount: row.amount,
        source_type: "content_auto",
        source_meta: row.source_meta,
      }))

    if (newLines.length > 0) {
      const { error: insertLinesError } = await admin.from("vendor_invoice_lines").insert(newLines)
      if (insertLinesError) throw new Error(insertLinesError.message)
    }

    const { data: allLines, error: allLinesError } = await admin
      .from("vendor_invoice_lines")
      .select("amount")
      .eq("vendor_invoice_id", vendorInvoiceId)
    if (allLinesError) throw new Error(allLinesError.message)
    const nextTotal = ((allLines ?? []) as Array<Record<string, unknown>>).reduce((sum, row) => sum + safeNumber(row.amount), 0)
    await updateKnownColumns(admin, "vendor_invoices", vendorInvoiceId, orgId, {
      total: nextTotal,
      total_amount: nextTotal,
      updated_at: new Date().toISOString(),
    })
  }

  const { data: approvedInvoices, error: approvedError } = await admin
    .from("vendor_invoices")
    .select("id, vendor_id, pay_date, total, total_amount")
    .eq("org_id", orgId)
    .eq("billing_month", targetMonth)
    .eq("status", "approved")

  if (approvedError) throw new Error(approvedError.message)

  for (const invoice of ((approvedInvoices ?? []) as Array<Record<string, unknown>>) || []) {
    const { data: existingPayout } = await admin
      .from("payouts")
      .select("id")
      .eq("org_id", orgId)
      .eq("vendor_invoice_id", invoice.id)
      .maybeSingle()
    if (existingPayout) continue
    const payoutId = crypto.randomUUID()
    const { error: payoutError } = await admin.from("payouts").insert({
      id: payoutId,
      org_id: orgId,
      vendor_id: invoice.vendor_id,
      vendor_invoice_id: invoice.id,
      target_month: targetMonth,
      pay_date: invoice.pay_date ?? payDate,
      amount: safeNumber(invoice.total_amount ?? invoice.total),
      status: "scheduled",
    })
    if (payoutError) throw new Error(payoutError.message)
    generatedPayoutIds.push(payoutId)
  }

  return {
    ok: true,
    dryRun: false,
    vendorInvoiceCount: generatedVendorInvoiceIds.length,
    payoutCount: generatedPayoutIds.length,
    diffCount: diffs.length,
    diffs,
    vendorInvoiceIds: generatedVendorInvoiceIds,
    payoutIds: generatedPayoutIds,
  }
}

export async function completeCloseRun(params: {
  admin: SupabaseClient
  orgId: string
  targetMonth: string
  userId: string
}) {
  const { admin, orgId, targetMonth, userId } = params
  assertTargetMonth(targetMonth)
  const summary = await loadCloseSummary({ admin, orgId, targetMonth })
  const blockingChecks = summary.checks.filter((row) => row.status === "open" && row.severity !== "low")
  const status = blockingChecks.length === 0 ? "completed" : "blocked"
  const now = new Date().toISOString()

  const { data: runRow, error } = await admin
    .from("close_runs")
    .insert({
      org_id: orgId,
      target_month: targetMonth,
      status,
      started_by_user_id: userId,
      completed_at: status === "completed" ? now : null,
      result_json: {
        open_count: summary.openCount,
        blocking_count: blockingChecks.length,
        high_count: summary.highCount,
      },
    })
    .select("id, status")
    .maybeSingle()

  if (error) throw new Error(error.message)

  return {
    ok: status === "completed",
    status,
    closeRunId: (runRow as { id?: string } | null)?.id ?? null,
    blockingCount: blockingChecks.length,
    openCount: summary.openCount,
    highCount: summary.highCount,
    blockingChecks,
  }
}
