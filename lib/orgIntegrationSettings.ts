import type { SupabaseClient } from "@supabase/supabase-js"

export const EXTERNAL_CHANNELS = ["chatwork", "slack", "discord", "lark"] as const

export type ExternalChannel = (typeof EXTERNAL_CHANNELS)[number]

export type OrgIntegrationSettings = {
  org_id: string
  chatwork_api_token: string | null
  chatwork_default_room_id: string | null
  slack_webhook_url: string | null
  discord_webhook_url: string | null
  lark_webhook_url: string | null
  auto_digest_enabled: boolean
  auto_invoice_reminders_enabled: boolean
  auto_backup_enabled: boolean
  digest_channels: ExternalChannel[]
  reminder_channels: ExternalChannel[]
  backup_channels: ExternalChannel[]
}

export type OrgIntegrationSettingsClient = {
  hasChatworkToken: boolean
  chatworkDefaultRoomId: string
  hasSlackWebhook: boolean
  hasDiscordWebhook: boolean
  hasLarkWebhook: boolean
  autoDigestEnabled: boolean
  autoInvoiceRemindersEnabled: boolean
  autoBackupEnabled: boolean
  digestChannels: ExternalChannel[]
  reminderChannels: ExternalChannel[]
  backupChannels: ExternalChannel[]
}

const EMPTY_CHANNELS: ExternalChannel[] = []

export function sanitizeChannelList(value: unknown): ExternalChannel[] {
  if (!Array.isArray(value)) return EMPTY_CHANNELS
  const allowed = new Set<ExternalChannel>(EXTERNAL_CHANNELS)
  return Array.from(
    new Set(
      value.filter((item): item is ExternalChannel => typeof item === "string" && allowed.has(item as ExternalChannel))
    )
  )
}

export function normalizeOrgIntegrationSettings(
  orgId: string,
  row: Partial<OrgIntegrationSettings> | null | undefined
): OrgIntegrationSettings {
  return {
    org_id: orgId,
    chatwork_api_token: typeof row?.chatwork_api_token === "string" && row.chatwork_api_token.trim() ? row.chatwork_api_token.trim() : null,
    chatwork_default_room_id:
      typeof row?.chatwork_default_room_id === "string" && row.chatwork_default_room_id.trim()
        ? row.chatwork_default_room_id.trim()
        : null,
    slack_webhook_url: typeof row?.slack_webhook_url === "string" && row.slack_webhook_url.trim() ? row.slack_webhook_url.trim() : null,
    discord_webhook_url:
      typeof row?.discord_webhook_url === "string" && row.discord_webhook_url.trim() ? row.discord_webhook_url.trim() : null,
    lark_webhook_url: typeof row?.lark_webhook_url === "string" && row.lark_webhook_url.trim() ? row.lark_webhook_url.trim() : null,
    auto_digest_enabled: row?.auto_digest_enabled === true,
    auto_invoice_reminders_enabled: row?.auto_invoice_reminders_enabled === true,
    auto_backup_enabled: row?.auto_backup_enabled === true,
    digest_channels: sanitizeChannelList(row?.digest_channels),
    reminder_channels: sanitizeChannelList(row?.reminder_channels),
    backup_channels: sanitizeChannelList(row?.backup_channels),
  }
}

export function toClientOrgIntegrationSettings(row: OrgIntegrationSettings): OrgIntegrationSettingsClient {
  return {
    hasChatworkToken: Boolean(row.chatwork_api_token),
    chatworkDefaultRoomId: row.chatwork_default_room_id ?? "",
    hasSlackWebhook: Boolean(row.slack_webhook_url),
    hasDiscordWebhook: Boolean(row.discord_webhook_url),
    hasLarkWebhook: Boolean(row.lark_webhook_url),
    autoDigestEnabled: row.auto_digest_enabled,
    autoInvoiceRemindersEnabled: row.auto_invoice_reminders_enabled,
    autoBackupEnabled: row.auto_backup_enabled,
    digestChannels: row.digest_channels,
    reminderChannels: row.reminder_channels,
    backupChannels: row.backup_channels,
  }
}

export async function loadOrgIntegrationSettings(
  admin: SupabaseClient,
  orgId: string
): Promise<OrgIntegrationSettings> {
  const { data } = await admin.from("org_integration_settings").select("*").eq("org_id", orgId).maybeSingle()
  return normalizeOrgIntegrationSettings(orgId, (data as Partial<OrgIntegrationSettings> | null) ?? null)
}

type BuildUpsertInput = {
  orgId: string
  existing?: OrgIntegrationSettings | null
  body: Record<string, unknown>
}

function resolveSecretInput(
  nextValue: unknown,
  existingValue: string | null | undefined
): string | null {
  if (typeof nextValue !== "string") return existingValue ?? null
  const trimmed = nextValue.trim()
  if (!trimmed) return null
  if (trimmed === "__KEEP__") return existingValue ?? null
  return trimmed
}

export function buildOrgIntegrationSettingsUpsert(input: BuildUpsertInput) {
  const existing = input.existing ?? normalizeOrgIntegrationSettings(input.orgId, null)
  return {
    org_id: input.orgId,
    chatwork_api_token: resolveSecretInput(input.body.chatworkApiToken, existing.chatwork_api_token),
    chatwork_default_room_id:
      typeof input.body.chatworkDefaultRoomId === "string" && input.body.chatworkDefaultRoomId.trim()
        ? input.body.chatworkDefaultRoomId.trim()
        : null,
    slack_webhook_url: resolveSecretInput(input.body.slackWebhookUrl, existing.slack_webhook_url),
    discord_webhook_url: resolveSecretInput(input.body.discordWebhookUrl, existing.discord_webhook_url),
    lark_webhook_url: resolveSecretInput(input.body.larkWebhookUrl, existing.lark_webhook_url),
    auto_digest_enabled: input.body.autoDigestEnabled === true,
    auto_invoice_reminders_enabled: input.body.autoInvoiceRemindersEnabled === true,
    auto_backup_enabled: input.body.autoBackupEnabled === true,
    digest_channels: sanitizeChannelList(input.body.digestChannels),
    reminder_channels: sanitizeChannelList(input.body.reminderChannels),
    backup_channels: sanitizeChannelList(input.body.backupChannels),
    updated_at: new Date().toISOString(),
  }
}

export function channelConfigured(
  settings: OrgIntegrationSettings,
  channel: ExternalChannel,
  options?: { chatworkRoomId?: string | null; useDefaultRoom?: boolean }
) {
  if (channel === "chatwork") {
    const roomId = options?.chatworkRoomId ?? (options?.useDefaultRoom ? settings.chatwork_default_room_id : null)
    return Boolean(settings.chatwork_api_token && roomId)
  }
  if (channel === "slack") return Boolean(settings.slack_webhook_url)
  if (channel === "discord") return Boolean(settings.discord_webhook_url)
  return Boolean(settings.lark_webhook_url)
}
