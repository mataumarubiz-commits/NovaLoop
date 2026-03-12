import { NextRequest, NextResponse } from "next/server"
import { getUserIdFromToken } from "@/lib/apiAuth"
import { EXTERNAL_CHAT_COPY } from "@/lib/ai/externalCopy"
import { writeExternalAiAuditLog } from "@/lib/ai/externalAudit"
import { answerExternalAiQuestion } from "@/lib/ai/externalGateway"
import { getLinkedActorContext, resolveLinkedUserScope } from "@/lib/ai/externalIdentity"
import type { ExternalActorContext } from "@/lib/ai/externalTypes"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

async function getInternalActor(req: NextRequest): Promise<ExternalActorContext | null> {
  const userId = await getUserIdFromToken(req)
  if (!userId) return null
  const scope = await resolveLinkedUserScope(userId)
  if (!scope) return null
  return {
    channelType: "internal",
    externalUserId: null,
    linkedUserId: scope.linkedUserId,
    orgId: scope.orgId,
    role: scope.role,
    vendorId: scope.vendorId,
    activeOrgName: scope.orgName,
    linkedDisplayName: null,
  }
}

function isAllowedExternal(req: NextRequest) {
  const shared = process.env.EXTERNAL_AI_SHARED_SECRET
  if (!shared) return false
  return req.headers.get("x-external-ai-secret") === shared
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as {
    channelType?: string
    externalUserId?: string
    message?: string
  }
  const message = typeof body.message === "string" ? body.message.trim() : ""
  if (!message) return NextResponse.json({ ok: false, error: "message is required" }, { status: 400 })

  let actor: ExternalActorContext | null = null
  let channelType: "discord" | "line" | "internal" = "internal"
  let externalUserId: string | null = null

  if (body.channelType === "discord" || body.channelType === "line") {
    if (!isAllowedExternal(req)) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 })
    channelType = body.channelType
    externalUserId = typeof body.externalUserId === "string" ? body.externalUserId.trim() : null
    if (!externalUserId) return NextResponse.json({ ok: false, error: "externalUserId is required" }, { status: 400 })
    actor = await getLinkedActorContext({ channelType, externalUserId })
  } else {
    actor = await getInternalActor(req)
  }

  if (!actor) {
    await writeExternalAiAuditLog({
      channelType,
      externalUserId,
      actor: null,
      userMessage: message,
      selectedTools: [],
      toolResultSummary: {},
      aiResponse: null,
      status: "unlinked",
    })
    return NextResponse.json(
      {
        ok: false,
        error: EXTERNAL_CHAT_COPY.common.unlinkedTitle,
        guidance: EXTERNAL_CHAT_COPY.common.unlinkedBody,
      },
      { status: 403 }
    )
  }

  try {
    const result = await answerExternalAiQuestion({ actor, channelType, message })
    return NextResponse.json({ ok: true, ...result })
  } catch (error) {
    await writeExternalAiAuditLog({
      channelType,
      externalUserId,
      actor,
      userMessage: message,
      selectedTools: [],
      toolResultSummary: {},
      aiResponse: null,
      status: "error",
      errorMessage: error instanceof Error ? error.message : "Server error",
    })
    return NextResponse.json(
      {
        ok: false,
        error: EXTERNAL_CHAT_COPY.common.temporaryError,
        guidance: EXTERNAL_CHAT_COPY.common.temporaryErrorFollow,
      },
      { status: 500 }
    )
  }
}
