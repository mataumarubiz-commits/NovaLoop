import { NextRequest, NextResponse } from "next/server"
import { createSupabaseAdmin } from "@/lib/supabaseAdmin"
import { getUserIdFromToken, getOrgRole, isOrgAdmin } from "@/lib/apiAuth"
import { writeAuditLog } from "@/lib/auditLog"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(req: NextRequest) {
  try {
    const userId = await getUserIdFromToken(req)
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const body = await req.json().catch(() => ({}))
    const requestId = typeof body?.requestId === "string" ? body.requestId.trim() : null
    if (!requestId) return NextResponse.json({ error: "requestId is required" }, { status: 400 })

    const admin = createSupabaseAdmin()
    const { data: jr } = await admin
      .from("join_requests")
      .select("id, org_id, owner_user_id, requester_user_id, status")
      .eq("id", requestId)
      .maybeSingle()
    const row = jr as { org_id?: string; owner_user_id?: string; requester_user_id?: string; status?: string } | null
    if (!row || row.status !== "pending") {
      return NextResponse.json({ error: "Request not found or already decided" }, { status: 400 })
    }

    const callerRole = await getOrgRole(admin, userId, row.org_id as string)
    if (!isOrgAdmin(callerRole)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }

    const now = new Date().toISOString()
    await admin
      .from("join_requests")
      .update({ status: "rejected", decided_at: now, decided_by: userId })
      .eq("id", requestId)

    if (row.requester_user_id && row.org_id) {
      const { data: org } = await admin.from("organizations").select("name").eq("id", row.org_id).maybeSingle()
      const orgName = (org as { name?: string } | null)?.name ?? ""
      await admin.from("notifications").insert({
        org_id: row.org_id,
        recipient_user_id: row.requester_user_id,
        type: "membership.rejected",
        payload: { org_id: row.org_id, org_name: orgName, join_request_id: requestId },
      })
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
        await admin.from("notifications").update({ read_at: now, payload }).eq("id", toUpdate.id)
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
