import { NextRequest, NextResponse } from "next/server"
import { requireFinanceContext } from "@/lib/financeApi"
import { assertTargetMonth, autoGenerateVendorPayouts, generateClosingChecks } from "@/lib/monthCloseAutomation"
import { writeAuditLog } from "@/lib/auditLog"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}))
    const auth = await requireFinanceContext(req, typeof body?.orgId === "string" ? body.orgId : null)
    if (!auth.ok) return auth.response
    const targetMonth = assertTargetMonth(body?.targetMonth ?? body?.target_month)
    const result = await autoGenerateVendorPayouts({
      admin: auth.admin,
      orgId: auth.orgId,
      targetMonth,
      userId: auth.userId,
      dryRun: Boolean(body?.dryRun ?? body?.dry_run),
    })
    if (!result.dryRun) {
      await generateClosingChecks({ admin: auth.admin, orgId: auth.orgId, targetMonth, userId: auth.userId })
      await writeAuditLog(auth.admin, {
        org_id: auth.orgId,
        user_id: auth.userId,
        action: "payout.generate",
        resource_type: "payout",
        resource_id: null,
        meta: {
          target_month: targetMonth,
          vendor_invoice_count: result.vendorInvoiceCount,
          payout_count: result.payoutCount,
          diff_count: result.diffCount,
        },
      })
    }
    return NextResponse.json(result)
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "failed to auto-generate payouts" },
      { status: 500 }
    )
  }
}
