import { NextRequest, NextResponse } from "next/server"
import { createUserClient, getBearerToken } from "@/lib/userClient"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

function unauthorized(message = "認証が必要です") {
  return NextResponse.json({ ok: false, message }, { status: 401 })
}

async function getAuth(req: NextRequest) {
  const token = getBearerToken(req)
  if (!token) return { error: unauthorized() }

  const supabase = createUserClient(token)
  if (!supabase) {
    return {
      error: NextResponse.json({ ok: false, message: "Supabase の設定が不足しています" }, { status: 500 }),
    }
  }

  const { data } = await supabase.auth.getUser(token)
  const userId = data.user?.id ?? null
  if (!userId) return { error: unauthorized() }

  return { supabase, userId }
}

export type SettingsInitialData = {
  profileDisplayName: string
  orgDisplayName: string | null
  activeOrgId: string | null
  activeOrgName: string
  role: string | null
}

export async function GET(req: NextRequest) {
  try {
    const auth = await getAuth(req)
    if ("error" in auth) return auth.error

    const { supabase, userId } = auth

    const { data: profile } = await supabase
      .from("user_profiles")
      .select("display_name, active_org_id")
      .eq("user_id", userId)
      .maybeSingle()

    const profileDisplayName = (profile?.display_name ?? "").trim() || ""
    const activeOrgId = profile?.active_org_id ?? null

    const { data: appUsersRows } = await supabase
      .from("app_users")
      .select("org_id, role, display_name")
      .eq("user_id", userId)

    const rows = (appUsersRows ?? []) as { org_id: string; role: string; display_name: string | null }[]
    const orgIds = [...new Set(rows.map((row) => row.org_id))]

    let activeOrgName = ""
    let role: string | null = null
    let orgDisplayName: string | null = null

    if (orgIds.length > 0) {
      const { data: orgs } = await supabase.from("organizations").select("id, name").in("id", orgIds)
      const orgMap = new Map<string, string>()
      ;(orgs ?? []).forEach((row) => orgMap.set((row as { id: string }).id, (row as { name: string }).name))

      const currentRow = activeOrgId ? rows.find((row) => row.org_id === activeOrgId) : rows[0]
      if (currentRow) {
        role = currentRow.role
        orgDisplayName = currentRow.display_name?.trim() || null
        activeOrgName = orgMap.get(currentRow.org_id) ?? ""
      }
    }

    const data: SettingsInitialData = {
      profileDisplayName,
      orgDisplayName,
      activeOrgId,
      activeOrgName,
      role,
    }

    return NextResponse.json(data, { status: 200 })
  } catch (e) {
    console.error("[api/me] GET unexpected error", e)
    return NextResponse.json({ ok: false, message: "設定情報の取得に失敗しました" }, { status: 500 })
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const auth = await getAuth(req)
    if ("error" in auth) return auth.error

    const { supabase, userId } = auth
    const body = await req.json().catch(() => ({}))

    const displayName = typeof body.display_name === "string" ? body.display_name.trim() : undefined
    const orgDisplayName = typeof body.org_display_name === "string" ? body.org_display_name.trim() : undefined
    const orgId = typeof body.org_id === "string" && body.org_id.length > 0 ? body.org_id : undefined
    const now = new Date().toISOString()

    if (displayName !== undefined) {
      const { error: profileErr } = await supabase
        .from("user_profiles")
        .upsert({ user_id: userId, display_name: displayName, updated_at: now }, { onConflict: "user_id" })

      if (profileErr) {
        console.error("[api/me] user_profiles upsert failed", profileErr)
        return NextResponse.json({ ok: false, message: "プロフィール名の保存に失敗しました" }, { status: 500 })
      }

      const { error: appErr } = await supabase.from("app_users").update({ display_name: displayName }).eq("user_id", userId)
      if (appErr) {
        console.error("[api/me] app_users update failed", appErr)
        return NextResponse.json({ ok: false, message: "プロフィール名の反映に失敗しました" }, { status: 500 })
      }
    }

    if (orgDisplayName !== undefined && orgId) {
      const { error: appErr } = await supabase
        .from("app_users")
        .update({ display_name: orgDisplayName })
        .eq("user_id", userId)
        .eq("org_id", orgId)

      if (appErr) {
        console.error("[api/me] app_users org_display_name update failed", appErr)
        return NextResponse.json({ ok: false, message: "ワークスペース表示名の保存に失敗しました" }, { status: 500 })
      }
    }

    return NextResponse.json({ ok: true }, { status: 200 })
  } catch (e) {
    console.error("[api/me] unexpected error", e)
    return NextResponse.json({ ok: false, message: "設定の保存に失敗しました" }, { status: 500 })
  }
}
