import { createSupabaseAdmin } from "@/lib/supabaseAdmin"
import type { ExternalActorContext, ExternalChannelType, ExternalActorRole } from "./externalTypes"

const LINK_CODE_PREFIX: Record<Exclude<ExternalChannelType, "internal">, string> = {
  discord: "DSC",
  line: "LIN",
}

type ResolvedUserScope =
  | { linkedUserId: string; orgId: string; role: Exclude<ExternalActorRole, "vendor">; vendorId: null; orgName: string | null }
  | { linkedUserId: string; orgId: string; role: "vendor"; vendorId: string; orgName: string | null }

function normalizeRole(role: string | null | undefined): Exclude<ExternalActorRole, "vendor"> | null {
  if (role === "owner" || role === "executive_assistant" || role === "member") return role
  if (role === "pm" || role === "director" || role === "worker") return "member"
  return null
}

function randomCode(channelType: Exclude<ExternalChannelType, "internal">) {
  return `NOVA-${LINK_CODE_PREFIX[channelType]}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`
}

export async function resolveLinkedUserScope(userId: string): Promise<ResolvedUserScope | null> {
  const admin = createSupabaseAdmin()

  const { data: vendorUser } = await admin
    .from("vendor_users")
    .select("org_id, vendor_id, organization:organizations(name)")
    .eq("user_id", userId)
    .maybeSingle()

  const vendorRow = vendorUser as
    | {
        org_id?: string | null
        vendor_id?: string | null
        organization?: { name?: string | null } | null
      }
    | null

  if (vendorRow?.org_id && vendorRow.vendor_id) {
    return {
      linkedUserId: userId,
      orgId: vendorRow.org_id,
      role: "vendor",
      vendorId: vendorRow.vendor_id,
      orgName: vendorRow.organization?.name?.trim() ?? null,
    }
  }

  const { data: profile } = await admin
    .from("user_profiles")
    .select("active_org_id")
    .eq("user_id", userId)
    .maybeSingle()

  const orgId = (profile as { active_org_id?: string | null } | null)?.active_org_id ?? null
  if (!orgId) return null

  const [{ data: appUser }, { data: org }] = await Promise.all([
    admin.from("app_users").select("role").eq("user_id", userId).eq("org_id", orgId).maybeSingle(),
    admin.from("organizations").select("name").eq("id", orgId).maybeSingle(),
  ])

  const role = normalizeRole((appUser as { role?: string | null } | null)?.role)
  if (!role) return null

  return {
    linkedUserId: userId,
    orgId,
    role,
    vendorId: null,
    orgName: (org as { name?: string | null } | null)?.name?.trim() ?? null,
  }
}

export async function startExternalChannelLink(params: {
  channelType: Exclude<ExternalChannelType, "internal">
  userId: string
}) {
  const resolved = await resolveLinkedUserScope(params.userId)
  if (!resolved) throw new Error("Linkable user context was not found.")

  const admin = createSupabaseAdmin()
  const code = randomCode(params.channelType)
  const expiresAt = new Date(Date.now() + 1000 * 60 * 30).toISOString()

  const { error } = await admin.from("external_channel_links").upsert(
    {
      org_id: resolved.orgId,
      linked_user_id: resolved.linkedUserId,
      vendor_id: resolved.vendorId,
      channel_type: params.channelType,
      role: resolved.role,
      status: "pending",
      link_code: code,
      code_expires_at: expiresAt,
      external_user_id: null,
      external_display_name: null,
      verified_at: null,
      updated_at: new Date().toISOString(),
    },
    {
      onConflict: "org_id,linked_user_id,channel_type",
    }
  )
  if (error) throw new Error(error.message)

  return {
    code,
    expiresAt,
    role: resolved.role,
    orgId: resolved.orgId,
    orgName: resolved.orgName,
    vendorId: resolved.vendorId,
  }
}

export async function confirmExternalChannelLink(params: {
  channelType: Exclude<ExternalChannelType, "internal">
  linkCode: string
  externalUserId: string
  externalDisplayName?: string | null
}) {
  const admin = createSupabaseAdmin()
  const { data: row } = await admin
    .from("external_channel_links")
    .select("id, org_id, linked_user_id, vendor_id, role, code_expires_at, status")
    .eq("channel_type", params.channelType)
    .eq("link_code", params.linkCode)
    .maybeSingle()

  const link = row as
    | {
        id: string
        org_id: string
        linked_user_id: string
        vendor_id?: string | null
        role: ExternalActorRole
        code_expires_at?: string | null
        status: string
      }
    | null

  if (!link || link.status === "revoked") return { ok: false as const, reason: "invalid_code" }
  if (link.code_expires_at && new Date(link.code_expires_at).getTime() < Date.now()) {
    return { ok: false as const, reason: "expired" }
  }

  const { error } = await admin
    .from("external_channel_links")
    .update({
      external_user_id: params.externalUserId,
      external_display_name: params.externalDisplayName ?? null,
      status: "linked",
      verified_at: new Date().toISOString(),
      last_used_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", link.id)

  if (error) {
    if (error.message.includes("external_channel_links_channel_external_idx")) {
      return { ok: false as const, reason: "already_linked" }
    }
    throw new Error(error.message)
  }

  return {
    ok: true as const,
    orgId: link.org_id,
    linkedUserId: link.linked_user_id,
    role: link.role,
    vendorId: link.vendor_id ?? null,
  }
}

export async function revokeExternalChannelLink(params: {
  channelType: Exclude<ExternalChannelType, "internal">
  userId: string
}) {
  const resolved = await resolveLinkedUserScope(params.userId)
  if (!resolved) throw new Error("Linkable user context was not found.")

  const admin = createSupabaseAdmin()
  const { error } = await admin
    .from("external_channel_links")
    .update({
      status: "revoked",
      link_code: null,
      code_expires_at: null,
      updated_at: new Date().toISOString(),
    })
    .eq("org_id", resolved.orgId)
    .eq("linked_user_id", resolved.linkedUserId)
    .eq("channel_type", params.channelType)

  if (error) throw new Error(error.message)
}

export async function listExternalChannelLinks(userId: string) {
  const resolved = await resolveLinkedUserScope(userId)
  if (!resolved) throw new Error("Linkable user context was not found.")

  const admin = createSupabaseAdmin()
  const { data, error } = await admin
    .from("external_channel_links")
    .select("channel_type, external_user_id, external_display_name, role, status, link_code, code_expires_at, verified_at, last_used_at")
    .eq("org_id", resolved.orgId)
    .eq("linked_user_id", resolved.linkedUserId)
    .order("channel_type", { ascending: true })

  if (error) throw new Error(error.message)
  return data ?? []
}

export async function getLinkedActorContext(params: {
  channelType: Exclude<ExternalChannelType, "internal">
  externalUserId: string
}): Promise<ExternalActorContext | null> {
  const admin = createSupabaseAdmin()
  const { data } = await admin
    .from("external_channel_links")
    .select("org_id, linked_user_id, vendor_id, role, external_display_name, status")
    .eq("channel_type", params.channelType)
    .eq("external_user_id", params.externalUserId)
    .maybeSingle()

  const row = data as
    | {
        org_id?: string | null
        linked_user_id?: string | null
        vendor_id?: string | null
        external_display_name?: string | null
        status?: string | null
      }
    | null

  if (!row?.org_id || !row.linked_user_id || row.status !== "linked") return null

  const fresh = await resolveLinkedUserScope(row.linked_user_id)
  if (!fresh || fresh.orgId !== row.org_id) return null

  await admin
    .from("external_channel_links")
    .update({
      last_used_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      role: fresh.role,
      vendor_id: fresh.vendorId,
    })
    .eq("channel_type", params.channelType)
    .eq("external_user_id", params.externalUserId)

  return {
    channelType: params.channelType,
    externalUserId: params.externalUserId,
    linkedUserId: row.linked_user_id,
    orgId: fresh.orgId,
    role: fresh.role,
    vendorId: fresh.vendorId,
    activeOrgName: fresh.orgName,
    linkedDisplayName: row.external_display_name ?? null,
  }
}
