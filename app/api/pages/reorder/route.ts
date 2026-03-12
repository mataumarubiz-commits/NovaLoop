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
  const supabase = createClient(url, anonKey, { auth: { persistSession: false } })
  const { data } = await supabase.auth.getUser(token)
  return data.user?.id ?? null
}

/**
 * POST /api/pages/reorder
 * Body: { ordered_ids: string[] } — 並び順の id 配列。Bearer 必須。owner/executive_assistant のみ。
 */
export async function POST(req: NextRequest) {
  try {
    const userId = await getUserIdFromToken(req)
    if (!userId) {
      return NextResponse.json({ ok: false, message: "認証が必要です。" }, { status: 401 })
    }

    const admin = createSupabaseAdmin()
    const { data: profile } = await admin
      .from("user_profiles")
      .select("active_org_id")
      .eq("user_id", userId)
      .maybeSingle()
    const orgId = (profile as { active_org_id?: string | null } | null)?.active_org_id ?? null
    if (!orgId) {
      return NextResponse.json({ ok: false, message: "ワークスペースを選択してください。" }, { status: 400 })
    }

    const { data: au } = await admin
      .from("app_users")
      .select("role")
      .eq("user_id", userId)
      .eq("org_id", orgId)
      .maybeSingle()
    const role = (au as { role?: string } | null)?.role ?? null
    if (role !== "owner" && role !== "executive_assistant") {
      return NextResponse.json({ ok: false, message: "並び替えの権限がありません。" }, { status: 403 })
    }

    let body: { ordered_ids?: string[] }
    try {
      body = await req.json()
    } catch {
      return NextResponse.json({ ok: false, message: "JSON が必要です。" }, { status: 400 })
    }
    const orderedIds = Array.isArray(body?.ordered_ids) ? body.ordered_ids : []
    if (orderedIds.length === 0) {
      return NextResponse.json({ ok: true }, { status: 200 })
    }

    for (let i = 0; i < orderedIds.length; i++) {
      const id = orderedIds[i]
      if (typeof id !== "string" || !id.trim()) continue
      await admin
        .from("pages")
        .update({ sort_order: i * 100 })
        .eq("id", id.trim())
        .eq("org_id", orgId)
    }

    return NextResponse.json({ ok: true }, { status: 200 })
  } catch (e) {
    console.error("[api/pages/reorder]", e)
    return NextResponse.json(
      { ok: false, message: "並び替えに失敗しました。" },
      { status: 500 }
    )
  }
}
