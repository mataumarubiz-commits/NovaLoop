import { NextRequest, NextResponse } from "next/server"
import { requireFinanceContext } from "@/lib/financeApi"
import { assertTargetMonth, completeCloseRun, generateClosingChecks } from "@/lib/monthCloseAutomation"
import { writeAuditLog } from "@/lib/auditLog"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}))
    const auth = await requireFinanceContext(req, typeof body?.orgId === "string" ? body.orgId : null)
    if (!auth.ok) return auth.response
    const targetMonth = assertTargetMonth(body?.targetMonth ?? body?.target_month)
    await generateClosingChecks({ admin: auth.admin, orgId: auth.orgId, targetMonth, userId: auth.userId })
    const result = await completeCloseRun({
      admin: auth.admin,
      orgId: auth.orgId,
      targetMonth,
      userId: auth.userId,
    })
    await writeAuditLog(auth.admin, {
      org_id: auth.orgId,
      user_id: auth.userId,
      action: "close.complete",
      resource_type: "close",
      resource_id: result.closeRunId,
      meta: { target_month: targetMonth, status: result.status, blocking_count: result.blockingCount },
    })
    return NextResponse.json(result, { status: result.ok ? 200 : 409 })
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "failed to complete close" },
      { status: 500 }
    )
  }
}
