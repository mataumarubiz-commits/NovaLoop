import { NextRequest, NextResponse } from "next/server"
import { createSupabaseAdmin } from "@/lib/supabaseAdmin"
import { getUserIdFromToken, getOrgRole, isOrgAdmin } from "@/lib/apiAuth"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(req: NextRequest) {
  try {
    const userId = await getUserIdFromToken(req)
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    const orgId = req.nextUrl.searchParams.get("orgId")?.trim() ?? null
    if (!orgId) return NextResponse.json({ error: "orgId is required" }, { status: 400 })
    const admin = createSupabaseAdmin()
    const callerRole = await getOrgRole(admin, userId, orgId)
    if (!isOrgAdmin(callerRole)) return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    const { data, error } = await admin
      .from("join_requests")
      .select("id, requester_user_id, requester_email, message, requested_role, requested_display_name, created_at")
      .eq("org_id", orgId)
      .eq("status", "pending")
      .order("created_at", { ascending: false })
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    const rows = (data ?? []) as { id: string; requester_user_id: string; requester_email: string | null; message: string | null; requested_role: string | null; requested_display_name: string | null; created_at: string }[]
    const list = rows.map((r) => ({ id: r.id, requesterUserId: r.requester_user_id, requesterEmail: r.requester_email ?? undefined, message: r.message ?? undefined, requestedRole: r.requested_role ?? undefined, requestedDisplayName: r.requested_display_name ?? undefined, createdAt: r.created_at }))
    return NextResponse.json({ ok: true, requests: list })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Server error" }, { status: 500 })
  }
}
