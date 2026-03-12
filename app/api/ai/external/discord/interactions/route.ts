import { NextRequest, NextResponse } from "next/server"
import { verifyDiscordSignature } from "@/lib/ai/channelAdapters"
import { EXTERNAL_CHAT_COPY } from "@/lib/ai/externalCopy"
import { answerExternalAiQuestion } from "@/lib/ai/externalGateway"
import { confirmExternalChannelLink, getLinkedActorContext } from "@/lib/ai/externalIdentity"
import { createSupabaseAdmin } from "@/lib/supabaseAdmin"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

type DiscordOption = { name?: string; value?: string }

type DiscordInteractionPayload = {
  type?: number
  user?: { id?: string; username?: string }
  member?: { user?: { id?: string; username?: string } }
  data?: {
    options?: DiscordOption[]
    custom_id?: string
  }
}

function mapButtonPrompt(customId: string) {
  switch (customId) {
    case "nova_refresh:overall":
      return "今の全体状況どう？"
    case "nova_refresh:contents":
      return "今案件どうなってる？"
    case "nova_refresh:billing":
      return "今月の請求どうなってる？"
    case "nova_refresh:vendor_invoices":
      return "外注請求どうなってる？"
    case "nova_refresh:payouts":
      return "今月の支払い予定いくら？"
    case "nova_refresh:notifications":
      return "重要な通知まとめて"
    case "nova_refresh:manuals":
      return "請求の手順教えて"
    case "filter_approval":
      return "承認待ちだけ見せて"
    case "filter_returned":
      return "差し戻しだけ見せて"
    case "filter_delayed":
      return "遅延案件だけ見せて"
    case "filter_unsubmitted_vendor":
      return "未提出の外注請求だけ見せて"
    default:
      return null
  }
}

function buildButtons(params: {
  openUrl?: string | null
  detailUrl?: string | null
  howToUrl?: string | null
  manualUrl?: string | null
  refreshCategory?: string | null
  includeFilterButtons?: boolean
}) {
  const buttons: Array<Record<string, unknown>> = []

  if (params.openUrl) {
    buttons.push({ type: 2, style: 5, label: EXTERNAL_CHAT_COPY.discord.buttons.open, url: params.openUrl })
  }
  if (params.detailUrl) {
    buttons.push({ type: 2, style: 5, label: EXTERNAL_CHAT_COPY.discord.buttons.detail, url: params.detailUrl })
  }
  if (params.howToUrl) {
    buttons.push({ type: 2, style: 5, label: EXTERNAL_CHAT_COPY.discord.buttons.howTo, url: params.howToUrl })
  }
  if (params.manualUrl) {
    buttons.push({ type: 2, style: 5, label: EXTERNAL_CHAT_COPY.discord.buttons.manuals, url: params.manualUrl })
  }
  if (params.refreshCategory) {
    buttons.push({
      type: 2,
      style: 2,
      custom_id: `nova_refresh:${params.refreshCategory}`,
      label: EXTERNAL_CHAT_COPY.discord.buttons.refresh,
    })
  }

  if (params.includeFilterButtons) {
    buttons.push({ type: 2, style: 2, custom_id: "filter_approval", label: EXTERNAL_CHAT_COPY.discord.buttons.approvalOnly })
    buttons.push({ type: 2, style: 2, custom_id: "filter_returned", label: EXTERNAL_CHAT_COPY.discord.buttons.returnedOnly })
    buttons.push({ type: 2, style: 2, custom_id: "filter_delayed", label: EXTERNAL_CHAT_COPY.discord.buttons.delayedOnly })
    buttons.push({ type: 2, style: 2, custom_id: "filter_unsubmitted_vendor", label: EXTERNAL_CHAT_COPY.discord.buttons.unsubmittedVendorOnly })
  }

  const rows: Array<{ type: 1; components: Array<Record<string, unknown>> }> = []
  for (let index = 0; index < buttons.length; index += 3) {
    rows.push({ type: 1, components: buttons.slice(index, index + 3) })
  }
  return rows
}

function interactionResponse(content: string, buttons: Array<{ type: 1; components: Array<Record<string, unknown>> }> = []) {
  return NextResponse.json({
    type: 4,
    data: {
      content,
      components: buttons,
    },
  })
}

function linkedSuccessMessage() {
  return [
    EXTERNAL_CHAT_COPY.discord.linkedTitle,
    EXTERNAL_CHAT_COPY.discord.linkedBody,
    "例文:",
    ...EXTERNAL_CHAT_COPY.discord.linkedExamples.map((item) => `- ${item}`),
  ].join("\n")
}

function unlinkedMessage() {
  return [EXTERNAL_CHAT_COPY.discord.unlinkedTitle, EXTERNAL_CHAT_COPY.discord.unlinkedBody].join("\n")
}

function noQuestionMessage() {
  return "質問文を入れてください。例: /nova question:今月の請求どうなってる？"
}

function resolveQuestion(payload: DiscordInteractionPayload) {
  if (payload.type === 3) {
    return mapButtonPrompt(String(payload.data?.custom_id ?? ""))
  }
  const options = Array.isArray(payload.data?.options) ? payload.data.options : []
  return String(options.find((option) => option.name === "question" || option.name === "text")?.value ?? "").trim()
}

function detailPathForCategory(category: string) {
  switch (category) {
    case "contents":
      return "/contents"
    case "billing":
      return "/invoices"
    case "vendor_invoices":
      return "/vendors"
    case "payouts":
      return "/payouts"
    case "notifications":
      return "/notifications"
    default:
      return "/pages"
  }
}

export async function POST(req: NextRequest) {
  const raw = await req.text()
  const valid = verifyDiscordSignature({
    body: raw,
    signature: req.headers.get("x-signature-ed25519"),
    timestamp: req.headers.get("x-signature-timestamp"),
    publicKey: process.env.DISCORD_PUBLIC_KEY,
  })
  if (!valid) return NextResponse.json({ error: "Invalid signature" }, { status: 401 })

  const payload = JSON.parse(raw) as DiscordInteractionPayload
  if (payload.type === 1) return NextResponse.json({ type: 1 })

  const externalUserId = String(payload.member?.user?.id ?? payload.user?.id ?? "")
  const externalDisplayName = String(payload.member?.user?.username ?? payload.user?.username ?? "")
  const question = resolveQuestion(payload)?.trim() ?? ""
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? ""
  const settingsUrl = `${appUrl}/settings/ai-channels`
  const manualUrl = `${appUrl}/pages`

  if (!question) {
    return interactionResponse(
      noQuestionMessage(),
      buildButtons({ openUrl: appUrl, howToUrl: settingsUrl, refreshCategory: "overall" })
    )
  }

  if (question.toLowerCase().startsWith("link ")) {
    const code = question.slice(5).trim()
    const result = await confirmExternalChannelLink({
      channelType: "discord",
      linkCode: code,
      externalUserId,
      externalDisplayName,
    })
    if (!result.ok) {
      return interactionResponse(
        unlinkedMessage(),
        buildButtons({ openUrl: settingsUrl, howToUrl: settingsUrl, refreshCategory: "overall" })
      )
    }
    return interactionResponse(
      linkedSuccessMessage(),
      buildButtons({ openUrl: appUrl, detailUrl: manualUrl, refreshCategory: "overall" })
    )
  }

  const actor = await getLinkedActorContext({ channelType: "discord", externalUserId })
  if (!actor) {
    return interactionResponse(
      unlinkedMessage(),
      buildButtons({ openUrl: settingsUrl, howToUrl: settingsUrl })
    )
  }

  const admin = createSupabaseAdmin()
  const { data: channelSettings } = await admin
    .from("ai_channel_settings")
    .select("discord_enabled, open_app_url")
    .eq("org_id", actor.orgId)
    .maybeSingle()

  const baseUrl = (channelSettings as { open_app_url?: string | null } | null)?.open_app_url ?? appUrl
  if ((channelSettings as { discord_enabled?: boolean } | null)?.discord_enabled !== true) {
    return interactionResponse(
      EXTERNAL_CHAT_COPY.common.temporaryError,
      buildButtons({ openUrl: settingsUrl, refreshCategory: "overall" })
    )
  }

  try {
    const result = await answerExternalAiQuestion({ actor, channelType: "discord", message: question })
    return interactionResponse(
      result.response,
      buildButtons({
        openUrl: baseUrl,
        detailUrl: `${baseUrl}${detailPathForCategory(result.category)}`,
        manualUrl,
        refreshCategory: result.category,
        includeFilterButtons: true,
      })
    )
  } catch {
    return interactionResponse(
      `${EXTERNAL_CHAT_COPY.common.temporaryError}\n${EXTERNAL_CHAT_COPY.common.temporaryErrorFollow}`,
      buildButtons({ openUrl: baseUrl || appUrl, refreshCategory: "overall" })
    )
  }
}
