import { NextRequest, NextResponse } from "next/server"
import { requireDiscordSettingsAdmin } from "@/lib/discord/settingsAuth"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const COMMANDS = [
  {
    name: "info",
    description: "Search operational project/content information without exposing accounting fields.",
    options: [
      {
        name: "query",
        description: "Client, project, title, or keyword",
        type: 3,
        required: true,
      },
    ],
  },
  {
    name: "add",
    description: "Create a new project content row from the admin Discord channel.",
    options: [
      { name: "client", description: "Client name", type: 3, required: true },
      { name: "project", description: "Project name", type: 3, required: true },
      { name: "title", description: "Content title", type: 3, required: true },
      { name: "due_client_at", description: "Client due date YYYY-MM-DD", type: 3, required: true },
      { name: "due_editor_at", description: "Editor due date YYYY-MM-DD", type: 3, required: false },
      { name: "unit_price", description: "Internal unit price. Never echoed back to Discord.", type: 10, required: false },
      { name: "note", description: "Internal note", type: 3, required: false },
    ],
  },
  {
    name: "audit",
    description: "Search recent operation/audit history without exposing billing amounts.",
    options: [
      { name: "query", description: "Keyword", type: 3, required: true },
      { name: "limit", description: "Result limit", type: 4, required: false },
    ],
  },
]

export async function POST(req: NextRequest) {
  const auth = await requireDiscordSettingsAdmin(req)
  if (auth instanceof NextResponse) return auth

  const appId = process.env.DISCORD_APP_ID?.trim()
  const botToken = process.env.DISCORD_BOT_TOKEN?.trim()
  if (!appId || !botToken) {
    return NextResponse.json({ ok: false, message: "DISCORD_APP_ID and DISCORD_BOT_TOKEN are required" }, { status: 409 })
  }

  const { data: connection } = await auth.admin
    .from("org_discord_connections")
    .select("guild_id")
    .eq("org_id", auth.orgId)
    .maybeSingle()
  const guildId = (connection as { guild_id?: string } | null)?.guild_id
  if (!guildId) {
    return NextResponse.json({ ok: false, message: "Discord guild_id is not configured" }, { status: 409 })
  }

  const url = `https://discord.com/api/v10/applications/${encodeURIComponent(appId)}/guilds/${encodeURIComponent(guildId)}/commands`
  const res = await fetch(url, {
    method: "PUT",
    headers: {
      Authorization: `Bot ${botToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(COMMANDS),
  })
  const payload = (await res.json().catch(() => null)) as unknown
  const ok = res.ok

  await auth.admin
    .from("org_discord_connections")
    .update({
      last_healthcheck_at: new Date().toISOString(),
      last_error: ok ? null : JSON.stringify(payload),
      status: ok ? "active" : "error",
      updated_at: new Date().toISOString(),
    })
    .eq("org_id", auth.orgId)

  return NextResponse.json(
    {
      ok,
      status: res.status,
      registeredCount: Array.isArray(payload) ? payload.length : 0,
      response: payload,
    },
    { status: ok ? 200 : 502 }
  )
}
