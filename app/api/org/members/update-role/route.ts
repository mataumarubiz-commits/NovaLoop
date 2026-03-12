import { NextRequest, NextResponse } from "next/server"
import { createSupabaseAdmin } from "@/lib/supabaseAdmin"
import { getOrgRole, getUserIdFromToken, isOrgAdmin } from "@/lib/apiAuth"
import { writeAuditLog } from "@/lib/auditLog"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const ALLOWED_ROLES = ["owner", "executive_assistant", "member"] as const

export async function POST(req: NextRequest) {
  try {
    const userId = await getUserIdFromToken(req)
    if (!userId) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 })

    const body = await req.json().catch(() => ({}))
    const orgId = typeof body?.orgId === "string" ? body.orgId.trim() : null
    const targetUserId = typeof body?.userId === "string" ? body.userId.trim() : null
    const nextRole =
      typeof body?.role === "string" && (ALLOWED_ROLES as readonly string[]).includes(body.role)
        ? body.role
        : null

    if (!orgId || !targetUserId || !nextRole) {
      return NextResponse.json({ ok: false, error: "orgId, userId, role is required" }, { status: 400 })
    }

    const admin = createSupabaseAdmin()
    const callerRole = await getOrgRole(admin, userId, orgId)
    if (!isOrgAdmin(callerRole)) {
      return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 })
    }

    const { data: currentRow } = await admin
      .from("app_users")
      .select("role")
      .eq("user_id", targetUserId)
      .eq("org_id", orgId)
      .maybeSingle()

    const currentRole = (currentRow as { role?: string } | null)?.role ?? null
    if (!currentRole) {
      return NextResponse.json({ ok: false, error: "Member not found" }, { status: 404 })
    }
    if (currentRole === "owner") {
      return NextResponse.json({ ok: false, error: "Owner role cannot be changed" }, { status: 400 })
    }

    const { error } = await admin
      .from("app_users")
      .update({ role: nextRole })
      .eq("user_id", targetUserId)
      .eq("org_id", orgId)

    if (error) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
    }

    await writeAuditLog(admin, {
      org_id: orgId,
      user_id: userId,
      action: "role.update",
      resource_type: "member",
      resource_id: targetUserId,
      meta: {
        previous_role: currentRole,
        next_role: nextRole,
      },
    })

    return NextResponse.json({ ok: true })
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Server error" },
      { status: 500 }
    )
  }
}
