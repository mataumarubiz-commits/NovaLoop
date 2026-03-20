import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js"

export type AppOrgRole = "owner" | "executive_assistant" | "member"

const LEGACY_MEMBER_ROLES = new Set(["member", "pm", "director", "worker", "none"])
const LEGACY_MEMBER_FALLBACK_ROLE = "worker"

export function normalizeAppOrgRole(role: string | null | undefined): AppOrgRole | null {
  if (role === "owner" || role === "executive_assistant") return role
  if (role && LEGACY_MEMBER_ROLES.has(role)) return "member"
  return null
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
  }
) {
  return runRoleCompatibleWrite(input.role, async (storedRole) =>
    admin
      .from("app_users")
      .update({ role: storedRole })
      .eq("user_id", input.userId)
      .eq("org_id", input.orgId)
  )
}
