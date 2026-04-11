import { NextRequest, NextResponse } from "next/server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

type DiscordInstallState = {
  org_id?: string
  installed_by_user_id?: string
  expires_at?: number
}

function decodeState(value: string | null): DiscordInstallState | null {
  if (!value) return null
  try {
    return JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as DiscordInstallState
  } catch {
    return null
  }
}

export async function GET(req: NextRequest) {
  const state = decodeState(req.nextUrl.searchParams.get("state"))
  const code = req.nextUrl.searchParams.get("code")
  const guildId = req.nextUrl.searchParams.get("guild_id")
  const redirect = new URL("/settings/integrations/discord", req.nextUrl.origin)

  if (!state?.org_id || !state.installed_by_user_id || !state.expires_at || state.expires_at < Date.now()) {
    redirect.searchParams.set("status", "state_invalid")
    return NextResponse.redirect(redirect)
  }

  if (!code) {
    redirect.searchParams.set("status", "code_missing")
    return NextResponse.redirect(redirect)
  }

  redirect.searchParams.set("status", "installed")
  if (guildId) redirect.searchParams.set("guild_id", guildId)
  return NextResponse.redirect(redirect)
}
