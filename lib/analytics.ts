import { createSupabaseAdmin } from "@/lib/supabaseAdmin"
import { supabase } from "@/lib/supabase"

export type AnalyticsEventInput = {
  orgId: string
  userId: string
  role?: string | null
  eventName: string
  source?: string | null
  entityType?: string | null
  entityId?: string | null
  metadata?: Record<string, unknown>
}

export async function trackServerEvent(input: AnalyticsEventInput) {
  const admin = createSupabaseAdmin()
  const { error } = await admin.from("analytics_events").insert({
    org_id: input.orgId,
    user_id: input.userId,
    role: input.role ?? null,
    event_name: input.eventName,
    source: input.source ?? null,
    entity_type: input.entityType ?? null,
    entity_id: input.entityId ?? null,
    metadata: input.metadata ?? {},
  })
  if (error) {
    console.error("[analytics] server insert failed", error)
  }
}

export async function trackClientEvent(
  eventName: string,
  payload: {
    source?: string
    entityType?: string
    entityId?: string
    metadata?: Record<string, unknown>
  } = {}
) {
  const { data } = await supabase.auth.getSession()
  const token = data.session?.access_token
  if (!token) return

  await fetch("/api/analytics/track", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      event_name: eventName,
      source: payload.source,
      entity_type: payload.entityType,
      entity_id: payload.entityId,
      metadata: payload.metadata ?? {},
    }),
  }).catch(() => null)
}
