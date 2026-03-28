import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"
import { loadPageTemplateBindings } from "@/lib/pageTemplateCatalogServer"
import { createSupabaseAdmin } from "@/lib/supabaseAdmin"

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

async function getContext(req: NextRequest) {
  const token = getToken(req)
  if (!token) {
    return { error: NextResponse.json({ ok: false, message: "認証が必要です" }, { status: 401 }) }
  }

  const supabase = createUserClient(token)
  if (!supabase) {
    return {
      error: NextResponse.json({ ok: false, message: "Supabase 設定が不足しています" }, { status: 500 }),
    }
  }

  const { data: userData } = await supabase.auth.getUser(token)
  const userId = userData.user?.id ?? null
  if (!userId) {
    return { error: NextResponse.json({ ok: false, message: "認証が必要です" }, { status: 401 }) }
  }

  const { data: profile } = await supabase
    .from("user_profiles")
    .select("active_org_id")
    .eq("user_id", userId)
    .maybeSingle()
  const orgId = (profile as { active_org_id?: string | null } | null)?.active_org_id ?? null
  if (!orgId) {
    return {
      error: NextResponse.json({ ok: false, message: "ワークスペースを選択してください" }, { status: 400 }),
    }
  }

  const { data: appUser } = await supabase
    .from("app_users")
    .select("role")
    .eq("user_id", userId)
    .eq("org_id", orgId)
    .maybeSingle()
  const role = (appUser as { role?: string } | null)?.role ?? null
  if (!role) {
    return {
      error: NextResponse.json({ ok: false, message: "組織メンバーではありません" }, { status: 403 }),
    }
  }

  return { orgId }
}

export async function GET(req: NextRequest) {
  try {
    const context = await getContext(req)
    if ("error" in context) return context.error

    const archivedParam = req.nextUrl.searchParams.get("archived")
    const archived = archivedParam === "1" || archivedParam === "true"
    const admin = createSupabaseAdmin()

    const primary = await admin
      .from("pages")
      .select("id, title, updated_at, sort_order, body_text")
      .eq("org_id", context.orgId)
      .eq("is_archived", archived)
      .order("sort_order", { ascending: true })
      .order("updated_at", { ascending: false })

    const primaryMessage = (primary.error?.message || "").toLowerCase()
    const fallbackNeeded =
      Boolean(primary.error) &&
      (primary.error?.code === "42703" ||
        primaryMessage.includes("body_text") ||
        primaryMessage.includes("sort_order") ||
        primaryMessage.includes("column"))

    let pages =
      (primary.data as Array<{
        id: string
        title: string
        updated_at: string
        sort_order: number
        body_text?: string | null
      }> | null) ?? []

    if (primary.error && !fallbackNeeded) {
      console.error("[api/pages/list] select failed", primary.error)
      return NextResponse.json({ ok: false, message: "Pages 一覧の取得に失敗しました" }, { status: 500 })
    }

    if (fallbackNeeded) {
      const fallback = await admin
        .from("pages")
        .select("id, title, updated_at")
        .eq("org_id", context.orgId)
        .eq("is_archived", archived)
        .order("updated_at", { ascending: false })

      if (fallback.error) {
        console.error("[api/pages/list] fallback failed", fallback.error)
        return NextResponse.json({ ok: false, message: "Pages 一覧の取得に失敗しました" }, { status: 500 })
      }

      pages = ((fallback.data ?? []) as Array<{ id: string; title: string; updated_at: string }>).map((row) => ({
        ...row,
        sort_order: 0,
        body_text: null,
      }))
    }

    let bindingMap = new Map()
    try {
      bindingMap = await loadPageTemplateBindings(
        admin,
        context.orgId,
        pages.map((page) => page.id)
      )
    } catch (error) {
      if (process.env.NODE_ENV === "development") {
        console.error("[api/pages/list] binding load skipped", error)
      }
    }

    return NextResponse.json(
      {
        ok: true,
        pages: pages.map((page) => ({
          ...page,
          template_binding: bindingMap.get(page.id) ?? null,
        })),
      },
      { status: 200 }
    )
  } catch (error) {
    console.error("[api/pages/list]", error)
    return NextResponse.json({ ok: false, message: "Pages 一覧の取得に失敗しました" }, { status: 500 })
  }
}
