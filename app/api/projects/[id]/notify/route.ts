import { NextRequest, NextResponse } from "next/server"
import { requireOrgPermission } from "@/lib/adminApi"
import { writeAuditLog } from "@/lib/auditLog"
import { sendExternalMessage } from "@/lib/externalChannels"
import {
  EXTERNAL_CHANNELS,
  loadOrgIntegrationSettings,
  type ExternalChannel,
} from "@/lib/orgIntegrationSettings"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

function isExternalChannel(value: unknown): value is ExternalChannel {
  return typeof value === "string" && EXTERNAL_CHANNELS.includes(value as ExternalChannel)
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireOrgPermission(req, "contents_write")
  if (!auth.ok) return auth.response

  const { id } = await params
  const body = (await req.json().catch(() => ({}))) as {
    channel?: unknown
    message?: unknown
  }

  if (!id) {
    return NextResponse.json({ ok: false, message: "projectId is required" }, { status: 400 })
  }

  if (!isExternalChannel(body.channel)) {
    return NextResponse.json({ ok: false, message: "channel is required" }, { status: 400 })
  }

  const message = typeof body.message === "string" ? body.message.trim() : ""
  if (!message) {
    return NextResponse.json({ ok: false, message: "message is required" }, { status: 400 })
  }

  const { data: project, error: projectError } = await auth.admin
    .from("projects")
    .select("id, name, chatwork_room_id, slack_channel_id, discord_channel_id")
    .eq("id", id)
    .eq("org_id", auth.orgId)
    .maybeSingle()

  if (projectError || !project) {
    return NextResponse.json({ ok: false, message: projectError?.message ?? "Project not found" }, { status: 404 })
  }

  const settings = await loadOrgIntegrationSettings(auth.admin, auth.orgId)
  const projectRow = project as {
    id: string
    name: string
    chatwork_room_id?: string | null
    slack_channel_id?: string | null
    discord_channel_id?: string | null
  }

  let text = message
  if (body.channel === "slack" && projectRow.slack_channel_id?.trim()) {
    text = `#${projectRow.slack_channel_id.trim()}\n${message}`
  }
  if (body.channel === "discord" && projectRow.discord_channel_id?.trim()) {
    text = `[${projectRow.discord_channel_id.trim()}]\n${message}`
  }

  try {
    await sendExternalMessage({
      settings,
      channel: body.channel,
      text,
      chatworkRoomId: projectRow.chatwork_room_id ?? null,
      useDefaultChatworkRoom: false,
    })
  } catch (error) {
    return NextResponse.json(
      { ok: false, message: error instanceof Error ? error.message : "Failed to send notification" },
      { status: 500 }
    )
  }

  await writeAuditLog(auth.admin, {
    org_id: auth.orgId,
    user_id: auth.userId,
    action: "project.notify.send",
    resource_type: "project",
    resource_id: projectRow.id,
    meta: {
      channel: body.channel,
      project_name: projectRow.name,
    },
  })

  return NextResponse.json({ ok: true }, { status: 200 })
}
