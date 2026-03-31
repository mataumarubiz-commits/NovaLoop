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
