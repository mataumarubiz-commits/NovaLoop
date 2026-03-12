import { NextRequest, NextResponse } from "next/server"
import { createSupabaseAdmin } from "@/lib/supabaseAdmin"
import { getOrgRole, getUserIdFromToken } from "@/lib/apiAuth"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

type Body = {
  event_name?: string
  source?: string
  entity_type?: string
  entity_id?: string
  metadata?: Record<string, unknown>
}

export async function POST(req: NextRequest) {
  try {
    const userId = await getUserIdFromToken(req)
    if (!userId) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 })
    }

    const body = (await req.json().catch(() => null)) as Body | null
    const eventName = typeof body?.event_name === "string" ? body.event_name.trim() : ""
    if (!eventName) {
      return NextResponse.json({ ok: false, error: "event_name is required" }, { status: 400 })
    }

    const admin = createSupabaseAdmin()
    const { data: profile } = await admin
      .from("user_profiles")
      .select("active_org_id")
      .eq("user_id", userId)
      .maybeSingle()

    const orgId = (profile as { active_org_id?: string | null } | null)?.active_org_id ?? null
    if (!orgId) {
      return NextResponse.json({ ok: false, error: "Active org not found" }, { status: 400 })
    }

    const role = await getOrgRole(admin, userId, orgId)
    if (!role) {
      return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 })
    }

    const { error } = await admin.from("analytics_events").insert({
      org_id: orgId,
      user_id: userId,
      role,
      event_name: eventName,
      source: typeof body?.source === "string" ? body.source : null,
      entity_type: typeof body?.entity_type === "string" ? body.entity_type : null,
      entity_id: typeof body?.entity_id === "string" ? body.entity_id : null,
      metadata: body?.metadata ?? {},
    })

    if (error) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
    }

    return NextResponse.json({ ok: true })
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Failed to track analytics event" },
      { status: 500 }
    )
  }
}
