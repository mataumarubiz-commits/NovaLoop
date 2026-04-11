import { NextRequest, NextResponse } from "next/server"
import { requireDiscordSettingsAdmin } from "@/lib/discord/settingsAuth"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

function textInput(value: unknown) {
  return typeof value === "string" ? value.trim() : ""
}

function boolInput(value: unknown, fallback: boolean) {
  return typeof value === "boolean" ? value : fallback
}

export async function GET(req: NextRequest) {
  const auth = await requireDiscordSettingsAdmin(req)
  if (auth instanceof NextResponse) return auth

  const [{ data: connection }, { data: rules }, { data: deliveries }, { data: commands }] = await Promise.all([
    auth.admin.from("org_discord_connections").select("*").eq("org_id", auth.orgId).maybeSingle(),
    auth.admin.from("discord_notification_rules").select("*").eq("org_id", auth.orgId).order("event_type", { ascending: true }),
    auth.admin.from("discord_delivery_logs").select("*").eq("org_id", auth.orgId).order("created_at", { ascending: false }).limit(10),
    auth.admin.from("discord_command_logs").select("*").eq("org_id", auth.orgId).order("created_at", { ascending: false }).limit(10),
  ])

  return NextResponse.json({
    ok: true,
    connection: connection ?? null,
    rules: rules ?? [],
    deliveries: deliveries ?? [],
    commands: commands ?? [],
    installUrl: buildInstallUrl(auth.orgId, auth.userId),
  })
}

export async function PATCH(req: NextRequest) {
  const auth = await requireDiscordSettingsAdmin(req)
  if (auth instanceof NextResponse) return auth

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
  const existingRes = await auth.admin.from("org_discord_connections").select("*").eq("org_id", auth.orgId).maybeSingle()
  const existing = (existingRes.data as Record<string, unknown> | null) ?? {}

  const guildId = textInput(body.guild_id ?? body.guildId)
  const channelId = textInput(body.channel_id ?? body.channelId)
  if (!guildId || !channelId) {
    return NextResponse.json({ ok: false, message: "guild_id and channel_id are required" }, { status: 400 })
  }

  const payload = {
    org_id: auth.orgId,
    guild_id: guildId,
    guild_name: textInput(body.guild_name ?? body.guildName),
    channel_id: channelId,
    channel_name: textInput(body.channel_name ?? body.channelName),
    installed_by_user_id: String(existing.installed_by_user_id ?? auth.userId),
    commands_enabled: boolInput(body.commands_enabled ?? body.commandsEnabled, Boolean(existing.commands_enabled ?? true)),
    immediate_notifications_enabled: boolInput(
      body.immediate_notifications_enabled ?? body.immediateNotificationsEnabled,
      Boolean(existing.immediate_notifications_enabled ?? true)
    ),
    morning_summary_enabled: boolInput(body.morning_summary_enabled ?? body.morningSummaryEnabled, Boolean(existing.morning_summary_enabled ?? true)),
    evening_summary_enabled: boolInput(body.evening_summary_enabled ?? body.eveningSummaryEnabled, Boolean(existing.evening_summary_enabled ?? true)),
    incident_notifications_enabled: boolInput(
      body.incident_notifications_enabled ?? body.incidentNotificationsEnabled,
      Boolean(existing.incident_notifications_enabled ?? true)
    ),
    status: "active",
    last_error: null,
    updated_at: new Date().toISOString(),
  }

  const { error } = await auth.admin.from("org_discord_connections").upsert(payload, { onConflict: "org_id" })
  if (error) return NextResponse.json({ ok: false, message: error.message }, { status: 500 })

  const rules = Array.isArray(body.rules) ? body.rules : []
  for (const rule of rules) {
    if (!rule || typeof rule !== "object") continue
    const item = rule as Record<string, unknown>
    const eventType = textInput(item.event_type ?? item.eventType)
    if (!eventType) continue
    await auth.admin.from("discord_notification_rules").upsert(
      {
        org_id: auth.orgId,
        event_type: eventType,
        enabled: boolInput(item.enabled, true),
        delivery_mode: ["immediate", "summary", "both"].includes(textInput(item.delivery_mode ?? item.deliveryMode))
          ? textInput(item.delivery_mode ?? item.deliveryMode)
          : "both",
        updated_at: new Date().toISOString(),
      },
      { onConflict: "org_id,event_type" }
    )
  }

  return NextResponse.json({ ok: true })
}

export async function DELETE(req: NextRequest) {
  const auth = await requireDiscordSettingsAdmin(req)
  if (auth instanceof NextResponse) return auth

  const { error } = await auth.admin
    .from("org_discord_connections")
    .update({ status: "revoked", updated_at: new Date().toISOString() })
    .eq("org_id", auth.orgId)

  if (error) return NextResponse.json({ ok: false, message: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}

function buildInstallUrl(orgId: string, userId: string) {
  const appId = process.env.DISCORD_APP_ID?.trim()
  const redirectUri = process.env.DISCORD_REDIRECT_URI?.trim()
  if (!appId || !redirectUri) return null
  const state = Buffer.from(
    JSON.stringify({
      org_id: orgId,
      installed_by_user_id: userId,
      expires_at: Date.now() + 15 * 60 * 1000,
    }),
    "utf8"
  ).toString("base64url")
  const url = new URL("https://discord.com/oauth2/authorize")
  url.searchParams.set("client_id", appId)
  url.searchParams.set("scope", "bot applications.commands")
  url.searchParams.set("permissions", "2147485696")
  url.searchParams.set("redirect_uri", redirectUri)
  url.searchParams.set("response_type", "code")
  url.searchParams.set("state", state)
  return url.toString()
}
