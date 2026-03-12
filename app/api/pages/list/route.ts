import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

function getBearerToken(req: NextRequest): string | null {
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

async function resolveActiveOrgId(supabase: ReturnType<typeof createUserClient>, userId: string) {
  if (!supabase) return null
  const { data } = await supabase
    .from("user_profiles")
    .select("active_org_id")
    .eq("user_id", userId)
    .maybeSingle()
  return (data as { active_org_id?: string | null } | null)?.active_org_id ?? null
}

export async function GET(req: NextRequest) {
  try {
    const token = getBearerToken(req)
    if (!token) return NextResponse.json({ ok: false, message: "認証が必要です" }, { status: 401 })

    const supabase = createUserClient(token)
    if (!supabase) {
      return NextResponse.json({ ok: false, message: "Supabase設定が不足しています" }, { status: 500 })
    }

    const { data: userData } = await supabase.auth.getUser(token)
    const userId = userData.user?.id ?? null
    if (!userId) return NextResponse.json({ ok: false, message: "認証が必要です" }, { status: 401 })

    const orgId = await resolveActiveOrgId(supabase, userId)
    if (!orgId) {
      return NextResponse.json({ ok: false, message: "ワークスペースを選択してください" }, { status: 400 })
    }

    const archivedParam = req.nextUrl.searchParams.get("archived")
    const archived = archivedParam === "1" || archivedParam === "true"

    const primary = await supabase
      .from("pages")
      .select("id, title, updated_at, sort_order, body_text")
      .eq("org_id", orgId)
      .eq("is_archived", archived)
      .order("sort_order", { ascending: true })
      .order("updated_at", { ascending: false })

    if (!primary.error) {
      return NextResponse.json({ ok: true, pages: primary.data ?? [] }, { status: 200 })
    }

    const errMsg = (primary.error.message || "").toLowerCase()
    const fallbackNeeded =
      primary.error.code === "42703" ||
      errMsg.includes("body_text") ||
      errMsg.includes("sort_order") ||
      errMsg.includes("column")

    if (!fallbackNeeded) {
      console.error("[api/pages/list] select failed", primary.error)
      return NextResponse.json({ ok: false, message: "ページ一覧の取得に失敗しました" }, { status: 500 })
    }

    const fallback = await supabase
      .from("pages")
      .select("id, title, updated_at")
      .eq("org_id", orgId)
      .eq("is_archived", archived)
      .order("updated_at", { ascending: false })

    if (fallback.error) {
      console.error("[api/pages/list] fallback failed", fallback.error)
      return NextResponse.json({ ok: false, message: "ページ一覧の取得に失敗しました" }, { status: 500 })
    }

    const pages = (fallback.data ?? []).map((row) => ({
      ...row,
      sort_order: 0,
      body_text: null,
    }))

    return NextResponse.json({ ok: true, pages }, { status: 200 })
  } catch (error) {
    console.error("[api/pages/list]", error)
    return NextResponse.json({ ok: false, message: "ページ一覧の取得に失敗しました" }, { status: 500 })
  }
}
