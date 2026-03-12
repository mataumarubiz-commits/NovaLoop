import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

function getToken(req: NextRequest): string | null {
  const authHeader = req.headers.get("Authorization")
  return authHeader?.startsWith("Bearer ") ? authHeader.slice(7).trim() : null
}

function createUserClient(token: string) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !anonKey) return null
  return createClient(url, anonKey, {
    auth: { persistSession: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  })
}

/**
 * DELETE /api/pages/[id]/delete
 * owner / executive_assistant のみ削除可能（RLSで担保）。
 */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const token = getToken(req)
    if (!token) {
      return NextResponse.json({ ok: false, message: "認証が必要です" }, { status: 401 })
    }

    const supabase = createUserClient(token)
    if (!supabase) {
      return NextResponse.json({ ok: false, message: "Supabase設定が不足しています" }, { status: 500 })
    }

    const { data: userData } = await supabase.auth.getUser(token)
    const userId = userData.user?.id ?? null
    if (!userId) {
      return NextResponse.json({ ok: false, message: "認証が必要です" }, { status: 401 })
    }

    const { id } = await params
    if (!id) {
      return NextResponse.json({ ok: false, message: "id が不正です" }, { status: 400 })
    }

    const { data: profile } = await supabase
      .from("user_profiles")
      .select("active_org_id")
      .eq("user_id", userId)
      .maybeSingle()
    const orgId = (profile as { active_org_id?: string | null } | null)?.active_org_id ?? null
    if (!orgId) {
      return NextResponse.json({ ok: false, message: "ワークスペースを選択してください" }, { status: 400 })
    }

    const { data: exists } = await supabase
      .from("pages")
      .select("id")
      .eq("id", id)
      .eq("org_id", orgId)
      .maybeSingle()
    if (!exists) {
      return NextResponse.json({ ok: false, message: "ページが見つかりません" }, { status: 404 })
    }

    const { error: deleteError } = await supabase
      .from("pages")
      .delete()
      .eq("id", id)
      .eq("org_id", orgId)

    if (deleteError) {
      const msg = (deleteError.message || "").toLowerCase()
      if (msg.includes("row-level security") || msg.includes("permission denied")) {
        return NextResponse.json({ ok: false, message: "削除権限がありません" }, { status: 403 })
      }
      console.error("[api/pages/delete] delete failed", deleteError)
      return NextResponse.json({ ok: false, message: "ページの削除に失敗しました" }, { status: 500 })
    }

    return NextResponse.json({ ok: true }, { status: 200 })
  } catch (e) {
    console.error("[api/pages/delete]", e)
    return NextResponse.json({ ok: false, message: "ページの削除に失敗しました" }, { status: 500 })
  }
}

