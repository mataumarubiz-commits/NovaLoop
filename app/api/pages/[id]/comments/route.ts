import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"
import { createSupabaseAdmin } from "@/lib/supabaseAdmin"
import { writeAuditLog } from "@/lib/auditLog"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

async function getAuth(req: NextRequest): Promise<{ userId: string; orgId: string; role: string } | NextResponse> {
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
  const { data: au } = await admin.from("app_users").select("role").eq("user_id", userId).eq("org_id", orgId).maybeSingle()
  const role = (au as { role?: string } | null)?.role ?? "member"
  return { userId, orgId, role }
}

/** GET /api/pages/[id]/comments - ページのコメント一覧（deleted_at は除外） */
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
      .from("page_comments")
      .select("id, user_id, body, created_at, selection_range")
      .eq("page_id", pageId)
      .is("deleted_at", null)
      .order("created_at", { ascending: true })

    const list = (rows ?? []) as { id: string; user_id: string; body: string; created_at: string; selection_range?: { from: number; to: number } | null }[]
    const userIds = [...new Set(list.map((r) => r.user_id))]
    const { data: profiles } = await admin.from("user_profiles").select("user_id, display_name").in("user_id", userIds)
    const nameMap = new Map((profiles ?? []).map((p: { user_id: string; display_name?: string }) => [p.user_id, p.display_name ?? ""]))

    const comments = list.map((c) => ({
      id: c.id,
      user_id: c.user_id,
      display_name: nameMap.get(c.user_id) ?? "不明",
      body: c.body,
      created_at: c.created_at,
      ...(c.selection_range != null && { selection_range: c.selection_range }),
    }))
    return NextResponse.json({ ok: true, comments }, { status: 200 })
  } catch (e) {
    console.error("[api/pages/comments GET]", e)
    return NextResponse.json({ ok: false, message: "取得に失敗しました。" }, { status: 500 })
  }
}

/** POST /api/pages/[id]/comments - コメント追加 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await getAuth(req)
    if (auth instanceof NextResponse) return auth
    const { userId, orgId } = auth
    const { id: pageId } = await params
    if (!pageId) return NextResponse.json({ ok: false, message: "page id が必要です。" }, { status: 400 })

    let body: { body?: string; selection_range?: { from?: number; to?: number } }
    try {
      body = await req.json()
    } catch {
      return NextResponse.json({ ok: false, message: "JSON が必要です。" }, { status: 400 })
    }
    const text = typeof body?.body === "string" ? body.body.trim() : ""
    if (!text) return NextResponse.json({ ok: false, message: "本文を入力してください。" }, { status: 400 })

    const selectionRange =
      body?.selection_range && typeof body.selection_range.from === "number" && typeof body.selection_range.to === "number"
        ? { from: body.selection_range.from, to: body.selection_range.to }
        : null

    const admin = createSupabaseAdmin()
    const { data: page } = await admin.from("pages").select("id, org_id").eq("id", pageId).eq("org_id", orgId).maybeSingle()
    if (!page) return NextResponse.json({ ok: false, message: "ページが見つかりません。" }, { status: 404 })

    const { data: inserted, error } = await admin
      .from("page_comments")
      .insert({
        org_id: orgId,
        page_id: pageId,
        user_id: userId,
        body: text,
        ...(selectionRange && { selection_range: selectionRange }),
      })
      .select("id, created_at")
      .single()

    if (error || !inserted) return NextResponse.json({ ok: false, message: "コメントの追加に失敗しました。" }, { status: 500 })

    await writeAuditLog(admin, {
      org_id: orgId,
      user_id: userId,
      action: "page.comment.create",
      resource_type: "page_comment",
      resource_id: (inserted as { id: string }).id,
      meta: { page_id: pageId },
    })

    return NextResponse.json({ ok: true, id: (inserted as { id: string }).id, created_at: (inserted as { created_at: string }).created_at }, { status: 200 })
  } catch (e) {
    console.error("[api/pages/comments POST]", e)
    return NextResponse.json({ ok: false, message: "追加に失敗しました。" }, { status: 500 })
  }
}
