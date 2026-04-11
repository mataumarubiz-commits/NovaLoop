import { NextRequest, NextResponse } from "next/server"
import { requireFinanceContext } from "@/lib/financeApi"
import { assertTargetMonth, currentTargetMonth, loadCloseSummary } from "@/lib/monthCloseAutomation"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(req: NextRequest) {
  try {
    const orgId = req.nextUrl.searchParams.get("orgId")
    const targetMonth = assertTargetMonth(req.nextUrl.searchParams.get("targetMonth") ?? currentTargetMonth())
    const auth = await requireFinanceContext(req, orgId)
    if (!auth.ok) return auth.response
    const summary = await loadCloseSummary({ admin: auth.admin, orgId: auth.orgId, targetMonth })
    return NextResponse.json({ ok: true, ...summary })
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "failed to load close summary" },
      { status: 500 }
    )
  }
}
