import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"
import { createSupabaseAdmin } from "@/lib/supabaseAdmin"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

async function getUserIdFromToken(req: NextRequest): Promise<string | null> {
  const authHeader = req.headers.get("Authorization")
  const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7).trim() : null
  if (!token) return null
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !anonKey) return null
  const supabase = createClient(url, anonKey)
  const { data } = await supabase.auth.getUser(token)
  return data.user?.id ?? null
}

export async function POST(req: NextRequest) {
  try {
    const userId = await getUserIdFromToken(req)
    if (!userId) {
      return NextResponse.json({ ok: false, message: "認証してください。" }, { status: 401 })
    }

    const body = await req.json().catch(() => ({}))
    const orgId = typeof body?.orgId === "string" ? body.orgId.trim() : ""
    if (!orgId) {
      return NextResponse.json({ ok: false, message: "組織を指定してください。" }, { status: 400 })
    }

    const admin = createSupabaseAdmin()

    const { data: myRow } = await admin
      .from("app_users")
      .select("id")
      .eq("user_id", userId)
      .eq("org_id", orgId)
      .maybeSingle()

    if (!myRow) {
      return NextResponse.json({ ok: false, message: "この組織に所属していません。" }, { status: 400 })
    }

    await admin.from("app_users").delete().eq("user_id", userId).eq("org_id", orgId)

    const { data: remaining } = await admin.from("app_users").select("org_id").eq("user_id", userId)
    const otherOrgId = (remaining ?? []).length > 0 ? (remaining as { org_id: string }[])[0].org_id : null

    await admin
      .from("user_profiles")
      .update({ active_org_id: otherOrgId, updated_at: new Date().toISOString() })
      .eq("user_id", userId)

    return NextResponse.json({ ok: true, activeOrgId: otherOrgId })
  } catch (e) {
    console.error("[orgs/leave]", e)
    return NextResponse.json(
      { ok: false, message: "脱退に失敗しました。しばらくしてから再試行してください。" },
      { status: 500 }
    )
  }
}
