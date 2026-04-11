import { NextRequest, NextResponse } from "next/server"
import { buildDiscordSummary, getDiscordAppBaseUrl } from "@/lib/discord/service"
import { hasDiscordInternalAccess } from "@/lib/discord/settingsAuth"
import { createSupabaseAdmin } from "@/lib/supabaseAdmin"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(req: NextRequest) {
  if (!hasDiscordInternalAccess(req)) {
    return NextResponse.json({ ok: false, message: "Forbidden" }, { status: 403 })
  }

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null
  const orgId = typeof body?.org_id === "string" ? body.org_id.trim() : ""
  const summaryType = body?.summary_type === "evening" ? "evening" : "morning"
  if (!orgId) return NextResponse.json({ ok: false, message: "org_id is required" }, { status: 400 })

  try {
    const result = await buildDiscordSummary({
      admin: createSupabaseAdmin(),
      orgId,
      summaryType,
      appBaseUrl: getDiscordAppBaseUrl(req.nextUrl.origin),
    })
    return NextResponse.json(result)
  } catch (error) {
    return NextResponse.json(
      { ok: false, message: error instanceof Error ? error.message : "Discord summary failed" },
      { status: 500 }
    )
  }
}
