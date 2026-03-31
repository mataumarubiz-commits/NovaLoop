import { NextRequest, NextResponse } from "next/server"
import { createUserClient, getBearerToken } from "@/lib/userClient"
import { normalizeAppOrgRole } from "@/lib/orgRoles"
import { buildOrgPermissions } from "@/lib/orgRolePermissions"

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
      supabase.from("app_users").select("org_id, role, role_id").eq("user_id", userId),
    ])

    const profile = (profileRes.data ?? null) as {
      display_name?: string | null
      active_org_id?: string | null
    } | null
    const appUsers = ((appUsersRes.data ?? []) as { org_id: string; role: string; role_id?: string | null }[])
    const roleIds = Array.from(new Set(appUsers.map((row) => row.role_id).filter((value): value is string => Boolean(value))))
    const rolePermissionMap = new Map<string, Record<string, unknown> | null>()
    if (roleIds.length > 0) {
      const { data: orgRoleRows } = await supabase.from("org_roles").select("id, permissions").in("id", roleIds)
      for (const row of (orgRoleRows ?? []) as Array<{ id: string; permissions?: Record<string, unknown> | null }>) {
        rolePermissionMap.set(row.id, row.permissions ?? null)
      }
    }

    const memberships = appUsers
      .map((row) => {
        const role = normalizeAppOrgRole(row.role)
        if (!role) return null
        return {
          org_id: row.org_id,
          role,
          role_id: row.role_id ?? null,
          permissions: buildOrgPermissions(role, row.role_id ? rolePermissionMap.get(row.role_id) ?? null : null),
        }
      })
      .filter(
        (
          row
        ): row is {
          org_id: string
          role: "owner" | "executive_assistant" | "member"
          role_id: string | null
          permissions: ReturnType<typeof buildOrgPermissions>
        } => Boolean(row)
      )

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
      roleId: row.role_id,
      permissions: row.permissions,
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
