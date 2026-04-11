import { NextRequest, NextResponse } from "next/server"
import { requireFinanceContext } from "@/lib/financeApi"
import { assertTargetMonth } from "@/lib/monthCloseAutomation"
import { createTransferBatch } from "@/lib/transferAutomation"
import { writeAuditLog } from "@/lib/auditLog"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}))
    const auth = await requireFinanceContext(req, typeof body?.orgId === "string" ? body.orgId : null)
    if (!auth.ok) return auth.response
    const targetMonth = assertTargetMonth(body?.targetMonth ?? body?.target_month)
    const vendorInvoiceIds = Array.isArray(body?.vendorInvoiceIds ?? body?.invoiceIds)
      ? (body.vendorInvoiceIds ?? body.invoiceIds).filter((value: unknown): value is string => typeof value === "string" && value.length > 0)
      : undefined
    const payoutIds = Array.isArray(body?.payoutIds)
      ? body.payoutIds.filter((value: unknown): value is string => typeof value === "string" && value.length > 0)
      : undefined
    const result = await createTransferBatch({
      admin: auth.admin,
      orgId: auth.orgId,
      targetMonth,
      userId: auth.userId,
      vendorInvoiceIds,
      payoutIds,
      provider: typeof body?.provider === "string" ? body.provider : "manual",
    })
    if (result.ok && "batchId" in result) {
      await writeAuditLog(auth.admin, {
        org_id: auth.orgId,
        user_id: auth.userId,
        action: "payout.batch.create",
        resource_type: "transfer_batch",
        resource_id: result.batchId,
        meta: { target_month: targetMonth, reused: result.reused ?? false },
      })
    }
    return NextResponse.json(result, { status: result.ok ? 200 : 409 })
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "failed to create payout batch" },
      { status: 500 }
    )
  }
}
