import { NextRequest, NextResponse } from "next/server"
import { requireFinanceContext } from "@/lib/financeApi"
import { assertTargetMonth, generateClosingChecks } from "@/lib/monthCloseAutomation"
import { writeAuditLog } from "@/lib/auditLog"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}))
    const auth = await requireFinanceContext(req, typeof body?.orgId === "string" ? body.orgId : null)
    if (!auth.ok) return auth.response
    const targetMonth = assertTargetMonth(body?.targetMonth ?? body?.target_month)
    const summary = await generateClosingChecks({
      admin: auth.admin,
      orgId: auth.orgId,
      targetMonth,
      userId: auth.userId,
    })
    await writeAuditLog(auth.admin, {
      org_id: auth.orgId,
      user_id: auth.userId,
      action: "close.checks.run",
      resource_type: "close",
      resource_id: null,
      meta: { target_month: targetMonth, open_count: summary.openCount, high_count: summary.highCount },
    })
    return NextResponse.json({ ok: true, ...summary })
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "failed to run close checks" },
      { status: 500 }
    )
  }
}
