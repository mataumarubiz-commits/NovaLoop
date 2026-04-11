import crypto from "node:crypto"
import type { SupabaseClient } from "@supabase/supabase-js"
import { writeAuditLog } from "@/lib/auditLog"
import {
  INCOMPLETE_CONTENT_STATUSES,
  absoluteAppUrl,
  actionRows,
  addDaysYmd,
  buildProjectsContentPath,
  linkButton,
  normalizeClientName,
  parseStrictYmd,
  statusLabel,
  toYmFromYmd,
  todayYmd,
  trimForDiscord,
} from "@/lib/discord/utils"

export type DiscordConnection = {
  id: string
  org_id: string
  guild_id: string
  guild_name: string | null
  channel_id: string
  channel_name: string | null
  installed_by_user_id: string | null
  commands_enabled: boolean
  immediate_notifications_enabled: boolean
  morning_summary_enabled: boolean
  evening_summary_enabled: boolean
  incident_notifications_enabled: boolean
  status: string
  last_healthcheck_at: string | null
  last_error: string | null
}

export type DiscordCommandResult = {
  ok: boolean
  code?: string
  content: string
  components?: Array<{ type: 1; components: Array<Record<string, unknown>> }>
  responsePayload?: Record<string, unknown>
}

type CommandBase = {
  admin: SupabaseClient
  interactionId: string
  discordUserId: string
  discordGuildId: string
  discordChannelId: string
  appBaseUrl: string
  orgId?: string | null
}

type ContentSearchRow = {
  id: string
  client_id: string
  project_id?: string | null
  project_name: string | null
  title: string | null
  due_client_at: string | null
  status: string | null
}

type PageSearchRow = {
  id: string
  title: string | null
  updated_at?: string | null
}

function discordError(code: string, message: string, details?: Record<string, unknown>): DiscordCommandResult {
  return {
    ok: false,
    code,
    content: message,
    responsePayload: { ok: false, code, message, details: details ?? {} },
  }
}

function isUniqueViolation(error: { code?: string; message?: string } | null | undefined) {
  const text = `${error?.code ?? ""} ${error?.message ?? ""}`.toLowerCase()
  return text.includes("23505") || text.includes("duplicate key") || text.includes("unique")
}

function isMissingColumn(error: { message?: string } | null | undefined, column: string) {
  const text = String(error?.message ?? "").toLowerCase()
  return (
    text.includes(column.toLowerCase()) &&
    (text.includes("does not exist") || text.includes("schema cache") || text.includes("could not find"))
  )
}

function ilikePattern(value: string) {
  return `%${value.trim().replace(/[%_]/g, "\\$&")}%`
}

function buildCommandRequestPayload(params: CommandBase, extra: Record<string, unknown>) {
  return {
    ...extra,
    interaction_id: params.interactionId,
    discord_user_id: params.discordUserId,
    discord_guild_id: params.discordGuildId,
    discord_channel_id: params.discordChannelId,
  }
}

export function getDiscordAppBaseUrl(fallbackOrigin?: string | null) {
  return process.env.NEXT_PUBLIC_APP_URL?.trim() || process.env.APP_BASE_URL?.trim() || fallbackOrigin?.trim() || ""
}

export async function loadDiscordConnection(
  admin: SupabaseClient,
  params: { orgId?: string | null; guildId?: string | null }
) {
  let query = admin.from("org_discord_connections").select("*")
  if (params.orgId) {
    query = query.eq("org_id", params.orgId)
  } else if (params.guildId) {
    query = query.eq("guild_id", params.guildId)
  } else {
    return null
  }

  const { data, error } = await query.maybeSingle()
  if (error) throw new Error(error.message)
  return (data as DiscordConnection | null) ?? null
}

async function requireUsableConnection(params: CommandBase): Promise<
  | { ok: true; connection: DiscordConnection }
  | { ok: false; result: DiscordCommandResult; connection?: DiscordConnection }
> {
  const connection = await loadDiscordConnection(params.admin, {
    orgId: params.orgId,
    guildId: params.discordGuildId,
  })
  if (!connection) {
    return { ok: false, result: discordError("DISCORD_CONNECTION_NOT_FOUND", "Discord連携が見つかりません。SaaS側の設定を確認してください。") }
  }
  if (connection.guild_id !== params.discordGuildId) {
    return { ok: false, connection, result: discordError("DISCORD_GUILD_MISMATCH", "このDiscordサーバーは設定済みの接続と一致しません。") }
  }
  if (connection.channel_id !== params.discordChannelId) {
    return { ok: false, connection, result: discordError("DISCORD_CHANNEL_MISMATCH", "このコマンドは設定済みの管理チャンネルでのみ使えます。") }
  }
  if (connection.status !== "active") {
    return { ok: false, connection, result: discordError("DISCORD_CONNECTION_NOT_FOUND", "Discord連携が有効ではありません。SaaS側で再接続してください。") }
  }
  if (connection.commands_enabled !== true) {
    return { ok: false, connection, result: discordError("DISCORD_COMMANDS_DISABLED", "Discordコマンドは現在OFFです。") }
  }
  return { ok: true, connection }
}

async function writeCommandLog(params: {
  admin: SupabaseClient
  connection: DiscordConnection
  base: CommandBase
  commandName: string
  requestPayload: Record<string, unknown>
  responsePayload: Record<string, unknown>
  status: "success" | "failed" | "denied" | "duplicate"
}) {
  await params.admin.from("discord_command_logs").upsert(
    {
      org_id: params.connection.org_id,
      interaction_id: params.base.interactionId,
      discord_guild_id: params.base.discordGuildId,
      discord_channel_id: params.base.discordChannelId,
      discord_user_id: params.base.discordUserId,
      app_user_id: null,
      command_name: params.commandName,
      request_payload: params.requestPayload,
      response_payload: params.responsePayload,
      status: params.status,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "interaction_id" }
  )
}

async function reserveAddCommand(params: {
  admin: SupabaseClient
  connection: DiscordConnection
  base: CommandBase
  requestPayload: Record<string, unknown>
}) {
  const { data: existing } = await params.admin
    .from("discord_command_logs")
    .select("response_payload")
    .eq("interaction_id", params.base.interactionId)
    .maybeSingle()

  if (existing) {
    return { duplicate: true, payload: (existing as { response_payload?: Record<string, unknown> }).response_payload ?? {} }
  }

  const { error } = await params.admin.from("discord_command_logs").insert({
    org_id: params.connection.org_id,
    interaction_id: params.base.interactionId,
    discord_guild_id: params.base.discordGuildId,
    discord_channel_id: params.base.discordChannelId,
    discord_user_id: params.base.discordUserId,
    app_user_id: null,
    command_name: "add",
    request_payload: params.requestPayload,
    response_payload: {},
    status: "success",
  })

  if (isUniqueViolation(error)) return { duplicate: true, payload: {} }
  if (error) throw new Error(error.message)
  return { duplicate: false, payload: {} }
}

async function markReservedAddCommand(params: {
  admin: SupabaseClient
  interactionId: string
  responsePayload: Record<string, unknown>
  status: "success" | "failed" | "duplicate"
}) {
  await params.admin
    .from("discord_command_logs")
    .update({
      response_payload: params.responsePayload,
      status: params.status,
      updated_at: new Date().toISOString(),
    })
    .eq("interaction_id", params.interactionId)
}

async function logDeniedCommand(params: {
  admin: SupabaseClient
  connection?: DiscordConnection
  base: CommandBase
  commandName: string
  requestPayload: Record<string, unknown>
  result: DiscordCommandResult
}) {
  if (!params.connection) return
  await writeCommandLog({
    admin: params.admin,
    connection: params.connection,
    base: params.base,
    commandName: params.commandName,
    requestPayload: params.requestPayload,
    responsePayload: params.result.responsePayload ?? { ok: false },
    status: "denied",
  })
}

async function loadClientMap(admin: SupabaseClient, orgId: string, clientIds: string[]) {
  if (clientIds.length === 0) return new Map<string, string>()
  const { data, error } = await admin.from("clients").select("id, name").eq("org_id", orgId).in("id", clientIds)
  if (error) throw new Error(error.message)
  return new Map(
    (data ?? []).map((row) => [
      String((row as { id: string }).id),
      String((row as { name?: string | null }).name ?? ""),
    ])
  )
}

async function resolveClientByName(admin: SupabaseClient, orgId: string, input: string) {
  const normalizedInput = normalizeClientName(input)
  const { data, error } = await admin.from("clients").select("id, name").eq("org_id", orgId)
  if (error) throw new Error(error.message)

  const clients = ((data ?? []) as Array<{ id: string; name: string | null }>).map((client) => ({
    id: client.id,
    name: String(client.name ?? ""),
    normalized: normalizeClientName(String(client.name ?? "")),
  }))
  const exact = clients.filter((client) => client.name.trim() === input.trim())
  if (exact.length === 1) return { ok: true as const, client: exact[0] }
  const normalized = clients.filter((client) => client.normalized === normalizedInput)
  if (normalized.length === 1) return { ok: true as const, client: normalized[0] }

  const partial = clients.filter((client) => client.normalized.includes(normalizedInput) || normalizedInput.includes(client.normalized))
  if (partial.length > 1) {
    return { ok: false as const, code: "CLIENT_AMBIGUOUS", candidates: partial.slice(0, 5).map((client) => client.name) }
  }
  if (partial.length === 1) return { ok: true as const, client: partial[0] }
  return { ok: false as const, code: "CLIENT_NOT_FOUND", candidates: [] }
}

async function findMatchingProject(admin: SupabaseClient, params: { orgId: string; clientId: string; projectName: string }) {
  const { data, error } = await admin
    .from("projects")
    .select("id")
    .eq("org_id", params.orgId)
    .eq("client_id", params.clientId)
    .eq("name", params.projectName)
    .maybeSingle()

  if (error) {
    const text = error.message.toLowerCase()
    if (text.includes("does not exist") || text.includes("schema cache") || text.includes("could not find")) return null
    throw new Error(error.message)
  }
  return (data as { id?: string } | null)?.id ?? null
}

async function insertContentCompat(admin: SupabaseClient, payload: Record<string, unknown>) {
  let nextPayload = { ...payload }
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const { data, error } = await admin
      .from("contents")
      .insert(nextPayload)
      .select("id, title, project_name, due_client_at, due_editor_at, status, project_id")
      .single()

    if (!error) {
      return data as {
        id: string
        title: string
        project_name: string
        due_client_at: string
        due_editor_at: string
        status: string
        project_id?: string | null
      }
    }

    const removableColumn = ["project_id", "editor_submitted_at", "client_submitted_at"].find((column) => isMissingColumn(error, column))
    if (removableColumn) {
      const rest = { ...nextPayload }
      delete rest[removableColumn]
      nextPayload = rest
      continue
    }
    throw new Error(error.message)
  }
  throw new Error("contents insert compatibility retry exceeded")
}

export async function runDiscordAddCommand(
  params: CommandBase & {
    clientName: string
    projectName: string
    title: string
    dueClientAt: string
    dueEditorAt?: string | null
    unitPrice?: number | null
    note?: string | null
  }
): Promise<DiscordCommandResult> {
  const requestPayload = buildCommandRequestPayload(params, {
    client_name: params.clientName,
    project_name: params.projectName,
    title: params.title,
    due_client_at: params.dueClientAt,
    due_editor_at: params.dueEditorAt ?? null,
    unit_price: params.unitPrice ?? null,
    note: params.note ?? null,
  })

  const usable = await requireUsableConnection(params)
  if (!usable.ok) {
    await logDeniedCommand({ admin: params.admin, connection: usable.connection, base: params, commandName: "add", requestPayload, result: usable.result })
    return usable.result
  }
  const { connection } = usable

  const reserved = await reserveAddCommand({ admin: params.admin, connection, base: params, requestPayload })
  if (reserved.duplicate) {
    const result = {
      ok: true,
      content: "このDiscord操作はすでに処理済みです。",
      responsePayload: { ok: true, duplicate: true, previous: reserved.payload },
    }
    await markReservedAddCommand({ admin: params.admin, interactionId: params.interactionId, responsePayload: result.responsePayload, status: "duplicate" })
    return result
  }

  const clientName = params.clientName.trim()
  const projectName = params.projectName.trim()
  const title = params.title.trim()
  const dueClientAt = parseStrictYmd(params.dueClientAt)
  const dueEditorAt = params.dueEditorAt ? parseStrictYmd(params.dueEditorAt) : dueClientAt ? addDaysYmd(dueClientAt, -3) : null
  const unitPrice = params.unitPrice ?? 0

  let validation: DiscordCommandResult | null = null
  if (!clientName || !projectName || !title) {
    validation = discordError("VALIDATION_ERROR", "client_name / project_name / title は必須です。")
  } else if (!dueClientAt || !dueEditorAt) {
    validation = discordError("DATE_PARSE_ERROR", "日付は YYYY-MM-DD で入力してください。")
  } else if (dueEditorAt > dueClientAt) {
    validation = discordError("DUE_EDITOR_AFTER_DUE_CLIENT", "編集者締切日は先方締切日以前にしてください。")
  } else if (!Number.isInteger(unitPrice) || unitPrice < 0) {
    validation = discordError("VALIDATION_ERROR", "unit_price は0以上の整数で入力してください。")
  }

  if (validation) {
    await markReservedAddCommand({ admin: params.admin, interactionId: params.interactionId, responsePayload: validation.responsePayload ?? {}, status: "failed" })
    return validation
  }
  if (!dueClientAt || !dueEditorAt) {
    const result = discordError("DATE_PARSE_ERROR", "日付は YYYY-MM-DD で入力してください。")
    await markReservedAddCommand({ admin: params.admin, interactionId: params.interactionId, responsePayload: result.responsePayload ?? {}, status: "failed" })
    return result
  }

  const clientResult = await resolveClientByName(params.admin, connection.org_id, clientName)
  if (!clientResult.ok) {
    const message =
      clientResult.code === "CLIENT_AMBIGUOUS"
        ? `クライアント候補が複数あります。\n${clientResult.candidates.map((candidate) => `- ${candidate}`).join("\n")}\nSaaS側で正式名称を確認して再実行してください。`
        : "既存クライアントが見つかりませんでした。SaaS側でクライアントを作成してから再実行してください。"
    const result = discordError(clientResult.code, message, { client_name: clientName, candidates: clientResult.candidates })
    await markReservedAddCommand({ admin: params.admin, interactionId: params.interactionId, responsePayload: result.responsePayload ?? {}, status: "failed" })
    return result
  }

  const projectId = await findMatchingProject(params.admin, {
    orgId: connection.org_id,
    clientId: clientResult.client.id,
    projectName,
  })
  const contentId = crypto.randomUUID()
  const inserted = await insertContentCompat(params.admin, {
    id: contentId,
    org_id: connection.org_id,
    client_id: clientResult.client.id,
    project_id: projectId,
    project_name: projectName,
    title,
    unit_price: unitPrice,
    due_client_at: dueClientAt,
    due_editor_at: dueEditorAt,
    status: "not_started",
    thumbnail_done: false,
    billable_flag: true,
    delivery_month: toYmFromYmd(dueClientAt),
    invoice_id: null,
    editor_submitted_at: null,
    client_submitted_at: null,
  })

  if (connection.installed_by_user_id) {
    await writeAuditLog(params.admin, {
      org_id: connection.org_id,
      user_id: connection.installed_by_user_id,
      action: "discord.add.created",
      resource_type: "content",
      resource_id: inserted.id,
      meta: {
        source: "discord",
        interaction_id: params.interactionId,
        discord_user_id: params.discordUserId,
        discord_channel_id: params.discordChannelId,
        content_id: inserted.id,
        client_id: clientResult.client.id,
        project_id: projectId,
        note: params.note?.trim() || null,
        auto_filled: {
          due_editor_at: !params.dueEditorAt,
          unit_price: params.unitPrice == null,
          project_id: Boolean(projectId),
        },
      },
    })
  }

  const appUrl = absoluteAppUrl(params.appBaseUrl, buildProjectsContentPath({ id: inserted.id, project_id: inserted.project_id ?? projectId }))
  const responsePayload = {
    ok: true,
    content_id: inserted.id,
    title: inserted.title,
    due_client_at: inserted.due_client_at,
    due_editor_at: inserted.due_editor_at,
    app_url: appUrl,
  }
  await markReservedAddCommand({ admin: params.admin, interactionId: params.interactionId, responsePayload, status: "success" })

  return {
    ok: true,
    content: [`追加しました。`, `タイトル: ${inserted.title}`, `先方締切: ${inserted.due_client_at}`, `編集締切: ${inserted.due_editor_at}`].join("\n"),
    components: actionRows([linkButton("案件を開く", appUrl)]),
    responsePayload,
  }
}

async function searchContents(params: { admin: SupabaseClient; orgId: string; query: string }) {
  const pattern = ilikePattern(params.query)
  const fields = "id, client_id, project_id, project_name, title, due_client_at, status"
  const [titleRes, projectRes, clientRes] = await Promise.all([
    params.admin.from("contents").select(fields).eq("org_id", params.orgId).ilike("title", pattern).limit(5),
    params.admin.from("contents").select(fields).eq("org_id", params.orgId).ilike("project_name", pattern).limit(5),
    params.admin.from("clients").select("id, name").eq("org_id", params.orgId).ilike("name", pattern).limit(5),
  ])
  if (titleRes.error) throw new Error(titleRes.error.message)
  if (projectRes.error) throw new Error(projectRes.error.message)
  if (clientRes.error) throw new Error(clientRes.error.message)

  const clientIds = ((clientRes.data ?? []) as Array<{ id: string }>).map((row) => row.id)
  const clientContentRes =
    clientIds.length > 0
      ? await params.admin.from("contents").select(fields).eq("org_id", params.orgId).in("client_id", clientIds).limit(5)
      : { data: [], error: null }
  if (clientContentRes.error) throw new Error(clientContentRes.error.message)

  const rows = [
    ...(((titleRes.data ?? []) as unknown[]) as ContentSearchRow[]),
    ...(((projectRes.data ?? []) as unknown[]) as ContentSearchRow[]),
    ...(((clientContentRes.data ?? []) as unknown[]) as ContentSearchRow[]),
  ]
  const seen = new Set<string>()
  return rows
    .filter((row) => {
      if (seen.has(row.id)) return false
      seen.add(row.id)
      return true
    })
    .slice(0, 5)
}

async function searchPages(params: { admin: SupabaseClient; orgId: string; query: string }) {
  const pattern = ilikePattern(params.query)
  const resultWithBody = await params.admin
    .from("pages")
    .select("id, title, updated_at, body_text")
    .eq("org_id", params.orgId)
    .or(`title.ilike.${pattern},body_text.ilike.${pattern}`)
    .eq("is_archived", false)
    .limit(5)

  if (resultWithBody.error && isMissingColumn(resultWithBody.error, "body_text")) {
    const fallback = await params.admin
      .from("pages")
      .select("id, title, updated_at")
      .eq("org_id", params.orgId)
      .ilike("title", pattern)
      .eq("is_archived", false)
      .limit(5)
    if (fallback.error) throw new Error(fallback.error.message)
    return ((fallback.data ?? []) as unknown[]) as PageSearchRow[]
  }
  if (resultWithBody.error) throw new Error(resultWithBody.error.message)
  return ((resultWithBody.data ?? []) as unknown[]) as PageSearchRow[]
}

export async function runDiscordInfoCommand(
  params: CommandBase & { query: string }
): Promise<DiscordCommandResult> {
  const requestPayload = buildCommandRequestPayload(params, { query: params.query })
  const usable = await requireUsableConnection(params)
  if (!usable.ok) {
    await logDeniedCommand({ admin: params.admin, connection: usable.connection, base: params, commandName: "info", requestPayload, result: usable.result })
    return usable.result
  }

  const query = params.query.trim()
  if (!query) {
    const result = discordError("QUERY_REQUIRED", "検索語を入力してください。")
    await writeCommandLog({ admin: params.admin, connection: usable.connection, base: params, commandName: "info", requestPayload, responsePayload: result.responsePayload ?? {}, status: "failed" })
    return result
  }

  const [contents, pages] = await Promise.all([
    searchContents({ admin: params.admin, orgId: usable.connection.org_id, query }),
    searchPages({ admin: params.admin, orgId: usable.connection.org_id, query }),
  ])
  const clientMap = await loadClientMap(params.admin, usable.connection.org_id, contents.map((row) => row.client_id))

  type InfoContentItem = {
    type: "content"
    id: string
    title: string
    client_name: string
    project_name: string
    due_client_at: string | null
    status_label: string
    app_url: string
  }
  type InfoPageItem = {
    type: "page"
    id: string
    title: string
    app_url: string
  }
  const contentItems: InfoContentItem[] = contents.map((row) => {
    const appPath = buildProjectsContentPath({ id: row.id, project_id: row.project_id ?? null })
    return {
      type: "content",
      id: row.id,
      title: trimForDiscord(row.title, "無題"),
      client_name: trimForDiscord(clientMap.get(row.client_id), "-"),
      project_name: trimForDiscord(row.project_name, "-"),
      due_client_at: row.due_client_at,
      status_label: statusLabel(row.status),
      app_url: absoluteAppUrl(params.appBaseUrl, appPath),
    }
  })
  const pageItems: InfoPageItem[] = pages.map((row) => ({
    type: "page",
    id: row.id,
    title: trimForDiscord(row.title, "無題"),
    app_url: absoluteAppUrl(params.appBaseUrl, `/pages/${encodeURIComponent(row.id)}`),
  }))
  const items: Array<InfoContentItem | InfoPageItem> = [...contentItems, ...pageItems].slice(0, 5)

  if (items.length === 0) {
    const result: DiscordCommandResult = {
      ok: true,
      content: "該当する案件・ページは見つかりませんでした。検索語を変えるか、Projectsを確認してください。",
      components: actionRows([linkButton("Projectsを開く", absoluteAppUrl(params.appBaseUrl, "/projects"))]),
      responsePayload: { ok: true, items: [], query },
    }
    await writeCommandLog({ admin: params.admin, connection: usable.connection, base: params, commandName: "info", requestPayload, responsePayload: result.responsePayload ?? {}, status: "success" })
    return result
  }

  const lines = ["検索結果です。"]
  for (const item of items) {
    if (item.type === "content") {
      lines.push(
        [
          "",
          `案件: ${item.title}`,
          `クライアント: ${item.client_name}`,
          `プロジェクト: ${item.project_name}`,
          `締切: ${item.due_client_at ?? "-"}`,
          `状態: ${item.status_label}`,
        ].join("\n")
      )
    } else {
      lines.push(["", `ページ: ${item.title}`].join("\n"))
    }
  }

  const result: DiscordCommandResult = {
    ok: true,
    content: lines.join("\n"),
    components: actionRows([linkButton("1件目を開く", items[0].app_url)]),
    responsePayload: { ok: true, summary: "検索結果です。", items, query },
  }
  await writeCommandLog({ admin: params.admin, connection: usable.connection, base: params, commandName: "info", requestPayload, responsePayload: result.responsePayload ?? {}, status: "success" })
  return result
}

export async function runDiscordAuditCommand(
  params: CommandBase & { query?: string | null; limit?: number | null }
): Promise<DiscordCommandResult> {
  const limit = Math.max(1, Math.min(10, Math.trunc(params.limit ?? 5)))
  const requestPayload = buildCommandRequestPayload(params, { query: params.query ?? null, limit })
  const usable = await requireUsableConnection(params)
  if (!usable.ok) {
    await logDeniedCommand({ admin: params.admin, connection: usable.connection, base: params, commandName: "audit", requestPayload, result: usable.result })
    return usable.result
  }

  const { data, error } = await params.admin
    .from("audit_logs")
    .select("id, action, resource_type, resource_id, meta, created_at")
    .eq("org_id", usable.connection.org_id)
    .gte("created_at", new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString())
    .order("created_at", { ascending: false })
    .limit(30)

  if (error) throw new Error(error.message)
  const query = params.query?.trim().toLowerCase() ?? ""
  const rows = (((data ?? []) as unknown[]) as Array<{
    id: string
    action: string
    resource_type: string
    resource_id: string | null
    meta: Record<string, unknown> | null
    created_at: string
  }>)
    .filter((row) => {
      if (!query) return true
      return `${row.action} ${row.resource_type} ${row.resource_id ?? ""}`.toLowerCase().includes(query)
    })
    .sort((a, b) => {
      const sourceA = a.meta?.source === "discord" ? 1 : 0
      const sourceB = b.meta?.source === "discord" ? 1 : 0
      if (sourceA !== sourceB) return sourceB - sourceA
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    })
    .slice(0, limit)

  if (rows.length === 0) {
    const result = discordError("AUDIT_NO_RESULTS", "該当する監査ログはありません。")
    await writeCommandLog({ admin: params.admin, connection: usable.connection, base: params, commandName: "audit", requestPayload, responsePayload: result.responsePayload ?? {}, status: "success" })
    return result
  }

  const items = rows.map((row) => {
    const appPath =
      row.resource_type === "content" && row.resource_id
        ? `/projects?highlight=${encodeURIComponent(row.resource_id)}`
        : row.resource_type === "page" && row.resource_id
          ? `/pages/${encodeURIComponent(row.resource_id)}`
          : "/settings/audit"
    return {
      action: row.action,
      created_at: row.created_at,
      target_id: row.resource_id,
      summary: row.action,
      app_url: absoluteAppUrl(params.appBaseUrl, appPath),
    }
  })

  const result: DiscordCommandResult = {
    ok: true,
    content: ["最近の監査ログです。", ...items.map((item) => `${item.created_at} / ${item.action} / ${item.target_id ?? "-"}`)].join("\n"),
    components: actionRows([linkButton("監査ログを開く", absoluteAppUrl(params.appBaseUrl, "/settings/audit"))]),
    responsePayload: { ok: true, items },
  }
  await writeCommandLog({ admin: params.admin, connection: usable.connection, base: params, commandName: "audit", requestPayload, responsePayload: result.responsePayload ?? {}, status: "success" })
  return result
}

async function sendDiscordBotMessage(params: {
  botToken: string
  channelId: string
  content: string
  components?: Array<{ type: 1; components: Array<Record<string, unknown>> }>
}) {
  const response = await fetch(`https://discord.com/api/v10/channels/${encodeURIComponent(params.channelId)}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bot ${params.botToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      content: params.content,
      components: params.components ?? [],
      allowed_mentions: { parse: [] },
    }),
  })

  const json = (await response.json().catch(() => null)) as { id?: string; message?: string; retry_after?: number } | null
  if (!response.ok) {
    const retry = json?.retry_after ? ` retry_after=${json.retry_after}` : ""
    throw new Error(`Discord returned ${response.status}${retry}: ${json?.message ?? "send failed"}`)
  }
  return String(json?.id ?? "")
}

export async function sendDiscordNotification(params: {
  admin: SupabaseClient
  orgId: string
  eventType: string
  dedupeKey: string
  payload: Record<string, unknown>
  appBaseUrl: string
}) {
  const connection = await loadDiscordConnection(params.admin, { orgId: params.orgId })
  if (!connection || connection.status !== "active") return { ok: false, skipped: true, message: "connection_not_active" }
  if (params.eventType === "summary.morning" && !connection.morning_summary_enabled) return { ok: true, skipped: true, message: "morning_summary_disabled" }
  if (params.eventType === "summary.evening" && !connection.evening_summary_enabled) return { ok: true, skipped: true, message: "evening_summary_disabled" }
  if (!params.eventType.startsWith("summary.") && !connection.immediate_notifications_enabled) return { ok: true, skipped: true, message: "immediate_notifications_disabled" }
  if (params.eventType === "system.incident" && !connection.incident_notifications_enabled) return { ok: true, skipped: true, message: "incident_notifications_disabled" }

  const { data: rule } = await params.admin
    .from("discord_notification_rules")
    .select("enabled")
    .eq("org_id", params.orgId)
    .eq("event_type", params.eventType)
    .maybeSingle()
  if ((rule as { enabled?: boolean } | null)?.enabled === false) return { ok: true, skipped: true, message: "rule_disabled" }

  const insertRes = await params.admin
    .from("discord_delivery_logs")
    .insert({
      org_id: params.orgId,
      notification_id: typeof params.payload.notification_id === "string" ? params.payload.notification_id : null,
      event_type: params.eventType,
      dedupe_key: params.dedupeKey,
      channel_id: connection.channel_id,
      status: "queued",
    })
    .select("id")
    .single()

  if (isUniqueViolation(insertRes.error)) return { ok: true, skipped: true, message: "duplicate_dedupe_key" }
  if (insertRes.error) throw new Error(insertRes.error.message)

  const logId = (insertRes.data as { id: string }).id
  const targetUrl =
    typeof params.payload.app_url === "string" && params.payload.app_url.trim()
      ? params.payload.app_url.trim()
      : absoluteAppUrl(params.appBaseUrl, "/projects")
  const title = trimForDiscord(params.payload.title ?? params.payload.incident_title ?? "通知")
  const due = trimForDiscord(params.payload.due_client_at ?? params.payload.due_editor_at ?? params.payload.occurred_at ?? "")
  const content = params.eventType.startsWith("summary.")
    ? trimForDiscord(params.payload.summary_text ?? "進行サマリです。")
    : [`${title}`, due !== "-" ? `日付: ${due}` : null, "状態が更新されたため通知しています。"].filter(Boolean).join("\n")

  try {
    const botToken = process.env.DISCORD_BOT_TOKEN?.trim()
    if (!botToken) throw new Error("DISCORD_BOT_TOKEN is not configured")
    const messageId = await sendDiscordBotMessage({
      botToken,
      channelId: connection.channel_id,
      content,
      components: actionRows([linkButton("SaaSで開く", targetUrl)]),
    })
    await params.admin
      .from("discord_delivery_logs")
      .update({ status: "sent", discord_message_id: messageId, updated_at: new Date().toISOString() })
      .eq("id", logId)
    await params.admin.from("org_discord_connections").update({ last_error: null, updated_at: new Date().toISOString() }).eq("id", connection.id)
    return { ok: true, skipped: false, messageId }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Discord send failed"
    await params.admin
      .from("discord_delivery_logs")
      .update({ status: "failed", error: message, updated_at: new Date().toISOString() })
      .eq("id", logId)
    await params.admin.from("org_discord_connections").update({ status: "error", last_error: message, updated_at: new Date().toISOString() }).eq("id", connection.id)
    return { ok: false, skipped: false, message }
  }
}

export async function buildDiscordSummary(params: {
  admin: SupabaseClient
  orgId: string
  appBaseUrl: string
  summaryType: "morning" | "evening"
}) {
  const today = todayYmd()
  const tomorrow = addDaysYmd(today, 1)
  const { data, error } = await params.admin
    .from("contents")
    .select("id, title, due_client_at, due_editor_at, status, project_id")
    .eq("org_id", params.orgId)
  if (error) throw new Error(error.message)
  const contents = ((data ?? []) as unknown[]) as Array<{
    id: string
    title: string | null
    due_client_at: string | null
    due_editor_at: string | null
    status: string | null
    project_id?: string | null
  }>
  const incomplete = contents.filter((row) => INCOMPLETE_CONTENT_STATUSES.has(String(row.status ?? "")))
  const editorOverdue = incomplete.filter((row) => row.due_editor_at && row.due_editor_at < today)
  const clientOverdue = incomplete.filter((row) => row.due_client_at && row.due_client_at < today)
  const todayDue = incomplete.filter((row) => row.due_client_at === today)
  const tomorrowDue = incomplete.filter((row) => row.due_client_at === tomorrow)

  const summaryText = [
    "進行サマリ",
    `外注未提出: ${editorOverdue.length}件`,
    `先方納期遅れ: ${clientOverdue.length}件`,
    `今日締切: ${todayDue.length}件`,
    `明日締切: ${tomorrowDue.length}件`,
    "障害中: 0件",
  ].join("\n")

  return sendDiscordNotification({
    admin: params.admin,
    orgId: params.orgId,
    eventType: `summary.${params.summaryType}`,
    dedupeKey: `summary.${params.summaryType}:${today}`,
    payload: { summary_text: summaryText, app_url: absoluteAppUrl(params.appBaseUrl, "/projects") },
    appBaseUrl: params.appBaseUrl,
  })
}

export async function checkDiscordHealth(params: { admin: SupabaseClient; orgId: string }) {
  const connection = await loadDiscordConnection(params.admin, { orgId: params.orgId })
  if (!connection) {
    return { status: "not_connected", guild_connected: false, channel_resolvable: false, bot_can_send: false, last_error: null }
  }

  const botToken = process.env.DISCORD_BOT_TOKEN?.trim()
  if (!botToken) {
    return {
      status: connection.status,
      guild_connected: Boolean(connection.guild_id),
      channel_resolvable: Boolean(connection.channel_id),
      bot_can_send: false,
      last_error: "DISCORD_BOT_TOKEN is not configured",
    }
  }

  try {
    const response = await fetch(`https://discord.com/api/v10/channels/${encodeURIComponent(connection.channel_id)}`, {
      headers: { Authorization: `Bot ${botToken}` },
    })
    const ok = response.ok
    const lastError = ok ? null : `Discord channel check returned ${response.status}`
    await params.admin
      .from("org_discord_connections")
      .update({ status: ok ? "active" : "error", last_healthcheck_at: new Date().toISOString(), last_error: lastError, updated_at: new Date().toISOString() })
      .eq("id", connection.id)
    return { status: ok ? "ok" : "error", guild_connected: Boolean(connection.guild_id), channel_resolvable: ok, bot_can_send: ok, last_error: lastError }
  } catch (error) {
    const lastError = error instanceof Error ? error.message : "Discord health check failed"
    await params.admin
      .from("org_discord_connections")
      .update({ status: "error", last_healthcheck_at: new Date().toISOString(), last_error: lastError, updated_at: new Date().toISOString() })
      .eq("id", connection.id)
    return { status: "error", guild_connected: Boolean(connection.guild_id), channel_resolvable: false, bot_can_send: false, last_error: lastError }
  }
}
