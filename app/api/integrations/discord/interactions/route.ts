import { NextRequest, NextResponse } from "next/server"
import { createSupabaseAdmin } from "@/lib/supabaseAdmin"
import { verifyDiscordInteractionSignature } from "@/lib/discord/verify"
import {
  getDiscordAppBaseUrl,
  runDiscordAddCommand,
  runDiscordAuditCommand,
  runDiscordInfoCommand,
  type DiscordCommandResult,
} from "@/lib/discord/service"
import { DISCORD_EPHEMERAL_FLAG } from "@/lib/discord/utils"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

type DiscordOption = { name?: string; value?: string | number | boolean }
type DiscordTextInput = { custom_id?: string; value?: string }
type DiscordModalRow = { components?: DiscordTextInput[] }
type DiscordInteractionPayload = {
  id?: string
  type?: number
  guild_id?: string
  channel_id?: string
  user?: { id?: string }
  member?: { user?: { id?: string } }
  data?: {
    name?: string
    custom_id?: string
    options?: DiscordOption[]
    components?: DiscordModalRow[]
  }
}

function optionValue(payload: DiscordInteractionPayload, name: string) {
  return payload.data?.options?.find((option) => option.name === name)?.value
}

function modalValue(payload: DiscordInteractionPayload, customId: string) {
  const rows = payload.data?.components ?? []
  for (const row of rows) {
    const input = row.components?.find((component) => component.custom_id === customId)
    if (input) return input.value ?? ""
  }
  return ""
}

function optionalFieldValue(raw: string, key: string) {
  const line = raw
    .split(/\r?\n/)
    .map((item) => item.trim())
    .find((item) => item.toLowerCase().startsWith(`${key.toLowerCase()}=`))
  return line ? line.slice(key.length + 1).trim() : ""
}

function commandBase(payload: DiscordInteractionPayload, req: NextRequest) {
  return {
    admin: createSupabaseAdmin(),
    interactionId: String(payload.id ?? ""),
    discordUserId: String(payload.member?.user?.id ?? payload.user?.id ?? ""),
    discordGuildId: String(payload.guild_id ?? ""),
    discordChannelId: String(payload.channel_id ?? ""),
    appBaseUrl: getDiscordAppBaseUrl(req.nextUrl.origin),
  }
}

function resultResponse(result: DiscordCommandResult) {
  return NextResponse.json({
    type: 4,
    data: {
      content: result.content,
      flags: DISCORD_EPHEMERAL_FLAG,
      components: result.components ?? [],
      allowed_mentions: { parse: [] },
    },
  })
}

function modalResponse() {
  return NextResponse.json({
    type: 9,
    data: {
      custom_id: "discord_add_modal",
      title: "案件を追加",
      components: [
        inputRow("client_name", "クライアント名", 1, true),
        inputRow("project_name", "プロジェクト名", 1, true),
        inputRow("title", "タイトル", 2, true),
        inputRow("due_client_at", "先方締切日 YYYY-MM-DD", 1, true),
        inputRow("optional_fields", "任意: due_editor_at= / unit_price= / note=", 2, false),
      ],
    },
  })
}

function inputRow(customId: string, label: string, style: 1 | 2, required: boolean) {
  return {
    type: 1,
    components: [
      {
        type: 4,
        custom_id: customId,
        label,
        style,
        required,
      },
    ],
  }
}

export async function POST(req: NextRequest) {
  const raw = await req.text()
  const valid = verifyDiscordInteractionSignature({
    body: raw,
    signature: req.headers.get("x-signature-ed25519"),
    timestamp: req.headers.get("x-signature-timestamp"),
    publicKey: process.env.DISCORD_PUBLIC_KEY,
  })
  if (!valid) return NextResponse.json({ error: "Invalid signature" }, { status: 401 })

  const payload = JSON.parse(raw) as DiscordInteractionPayload
  if (payload.type === 1) return NextResponse.json({ type: 1 })

  try {
    if (payload.type === 2) {
      const commandName = String(payload.data?.name ?? "")
      if (commandName === "add") return modalResponse()
      if (commandName === "info") {
        return resultResponse(
          await runDiscordInfoCommand({
            ...commandBase(payload, req),
            query: String(optionValue(payload, "query") ?? ""),
          })
        )
      }
      if (commandName === "audit") {
        const limitValue = Number(optionValue(payload, "limit") ?? 5)
        return resultResponse(
          await runDiscordAuditCommand({
            ...commandBase(payload, req),
            query: typeof optionValue(payload, "query") === "string" ? String(optionValue(payload, "query")) : null,
            limit: Number.isFinite(limitValue) ? limitValue : 5,
          })
        )
      }
    }

    if (payload.type === 5 && payload.data?.custom_id === "discord_add_modal") {
      const optionalFields = modalValue(payload, "optional_fields")
      const unitPriceRaw = optionalFieldValue(optionalFields, "unit_price")
      const unitPrice = unitPriceRaw ? Number(unitPriceRaw) : null
      return resultResponse(
        await runDiscordAddCommand({
          ...commandBase(payload, req),
          clientName: modalValue(payload, "client_name"),
          projectName: modalValue(payload, "project_name"),
          title: modalValue(payload, "title"),
          dueClientAt: modalValue(payload, "due_client_at"),
          dueEditorAt: optionalFieldValue(optionalFields, "due_editor_at") || null,
          unitPrice: typeof unitPrice === "number" && Number.isFinite(unitPrice) ? unitPrice : null,
          note: optionalFieldValue(optionalFields, "note") || null,
        })
      )
    }

    return resultResponse({
      ok: false,
      code: "UNKNOWN_COMMAND",
      content: "対応していないDiscord操作です。",
      responsePayload: { ok: false, code: "UNKNOWN_COMMAND" },
    })
  } catch (error) {
    return resultResponse({
      ok: false,
      code: "DISCORD_COMMAND_FAILED",
      content: error instanceof Error ? error.message : "Discord操作に失敗しました。",
      responsePayload: { ok: false, code: "DISCORD_COMMAND_FAILED" },
    })
  }
}
