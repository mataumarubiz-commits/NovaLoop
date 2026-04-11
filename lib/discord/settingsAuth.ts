import { NextRequest, NextResponse } from "next/server"
import { createSupabaseAdmin } from "@/lib/supabaseAdmin"
import { getOrgRole, getUserIdFromToken, isOrgAdmin } from "@/lib/apiAuth"

export async function requireDiscordSettingsAdmin(req: NextRequest) {
  const userId = await getUserIdFromToken(req)
  if (!userId) return NextResponse.json({ ok: false, message: "Unauthorized" }, { status: 401 })

  const admin = createSupabaseAdmin()
  const { data: profile } = await admin
    .from("user_profiles")
    .select("active_org_id")
    .eq("user_id", userId)
    .maybeSingle()

  const orgId = (profile as { active_org_id?: string | null } | null)?.active_org_id ?? null
  if (!orgId) return NextResponse.json({ ok: false, message: "Active organization is required" }, { status: 400 })

  const role = await getOrgRole(admin, userId, orgId)
  if (!isOrgAdmin(role)) {
    return NextResponse.json({ ok: false, message: "Forbidden" }, { status: 403 })
  }

  return { admin, userId, orgId, role }
}

export function hasDiscordInternalAccess(req: NextRequest) {
  const secret = process.env.DISCORD_INTERNAL_API_SECRET || process.env.DIGEST_CRON_SECRET || process.env.CRON_SECRET
  if (!secret) return false
  if (req.headers.get("authorization") === `Bearer ${secret}`) return true
  return req.headers.get("x-discord-internal-secret") === secret
}
