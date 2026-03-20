import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js"

function isMissingDecidedByError(error: PostgrestError | null) {
  if (!error?.message) return false
  return error.message.includes("join_requests.decided_by") || error.message.includes("decided_by")
}

export async function updateJoinRequestDecision(
  admin: SupabaseClient,
  requestId: string,
  input: {
    status: "approved" | "rejected"
    decidedAt: string
    decidedBy: string
  }
) {
  const primaryResult = await admin
    .from("join_requests")
    .update({
      status: input.status,
      decided_at: input.decidedAt,
      decided_by: input.decidedBy,
    })
    .eq("id", requestId)
    .select("id")
    .maybeSingle()

  if (!isMissingDecidedByError(primaryResult.error)) {
    return {
      error: primaryResult.error,
      updated: Boolean((primaryResult.data as { id?: string } | null)?.id),
    }
  }

  const fallbackResult = await admin
    .from("join_requests")
    .update({
      status: input.status,
      decided_at: input.decidedAt,
    })
    .eq("id", requestId)
    .select("id")
    .maybeSingle()

  return {
    error: fallbackResult.error,
    updated: Boolean((fallbackResult.data as { id?: string } | null)?.id),
  }
}
