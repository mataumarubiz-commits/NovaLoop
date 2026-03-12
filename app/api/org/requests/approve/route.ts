import { NextRequest, NextResponse } from "next/server"
import { createSupabaseAdmin } from "@/lib/supabaseAdmin"
import { getUserIdFromToken, getOrgRole, isOrgAdmin } from "@/lib/apiAuth"
import { writeAuditLog } from "@/lib/auditLog"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const ALLOWED_ROLES = ["owner", "executive_assistant", "member"] as const

export async function POST(req: NextRequest) {
  try {
    const approverId = await getUserIdFromToken(req)
    if (!approverId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const body = await req.json().catch(() => ({}))
    const requestId = typeof body?.requestId === "string" ? body.requestId.trim() : null
    const roleKey =
    typeof body?.roleKey === "string" && (ALLOWED_ROLES as readonly string[]).includes(body.roleKey)
      ? body.roleKey
      : "member"
    if (!requestId) return NextResponse.json({ error: "requestId is required" }, { status: 400 })

    const admin = createSupabaseAdmin()
    const { data: jr, error: fetchErr } = await admin
      .from("join_requests")
      .select("id, org_id, owner_user_id, requester_user_id, status, requested_display_name")
      .eq("id", requestId)
      .maybeSingle()

    const row = jr as { org_id?: string; owner_user_id?: string; requester_user_id?: string; status?: string; requested_display_name?: string | null } | null
    if (fetchErr || !row || row.status !== "pending") {
      return NextResponse.json({ error: "Request not found or already decided" }, { status: 400 })
    }

    const orgId = row.org_id as string
    const callerRole = await getOrgRole(admin, approverId, orgId)
    if (!isOrgAdmin(callerRole)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }

    const requesterUserId = row.requester_user_id as string
    const displayName = row.requested_display_name?.trim() || null

    const { error: upsertErr } = await admin.from("app_users").upsert(
      {
        user_id: requesterUserId,
        org_id: orgId,
        role: roleKey,
        status: "active",
        display_name: displayName,
      },
      { onConflict: "user_id,org_id" }
    )
    if (upsertErr) {
      return NextResponse.json(
        { error: upsertErr.message ?? "Failed to add member" },
        { status: 500 }
      )
    }

    const now = new Date().toISOString()
    await admin
      .from("user_profiles")
      .update({ active_org_id: orgId, updated_at: now })
      .eq("user_id", requesterUserId)

    await admin
      .from("join_requests")
      .update({ status: "approved", decided_at: now, decided_by: approverId })
      .eq("id", requestId)

    const { data: org } = await admin.from("organizations").select("name").eq("id", orgId).maybeSingle()
    const orgName = (org as { name?: string } | null)?.name ?? ""

    await admin.from("notifications").insert({
      org_id: orgId,
      recipient_user_id: requesterUserId,
      type: "membership.approved",
      payload: { org_id: orgId, org_name: orgName, role: roleKey },
    })

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
        await admin.from("notifications").update({ read_at: now, payload }).eq("id", toUpdate.id)
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
        role: roleKey,
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
