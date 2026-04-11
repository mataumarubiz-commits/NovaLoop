import { NextRequest, NextResponse } from "next/server"
import { requireFinanceContext } from "@/lib/financeApi"
import { writeAuditLog } from "@/lib/auditLog"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}))
    const auth = await requireFinanceContext(req, typeof body?.orgId === "string" ? body.orgId : null)
    if (!auth.ok) return auth.response
    const expenseId = typeof body?.expenseId === "string" ? body.expenseId.trim() : typeof body?.expense_id === "string" ? body.expense_id.trim() : ""
    if (!expenseId) return NextResponse.json({ ok: false, error: "expenseId is required" }, { status: 400 })

    const requestedToType = typeof body?.requestedToType === "string" ? body.requestedToType : typeof body?.receipt_requested_to_type === "string" ? body.receipt_requested_to_type : "internal"
    const now = new Date().toISOString()
    const { data, error } = await auth.admin
      .from("expenses")
      .update({
        receipt_collection_status: "requested",
        receipt_requested_at: now,
        receipt_requested_to_type: requestedToType,
        receipt_requested_to_id: typeof body?.requestedToId === "string" ? body.requestedToId : typeof body?.receipt_requested_to_id === "string" ? body.receipt_requested_to_id : null,
        receipt_followup_memo: typeof body?.memo === "string" ? body.memo : null,
      })
      .eq("org_id", auth.orgId)
      .eq("id", expenseId)
      .select("*")
      .maybeSingle()
    if (error) throw new Error(error.message)

    await writeAuditLog(auth.admin, {
      org_id: auth.orgId,
      user_id: auth.userId,
      action: "expense.receipt_request",
      resource_type: "expense",
      resource_id: expenseId,
      meta: { requested_to_type: requestedToType },
    })
    return NextResponse.json({ ok: true, expense: data })
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "failed to request receipt" },
      { status: 500 }
    )
  }
}
