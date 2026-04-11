import crypto from "node:crypto"
import type { SupabaseClient } from "@supabase/supabase-js"
import { assertTargetMonth } from "@/lib/monthCloseAutomation"

export type FreeeEntityType = "invoice" | "expense" | "payout" | "payout_batch"

type FreeeSyncInput = {
  admin: SupabaseClient
  orgId: string
  targetMonth: string
  entityType: FreeeEntityType
  ids?: string[]
}

function getEncryptionKey() {
  const raw = process.env.FREEE_TOKEN_ENCRYPTION_KEY?.trim()
  if (!raw) return null
  return crypto.createHash("sha256").update(raw).digest()
}

export function encryptFreeeToken(value: string): string {
  const key = getEncryptionKey()
  if (!key) throw new Error("FREEE_TOKEN_ENCRYPTION_KEY is required")
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv)
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()])
  const tag = cipher.getAuthTag()
  return `v1:${iv.toString("base64")}:${tag.toString("base64")}:${encrypted.toString("base64")}`
}

export async function connectFreee(params: {
  admin: SupabaseClient
  orgId: string
  userId: string
  code: string
  companyId?: string | null
}) {
  const { admin, orgId, userId, code, companyId } = params
  const clientId = process.env.FREEE_CLIENT_ID?.trim()
  const clientSecret = process.env.FREEE_CLIENT_SECRET?.trim()
  const redirectUri = process.env.FREEE_REDIRECT_URI?.trim()
  const tokenUrl = process.env.FREEE_TOKEN_URL?.trim() || "https://accounts.secure.freee.co.jp/public_api/token"

  if (!clientId || !clientSecret || !redirectUri || !getEncryptionKey()) {
    const message = "freee OAuth env is not configured"
    await admin.from("org_freee_connections").upsert(
      {
        org_id: orgId,
        status: "setup_required",
        connected_by_user_id: userId,
        last_error: message,
      },
      { onConflict: "org_id" }
    )
    return { ok: false, status: "setup_required", message }
  }

  const body = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: redirectUri,
    code,
  })

  const res = await fetch(tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  })
  const json = (await res.json().catch(() => null)) as
    | {
        access_token?: string
        refresh_token?: string
        expires_in?: number
        scope?: string
        company_id?: string | number
        error?: string
        error_description?: string
      }
    | null

  if (!res.ok || !json?.access_token || !json?.refresh_token) {
    const message = json?.error_description || json?.error || `freee token exchange failed: ${res.status}`
    await admin.from("org_freee_connections").upsert(
      {
        org_id: orgId,
        status: "error",
        connected_by_user_id: userId,
        last_error: message,
      },
      { onConflict: "org_id" }
    )
    return { ok: false, status: "error", message }
  }

  const expiresAt = new Date(Date.now() + Number(json.expires_in ?? 0) * 1000).toISOString()
  const connectionCompanyId = companyId || (json.company_id == null ? null : String(json.company_id))
  const { error } = await admin.from("org_freee_connections").upsert(
    {
      org_id: orgId,
      company_id: connectionCompanyId,
      status: "active",
      access_token_ciphertext: encryptFreeeToken(json.access_token),
      refresh_token_ciphertext: encryptFreeeToken(json.refresh_token),
      expires_at: expiresAt,
      scope_json: { scope: json.scope ?? null },
      connected_by_user_id: userId,
      last_error: null,
    },
    { onConflict: "org_id" }
  )
  if (error) throw new Error(error.message)
  return { ok: true, status: "active", companyId: connectionCompanyId }
}

async function loadFreeeConnection(admin: SupabaseClient, orgId: string) {
  const { data, error } = await admin
    .from("org_freee_connections")
    .select("id, status, company_id, access_token_ciphertext, expires_at, last_error")
    .eq("org_id", orgId)
    .maybeSingle()
  if (error) throw new Error(error.message)
  return (data ?? null) as Record<string, unknown> | null
}

function entityConfig(entityType: FreeeEntityType) {
  switch (entityType) {
    case "invoice":
      return { table: "invoices", monthColumn: "invoice_month", statusColumn: "freee_sync_status", idColumn: "id" }
    case "expense":
      return { table: "expenses", monthColumn: "target_month", statusColumn: "freee_sync_status", idColumn: "id" }
    case "payout":
      return { table: "payouts", monthColumn: "target_month", statusColumn: "freee_sync_status", idColumn: "id" }
    case "payout_batch":
      return { table: "transfer_batches", monthColumn: "target_month", statusColumn: null, idColumn: "id" }
  }
}

async function loadEntities(params: FreeeSyncInput) {
  const { admin, orgId, targetMonth, entityType, ids } = params
  const config = entityConfig(entityType)
  let query = admin.from(config.table).select("*").eq("org_id", orgId)
  if (ids && ids.length > 0) {
    query = query.in(config.idColumn, ids)
  } else {
    query = query.eq(config.monthColumn, targetMonth)
  }
  const { data, error } = await query
  if (error) throw new Error(error.message)
  return ((data ?? []) as Array<Record<string, unknown>>) || []
}

async function updateEntitySyncStatus(params: {
  admin: SupabaseClient
  orgId: string
  entityType: FreeeEntityType
  entityId: string
  status: "queued" | "synced" | "failed"
  externalId?: string | null
}) {
  const { admin, orgId, entityType, entityId, status, externalId } = params
  const config = entityConfig(entityType)
  if (!config.statusColumn) return
  const payload: Record<string, unknown> = {
    [config.statusColumn]: status,
    freee_synced_at: status === "synced" ? new Date().toISOString() : null,
  }
  if (entityType === "invoice" && externalId) payload.freee_invoice_id = externalId
  if (entityType === "expense" && externalId) payload.freee_expense_id = externalId
  if (entityType === "payout" && externalId) payload.freee_payout_id = externalId
  await admin.from(config.table).update(payload).eq("org_id", orgId).eq("id", entityId)
}

export async function syncFreeeEntities(params: FreeeSyncInput) {
  const { admin, orgId, targetMonth, entityType } = params
  assertTargetMonth(targetMonth)
  const [connection, entities] = await Promise.all([loadFreeeConnection(admin, orgId), loadEntities(params)])
  const dryRunMode = process.env.FREEE_SYNC_MODE !== "local_success"

  let queued = 0
  let synced = 0
  let failed = 0
  const logs: Array<Record<string, unknown>> = []

  for (const entity of entities) {
    const entityId = String(entity.id)
    const requestPayload = {
      company_id: connection?.company_id ?? null,
      entity_type: entityType,
      entity,
    }

    if (!connection || connection.status !== "active" || !connection.access_token_ciphertext) {
      const errorMessage = "freee connection is not active"
      const { data: log } = await admin
        .from("freee_sync_logs")
        .insert({
          org_id: orgId,
          target_month: targetMonth,
          entity_type: entityType,
          entity_id: entityId,
          direction: "outbound",
          status: "failed",
          request_payload: requestPayload,
          error_message: errorMessage,
        })
        .select("id")
        .maybeSingle()
      await updateEntitySyncStatus({ admin, orgId, entityType, entityId, status: "failed" })
      logs.push({ id: (log as { id?: string } | null)?.id ?? null, entityId, status: "failed", error: errorMessage })
      failed += 1
      continue
    }

    if (dryRunMode) {
      const { data: log } = await admin
        .from("freee_sync_logs")
        .insert({
          org_id: orgId,
          target_month: targetMonth,
          entity_type: entityType,
          entity_id: entityId,
          direction: "outbound",
          status: "queued",
          request_payload: requestPayload,
          response_payload: {
            mode: "queued_until_freee_adapter_enabled",
          },
        })
        .select("id")
        .maybeSingle()
      await updateEntitySyncStatus({ admin, orgId, entityType, entityId, status: "queued" })
      logs.push({ id: (log as { id?: string } | null)?.id ?? null, entityId, status: "queued" })
      queued += 1
      continue
    }

    const externalId = `freee_local_${entityType}_${entityId}`
    const { data: log } = await admin
      .from("freee_sync_logs")
      .insert({
        org_id: orgId,
        target_month: targetMonth,
        entity_type: entityType,
        entity_id: entityId,
        direction: "outbound",
        status: "synced",
        request_payload: requestPayload,
        response_payload: { mode: "local_success", external_id: externalId },
        external_id: externalId,
        synced_at: new Date().toISOString(),
      })
      .select("id")
      .maybeSingle()
    await updateEntitySyncStatus({ admin, orgId, entityType, entityId, status: "synced", externalId })
    logs.push({ id: (log as { id?: string } | null)?.id ?? null, entityId, status: "synced", externalId })
    synced += 1
  }

  return {
    ok: true,
    targetMonth,
    entityType,
    queued,
    synced,
    failed,
    logs,
    connectionStatus: connection?.status ?? "missing",
  }
}

export async function retryFreeeSync(params: {
  admin: SupabaseClient
  orgId: string
  targetMonth: string
  logIds?: string[]
}) {
  const { admin, orgId, targetMonth, logIds } = params
  assertTargetMonth(targetMonth)
  let query = admin
    .from("freee_sync_logs")
    .select("id, entity_type, entity_id")
    .eq("org_id", orgId)
    .eq("target_month", targetMonth)
    .eq("status", "failed")
  if (logIds && logIds.length > 0) query = query.in("id", logIds)
  const { data, error } = await query
  if (error) throw new Error(error.message)
  const rows = ((data ?? []) as Array<Record<string, unknown>>) || []
  const results = []
  for (const [entityType, ids] of Object.entries(
    rows.reduce<Record<string, string[]>>((acc, row) => {
      const key = String(row.entity_type)
      acc[key] = acc[key] ?? []
      acc[key].push(String(row.entity_id))
      return acc
    }, {})
  )) {
    if (entityType === "invoice" || entityType === "expense" || entityType === "payout" || entityType === "payout_batch") {
      results.push(await syncFreeeEntities({ admin, orgId, targetMonth, entityType, ids }))
    }
  }
  return { ok: true, retried: rows.length, results }
}
