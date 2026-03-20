import { NextRequest } from "next/server"
import { createClient } from "@supabase/supabase-js"
import type { SupabaseClient } from "@supabase/supabase-js"
import { normalizeAppOrgRole, type AppOrgRole } from "@/lib/orgRoles"

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

export function isOrgAdmin(role: string | null): boolean {
  return role === "owner" || role === "executive_assistant"
}
