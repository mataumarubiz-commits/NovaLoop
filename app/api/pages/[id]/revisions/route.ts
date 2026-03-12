import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"
import { createSupabaseAdmin } from "@/lib/supabaseAdmin"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

async function getAuth(req: NextRequest): Promise<{ userId: string; orgId: string } | NextResponse> {
  const authHeader = req.headers.get("Authorization")
  const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7).trim() : null
  if (!token) return NextResponse.json({ ok: false, message: "認証が必要です。" }, { status: 401 })
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !anonKey) return NextResponse.json({ ok: false, message: "設定エラー" }, { status: 500 })
  const supabase = createClient(url, anonKey, { auth: { persistSession: false } })
  const { data } = await supabase.auth.getUser(token)
  const userId = data.user?.id
  if (!userId) return NextResponse.json({ ok: false, message: "認証が必要です。" }, { status: 401 })
  const admin = createSupabaseAdmin()
  const { data: profile } = await admin.from("user_profiles").select("active_org_id").eq("user_id", userId).maybeSingle()
  const orgId = (profile as { active_org_id?: string | null } | null)?.active_org_id ?? null
  if (!orgId) return NextResponse.json({ ok: false, message: "ワークスペースを選択してください。" }, { status: 400 })
  return { userId, orgId }
}

/** GET /api/pages/[id]/revisions - 更新履歴一覧（直近50件） */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await getAuth(req)
    if (auth instanceof NextResponse) return auth
    const { orgId } = auth
    const { id: pageId } = await params
    if (!pageId) return NextResponse.json({ ok: false, message: "page id が必要です。" }, { status: 400 })

    const admin = createSupabaseAdmin()
    const { data: page } = await admin.from("pages").select("id, org_id").eq("id", pageId).eq("org_id", orgId).maybeSingle()
    if (!page) return NextResponse.json({ ok: false, message: "ページが見つかりません。" }, { status: 404 })

    const { data: rows } = await admin
      .from("page_revisions")
      .select("id, title, body_json, updated_by_user_id, created_at")
      .eq("page_id", pageId)
      .order("created_at", { ascending: false })
      .limit(50)

    const list = (rows ?? []) as { id: string; title: string; body_json: unknown; updated_by_user_id: string; created_at: string }[]
    const userIds = [...new Set(list.map((r) => r.updated_by_user_id))]
    const { data: profiles } = await admin.from("user_profiles").select("user_id, display_name").in("user_id", userIds)
    const nameMap = new Map((profiles ?? []).map((p: { user_id: string; display_name?: string }) => [p.user_id, p.display_name ?? ""]))

    const revisions = list.map((r) => ({
      id: r.id,
      title: r.title,
      body_json: r.body_json,
      updated_by_user_id: r.updated_by_user_id,
      updated_by_name: nameMap.get(r.updated_by_user_id) ?? "不明",
      created_at: r.created_at,
    }))
    return NextResponse.json({ ok: true, revisions }, { status: 200 })
  } catch (e) {
    console.error("[api/pages/revisions GET]", e)
    return NextResponse.json({ ok: false, message: "取得に失敗しました。" }, { status: 500 })
  }
}
