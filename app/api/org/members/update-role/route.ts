import { NextRequest, NextResponse } from "next/server"
import { requireOrgPermission } from "@/lib/adminApi"
import { writeAuditLog } from "@/lib/auditLog"
import { resolveOrgRoleById, updateOrgMembershipRole } from "@/lib/orgRoles"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}))
    const orgId = typeof body?.orgId === "string" ? body.orgId.trim() : null
    const targetUserId = typeof body?.userId === "string" ? body.userId.trim() : null
    const nextRoleId = typeof body?.roleId === "string" ? body.roleId.trim() : null

    if (!orgId || !targetUserId || !nextRoleId) {
      return NextResponse.json({ ok: false, error: "orgId, userId, roleId is required" }, { status: 400 })
    }

    const auth = await requireOrgPermission(req, "members_manage", orgId)
    if (!auth.ok) return auth.response
    const { admin, userId } = auth

    const { data: currentRow } = await admin
      .from("app_users")
      .select("role, role_id")
      .eq("user_id", targetUserId)
      .eq("org_id", orgId)
      .maybeSingle()

    const currentMembership = (currentRow as { role?: string; role_id?: string | null } | null) ?? null
    const currentRole = currentMembership?.role ?? null
    if (!currentRole) {
      return NextResponse.json({ ok: false, error: "Member not found" }, { status: 404 })
    }
    if (currentRole === "owner") {
      return NextResponse.json({ ok: false, error: "Owner role cannot be changed" }, { status: 400 })
    }

    const resolvedRole = await resolveOrgRoleById(admin, orgId, nextRoleId)
    if (!resolvedRole) {
      return NextResponse.json({ ok: false, error: "Role not found" }, { status: 404 })
    }
    if (resolvedRole.key === "owner") {
      return NextResponse.json({ ok: false, error: "Owner role cannot be assigned here" }, { status: 400 })
    }

    const membershipUpdate = await updateOrgMembershipRole(admin, {
      userId: targetUserId,
      orgId,
      role: resolvedRole.appRole,
      roleId: resolvedRole.id,
    })

    if (membershipUpdate.error) {
      return NextResponse.json({ ok: false, error: membershipUpdate.error.message }, { status: 500 })
    }

    await writeAuditLog(admin, {
      org_id: orgId,
      user_id: userId,
      action: "role.update",
      resource_type: "member",
      resource_id: targetUserId,
      meta: {
        previous_role: currentRole,
        previous_role_id: currentMembership?.role_id ?? null,
        next_role: resolvedRole.appRole,
        next_role_id: resolvedRole.id,
        next_role_key: resolvedRole.key,
        next_role_name: resolvedRole.name,
        stored_role: membershipUpdate.storedRole,
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
