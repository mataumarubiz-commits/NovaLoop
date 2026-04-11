import { NextRequest, NextResponse } from "next/server"
import crypto from "node:crypto"
import { getDiscordAppBaseUrl, runDiscordAuditCommand } from "@/lib/discord/service"
import { hasDiscordInternalAccess } from "@/lib/discord/settingsAuth"
import { createSupabaseAdmin } from "@/lib/supabaseAdmin"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(req: NextRequest) {
  if (!hasDiscordInternalAccess(req)) return NextResponse.json({ ok: false, message: "Forbidden" }, { status: 403 })
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null
  const result = await runDiscordAuditCommand({
    admin: createSupabaseAdmin(),
    orgId: typeof body?.org_id === "string" ? body.org_id : null,
    interactionId: String(body?.interaction_id ?? crypto.randomUUID()),
    discordUserId: String(body?.discord_user_id ?? ""),
    discordGuildId: String(body?.discord_guild_id ?? ""),
    discordChannelId: String(body?.discord_channel_id ?? ""),
    appBaseUrl: getDiscordAppBaseUrl(req.nextUrl.origin),
    query: typeof body?.query === "string" ? body.query : null,
    limit: typeof body?.limit === "number" ? body.limit : null,
  })
  return NextResponse.json(result.responsePayload ?? { ok: result.ok, content: result.content }, { status: result.ok ? 200 : 400 })
}
