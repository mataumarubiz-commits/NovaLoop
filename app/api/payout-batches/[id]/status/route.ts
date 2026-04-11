import { NextRequest, NextResponse } from "next/server"
import { requireFinanceContext } from "@/lib/financeApi"
import { loadTransferBatchStatus } from "@/lib/transferAutomation"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const auth = await requireFinanceContext(req, req.nextUrl.searchParams.get("orgId"))
    if (!auth.ok) return auth.response

    const batchId = id?.trim()
    if (!batchId) return NextResponse.json({ ok: false, error: "batch id is required" }, { status: 400 })

    const result = await loadTransferBatchStatus({ admin: auth.admin, orgId: auth.orgId, batchId })
    return NextResponse.json(result)
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "failed to load payout batch" },
      { status: 500 }
    )
  }
}
