import { NextRequest, NextResponse } from "next/server"
import { createSupabaseAdmin } from "@/lib/supabaseAdmin"
import { getUserIdFromToken } from "@/lib/apiAuth"
import { normalizeAppOrgRole, upsertOrgMembership } from "@/lib/orgRoles"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(req: NextRequest) {
  try {
    const userId = await getUserIdFromToken(req)
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const body = await req.json().catch(() => ({}))
    const token = typeof body?.token === "string" ? body.token.trim() : null
    const displayName = typeof body?.displayName === "string" ? body.displayName.trim() || null : null
    if (!token) return NextResponse.json({ error: "token is required" }, { status: 400 })

    const admin = createSupabaseAdmin()
    const { data: inv, error: fetchErr } = await admin
      .from("org_invites")
      .select("id, org_id, email, role_key, status, expires_at")
      .eq("token", token)
      .maybeSingle()

    if (fetchErr || !inv) {
      return NextResponse.json({ error: "招待が見つかりません" }, { status: 404 })
    }
    const row = inv as { status: string; expires_at: string; org_id: string; role_key: string }
    if (row.status !== "pending") {
      return NextResponse.json({ error: "この招待はすでに使用済みか無効です" }, { status: 400 })
    }
    if (new Date(row.expires_at) < new Date()) {
      await admin.from("org_invites").update({ status: "expired" }).eq("id", (inv as { id: string }).id)
      return NextResponse.json({ error: "招待の有効期限が切れています" }, { status: 400 })
    }

    const orgId = row.org_id
    const roleKey = normalizeAppOrgRole(row.role_key) ?? "member"

    const membershipWrite = await upsertOrgMembership(admin, {
      userId,
      orgId,
      role: roleKey,
      status: "active",
      displayName,
    })
    if (membershipWrite.error) {
      return NextResponse.json(
        { error: membershipWrite.error.message ?? "参加に失敗しました" },
        { status: 500 }
      )
    }

    await admin
      .from("user_profiles")
      .update({ active_org_id: orgId, updated_at: new Date().toISOString() })
      .eq("user_id", userId)

    await admin
      .from("org_invites")
      .update({ status: "accepted" })
      .eq("id", (inv as { id: string }).id)

    return NextResponse.json({ ok: true, orgId })
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Server error" },
      { status: 500 }
    )
  }
}
