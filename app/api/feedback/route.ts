import { NextRequest, NextResponse } from "next/server"
import { createSupabaseAdmin } from "@/lib/supabaseAdmin"
import { getOrgRole, getUserIdFromToken } from "@/lib/apiAuth"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

type Body = {
  category?: string
  message?: string
  page_path?: string
  metadata?: Record<string, unknown>
}

export async function POST(req: NextRequest) {
  try {
    const userId = await getUserIdFromToken(req)
    if (!userId) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 })

    const body = (await req.json().catch(() => null)) as Body | null
    const category = typeof body?.category === "string" ? body.category.trim() : ""
    const message = typeof body?.message === "string" ? body.message.trim() : ""
    if (!category || !message) {
      return NextResponse.json({ ok: false, error: "category and message are required" }, { status: 400 })
    }

    const admin = createSupabaseAdmin()
    const { data: profile } = await admin
      .from("user_profiles")
      .select("active_org_id")
      .eq("user_id", userId)
      .maybeSingle()
    const orgId = (profile as { active_org_id?: string | null } | null)?.active_org_id ?? null
    if (!orgId) return NextResponse.json({ ok: false, error: "Active org not found" }, { status: 400 })

    const role = await getOrgRole(admin, userId, orgId)
    if (!role) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 })

    const { error } = await admin.from("feedback_submissions").insert({
      org_id: orgId,
      user_id: userId,
      role,
      category,
      message,
      page_path: typeof body?.page_path === "string" ? body.page_path : null,
      metadata: body?.metadata ?? {},
    })

    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true })
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Failed to submit feedback" },
      { status: 500 }
    )
  }
}
