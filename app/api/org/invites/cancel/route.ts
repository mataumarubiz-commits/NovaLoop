import { NextRequest, NextResponse } from "next/server"
import { createSupabaseAdmin } from "@/lib/supabaseAdmin"
import { requireOrgPermission } from "@/lib/adminApi"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}))
    const inviteId = typeof body?.inviteId === "string" ? body.inviteId.trim() : null
    if (!inviteId) return NextResponse.json({ error: "inviteId is required" }, { status: 400 })

    const admin = createSupabaseAdmin()
    const { data: inv } = await admin
      .from("org_invites")
      .select("id, org_id, status")
      .eq("id", inviteId)
      .maybeSingle()
    if (!inv || (inv as { status: string }).status !== "pending") {
      return NextResponse.json({ error: "Invite not found or already used" }, { status: 400 })
    }

    const orgId = (inv as { org_id: string }).org_id
    const auth = await requireOrgPermission(req, "members_manage", orgId)
    if (!auth.ok) return auth.response

    await admin
      .from("org_invites")
      .update({ status: "cancelled" })
      .eq("id", inviteId)

    return NextResponse.json({ ok: true })
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Server error" },
      { status: 500 }
    )
  }
}
