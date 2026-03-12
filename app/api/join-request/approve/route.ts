import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"
import { createSupabaseAdmin } from "@/lib/supabaseAdmin"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const ALLOWED_ROLES = ["executive_assistant", "none"] as const

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

/**
 * POST { joinRequestId: string, role: 'executive_assistant' | 'none' }
 * Owner only. Approves request, inserts app_users, updates join_requests, notifies requester.
 */
export async function POST(req: NextRequest) {
  try {
    const ownerUserId = await getUserIdFromToken(req)
    if (!ownerUserId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const body = await req.json()
    const joinRequestId = typeof body?.joinRequestId === "string" ? body.joinRequestId.trim() : null
    const role = typeof body?.role === "string" && ALLOWED_ROLES.includes(body.role as (typeof ALLOWED_ROLES)[number]) ? body.role : "none"
    if (!joinRequestId) {
      return NextResponse.json({ error: "joinRequestId is required" }, { status: 400 })
    }

    const admin = createSupabaseAdmin()
    const { data: jr, error: fetchErr } = await admin
      .from("join_requests")
      .select("id, org_id, requester_user_id, owner_user_id, status, requested_display_name")
      .eq("id", joinRequestId)
      .maybeSingle()
    const row = jr as { owner_user_id?: string; requester_user_id?: string; org_id?: string; status?: string; requested_display_name?: string | null } | null

    // 申請が見つからない or すでに決済済みの場合は、対応する通知を完了状態にして静かに成功扱いにする
    if (fetchErr || !row || row.owner_user_id !== ownerUserId || row.status !== "pending") {
      const notifNow = new Date().toISOString()
      const { data: ownerNotifs } = await admin
        .from("notifications")
        .select("id, payload")
        .eq("recipient_user_id", ownerUserId)
        .in("type", ["join_request", "membership.requested"])
      const toUpdate = (ownerNotifs ?? []).find((n) => (n.payload as { join_request_id?: string })?.join_request_id === joinRequestId)
      if (toUpdate?.id) {
        const payload = { ...(toUpdate.payload as object), resolved: true }
        await admin.from("notifications").update({ read_at: notifNow, payload }).eq("id", toUpdate.id)
      }
      return NextResponse.json({ success: true, alreadyDecided: true })
    }

    const requesterUserId = row.requester_user_id as string
    const orgId = row.org_id as string

    const displayName = row.requested_display_name?.trim() || null
    const { error: upsertErr } = await admin.from("app_users").upsert(
      {
        user_id: requesterUserId,
        org_id: orgId,
        role,
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

    // 承認された組織を現在のアクティブ組織として扱えるよう、user_profiles.active_org_id を更新
    const now = new Date().toISOString()
    await admin
      .from("user_profiles")
      .update({ active_org_id: orgId, updated_at: now })
      .eq("user_id", requesterUserId)

    await admin
      .from("join_requests")
      .update({ status: "approved", decided_at: new Date().toISOString() })
      .eq("id", joinRequestId)

    const { data: org } = await admin.from("organizations").select("name").eq("id", orgId).maybeSingle()
    const orgName = (org as { name?: string } | null)?.name ?? ""

    await admin.from("notifications").insert({
      org_id: orgId,
      recipient_user_id: requesterUserId,
      type: "membership.approved",
      payload: { org_id: orgId, org_name: orgName, role },
    })

    // オーナー側の参加申請通知を既読・完了にし「既読済み完了」タブに移す
    const notifNow = new Date().toISOString()
    const { data: ownerNotifs } = await admin
      .from("notifications")
      .select("id, payload")
      .eq("recipient_user_id", ownerUserId)
      .in("type", ["join_request", "membership.requested"])
    const toUpdate = (ownerNotifs ?? []).find((n) => (n.payload as { join_request_id?: string })?.join_request_id === joinRequestId)
    if (toUpdate?.id) {
      const payload = { ...(toUpdate.payload as object), resolved: true }
      await admin.from("notifications").update({ read_at: notifNow, payload }).eq("id", toUpdate.id)
    }

    return NextResponse.json({ success: true })
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Server error" },
      { status: 500 }
    )
  }
}
