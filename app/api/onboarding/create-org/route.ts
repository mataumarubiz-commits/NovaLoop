import { randomUUID } from "crypto"
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
    const userId = await getUserIdFromToken(req)
    if (!userId) {
      return NextResponse.json({ error: "認証が必要です" }, { status: 401 })
    }

    const body = await req.json().catch(() => ({}))
    const type = body?.type === "personal" ? "personal" : body?.type === "new_org" ? "new_org" : null

    if (!type) {
      return NextResponse.json({ error: "作成種別が不正です" }, { status: 400 })
    }

    const workspaceName = typeof body?.workspaceName === "string" ? body.workspaceName.trim() : ""
    const orgName = typeof body?.orgName === "string" ? body.orgName.trim() : ""
    const displayNameInOrg =
      typeof body?.displayNameInOrg === "string" ? body.displayNameInOrg.trim() || null : null

    const name = type === "personal" ? workspaceName || "個人ワークスペース" : orgName
    if (!name) {
      return NextResponse.json(
        {
          error: type === "new_org" ? "ワークスペース名を入力してください" : "個人ワークスペース名を入力してください",
        },
        { status: 400 }
      )
    }

    const admin = createSupabaseAdmin()
    const orgId = randomUUID()
    const now = new Date().toISOString()

    const { error: orgErr } = await admin.from("organizations").insert({ id: orgId, name })
    if (orgErr) {
      return NextResponse.json({ error: orgErr.message || "ワークスペースの作成に失敗しました" }, { status: 500 })
    }

    const { error: memberErr } = await admin.from("app_users").insert({
      id: randomUUID(),
      user_id: userId,
      org_id: orgId,
      role: "owner",
      status: "active",
      display_name: displayNameInOrg,
    })

    if (memberErr) {
      await admin.from("organizations").delete().eq("id", orgId)
      return NextResponse.json({ error: memberErr.message || "メンバー追加に失敗しました" }, { status: 500 })
    }

    const { error: profileErr } = await admin
      .from("user_profiles")
      .update({ active_org_id: orgId, updated_at: now })
      .eq("user_id", userId)

    if (profileErr) {
      await admin.from("user_profiles").upsert(
        { user_id: userId, active_org_id: orgId, updated_at: now, display_name: "" },
        { onConflict: "user_id" }
      )
    }

    return NextResponse.json({ success: true, orgId })
  } catch (e) {
    console.error("[onboarding/create-org]", e)
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "ワークスペース作成中にエラーが発生しました" },
      { status: 500 }
    )
  }
}
