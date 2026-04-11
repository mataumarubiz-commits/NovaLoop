import { NextRequest, NextResponse } from "next/server"
import { requireFinanceContext } from "@/lib/financeApi"
import { buildTransferReverseGuide } from "@/lib/transferAutomation"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(req: NextRequest) {
  try {
    const auth = await requireFinanceContext(req, req.nextUrl.searchParams.get("orgId"))
    if (!auth.ok) return auth.response
    const batchId = req.nextUrl.searchParams.get("batchId")?.trim()
    if (!batchId) return NextResponse.json({ ok: false, error: "batchId is required" }, { status: 400 })

    const result = await buildTransferReverseGuide({ admin: auth.admin, orgId: auth.orgId, batchId })
    return NextResponse.json(result)
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "failed to build reverse guide" },
      { status: 500 }
    )
  }
}
