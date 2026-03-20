import { NextRequest, NextResponse } from "next/server"
import { createUserClient, getBearerToken } from "@/lib/userClient"
import { normalizeAppOrgRole } from "@/lib/orgRoles"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

async function getAuth(req: NextRequest) {
  const token = getBearerToken(req)
  if (!token) {
    return { error: NextResponse.json({ ok: false, message: "認証が必要です" }, { status: 401 }) }
  }

  const supabase = createUserClient(token)
  if (!supabase) {
    return {
      error: NextResponse.json(
        { ok: false, message: "Supabase の設定が不足しています" },
        { status: 500 }
      ),
    }
  }

  const { data } = await supabase.auth.getUser(token)
  const userId = data.user?.id ?? null
  if (!userId) {
    return { error: NextResponse.json({ ok: false, message: "認証が必要です" }, { status: 401 }) }
  }

  return { supabase, userId }
}

export async function GET(req: NextRequest) {
  try {
    const auth = await getAuth(req)
    if ("error" in auth) return auth.error

    const { supabase, userId } = auth

    const [profileRes, appUsersRes] = await Promise.all([
      supabase.from("user_profiles").select("display_name, active_org_id").eq("user_id", userId).maybeSingle(),
      supabase.from("app_users").select("org_id, role").eq("user_id", userId),
    ])

    const profile = (profileRes.data ?? null) as {
      display_name?: string | null
      active_org_id?: string | null
    } | null
    const memberships = ((appUsersRes.data ?? []) as { org_id: string; role: string }[])
      .map((row) => {
        const role = normalizeAppOrgRole(row.role)
        if (!role) return null
        return { org_id: row.org_id, role }
      })
      .filter((row): row is { org_id: string; role: "owner" | "executive_assistant" | "member" } => Boolean(row))

    if (memberships.length === 0) {
      return NextResponse.json({
        ok: true,
        profile: {
          display_name: profile?.display_name?.trim() ?? "",
          active_org_id: profile?.active_org_id ?? null,
        },
        orgs: [],
      })
    }

    const orgIds = [...new Set(memberships.map((row) => row.org_id))]
    const { data: orgRows } = await supabase.from("organizations").select("id, name").in("id", orgIds)
    const orgMap = new Map((orgRows ?? []).map((row) => [row.id as string, row.name as string]))

    const orgs = memberships.map((row) => ({
      org_id: row.org_id,
      org_name: orgMap.get(row.org_id) ?? "",
      role: row.role,
    }))

    return NextResponse.json({
      ok: true,
      profile: {
        display_name: profile?.display_name?.trim() ?? "",
        active_org_id: profile?.active_org_id ?? orgs[0]?.org_id ?? null,
      },
      orgs,
    })
  } catch (e) {
    console.error("[auth/my-orgs]", e)
    return NextResponse.json({ ok: false, message: "所属ワークスペースの取得に失敗しました" }, { status: 500 })
  }
}
