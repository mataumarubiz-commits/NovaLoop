import { NextRequest, NextResponse } from "next/server"
import { requireOrgPermission } from "@/lib/adminApi"
import { resolveOrgRoleById, resolveOrgRoleByKey } from "@/lib/orgRoles"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

function randomToken(): string {
  return `${crypto.randomUUID()}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 14)}`
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}))
    const orgId = typeof body?.orgId === "string" ? body.orgId.trim() : null
    const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : null
    const roleId = typeof body?.roleId === "string" ? body.roleId.trim() : null
    const roleKey = typeof body?.roleKey === "string" ? body.roleKey.trim() : null
    if (!orgId || !email) {
      return NextResponse.json({ error: "orgId and email are required" }, { status: 400 })
    }

    const auth = await requireOrgPermission(req, "members_manage", orgId)
    if (!auth.ok) return auth.response
    const { admin, userId } = auth

    let resolvedRole = roleId ? await resolveOrgRoleById(admin, orgId, roleId) : null
    if (!resolvedRole && roleKey) {
      resolvedRole = await resolveOrgRoleByKey(admin, orgId, roleKey)
    }
    if (!resolvedRole) {
      resolvedRole = await resolveOrgRoleByKey(admin, orgId, "member")
    }
    if (!resolvedRole || resolvedRole.key === "owner") {
      return NextResponse.json({ error: "Role not found" }, { status: 400 })
    }

    const expiresAt = new Date()
    expiresAt.setDate(expiresAt.getDate() + 7)
    const token = randomToken()

    const insertPayload = {
      org_id: orgId,
      email,
      invited_by: userId,
      role_key: resolvedRole.key,
      role_id: resolvedRole.id,
      token,
      status: "pending",
      expires_at: expiresAt.toISOString(),
    }

    let invite: { id: string; token: string; expires_at: string } | null = null
    const primary = await admin
      .from("org_invites")
      .insert(insertPayload)
      .select("id, token, expires_at")
      .single()

    if (primary.error?.code === "42703") {
      const fallback = await admin
        .from("org_invites")
        .insert({ ...insertPayload, role_id: undefined })
        .select("id, token, expires_at")
        .single()
      if (fallback.error || !fallback.data) {
        return NextResponse.json(
          { error: fallback.error?.message ?? "Failed to create invite" },
          { status: 500 }
        )
      }
      invite = fallback.data as { id: string; token: string; expires_at: string }
    } else if (primary.error || !primary.data) {
      return NextResponse.json(
        { error: primary.error?.message ?? "Failed to create invite" },
        { status: 500 }
      )
    } else {
      invite = primary.data as { id: string; token: string; expires_at: string }
    }

    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || (req.nextUrl.origin || "")
    const inviteLink = `${baseUrl}/invite?token=${invite.token}`

    return NextResponse.json({
      ok: true,
      inviteId: invite.id,
      inviteLink,
      expiresAt: invite.expires_at,
    })
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Server error" },
      { status: 500 }
    )
  }
}
