import { NextRequest, NextResponse } from "next/server"
import { requireFinanceContext } from "@/lib/financeApi"
import { retryFailedTransferBatch } from "@/lib/transferAutomation"
import { writeAuditLog } from "@/lib/auditLog"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}))
    const auth = await requireFinanceContext(req, typeof body?.orgId === "string" ? body.orgId : null)
    if (!auth.ok) return auth.response
    const batchId = typeof body?.batchId === "string" ? body.batchId.trim() : ""
    if (!batchId) return NextResponse.json({ ok: false, error: "batchId is required" }, { status: 400 })

    const result = await retryFailedTransferBatch({
      admin: auth.admin,
      orgId: auth.orgId,
      batchId,
      userId: auth.userId,
    })
    await writeAuditLog(auth.admin, {
      org_id: auth.orgId,
      user_id: auth.userId,
      action: "payout.batch.execute_stage2",
      resource_type: "transfer_batch",
      resource_id: batchId,
      meta: { retry_failed: true, status: result.status },
    })
    return NextResponse.json(result, { status: result.ok ? 200 : 409 })
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "failed to retry transfers" },
      { status: 500 }
    )
  }
}
