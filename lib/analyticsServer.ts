import { createSupabaseAdmin } from "@/lib/supabaseAdmin"
import type { AnalyticsEventInput } from "@/lib/analytics"

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
