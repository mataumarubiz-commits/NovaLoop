import { channelConfigured, type ExternalChannel, type OrgIntegrationSettings } from "@/lib/orgIntegrationSettings"

export type ExternalSendResult = {
  channel: ExternalChannel
  ok: boolean
  message?: string
}

function trimText(text: string) {
  return text.trim().replace(/\r\n/g, "\n")
}

async function sendChatworkMessage(settings: OrgIntegrationSettings, roomId: string, text: string) {
  const token = settings.chatwork_api_token
  if (!token) throw new Error("Chatwork token is not configured")
  const response = await fetch(`https://api.chatwork.com/v2/rooms/${encodeURIComponent(roomId)}/messages`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
      "X-ChatWorkToken": token,
    },
    body: new URLSearchParams({ body: trimText(text) }).toString(),
  })
  if (!response.ok) {
    throw new Error(`Chatwork returned ${response.status}`)
  }
}

async function sendSlackMessage(settings: OrgIntegrationSettings, text: string) {
  if (!settings.slack_webhook_url) throw new Error("Slack webhook is not configured")
  const response = await fetch(settings.slack_webhook_url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text: trimText(text) }),
  })
  if (!response.ok) {
    throw new Error(`Slack returned ${response.status}`)
  }
}

async function sendDiscordMessage(settings: OrgIntegrationSettings, text: string) {
  if (!settings.discord_webhook_url) throw new Error("Discord webhook is not configured")
  const response = await fetch(settings.discord_webhook_url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content: trimText(text) }),
  })
  if (!response.ok) {
    throw new Error(`Discord returned ${response.status}`)
  }
}

async function sendLarkMessage(settings: OrgIntegrationSettings, text: string) {
  if (!settings.lark_webhook_url) throw new Error("Lark webhook is not configured")
  const response = await fetch(settings.lark_webhook_url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      msg_type: "text",
      content: { text: trimText(text) },
    }),
  })
  if (!response.ok) {
    throw new Error(`Lark returned ${response.status}`)
  }
}

export async function sendExternalMessage(params: {
  settings: OrgIntegrationSettings
  channel: ExternalChannel
  text: string
  chatworkRoomId?: string | null
  useDefaultChatworkRoom?: boolean
}) {
  const { settings, channel, text } = params
  if (channel === "chatwork") {
    const roomId = params.chatworkRoomId ?? (params.useDefaultChatworkRoom ? settings.chatwork_default_room_id : null)
    if (!roomId) throw new Error("Chatwork room is not configured")
    await sendChatworkMessage(settings, roomId, text)
    return
  }
  if (channel === "slack") {
    await sendSlackMessage(settings, text)
    return
  }
  if (channel === "discord") {
    await sendDiscordMessage(settings, text)
    return
  }
  await sendLarkMessage(settings, text)
}

export async function fanOutExternalMessage(params: {
  settings: OrgIntegrationSettings
  channels: ExternalChannel[]
  text: string
  chatworkRoomId?: string | null
  useDefaultChatworkRoom?: boolean
}) {
  const results: ExternalSendResult[] = []
  for (const channel of params.channels) {
    if (
      !channelConfigured(params.settings, channel, {
        chatworkRoomId: params.chatworkRoomId,
        useDefaultRoom: params.useDefaultChatworkRoom,
      })
    ) {
      results.push({ channel, ok: false, message: "not_configured" })
      continue
    }
    try {
      await sendExternalMessage({
        settings: params.settings,
        channel,
        text: params.text,
        chatworkRoomId: params.chatworkRoomId,
        useDefaultChatworkRoom: params.useDefaultChatworkRoom,
      })
      results.push({ channel, ok: true })
    } catch (error) {
      results.push({
        channel,
        ok: false,
        message: error instanceof Error ? error.message : "unknown_error",
      })
    }
  }
  return results
}
