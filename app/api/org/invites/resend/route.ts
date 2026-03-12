import { NextRequest, NextResponse } from "next/server"
import { createSupabaseAdmin } from "@/lib/supabaseAdmin"
import { getUserIdFromToken, getOrgRole, isOrgAdmin } from "@/lib/apiAuth"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(req: NextRequest) {
  try {
    const userId = await getUserIdFromToken(req)
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const body = await req.json().catch(() => ({}))
    const inviteId = typeof body?.inviteId === "string" ? body.inviteId.trim() : null
    if (!inviteId) return NextResponse.json({ error: "inviteId is required" }, { status: 400 })

    const admin = createSupabaseAdmin()
    const { data: inv } = await admin
      .from("org_invites")
      .select("id, org_id, token, status")
      .eq("id", inviteId)
      .maybeSingle()
    if (!inv || (inv as { status: string }).status !== "pending") {
      return NextResponse.json({ error: "Invite not found or already used" }, { status: 400 })
    }

    const callerRole = await getOrgRole(admin, userId, (inv as { org_id: string }).org_id)
    if (!isOrgAdmin(callerRole)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }

    const expiresAt = new Date()
    expiresAt.setDate(expiresAt.getDate() + 7)

    await admin
      .from("org_invites")
      .update({ expires_at: expiresAt.toISOString() })
      .eq("id", inviteId)

    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || req.nextUrl?.origin || ""
    const inviteLink = `${baseUrl}/invite?token=${(inv as { token: string }).token}`

    return NextResponse.json({
      ok: true,
      inviteLink,
      expiresAt: expiresAt.toISOString(),
    })
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Server error" },
      { status: 500 }
    )
  }
}
