import { NextRequest, NextResponse } from "next/server"
import { requireFinanceContext } from "@/lib/financeApi"
import { assertTargetMonth } from "@/lib/monthCloseAutomation"
import { previewTransferBatch } from "@/lib/transferAutomation"

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
    const result = await previewTransferBatch({
      admin: auth.admin,
      orgId: auth.orgId,
      targetMonth,
      vendorInvoiceIds,
      payoutIds,
    })
    return NextResponse.json(result)
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "failed to preview payout batch" },
      { status: 500 }
    )
  }
}
