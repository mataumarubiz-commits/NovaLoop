import { NextRequest, NextResponse } from "next/server"
import { confirmExternalChannelLink } from "@/lib/ai/externalIdentity"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

function isAllowed(req: NextRequest) {
  const shared = process.env.EXTERNAL_AI_SHARED_SECRET
  if (!shared) return false
  return req.headers.get("x-external-ai-secret") === shared
}

export async function POST(req: NextRequest) {
  if (!isAllowed(req)) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 })

  const body = (await req.json().catch(() => ({}))) as {
    channelType?: string
    linkCode?: string
    externalUserId?: string
    externalDisplayName?: string | null
  }
  const channelType = body.channelType === "discord" || body.channelType === "line" ? body.channelType : null
  if (!channelType || !body.linkCode || !body.externalUserId) {
    return NextResponse.json({ ok: false, error: "channelType, linkCode, externalUserId are required" }, { status: 400 })
  }

  try {
    const result = await confirmExternalChannelLink({
      channelType,
      linkCode: body.linkCode.trim(),
      externalUserId: body.externalUserId.trim(),
      externalDisplayName: body.externalDisplayName?.trim() ?? null,
    })
    return NextResponse.json(result)
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Server error" }, { status: 500 })
  }
}
