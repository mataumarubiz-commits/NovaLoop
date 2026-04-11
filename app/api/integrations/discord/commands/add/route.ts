import { NextRequest, NextResponse } from "next/server"
import crypto from "node:crypto"
import { getDiscordAppBaseUrl, runDiscordAddCommand } from "@/lib/discord/service"
import { hasDiscordInternalAccess } from "@/lib/discord/settingsAuth"
import { createSupabaseAdmin } from "@/lib/supabaseAdmin"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

function numberInput(value: unknown) {
  if (value == null || value === "") return null
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

export async function POST(req: NextRequest) {
  if (!hasDiscordInternalAccess(req)) return NextResponse.json({ ok: false, message: "Forbidden" }, { status: 403 })
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null
  const result = await runDiscordAddCommand({
    admin: createSupabaseAdmin(),
    orgId: typeof body?.org_id === "string" ? body.org_id : null,
    interactionId: String(body?.interaction_id ?? crypto.randomUUID()),
    discordUserId: String(body?.discord_user_id ?? ""),
    discordGuildId: String(body?.discord_guild_id ?? ""),
    discordChannelId: String(body?.discord_channel_id ?? ""),
    appBaseUrl: getDiscordAppBaseUrl(req.nextUrl.origin),
    clientName: String(body?.client_name ?? ""),
    projectName: String(body?.project_name ?? ""),
    title: String(body?.title ?? ""),
    dueClientAt: String(body?.due_client_at ?? ""),
    dueEditorAt: typeof body?.due_editor_at === "string" ? body.due_editor_at : null,
    unitPrice: numberInput(body?.unit_price),
    note: typeof body?.note === "string" ? body.note : null,
  })
  return NextResponse.json(result.responsePayload ?? { ok: result.ok, content: result.content }, { status: result.ok ? 200 : 400 })
}
