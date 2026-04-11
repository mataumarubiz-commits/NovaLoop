import { NextRequest, NextResponse } from "next/server"
import { requireFinanceContext } from "@/lib/financeApi"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(req: NextRequest) {
  try {
    const auth = await requireFinanceContext(req, req.nextUrl.searchParams.get("orgId"))
    if (!auth.ok) return auth.response
    const entityType = req.nextUrl.searchParams.get("entityType") ?? req.nextUrl.searchParams.get("entity_type")
    const entityId = req.nextUrl.searchParams.get("entityId") ?? req.nextUrl.searchParams.get("entity_id")
    const targetMonth = req.nextUrl.searchParams.get("targetMonth") ?? req.nextUrl.searchParams.get("target_month")

    let query = auth.admin
      .from("freee_sync_logs")
      .select("*")
      .eq("org_id", auth.orgId)
      .order("created_at", { ascending: false })
      .limit(100)
    if (entityType) query = query.eq("entity_type", entityType)
    if (entityId) query = query.eq("entity_id", entityId)
    if (targetMonth) query = query.eq("target_month", targetMonth)

    const [{ data: connection }, { data: logs, error }] = await Promise.all([
      auth.admin
        .from("org_freee_connections")
        .select("status, company_id, expires_at, last_error, updated_at")
        .eq("org_id", auth.orgId)
        .maybeSingle(),
      query,
    ])
    if (error) throw new Error(error.message)

    return NextResponse.json({
      ok: true,
      connection: connection ?? { status: "missing" },
      logs: logs ?? [],
    })
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "failed to load freee sync status" },
      { status: 500 }
    )
  }
}
