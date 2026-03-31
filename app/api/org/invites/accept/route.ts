import { NextRequest, NextResponse } from "next/server"
import { createSupabaseAdmin } from "@/lib/supabaseAdmin"
import { getUserIdFromToken } from "@/lib/apiAuth"
import { normalizeAppOrgRole, resolveOrgRoleById, resolveOrgRoleByKey, upsertOrgMembership } from "@/lib/orgRoles"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(req: NextRequest) {
  try {
    const userId = await getUserIdFromToken(req)
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const body = await req.json().catch(() => ({}))
    const token = typeof body?.token === "string" ? body.token.trim() : null
    const displayName = typeof body?.displayName === "string" ? body.displayName.trim() || null : null
    if (!token) return NextResponse.json({ error: "token is required" }, { status: 400 })

    const admin = createSupabaseAdmin()
    let inv: unknown = null
    let fetchErr: { code?: string; message?: string } | null = null
    const primary = await admin
      .from("org_invites")
      .select("id, org_id, email, role_key, role_id, status, expires_at")
      .eq("token", token)
      .maybeSingle()

    if (primary.error?.code === "42703") {
      const fallback = await admin
        .from("org_invites")
        .select("id, org_id, email, role_key, status, expires_at")
        .eq("token", token)
        .maybeSingle()
      inv = fallback.data
      fetchErr = fallback.error as { code?: string; message?: string } | null
    } else {
      inv = primary.data
      fetchErr = primary.error as { code?: string; message?: string } | null
    }

    if (fetchErr || !inv) {
      return NextResponse.json({ error: "招待が見つかりません" }, { status: 404 })
    }

    const row = inv as { id: string; status: string; expires_at: string; org_id: string; role_key: string; role_id?: string | null }
    if (row.status !== "pending") {
      return NextResponse.json({ error: "この招待はすでに使用済みか無効です" }, { status: 400 })
    }
    if (new Date(row.expires_at) < new Date()) {
      await admin.from("org_invites").update({ status: "expired" }).eq("id", row.id)
      return NextResponse.json({ error: "招待の有効期限が切れています" }, { status: 400 })
    }

    const orgId = row.org_id
    let resolvedRole = row.role_id ? await resolveOrgRoleById(admin, orgId, row.role_id) : null
    if (!resolvedRole) {
      resolvedRole = await resolveOrgRoleByKey(admin, orgId, row.role_key)
    }
    if (!resolvedRole) {
      const normalizedRole = normalizeAppOrgRole(row.role_key)
      resolvedRole = normalizedRole ? await resolveOrgRoleByKey(admin, orgId, normalizedRole) : null
    }
    if (!resolvedRole) {
      resolvedRole = await resolveOrgRoleByKey(admin, orgId, "member")
    }
    if (!resolvedRole || resolvedRole.key === "owner") {
      return NextResponse.json({ error: "Role not found" }, { status: 400 })
    }

    const membershipWrite = await upsertOrgMembership(admin, {
      userId,
      orgId,
      role: resolvedRole.appRole,
      roleId: resolvedRole.id,
      status: "active",
      displayName,
    })
    if (membershipWrite.error) {
      return NextResponse.json(
        { error: membershipWrite.error.message ?? "参加に失敗しました" },
        { status: 500 }
      )
    }

    await admin
      .from("user_profiles")
      .update({ active_org_id: orgId, updated_at: new Date().toISOString() })
      .eq("user_id", userId)

    await admin
      .from("org_invites")
      .update({ status: "accepted" })
      .eq("id", row.id)

    return NextResponse.json({ ok: true, orgId })
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Server error" },
      { status: 500 }
    )
  }
}
