import { NextRequest, NextResponse } from "next/server"
import { checkDiscordHealth } from "@/lib/discord/service"
import { requireDiscordSettingsAdmin } from "@/lib/discord/settingsAuth"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(req: NextRequest) {
  const auth = await requireDiscordSettingsAdmin(req)
  if (auth instanceof NextResponse) return auth

  const orgId = req.nextUrl.searchParams.get("org_id")?.trim() || auth.orgId
  if (orgId !== auth.orgId) return NextResponse.json({ ok: false, message: "Forbidden" }, { status: 403 })

  try {
    const result = await checkDiscordHealth({ admin: auth.admin, orgId })
    return NextResponse.json({ ok: true, ...result })
  } catch (error) {
    return NextResponse.json(
      { ok: false, message: error instanceof Error ? error.message : "Discord health check failed" },
      { status: 500 }
    )
  }
}
