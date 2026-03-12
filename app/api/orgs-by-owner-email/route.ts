import { NextRequest, NextResponse } from "next/server"
import { createSupabaseAdmin } from "@/lib/supabaseAdmin"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * POST { ownerEmail: string }
 * Returns { ownerUserId: string, orgs: [{ id, name }] } for orgs where that user is owner.
 * Uses service role to resolve email -> user_id and list owner's orgs.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const ownerEmail = typeof body?.ownerEmail === "string" ? body.ownerEmail.trim().toLowerCase() : null
    if (!ownerEmail) {
      return NextResponse.json({ error: "ownerEmail is required" }, { status: 400 })
    }

    const admin = createSupabaseAdmin()
    const { data: list } = await admin.auth.admin.listUsers({ perPage: 1000 })
    const owner = list?.users?.find((u) => u.email?.toLowerCase() === ownerEmail)
    if (!owner?.id) {
      return NextResponse.json({ error: "User not found with that email", ownerUserId: null, orgs: [] }, { status: 200 })
    }

    const { data: memberships } = await admin
      .from("app_users")
      .select("org_id")
      .eq("user_id", owner.id)
      .eq("role", "owner")
    if (!memberships?.length) {
      return NextResponse.json({ ownerUserId: owner.id, orgs: [] })
    }

    const orgIds = memberships.map((m) => (m as { org_id: string }).org_id)
    const { data: orgs } = await admin
      .from("organizations")
      .select("id, name")
      .in("id", orgIds)
    const listOut = (orgs ?? []).map((o) => ({ id: (o as { id: string }).id, name: (o as { name: string }).name }))
    return NextResponse.json({ ownerUserId: owner.id, orgs: listOut })
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Server error" },
      { status: 500 }
    )
  }
}
