import { NextRequest, NextResponse } from "next/server"
import { createSupabaseAdmin } from "@/lib/supabaseAdmin"
import { requireOrgPermission } from "@/lib/adminApi"
import { writeAuditLog } from "@/lib/auditLog"
import { updateJoinRequestDecision } from "@/lib/joinRequests"
import { resolveOrgRoleById, resolveOrgRoleByKey, upsertOrgMembership } from "@/lib/orgRoles"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}))
    const requestId = typeof body?.requestId === "string" ? body.requestId.trim() : null
    const requestedRoleId = typeof body?.roleId === "string" ? body.roleId.trim() : null
    if (!requestId) return NextResponse.json({ error: "requestId is required" }, { status: 400 })

    const admin = createSupabaseAdmin()
    let jr: unknown = null
    let fetchErr: { code?: string; message?: string } | null = null

    const primary = await admin
      .from("join_requests")
      .select("id, org_id, owner_user_id, requester_user_id, status, requested_display_name, requested_role, requested_role_id")
      .eq("id", requestId)
      .maybeSingle()

    if (primary.error?.code === "42703") {
      const fallback = await admin
        .from("join_requests")
        .select("id, org_id, owner_user_id, requester_user_id, status, requested_display_name, requested_role")
        .eq("id", requestId)
        .maybeSingle()
      jr = fallback.data
      fetchErr = fallback.error as { code?: string; message?: string } | null
    } else {
      jr = primary.data
      fetchErr = primary.error as { code?: string; message?: string } | null
    }

    const row = jr as {
      org_id?: string
      owner_user_id?: string
      requester_user_id?: string
      status?: string
      requested_display_name?: string | null
      requested_role?: string | null
      requested_role_id?: string | null
    } | null

    if (fetchErr || !row || row.status !== "pending") {
      return NextResponse.json({ error: "Request not found or already decided" }, { status: 400 })
    }

    const orgId = row.org_id as string
    const auth = await requireOrgPermission(req, "members_manage", orgId)
    if (!auth.ok) return auth.response
    const approverId = auth.userId

    const requesterUserId = row.requester_user_id as string
    const displayName = row.requested_display_name?.trim() || null
    const fallbackRoleKey = row.requested_role?.trim() || "member"

    let resolvedRole = requestedRoleId ? await resolveOrgRoleById(admin, orgId, requestedRoleId) : null
    if (!resolvedRole && row.requested_role_id) {
      resolvedRole = await resolveOrgRoleById(admin, orgId, row.requested_role_id)
    }
    if (!resolvedRole) {
      resolvedRole = await resolveOrgRoleByKey(admin, orgId, fallbackRoleKey)
    }
    if (!resolvedRole) {
      resolvedRole = await resolveOrgRoleByKey(admin, orgId, "member")
    }
    if (!resolvedRole || resolvedRole.key === "owner") {
      return NextResponse.json({ error: "Role not found" }, { status: 400 })
    }

    const membershipWrite = await upsertOrgMembership(admin, {
      userId: requesterUserId,
      orgId,
      role: resolvedRole.appRole,
      roleId: resolvedRole.id,
      status: "active",
      displayName,
    })
    if (membershipWrite.error) {
      return NextResponse.json(
        { error: membershipWrite.error.message ?? "Failed to add member" },
        { status: 500 }
      )
    }

    const now = new Date().toISOString()
    const { error: profileUpdateErr } = await admin
      .from("user_profiles")
      .update({ active_org_id: orgId, updated_at: now })
      .eq("user_id", requesterUserId)
    if (profileUpdateErr) {
      console.error("[api/org/requests/approve] failed to update active org", profileUpdateErr)
    }

    const decisionUpdate = await updateJoinRequestDecision(admin, requestId, {
      status: "approved",
      decidedAt: now,
      decidedBy: approverId,
    })
    if (decisionUpdate.error) {
      return NextResponse.json(
        { error: decisionUpdate.error.message ?? "Failed to update join request" },
        { status: 500 }
      )
    }
    if (!decisionUpdate.updated) {
      return NextResponse.json({ error: "Request not found or already decided" }, { status: 409 })
    }

    const { data: org } = await admin.from("organizations").select("name").eq("id", orgId).maybeSingle()
    const orgName = (org as { name?: string } | null)?.name ?? ""

    const { error: notificationErr } = await admin.from("notifications").insert({
      org_id: orgId,
      recipient_user_id: requesterUserId,
      type: "membership.approved",
      payload: {
        org_id: orgId,
        org_name: orgName,
        role: resolvedRole.appRole,
        role_id: resolvedRole.id,
        role_key: resolvedRole.key,
      },
    })
    if (notificationErr) {
      console.error("[api/org/requests/approve] failed to notify requester", notificationErr)
    }

    const ownerUserId = row.owner_user_id
    if (ownerUserId) {
      const { data: ownerNotifs } = await admin
        .from("notifications")
        .select("id, payload")
        .eq("recipient_user_id", ownerUserId)
        .in("type", ["join_request", "membership.requested"])
      const toUpdate = (ownerNotifs ?? []).find(
        (n) => (n.payload as { join_request_id?: string })?.join_request_id === requestId
      )
      if (toUpdate?.id) {
        const payload = { ...(toUpdate.payload as object), resolved: true }
        const { error: ownerNotificationErr } = await admin
          .from("notifications")
          .update({ read_at: now, payload })
          .eq("id", toUpdate.id)
        if (ownerNotificationErr) {
          console.error("[api/org/requests/approve] failed to resolve owner notification", ownerNotificationErr)
        }
      }
    }

    await writeAuditLog(admin, {
      org_id: orgId,
      user_id: approverId,
      action: "membership.approve",
      resource_type: "join_request",
      resource_id: requestId,
      meta: {
        requester_user_id: requesterUserId,
        role: resolvedRole.appRole,
        role_id: resolvedRole.id,
        role_key: resolvedRole.key,
        stored_role: membershipWrite.storedRole,
      },
    })

    return NextResponse.json({ ok: true })
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Server error" },
      { status: 500 }
    )
  }
}
