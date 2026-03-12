import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"
import { createSupabaseAdmin } from "@/lib/supabaseAdmin"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

async function getUserIdFromToken(req: NextRequest): Promise<string | null> {
  const authHeader = req.headers.get("Authorization")
  const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7).trim() : null
  if (!token) return null
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !anonKey) return null
  const supabase = createClient(url, anonKey)
  const { data } = await supabase.auth.getUser(token)
  return data?.user?.id ?? null
}

export async function POST(req: NextRequest) {
  try {
    const ownerUserId = await getUserIdFromToken(req)
    if (!ownerUserId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const body = await req.json()
    const joinRequestId = typeof body?.joinRequestId === "string" ? body.joinRequestId.trim() : null
    if (!joinRequestId) return NextResponse.json({ error: "joinRequestId is required" }, { status: 400 })

    const admin = createSupabaseAdmin()
    const { data: jr } = await admin
      .from("join_requests")
      .select("owner_user_id, requester_user_id, org_id, status")
      .eq("id", joinRequestId)
      .maybeSingle()
    const row = jr as { owner_user_id?: string; requester_user_id?: string; org_id?: string; status?: string } | null
    if (!row || row.owner_user_id !== ownerUserId) return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    if (row.status !== "pending") return NextResponse.json({ error: "Request already decided" }, { status: 400 })

    const now = new Date().toISOString()
    await admin
      .from("join_requests")
      .update({ status: "rejected", decided_at: now })
      .eq("id", joinRequestId)

    if (row.requester_user_id && row.org_id) {
      const { data: org } = await admin.from("organizations").select("name").eq("id", row.org_id).maybeSingle()
      const orgName = (org as { name?: string } | null)?.name ?? ""
      await admin.from("notifications").insert({
        org_id: row.org_id,
        recipient_user_id: row.requester_user_id,
        type: "membership.rejected",
        payload: { org_id: row.org_id, org_name: orgName, join_request_id: joinRequestId },
      })
    }

    // オーナー側の参加申請通知を既読・完了にし「既読済み完了」タブに移す
    const { data: ownerNotifs } = await admin
      .from("notifications")
      .select("id, payload")
      .eq("recipient_user_id", ownerUserId)
      .in("type", ["join_request", "membership.requested"])
    const toUpdate = (ownerNotifs ?? []).find((n) => (n.payload as { join_request_id?: string })?.join_request_id === joinRequestId)
    if (toUpdate?.id) {
      const payload = { ...(toUpdate.payload as object), resolved: true }
      await admin.from("notifications").update({ read_at: now, payload }).eq("id", toUpdate.id)
    }

    return NextResponse.json({ success: true })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Server error" }, { status: 500 })
  }
}
