import { NextRequest, NextResponse } from "next/server"
import { requireFinanceContext } from "@/lib/financeApi"
import { writeAuditLog } from "@/lib/auditLog"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

function ym(value: unknown) {
  return typeof value === "string" ? value.slice(0, 7) : ""
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}))
    const auth = await requireFinanceContext(req, typeof body?.orgId === "string" ? body.orgId : null)
    if (!auth.ok) return auth.response
    const expenseId = typeof body?.expenseId === "string" ? body.expenseId.trim() : typeof body?.expense_id === "string" ? body.expense_id.trim() : ""
    if (!expenseId) return NextResponse.json({ ok: false, error: "expenseId is required" }, { status: 400 })

    const { data: expense, error } = await auth.admin
      .from("expenses")
      .select("*")
      .eq("org_id", auth.orgId)
      .eq("id", expenseId)
      .maybeSingle()
    if (error) throw new Error(error.message)
    if (!expense) return NextResponse.json({ ok: false, error: "expense not found" }, { status: 404 })

    const row = expense as Record<string, unknown>
    const targetMonth = String(row.target_month ?? ym(row.occurred_on))
    const { data: candidates } = await auth.admin
      .from("contents")
      .select("id, project_id, project_name, title, delivery_month, due_client_at")
      .eq("org_id", auth.orgId)
      .or(`delivery_month.eq.${targetMonth},due_client_at.gte.${targetMonth}-01`)
      .limit(20)

    const extracted = {
      parser: "heuristic",
      target_month: targetMonth,
      amount: Number(row.amount ?? 0),
      occurred_on: row.occurred_on ?? null,
      payee_name: row.payee_name ?? null,
      category: row.category ?? null,
      receipt_path: row.receipt_path ?? null,
      content_candidates: ((candidates ?? []) as Array<Record<string, unknown>>).slice(0, 8),
      notes: "External OCR is not called unless a provider adapter is configured.",
    }

    const { error: updateError } = await auth.admin
      .from("expenses")
      .update({
        extracted_json: extracted,
        status: row.status === "draft" ? "parsed" : row.status,
        target_month: targetMonth,
        receipt_collection_status: row.receipt_path ? "received" : "requested",
      })
      .eq("org_id", auth.orgId)
      .eq("id", expenseId)
    if (updateError) throw new Error(updateError.message)

    await writeAuditLog(auth.admin, {
      org_id: auth.orgId,
      user_id: auth.userId,
      action: "expense.parse",
      resource_type: "expense",
      resource_id: expenseId,
      meta: { target_month: targetMonth, parser: "heuristic" },
    })
    return NextResponse.json({ ok: true, extracted })
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "failed to parse expense" },
      { status: 500 }
    )
  }
}
