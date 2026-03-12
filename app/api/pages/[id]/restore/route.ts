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
  if (role !== "owner" && role !== "executive_assistant") {
    return NextResponse.json({ ok: false, message: "復元の権限がありません。" }, { status: 403 })
  }
  return { userId, orgId, role }
}

/** POST /api/pages/[id]/restore - 指定リビジョンに復元 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await getAuth(req)
    if (auth instanceof NextResponse) return auth
    const { userId, orgId } = auth
    const { id: pageId } = await params
    if (!pageId) return NextResponse.json({ ok: false, message: "page id が必要です。" }, { status: 400 })

    let body: { revision_id?: string }
    try {
      body = await req.json()
    } catch {
      return NextResponse.json({ ok: false, message: "JSON が必要です。" }, { status: 400 })
    }
    const revisionId = typeof body?.revision_id === "string" ? body.revision_id.trim() : ""
    if (!revisionId) return NextResponse.json({ ok: false, message: "revision_id が必要です。" }, { status: 400 })

    const admin = createSupabaseAdmin()
    const { data: page } = await admin.from("pages").select("id, org_id").eq("id", pageId).eq("org_id", orgId).maybeSingle()
    if (!page) return NextResponse.json({ ok: false, message: "ページが見つかりません。" }, { status: 404 })

    const { data: rev } = await admin
      .from("page_revisions")
      .select("id, title, body_json")
      .eq("id", revisionId)
      .eq("page_id", pageId)
      .eq("org_id", orgId)
      .maybeSingle()

    if (!rev) return NextResponse.json({ ok: false, message: "指定の履歴が見つかりません。" }, { status: 404 })

    const r = rev as { title: string; body_json: unknown }
    const now = new Date().toISOString()
    const { error: updateErr } = await admin
      .from("pages")
      .update({
        title: r.title,
        content: r.body_json ?? {},
        updated_by: userId,
        updated_at: now,
      })
      .eq("id", pageId)
      .eq("org_id", orgId)

    if (updateErr) return NextResponse.json({ ok: false, message: "復元に失敗しました。" }, { status: 500 })

    await writeAuditLog(admin, {
      org_id: orgId,
      user_id: userId,
      action: "page.restore",
      resource_type: "page",
      resource_id: pageId,
      meta: { revision_id: revisionId },
    })
    await writeAuditLog(admin, {
      org_id: orgId,
      user_id: userId,
      action: "page.revision.restore",
      resource_type: "page_revision",
      resource_id: revisionId,
      meta: { page_id: pageId },
    })

    return NextResponse.json({ ok: true, title: r.title, content: r.body_json }, { status: 200 })
  } catch (e) {
    console.error("[api/pages/restore]", e)
    return NextResponse.json({ ok: false, message: "復元に失敗しました。" }, { status: 500 })
  }
}
