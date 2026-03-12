import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"
import { createSupabaseAdmin } from "@/lib/supabaseAdmin"
import { writeAuditLog } from "@/lib/auditLog"

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
  const { data: au } = await admin.from("app_users").select("role").eq("user_id", userId).eq("org_id", orgId).maybeSingle()
  const role = (au as { role?: string } | null)?.role ?? null
  if (role !== "owner" && role !== "executive_assistant") {
    return NextResponse.json({ ok: false, message: "アーカイブの権限がありません。" }, { status: 403 })
  }
  return { userId, orgId }
}

/**
 * POST /api/pages/[id]/archive
 * ページをアーカイブ（is_archived = true, archived_at = now()）。同一 org のみ。
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await getAuth(req)
    if (auth instanceof NextResponse) return auth
    const { userId, orgId } = auth
    const { id } = await params
    if (!id) return NextResponse.json({ ok: false, message: "id が必要です。" }, { status: 400 })

    const admin = createSupabaseAdmin()
    const { data: page, error: fetchErr } = await admin
      .from("pages")
      .select("id, org_id")
      .eq("id", id)
      .eq("org_id", orgId)
      .maybeSingle()
    if (fetchErr || !page) {
      return NextResponse.json({ ok: false, message: "ページが見つかりません。" }, { status: 404 })
    }

    const now = new Date().toISOString()
    const updatePayload: Record<string, unknown> = { is_archived: true, updated_at: now }
    try {
      await admin.from("pages").update({ ...updatePayload, archived_at: now }).eq("id", id).eq("org_id", orgId)
    } catch {
      await admin.from("pages").update(updatePayload).eq("id", id).eq("org_id", orgId)
    }
    await writeAuditLog(admin, { org_id: orgId, user_id: userId, action: "page.archive", resource_type: "page", resource_id: id })
    return NextResponse.json({ ok: true }, { status: 200 })
  } catch (e) {
    console.error("[api/pages/archive]", e)
    return NextResponse.json({ ok: false, message: "アーカイブに失敗しました。" }, { status: 500 })
  }
}
