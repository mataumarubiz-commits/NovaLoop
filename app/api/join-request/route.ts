import { NextRequest, NextResponse } from "next/server"
import { createSupabaseAdmin } from "@/lib/supabaseAdmin"
import { createUserClient, getBearerToken } from "@/lib/userClient"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

async function getUserIdFromToken(req: NextRequest): Promise<string | null> {
  const token = getBearerToken(req)
  if (!token) return null

  const supabase = createUserClient(token)
  if (!supabase) return null

  const {
    data: { user },
  } = await supabase.auth.getUser(token)

  return user?.id ?? null
}

export async function POST(req: NextRequest) {
  try {
    const requesterUserId = await getUserIdFromToken(req)
    if (!requesterUserId) {
      return NextResponse.json({ error: "認証が必要です" }, { status: 401 })
    }

    const body = await req.json().catch(() => ({}))
    const orgId = typeof body?.orgId === "string" ? body.orgId.trim() : null
    const ownerUserId = typeof body?.ownerUserId === "string" ? body.ownerUserId.trim() : null
    const displayNameInOrg =
      typeof body?.displayNameInOrg === "string" ? body.displayNameInOrg.trim() || null : null
    const message = typeof body?.message === "string" ? body.message.trim() || null : null

    if (!orgId || !ownerUserId) {
      return NextResponse.json({ error: "ワークスペース情報が不足しています" }, { status: 400 })
    }

    if (requesterUserId === ownerUserId) {
      return NextResponse.json({ error: "自分自身のワークスペースには申請できません" }, { status: 400 })
    }

    const admin = createSupabaseAdmin()

    const { data: ownerRow } = await admin
      .from("app_users")
      .select("org_id")
      .eq("user_id", ownerUserId)
      .eq("role", "owner")
      .eq("org_id", orgId)
      .maybeSingle()

    if (!ownerRow) {
      return NextResponse.json({ error: "指定されたオーナーのワークスペースが見つかりません" }, { status: 400 })
    }

    let requesterEmail: string | null = null
    try {
      const { data } = await admin.auth.admin.getUserById(requesterUserId)
      requesterEmail = data?.user?.email ?? null
    } catch {
      requesterEmail = null
    }

    const { data: joinRequest, error: insertErr } = await admin
      .from("join_requests")
      .insert({
        org_id: orgId,
        requester_user_id: requesterUserId,
        owner_user_id: ownerUserId,
        status: "pending",
        requested_display_name: displayNameInOrg,
        requester_email: requesterEmail,
        message,
      })
      .select("id")
      .single()

    if (insertErr || !joinRequest) {
      return NextResponse.json(
        { error: insertErr?.message ?? "参加申請の作成に失敗しました" },
        { status: 500 }
      )
    }

    const { data: org } = await admin.from("organizations").select("name").eq("id", orgId).maybeSingle()
    const orgName = (org as { name?: string } | null)?.name ?? ""

    const { error: notificationErr } = await admin.from("notifications").insert({
      org_id: orgId,
      recipient_user_id: ownerUserId,
      type: "membership.requested",
      payload: {
        join_request_id: (joinRequest as { id: string }).id,
        org_id: orgId,
        org_name: orgName,
        requester_user_id: requesterUserId,
      },
    })

    if (notificationErr) {
      await admin.from("join_requests").delete().eq("id", (joinRequest as { id: string }).id)
      return NextResponse.json(
        { error: notificationErr.message ?? "参加申請の通知作成に失敗しました" },
        { status: 500 }
      )
    }

    return NextResponse.json({ success: true, joinRequestId: (joinRequest as { id: string }).id })
  } catch (e) {
    console.error("[join-request]", e)
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "参加申請に失敗しました" },
      { status: 500 }
    )
  }
}
