import { NextRequest, NextResponse } from "next/server"
import { EXTERNAL_CHAT_COPY } from "@/lib/ai/externalCopy"
import { writeExternalAiAuditLog } from "@/lib/ai/externalAudit"
import { verifyLineSignature } from "@/lib/ai/channelAdapters"
import { answerExternalAiQuestion } from "@/lib/ai/externalGateway"
import { confirmExternalChannelLink, getLinkedActorContext } from "@/lib/ai/externalIdentity"
import { buildLineQuickReplyItems } from "@/lib/ai/externalUi"
import { createSupabaseAdmin } from "@/lib/supabaseAdmin"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

type LineWebhookPayload = {
  events?: Array<{
    type?: string
    replyToken?: string
    source?: { userId?: string }
    message?: { type?: string; text?: string }
  }>
}

async function replyToLine(replyToken: string, message: string, quickReplyTexts: readonly string[] = []) {
  const accessToken = process.env.LINE_CHANNEL_ACCESS_TOKEN
  if (!accessToken) return

  const quickReplyItems = buildLineQuickReplyItems(quickReplyTexts)
  await fetch("https://api.line.me/v2/bot/message/reply", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({
      replyToken,
      messages: [
        {
          type: "text",
          text: message,
          ...(quickReplyItems.length > 0 ? { quickReply: { items: quickReplyItems } } : {}),
        },
      ],
    }),
  }).catch(() => null)
}

function linkedSuccessMessage() {
  return [
    EXTERNAL_CHAT_COPY.line.linkedTitle,
    EXTERNAL_CHAT_COPY.line.linkedBody,
    "例:",
    ...EXTERNAL_CHAT_COPY.line.linkedExamples.map((item) => `・${item}`),
  ].join("\n")
}

function unlinkedMessage() {
  return [EXTERNAL_CHAT_COPY.line.unlinkedTitle, EXTERNAL_CHAT_COPY.line.unlinkedBody].join("\n")
}

export async function POST(req: NextRequest) {
  const raw = await req.text()
  const valid = verifyLineSignature(raw, req.headers.get("x-line-signature"), process.env.LINE_CHANNEL_SECRET)
  if (!valid) return NextResponse.json({ ok: false, error: "Invalid signature" }, { status: 401 })

  const payload = JSON.parse(raw) as LineWebhookPayload
  const events = Array.isArray(payload.events) ? payload.events : []
  const admin = createSupabaseAdmin()

  for (const event of events) {
    if (event.type !== "message" || event.message?.type !== "text" || !event.replyToken) continue

    const externalUserId = String(event.source?.userId ?? "")
    const text = String(event.message?.text ?? "").trim()
    if (!externalUserId || !text) continue

    if (text.toLowerCase().startsWith("link ")) {
      const code = text.slice(5).trim()
      const result = await confirmExternalChannelLink({
        channelType: "line",
        linkCode: code,
        externalUserId,
      })
      await replyToLine(
        event.replyToken,
        result.ok ? linkedSuccessMessage() : unlinkedMessage(),
        result.ok ? EXTERNAL_CHAT_COPY.line.linkedExamples : []
      )
      continue
    }

    const actor = await getLinkedActorContext({ channelType: "line", externalUserId })
    if (!actor) {
      await writeExternalAiAuditLog({
        channelType: "line",
        externalUserId,
        actor: null,
        userMessage: text,
        selectedTools: [],
        toolResultSummary: {},
        aiResponse: unlinkedMessage(),
        status: "unlinked",
      })
      await replyToLine(event.replyToken, unlinkedMessage())
      continue
    }

    const { data: channelSettings } = await admin
      .from("ai_channel_settings")
      .select("line_enabled")
      .eq("org_id", actor.orgId)
      .maybeSingle()

    if ((channelSettings as { line_enabled?: boolean } | null)?.line_enabled !== true) {
      await writeExternalAiAuditLog({
        channelType: "line",
        externalUserId,
        actor,
        userMessage: text,
        selectedTools: [],
        toolResultSummary: {},
        aiResponse: EXTERNAL_CHAT_COPY.common.temporaryError,
        status: "error",
        errorMessage: "LINE AI channel disabled",
      })
      await replyToLine(
        event.replyToken,
        `${EXTERNAL_CHAT_COPY.common.temporaryError}\n${EXTERNAL_CHAT_COPY.common.temporaryErrorFollow}`
      )
      continue
    }

    let result = null
    try {
      result = await answerExternalAiQuestion({ actor, channelType: "line", message: text })
    } catch (error) {
      await writeExternalAiAuditLog({
        channelType: "line",
        externalUserId,
        actor,
        userMessage: text,
        selectedTools: [],
        toolResultSummary: {},
        aiResponse: null,
        status: "error",
        errorMessage: error instanceof Error ? error.message : "Unknown LINE AI error",
      })
    }

    await replyToLine(
      event.replyToken,
      result?.response ?? `${EXTERNAL_CHAT_COPY.common.temporaryError}\n${EXTERNAL_CHAT_COPY.common.temporaryErrorFollow}`,
      result?.followups ?? []
    )
  }

  return NextResponse.json({ ok: true })
}
