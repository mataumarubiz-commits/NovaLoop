import { createSupabaseAdmin } from "@/lib/supabaseAdmin"

export async function notifyAdminRoles(params: {
  orgId: string
  type: string
  payload: Record<string, unknown>
}) {
  const admin = createSupabaseAdmin()
  const { data: recipients } = await admin
    .from("app_users")
    .select("user_id")
    .eq("org_id", params.orgId)
    .in("role", ["owner", "executive_assistant"])

  const userIds = Array.from(new Set(((recipients ?? []) as Array<{ user_id: string }>).map((row) => row.user_id).filter(Boolean)))
  if (userIds.length === 0) return

  await admin.from("notifications").insert(
    userIds.map((userId) => ({
      recipient_user_id: userId,
      type: params.type,
      payload: params.payload,
    }))
  )
}

export async function notifyVendorUser(params: {
  orgId: string
  vendorId: string
  type: string
  payload: Record<string, unknown>
}) {
  const admin = createSupabaseAdmin()
  const { data: vendorUser } = await admin
    .from("vendor_users")
    .select("user_id")
    .eq("org_id", params.orgId)
    .eq("vendor_id", params.vendorId)
    .maybeSingle()

  const userId = (vendorUser as { user_id?: string | null } | null)?.user_id ?? null
  if (!userId) return

  await admin.from("notifications").insert({
    recipient_user_id: userId,
    type: params.type,
    payload: params.payload,
  })
}
