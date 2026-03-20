import { NextRequest } from "next/server"
import { createClient } from "@supabase/supabase-js"
import { createSupabaseAdmin } from "@/lib/supabaseAdmin"
import { normalizeAppOrgRole } from "@/lib/orgRoles"

export type AiActor = {
  userId: string
  orgId: string
  role: string
}

export async function getAiActorFromRequest(req: NextRequest): Promise<AiActor | null> {
  const authHeader = req.headers.get("Authorization")
  const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7).trim() : null
  if (!token) return null

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !anonKey) return null

  const supabase = createClient(url, anonKey, { auth: { persistSession: false } })
  const {
    data: { user },
  } = await supabase.auth.getUser(token)
  if (!user) return null

  const admin = createSupabaseAdmin()
  const { data: profile } = await admin.from("user_profiles").select("active_org_id").eq("user_id", user.id).maybeSingle()
  const orgId = (profile as { active_org_id?: string | null } | null)?.active_org_id ?? null
  if (!orgId) return null

  const { data: appUser } = await admin.from("app_users").select("role").eq("user_id", user.id).eq("org_id", orgId).maybeSingle()
  const role = normalizeAppOrgRole((appUser as { role?: string } | null)?.role) ?? "member"

  return { userId: user.id, orgId, role }
}
