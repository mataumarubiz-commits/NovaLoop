import { NextRequest, NextResponse } from "next/server"
import { requireFinanceContext } from "@/lib/financeApi"
import { assertTargetMonth } from "@/lib/monthCloseAutomation"
import { retryFreeeSync } from "@/lib/freeeIntegration"
import { writeAuditLog } from "@/lib/auditLog"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}))
    const auth = await requireFinanceContext(req, typeof body?.orgId === "string" ? body.orgId : null)
    if (!auth.ok) return auth.response
    const targetMonth = assertTargetMonth(body?.targetMonth ?? body?.target_month)
    const logIds = Array.isArray(body?.logIds) ? body.logIds.filter((value: unknown): value is string => typeof value === "string" && value.length > 0) : undefined
    const result = await retryFreeeSync({ admin: auth.admin, orgId: auth.orgId, targetMonth, logIds })
    await writeAuditLog(auth.admin, {
      org_id: auth.orgId,
      user_id: auth.userId,
      action: "freee.sync.retry",
      resource_type: "freee_sync_log",
      resource_id: null,
      meta: { target_month: targetMonth, retried: result.retried },
    })
    return NextResponse.json(result)
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "failed to retry freee sync" },
      { status: 500 }
    )
  }
}
