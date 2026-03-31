import { NextRequest, NextResponse } from "next/server"
import { createSupabaseAdmin } from "@/lib/supabaseAdmin"
import { requireOrgPermission } from "@/lib/adminApi"
import { writeAuditLog } from "@/lib/auditLog"
import { updateJoinRequestDecision } from "@/lib/joinRequests"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}))
    const requestId = typeof body?.requestId === "string" ? body.requestId.trim() : null
    if (!requestId) return NextResponse.json({ error: "requestId is required" }, { status: 400 })

    const admin = createSupabaseAdmin()
    const { data: jr, error: fetchErr } = await admin
      .from("join_requests")
      .select("id, org_id, owner_user_id, requester_user_id, status")
      .eq("id", requestId)
      .maybeSingle()
    const row = jr as { org_id?: string; owner_user_id?: string; requester_user_id?: string; status?: string } | null
    if (fetchErr || !row || row.status !== "pending") {
      return NextResponse.json({ error: "Request not found or already decided" }, { status: 400 })
    }

    const orgId = row.org_id as string
    const auth = await requireOrgPermission(req, "members_manage", orgId)
    if (!auth.ok) return auth.response
    const userId = auth.userId

    const now = new Date().toISOString()
    const decisionUpdate = await updateJoinRequestDecision(admin, requestId, {
      status: "rejected",
      decidedAt: now,
      decidedBy: userId,
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

    if (row.requester_user_id && row.org_id) {
      const { data: org } = await admin.from("organizations").select("name").eq("id", row.org_id).maybeSingle()
      const orgName = (org as { name?: string } | null)?.name ?? ""
      const { error: notificationErr } = await admin.from("notifications").insert({
        org_id: row.org_id,
        recipient_user_id: row.requester_user_id,
        type: "membership.rejected",
        payload: { org_id: row.org_id, org_name: orgName, join_request_id: requestId },
      })
      if (notificationErr) {
        console.error("[api/org/requests/reject] failed to notify requester", notificationErr)
      }
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
          console.error("[api/org/requests/reject] failed to resolve owner notification", ownerNotificationErr)
        }
      }
    }

    await writeAuditLog(admin, {
      org_id: row.org_id as string,
      user_id: userId,
      action: "membership.reject",
      resource_type: "join_request",
      resource_id: requestId,
      meta: {
        requester_user_id: row.requester_user_id ?? null,
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
