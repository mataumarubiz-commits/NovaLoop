import { createSupabaseAdmin } from "@/lib/supabaseAdmin"
import type { ExternalActorContext, ExternalChannelType, InternalToolName } from "./externalTypes"

export async function writeExternalAiAuditLog(params: {
  channelType: ExternalChannelType
  externalUserId: string | null
  actor: ExternalActorContext | null
  userMessage: string
  selectedTools: InternalToolName[]
  toolResultSummary: Record<string, unknown>
  aiResponse: string | null
  status: "completed" | "denied" | "unlinked" | "error"
  errorMessage?: string | null
}) {
  const admin = createSupabaseAdmin()
  await admin.from("ai_chat_audit_logs").insert({
    channel_type: params.channelType,
    external_user_id: params.externalUserId,
    linked_user_id: params.actor?.linkedUserId ?? null,
    org_id: params.actor?.orgId ?? null,
    role: params.actor?.role ?? null,
    vendor_id: params.actor?.vendorId ?? null,
    user_message: params.userMessage,
    selected_tools: params.selectedTools,
    tool_result_summary: params.toolResultSummary,
    ai_response: params.aiResponse,
    status: params.status,
    error_message: params.errorMessage ?? null,
  })
}
