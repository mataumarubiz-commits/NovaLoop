import { NextRequest, NextResponse } from "next/server"
import { getUserIdFromToken } from "@/lib/apiAuth"
import { startExternalChannelLink } from "@/lib/ai/externalIdentity"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(req: NextRequest) {
  const userId = await getUserIdFromToken(req)
  if (!userId) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 })

  const body = (await req.json().catch(() => ({}))) as { channelType?: string }
  const channelType = body.channelType === "discord" || body.channelType === "line" ? body.channelType : null
  if (!channelType) return NextResponse.json({ ok: false, error: "channelType is required" }, { status: 400 })

  try {
    const result = await startExternalChannelLink({ channelType, userId })
    return NextResponse.json({ ok: true, ...result })
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Server error" }, { status: 400 })
  }
}
