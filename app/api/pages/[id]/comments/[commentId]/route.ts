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

/** DELETE /api/pages/[id]/comments/[commentId] - コメント削除（soft）。本人または owner/executive_assistant のみ */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; commentId: string }> }
) {
  try {
    const auth = await getAuth(req)
    if (auth instanceof NextResponse) return auth
    const { userId, orgId, role } = auth
    const { id: pageId, commentId } = await params
    if (!pageId || !commentId) return NextResponse.json({ ok: false, message: "id と commentId が必要です。" }, { status: 400 })

    const admin = createSupabaseAdmin()
    const { data: comment } = await admin
      .from("page_comments")
      .select("id, user_id, org_id, page_id")
      .eq("id", commentId)
      .eq("page_id", pageId)
      .eq("org_id", orgId)
      .is("deleted_at", null)
      .maybeSingle()

    if (!comment) return NextResponse.json({ ok: false, message: "コメントが見つかりません。" }, { status: 404 })

    const c = comment as { user_id: string }
    const isSelf = c.user_id === userId
    const canDelete = isSelf || role === "owner" || role === "executive_assistant"
    if (!canDelete) return NextResponse.json({ ok: false, message: "削除の権限がありません。" }, { status: 403 })

    const now = new Date().toISOString()
    const { error } = await admin.from("page_comments").update({ deleted_at: now }).eq("id", commentId).eq("org_id", orgId)
    if (error) return NextResponse.json({ ok: false, message: "削除に失敗しました。" }, { status: 500 })

    await writeAuditLog(admin, {
      org_id: orgId,
      user_id: userId,
      action: "page.comment.delete",
      resource_type: "page_comment",
      resource_id: commentId,
      meta: { page_id: pageId },
    })

    return NextResponse.json({ ok: true }, { status: 200 })
  } catch (e) {
    console.error("[api/pages/comments DELETE]", e)
    return NextResponse.json({ ok: false, message: "削除に失敗しました。" }, { status: 500 })
  }
}
