import { NextRequest, NextResponse } from "next/server"
import { createSupabaseAdmin } from "@/lib/supabaseAdmin"
import { getUserIdFromToken, getOrgRole } from "@/lib/apiAuth"

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
    if (!callerRole) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }

    const { data: rows, error } = await admin
      .from("app_users")
      .select("user_id, role, status, display_name, role_id")
      .eq("org_id", orgId)
      .order("role", { ascending: true })

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    const list = (rows ?? []) as { user_id: string; role: string; status: string; display_name: string | null; role_id: string | null }[]
    const userIds = list.map((r) => r.user_id)
    const emails = new Map<string, string>()
    for (const uid of userIds) {
      try {
        const { data: u } = await admin.auth.admin.getUserById(uid)
        if (u?.user?.email) emails.set(uid, u.user.email)
      } catch {
        // skip
      }
    }

    const members = list.map((r) => ({
      userId: r.user_id,
      displayName: r.display_name ?? undefined,
      email: emails.get(r.user_id) ?? undefined,
      role: r.role,
      status: r.status,
      roleId: r.role_id ?? undefined,
    }))

    return NextResponse.json({ ok: true, members })
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Server error" },
      { status: 500 }
    )
  }
}
