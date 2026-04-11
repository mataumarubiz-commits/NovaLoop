import { NextRequest, NextResponse } from "next/server"
import { getDiscordAppBaseUrl, sendDiscordNotification } from "@/lib/discord/service"
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
  const eventType = typeof body?.event_type === "string" ? body.event_type.trim() : ""
  const dedupeKey = typeof body?.dedupe_key === "string" ? body.dedupe_key.trim() : ""
  const payload = body?.payload && typeof body.payload === "object" ? (body.payload as Record<string, unknown>) : {}
  if (!orgId || !eventType || !dedupeKey) {
    return NextResponse.json({ ok: false, message: "org_id, event_type, dedupe_key are required" }, { status: 400 })
  }

  try {
    const result = await sendDiscordNotification({
      admin: createSupabaseAdmin(),
      orgId,
      eventType,
      dedupeKey,
      payload,
      appBaseUrl: getDiscordAppBaseUrl(req.nextUrl.origin),
    })
    return NextResponse.json(result)
  } catch (error) {
    return NextResponse.json(
      { ok: false, message: error instanceof Error ? error.message : "Discord notification failed" },
      { status: 500 }
    )
  }
}
