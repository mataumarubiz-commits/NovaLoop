import { NextRequest, NextResponse } from "next/server"
import { requireFinanceContext } from "@/lib/financeApi"
import { currentTargetMonth } from "@/lib/monthCloseAutomation"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

function safeNumber(value: unknown) {
  const num = Number(value ?? 0)
  return Number.isFinite(num) ? num : 0
}

function monthOf(row: Record<string, unknown>, ...keys: string[]) {
  for (const key of keys) {
    const value = row[key]
    if (typeof value === "string" && value.length >= 7) return value.slice(0, 7)
  }
  return ""
}

export async function GET(req: NextRequest) {
  try {
    const auth = await requireFinanceContext(req, req.nextUrl.searchParams.get("orgId"))
    if (!auth.ok) return auth.response
    const targetMonth = req.nextUrl.searchParams.get("targetMonth") ?? req.nextUrl.searchParams.get("target_month") ?? currentTargetMonth()
    const projectId = req.nextUrl.searchParams.get("projectId") ?? req.nextUrl.searchParams.get("project_id")

    const [
      { data: projectRows, error: projectError },
      { data: contentRows, error: contentError },
      { data: expenseRows, error: expenseError },
      { data: invoiceRows, error: invoiceError },
      { data: vendorInvoiceRows, error: vendorInvoiceError },
    ] = await Promise.all([
      auth.admin.from("projects").select("id, name, client_id").eq("org_id", auth.orgId),
      auth.admin.from("contents").select("*").eq("org_id", auth.orgId),
      auth.admin.from("expenses").select("*").eq("org_id", auth.orgId),
      auth.admin.from("invoices").select("id, invoice_month, status").eq("org_id", auth.orgId),
      auth.admin.from("vendor_invoices").select("id, billing_month, target_month, status").eq("org_id", auth.orgId),
    ])
    if (projectError) throw new Error(projectError.message)
    if (contentError) throw new Error(contentError.message)
    if (expenseError) throw new Error(expenseError.message)
    if (invoiceError) throw new Error(invoiceError.message)
    if (vendorInvoiceError) throw new Error(vendorInvoiceError.message)

    const projects = ((projectRows ?? []) as Array<Record<string, unknown>>).filter((row) => !projectId || row.id === projectId)
    const projectIds = new Set(projects.map((row) => String(row.id)))
    const contents = ((contentRows ?? []) as Array<Record<string, unknown>>).filter(
      (row) => projectIds.has(String(row.project_id ?? "")) && monthOf(row, "delivery_month", "due_client_at") === targetMonth
    )
    const contentById = new Map(contents.map((row) => [String(row.id), row]))
    const validInvoiceIds = new Set(
      ((invoiceRows ?? []) as Array<Record<string, unknown>>)
        .filter((row) => row.invoice_month === targetMonth && row.status !== "void")
        .map((row) => String(row.id))
    )
    const validVendorInvoiceIds = new Set(
      ((vendorInvoiceRows ?? []) as Array<Record<string, unknown>>)
        .filter((row) => (row.target_month === targetMonth || row.billing_month === targetMonth) && row.status !== "void")
        .map((row) => String(row.id))
    )

    const [{ data: invoiceLines }, { data: vendorInvoiceLines }] = await Promise.all([
      validInvoiceIds.size > 0
        ? auth.admin.from("invoice_lines").select("invoice_id, content_id, amount").in("invoice_id", [...validInvoiceIds])
        : Promise.resolve({ data: [] }),
      validVendorInvoiceIds.size > 0
        ? auth.admin.from("vendor_invoice_lines").select("vendor_invoice_id, content_id, amount").in("vendor_invoice_id", [...validVendorInvoiceIds])
        : Promise.resolve({ data: [] }),
    ])

    const salesByContent = new Map<string, number>()
    for (const line of ((invoiceLines ?? []) as Array<Record<string, unknown>>) || []) {
      const contentId = String(line.content_id ?? "")
      if (!contentById.has(contentId)) continue
      salesByContent.set(contentId, (salesByContent.get(contentId) ?? 0) + safeNumber(line.amount))
    }

    const vendorCostByContent = new Map<string, number>()
    for (const line of ((vendorInvoiceLines ?? []) as Array<Record<string, unknown>>) || []) {
      const contentId = String(line.content_id ?? "")
      if (!contentById.has(contentId)) continue
      vendorCostByContent.set(contentId, (vendorCostByContent.get(contentId) ?? 0) + safeNumber(line.amount))
    }

    const expenses = ((expenseRows ?? []) as Array<Record<string, unknown>>).filter(
      (row) => projectIds.has(String(row.project_id ?? "")) && monthOf(row, "target_month", "occurred_on", "expense_date") === targetMonth
    )
    const expenseByProject = new Map<string, number>()
    const expenseByContent = new Map<string, number>()
    for (const expense of expenses) {
      const amount = safeNumber(expense.amount)
      const projectKey = String(expense.project_id ?? "")
      const contentKey = String(expense.content_id ?? "")
      if (projectKey) expenseByProject.set(projectKey, (expenseByProject.get(projectKey) ?? 0) + amount)
      if (contentKey) expenseByContent.set(contentKey, (expenseByContent.get(contentKey) ?? 0) + amount)
    }

    const projectReports = projects.map((project) => {
      const projectContents = contents.filter((content) => content.project_id === project.id)
      const sales = projectContents.reduce((sum, content) => sum + (salesByContent.get(String(content.id)) ?? safeNumber(content.unit_price)), 0)
      const vendorCost = projectContents.reduce(
        (sum, content) => sum + (vendorCostByContent.get(String(content.id)) ?? safeNumber(content.estimated_cost)),
        0
      )
      const expense = expenseByProject.get(String(project.id)) ?? 0
      const grossProfit = sales - vendorCost - expense
      return {
        project_id: project.id,
        project_name: project.name,
        target_month: targetMonth,
        content_count: projectContents.length,
        sales,
        vendor_cost: vendorCost,
        expense,
        gross_profit: grossProfit,
        margin_rate: sales > 0 ? grossProfit / sales : null,
      }
    })

    const contentReports = contents.map((content) => {
      const sales = salesByContent.get(String(content.id)) ?? safeNumber(content.unit_price)
      const vendorCost = vendorCostByContent.get(String(content.id)) ?? safeNumber(content.estimated_cost)
      const expense = expenseByContent.get(String(content.id)) ?? 0
      const grossProfit = sales - vendorCost - expense
      return {
        content_id: content.id,
        project_id: content.project_id,
        title: content.title,
        sales,
        vendor_cost: vendorCost,
        expense,
        gross_profit: grossProfit,
        margin_rate: sales > 0 ? grossProfit / sales : null,
      }
    })

    const totals = projectReports.reduce(
      (acc, row) => {
        acc.sales += row.sales
        acc.vendor_cost += row.vendor_cost
        acc.expense += row.expense
        acc.gross_profit += row.gross_profit
        return acc
      },
      { sales: 0, vendor_cost: 0, expense: 0, gross_profit: 0 }
    )

    return NextResponse.json({
      ok: true,
      targetMonth,
      totals: {
        ...totals,
        margin_rate: totals.sales > 0 ? totals.gross_profit / totals.sales : null,
      },
      projects: projectReports,
      contents: contentReports,
      alerts: projectReports.filter((row) => row.gross_profit < 0 || (row.margin_rate ?? 1) < 0.35),
    })
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "failed to load profitability report" },
      { status: 500 }
    )
  }
}
