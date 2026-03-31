import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js"

export type AppOrgRole = "owner" | "executive_assistant" | "member"
export type ResolvedOrgRole = {
  id: string
  key: string
  name: string
  appRole: AppOrgRole
}

const LEGACY_MEMBER_ROLES = new Set(["member", "pm", "director", "worker", "none"])
const LEGACY_MEMBER_FALLBACK_ROLE = "worker"

export function normalizeAppOrgRole(role: string | null | undefined): AppOrgRole | null {
  if (role === "owner" || role === "executive_assistant") return role
  if (role && LEGACY_MEMBER_ROLES.has(role)) return "member"
  return null
}

export function appRoleFromOrgRoleKey(roleKey: string | null | undefined): AppOrgRole {
  return roleKey === "executive_assistant" ? "executive_assistant" : roleKey === "owner" ? "owner" : "member"
}

function isLegacyMemberRoleWriteError(error: PostgrestError | null) {
  if (!error) return false
  const message = [error.code, error.message, error.details, error.hint]
    .filter(Boolean)
    .join(" ")
    .toLowerCase()

  return (
    message.includes("app_users_role_check") ||
    (message.includes("check constraint") && message.includes("app_users") && message.includes("role")) ||
    (message.includes("role in") && message.includes("worker") && message.includes("director"))
  )
}

async function runRoleCompatibleWrite(
  requestedRole: AppOrgRole,
  writer: (storedRole: string) => Promise<{ error: PostgrestError | null }>
) {
  const primary = await writer(requestedRole)
  if (requestedRole !== "member" || !isLegacyMemberRoleWriteError(primary.error)) {
    return {
      error: primary.error,
      storedRole: requestedRole,
      normalizedRole: requestedRole,
    }
  }

  const fallback = await writer(LEGACY_MEMBER_FALLBACK_ROLE)
  return {
    error: fallback.error,
    storedRole: LEGACY_MEMBER_FALLBACK_ROLE,
    normalizedRole: "member" as const,
  }
}

export async function upsertOrgMembership(
  admin: SupabaseClient,
  input: {
    userId: string
    orgId: string
    role: AppOrgRole
    roleId?: string | null
    status: string
    displayName?: string | null
  }
) {
  return runRoleCompatibleWrite(input.role, async (storedRole) =>
    admin.from("app_users").upsert(
      {
        user_id: input.userId,
        org_id: input.orgId,
        role: storedRole,
        role_id: input.roleId ?? null,
        status: input.status,
        display_name: input.displayName ?? null,
      },
      { onConflict: "user_id,org_id" }
    )
  )
}

export async function updateOrgMembershipRole(
  admin: SupabaseClient,
  input: {
    userId: string
    orgId: string
    role: AppOrgRole
    roleId?: string | null
  }
) {
  return runRoleCompatibleWrite(input.role, async (storedRole) =>
    admin
      .from("app_users")
      .update({ role: storedRole, role_id: input.roleId ?? null })
      .eq("user_id", input.userId)
      .eq("org_id", input.orgId)
  )
}

export async function resolveOrgRoleById(
  admin: SupabaseClient,
  orgId: string,
  roleId: string
): Promise<ResolvedOrgRole | null> {
  const { data } = await admin
    .from("org_roles")
    .select("id, key, name")
    .eq("id", roleId)
    .eq("org_id", orgId)
    .maybeSingle()

  const row = (data as { id?: string; key?: string; name?: string } | null) ?? null
  if (!row?.id || !row.key) return null
  return {
    id: row.id,
    key: row.key,
    name: row.name ?? row.key,
    appRole: appRoleFromOrgRoleKey(row.key),
  }
}

export async function resolveOrgRoleByKey(
  admin: SupabaseClient,
  orgId: string,
  roleKey: string
): Promise<ResolvedOrgRole | null> {
  const { data } = await admin
    .from("org_roles")
    .select("id, key, name")
    .eq("org_id", orgId)
    .eq("key", roleKey)
    .maybeSingle()

  const row = (data as { id?: string; key?: string; name?: string } | null) ?? null
  if (!row?.id || !row.key) return null
  return {
    id: row.id,
    key: row.key,
    name: row.name ?? row.key,
    appRole: appRoleFromOrgRoleKey(row.key),
  }
}
