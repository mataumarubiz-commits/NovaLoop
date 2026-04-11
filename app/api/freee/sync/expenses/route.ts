import { NextRequest, NextResponse } from "next/server"
import { requireFinanceContext } from "@/lib/financeApi"
import { assertTargetMonth } from "@/lib/monthCloseAutomation"
import { syncFreeeEntities } from "@/lib/freeeIntegration"
import { writeAuditLog } from "@/lib/auditLog"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}))
    const auth = await requireFinanceContext(req, typeof body?.orgId === "string" ? body.orgId : null)
    if (!auth.ok) return auth.response
    const targetMonth = assertTargetMonth(body?.targetMonth ?? body?.target_month)
    const ids = Array.isArray(body?.ids) ? body.ids.filter((value: unknown): value is string => typeof value === "string" && value.length > 0) : undefined
    const result = await syncFreeeEntities({ admin: auth.admin, orgId: auth.orgId, targetMonth, entityType: "expense", ids })
    await writeAuditLog(auth.admin, {
      org_id: auth.orgId,
      user_id: auth.userId,
      action: "freee.sync",
      resource_type: "expense",
      resource_id: null,
      meta: { target_month: targetMonth, queued: result.queued, synced: result.synced, failed: result.failed },
    })
    return NextResponse.json(result)
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "failed to sync freee expenses" },
      { status: 500 }
    )
  }
}
