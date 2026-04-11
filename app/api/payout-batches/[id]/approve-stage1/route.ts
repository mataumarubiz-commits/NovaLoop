import { NextRequest, NextResponse } from "next/server"
import { requireFinanceContext } from "@/lib/financeApi"
import { approveTransferBatchStage1 } from "@/lib/transferAutomation"
import { writeAuditLog } from "@/lib/auditLog"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const body = await req.json().catch(() => ({}))
    const auth = await requireFinanceContext(req, typeof body?.orgId === "string" ? body.orgId : null)
    if (!auth.ok) return auth.response

    const batchId = id?.trim()
    if (!batchId) return NextResponse.json({ ok: false, error: "batch id is required" }, { status: 400 })

    const result = await approveTransferBatchStage1({
      admin: auth.admin,
      orgId: auth.orgId,
      batchId,
      userId: auth.userId,
    })
    await writeAuditLog(auth.admin, {
      org_id: auth.orgId,
      user_id: auth.userId,
      action: "payout.batch.approve_stage1",
      resource_type: "transfer_batch",
      resource_id: batchId,
      meta: { status: result.status },
    })
    return NextResponse.json(result)
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "failed to approve payout batch" },
      { status: 500 }
    )
  }
}
