import { NextRequest, NextResponse } from "next/server"
import { createSupabaseAdmin } from "@/lib/supabaseAdmin"
import { getUserIdFromToken } from "@/lib/apiAuth"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

async function getMemberContext(req: NextRequest) {
  const userId = await getUserIdFromToken(req)
  if (!userId) return null

  const admin = createSupabaseAdmin()
  const { data: profile } = await admin
    .from("user_profiles")
    .select("active_org_id")
    .eq("user_id", userId)
    .maybeSingle()

  const orgId = (profile as { active_org_id?: string | null } | null)?.active_org_id ?? null
  if (!orgId) return null

  const { data: appUser } = await admin
    .from("app_users")
    .select("role")
    .eq("user_id", userId)
    .eq("org_id", orgId)
    .maybeSingle()

  const role = (appUser as { role?: string | null } | null)?.role ?? null
  if (!role) return null

  return { admin, userId, orgId, role }
}

export async function GET(req: NextRequest) {
  const auth = await getMemberContext(req)
  if (!auth) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 })

  const [{ data: settings }, { data: links }] = await Promise.all([
    auth.admin.from("ai_channel_settings").select("*").eq("org_id", auth.orgId).maybeSingle(),
    auth.admin
      .from("external_channel_links")
      .select("channel_type, external_user_id, external_display_name, role, status, link_code, code_expires_at, verified_at, last_used_at")
      .eq("org_id", auth.orgId)
      .eq("linked_user_id", auth.userId)
      .order("channel_type", { ascending: true }),
  ])

  return NextResponse.json({
    ok: true,
    role: auth.role,
    canManageSettings: auth.role === "owner" || auth.role === "executive_assistant",
    settings: settings ?? {
      org_id: auth.orgId,
      discord_enabled: false,
      line_enabled: false,
      discord_bot_label: "NovaLoop AI",
      line_bot_label: "NovaLoop AI",
      open_app_url: process.env.NEXT_PUBLIC_APP_URL ?? "",
    },
    links: links ?? [],
  })
}

export async function PATCH(req: NextRequest) {
  const auth = await getMemberContext(req)
  if (!auth) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 })
  if (auth.role !== "owner" && auth.role !== "executive_assistant") {
    return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 })
  }

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
  const payload = {
    org_id: auth.orgId,
    discord_enabled: body.discord_enabled === true,
    line_enabled: body.line_enabled === true,
    discord_bot_label: typeof body.discord_bot_label === "string" ? body.discord_bot_label.trim() : "NovaLoop AI",
    line_bot_label: typeof body.line_bot_label === "string" ? body.line_bot_label.trim() : "NovaLoop AI",
    open_app_url:
      typeof body.open_app_url === "string" && body.open_app_url.trim().length > 0
        ? body.open_app_url.trim()
        : process.env.NEXT_PUBLIC_APP_URL ?? null,
    updated_at: new Date().toISOString(),
  }

  const { error } = await auth.admin.from("ai_channel_settings").upsert(payload, { onConflict: "org_id" })
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })

  return NextResponse.json({ ok: true })
}
