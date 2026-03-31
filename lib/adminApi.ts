import type { NextRequest } from "next/server"
import { NextResponse } from "next/server"
import { createSupabaseAdmin } from "@/lib/supabaseAdmin"
import { getOrgAccess, getOrgRole, getUserIdFromToken, isOrgAdmin } from "@/lib/apiAuth"
import { hasOrgPermission as permissionEnabled, type OrgPermissionKey } from "@/lib/orgRolePermissions"

export type AdminApiAuth =
  | {
      ok: true
      admin: ReturnType<typeof createSupabaseAdmin>
      userId: string
      orgId: string
      role: "owner" | "executive_assistant"
    }
  | {
      ok: false
      response: NextResponse
    }

export async function requireOrgAdmin(req: NextRequest, orgIdInput?: string | null): Promise<AdminApiAuth> {
  const userId = await getUserIdFromToken(req)
  if (!userId) {
    return { ok: false, response: NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 }) }
  }

  const orgId =
    typeof orgIdInput === "string" && orgIdInput.trim().length > 0 ? orgIdInput.trim() : null
  if (!orgId) {
    return { ok: false, response: NextResponse.json({ ok: false, error: "orgId is required" }, { status: 400 }) }
  }

  const admin = createSupabaseAdmin()
  const role = await getOrgRole(admin, userId, orgId)
  if (!isOrgAdmin(role)) {
    return { ok: false, response: NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 }) }
  }

  return { ok: true, admin, userId, orgId, role: role as "owner" | "executive_assistant" }
}

export async function requireAdminContext(req: NextRequest): Promise<
  | {
      admin: ReturnType<typeof createSupabaseAdmin>
      userId: string
      orgId: string
      role: "owner" | "executive_assistant"
    }
  | {
      error: NextResponse
    }
> {
  const userId = await getUserIdFromToken(req)
  if (!userId) {
    return { error: NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 }) }
  }

  const admin = createSupabaseAdmin()
  const { data: profile, error: profileError } = await admin
    .from("user_profiles")
    .select("active_org_id")
    .eq("user_id", userId)
    .maybeSingle()

  if (profileError) {
    return { error: NextResponse.json({ ok: false, error: profileError.message }, { status: 500 }) }
  }

  const orgId = (profile as { active_org_id?: string | null } | null)?.active_org_id ?? null
  if (!orgId) {
    return { error: NextResponse.json({ ok: false, error: "Active org not found" }, { status: 400 }) }
  }

  const role = await getOrgRole(admin, userId, orgId)
  if (!isOrgAdmin(role)) {
    return { error: NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 }) }
  }

  return { admin, userId, orgId, role: role as "owner" | "executive_assistant" }
}

export async function requireOrgPermission(
  req: NextRequest,
  permission: OrgPermissionKey,
  orgIdInput?: string | null
): Promise<
  | {
      ok: true
      admin: ReturnType<typeof createSupabaseAdmin>
      userId: string
      orgId: string
      role: string | null
    }
  | {
      ok: false
      response: NextResponse
    }
> {
  const userId = await getUserIdFromToken(req)
  if (!userId) {
    return { ok: false, response: NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 }) }
  }

  const admin = createSupabaseAdmin()
  const explicitOrgId =
    typeof orgIdInput === "string" && orgIdInput.trim().length > 0 ? orgIdInput.trim() : null
  let orgId = explicitOrgId
  if (!orgId) {
    const { data: profile, error: profileError } = await admin
      .from("user_profiles")
      .select("active_org_id")
      .eq("user_id", userId)
      .maybeSingle()

    if (profileError) {
      return { ok: false, response: NextResponse.json({ ok: false, error: profileError.message }, { status: 500 }) }
    }

    orgId = (profile as { active_org_id?: string | null } | null)?.active_org_id ?? null
  }
  if (!orgId) {
    return { ok: false, response: NextResponse.json({ ok: false, error: "orgId is required" }, { status: 400 }) }
  }

  const access = await getOrgAccess(admin, userId, orgId)
  const allowed =
    access.role === "owner" ||
    access.role === "executive_assistant" ||
    permissionEnabled(access.role, access.permissions, permission)

  if (!allowed) {
    return { ok: false, response: NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 }) }
  }

  return { ok: true, admin, userId, orgId, role: access.role }
}
