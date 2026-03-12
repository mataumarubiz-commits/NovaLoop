import { NextRequest, NextResponse } from "next/server"
import { requireAdminContext } from "@/lib/adminApi"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(req: NextRequest) {
  const auth = await requireAdminContext(req)
  if ("error" in auth) return auth.error
  const { admin, orgId } = auth

  const limit = Math.min(100, Math.max(10, Number(req.nextUrl.searchParams.get("limit") ?? 50)))
  const action = req.nextUrl.searchParams.get("action")?.trim() || null

  let query = admin
    .from("audit_logs")
    .select("id, user_id, action, resource_type, resource_id, meta, created_at")
    .eq("org_id", orgId)
    .order("created_at", { ascending: false })
    .limit(limit)

  if (action) {
    query = query.eq("action", action)
  }

  const { data, error } = await query
  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true, logs: data ?? [] })
}
