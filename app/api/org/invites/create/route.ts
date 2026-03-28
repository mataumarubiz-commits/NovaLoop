import { NextRequest, NextResponse } from "next/server"
import { createSupabaseAdmin } from "@/lib/supabaseAdmin"
import { getUserIdFromToken, getOrgRole, isOrgAdmin } from "@/lib/apiAuth"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

function randomToken(): string {
  return `${crypto.randomUUID()}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 14)}`
}

export async function POST(req: NextRequest) {
  try {
    const userId = await getUserIdFromToken(req)
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const body = await req.json().catch(() => ({}))
    const orgId = typeof body?.orgId === "string" ? body.orgId.trim() : null
    const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : null
    const roleKey = typeof body?.roleKey === "string" ? body.roleKey.trim() : "member"
    if (!orgId || !email) {
      return NextResponse.json({ error: "orgId and email are required" }, { status: 400 })
    }
    const allowedRoles = ["executive_assistant", "member"]
    const role = allowedRoles.includes(roleKey) ? roleKey : "member"

    const admin = createSupabaseAdmin()
    const callerRole = await getOrgRole(admin, userId, orgId)
    if (!isOrgAdmin(callerRole)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }

    const expiresAt = new Date()
    expiresAt.setDate(expiresAt.getDate() + 7)
    const token = randomToken()

    const { data: invite, error: insertErr } = await admin
      .from("org_invites")
      .insert({
        org_id: orgId,
        email,
        invited_by: userId,
        role_key: role,
        token,
        status: "pending",
        expires_at: expiresAt.toISOString(),
      })
      .select("id, token, expires_at")
      .single()

    if (insertErr || !invite) {
      return NextResponse.json(
        { error: insertErr?.message ?? "Failed to create invite" },
        { status: 500 }
      )
    }

    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || (req.nextUrl.origin || "")
    const inviteLink = `${baseUrl}/invite?token=${(invite as { token: string }).token}`

    return NextResponse.json({
      ok: true,
      inviteId: (invite as { id: string }).id,
      inviteLink,
      expiresAt: (invite as { expires_at: string }).expires_at,
    })
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Server error" },
      { status: 500 }
    )
  }
}
