import { NextRequest } from "next/server"
import { createClient } from "@supabase/supabase-js"
import type { SupabaseClient } from "@supabase/supabase-js"
import { normalizeAppOrgRole, type AppOrgRole } from "@/lib/orgRoles"
import { buildOrgPermissions, type OrgPermissionKey, type OrgPermissions } from "@/lib/orgRolePermissions"

export async function getUserIdFromToken(req: NextRequest): Promise<string | null> {
  const authHeader = req.headers.get("Authorization")
  const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7).trim() : null
  if (!token) return null
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !anonKey) return null
  const supabase = createClient(url, anonKey)
  const { data } = await supabase.auth.getUser(token)
  return data?.user?.id ?? null
}

/**
 * Returns the caller's role in the given org, or null if not a member.
 */
export async function getOrgRole(
  admin: SupabaseClient,
  userId: string,
  orgId: string
): Promise<AppOrgRole | null> {
  const { data } = await admin
    .from("app_users")
    .select("role")
    .eq("user_id", userId)
    .eq("org_id", orgId)
    .maybeSingle()
  return normalizeAppOrgRole((data as { role?: string } | null)?.role)
}

export async function getOrgAccess(
  admin: SupabaseClient,
  userId: string,
  orgId: string
): Promise<{
  role: AppOrgRole | null
  roleId: string | null
  permissions: OrgPermissions
}> {
  const { data } = await admin
    .from("app_users")
    .select("role, role_id")
    .eq("user_id", userId)
    .eq("org_id", orgId)
    .maybeSingle()

  const membership = (data as { role?: string; role_id?: string | null } | null) ?? null
  const role = normalizeAppOrgRole(membership?.role)
  const roleId = membership?.role_id ?? null

  if (!roleId) {
    return {
      role,
      roleId,
      permissions: buildOrgPermissions(role, null),
    }
  }

  const { data: roleRow } = await admin
    .from("org_roles")
    .select("permissions")
    .eq("id", roleId)
    .eq("org_id", orgId)
    .maybeSingle()

  return {
    role,
    roleId,
    permissions: buildOrgPermissions(
      role,
      ((roleRow as { permissions?: Record<string, unknown> | null } | null)?.permissions ?? null) as
        | Record<string, unknown>
        | null
    ),
  }
}

export function isOrgAdmin(role: string | null): boolean {
  return role === "owner" || role === "executive_assistant"
}

export async function hasOrgPermission(
  admin: SupabaseClient,
  userId: string,
  orgId: string,
  permission: OrgPermissionKey
): Promise<boolean> {
  const access = await getOrgAccess(admin, userId, orgId)
  return access.role === "owner" || access.role === "executive_assistant" || access.permissions[permission] === true
}
