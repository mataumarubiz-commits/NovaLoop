import { NextRequest, NextResponse } from "next/server"
import { getUserIdFromToken } from "@/lib/apiAuth"
import { listExternalChannelLinks, revokeExternalChannelLink } from "@/lib/ai/externalIdentity"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(req: NextRequest) {
  const userId = await getUserIdFromToken(req)
  if (!userId) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 })

  try {
    const links = await listExternalChannelLinks(userId)
    return NextResponse.json({ ok: true, links })
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Server error" }, { status: 400 })
  }
}

export async function DELETE(req: NextRequest) {
  const userId = await getUserIdFromToken(req)
  if (!userId) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 })

  const body = (await req.json().catch(() => ({}))) as { channelType?: string }
  const channelType = body.channelType === "discord" || body.channelType === "line" ? body.channelType : null
  if (!channelType) return NextResponse.json({ ok: false, error: "channelType is required" }, { status: 400 })

  try {
    await revokeExternalChannelLink({ channelType, userId })
    return NextResponse.json({ ok: true })
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Server error" }, { status: 400 })
  }
}
