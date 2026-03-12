import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"
import { resolveSlugDuplicate, titleToSlug } from "@/lib/slug"
import { createSupabaseAdmin } from "@/lib/supabaseAdmin"
import { writeAuditLog } from "@/lib/auditLog"

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

async function getAuth(req: NextRequest) {
  const token = getToken(req)
  if (!token) return { error: NextResponse.json({ ok: false, message: "認証が必要です" }, { status: 401 }) }

  const supabase = createUserClient(token)
  if (!supabase) {
    return { error: NextResponse.json({ ok: false, message: "Supabase 設定が不足しています" }, { status: 500 }) }
  }

  const { data: userData } = await supabase.auth.getUser(token)
  const userId = userData.user?.id ?? null
  if (!userId) return { error: NextResponse.json({ ok: false, message: "認証が必要です" }, { status: 401 }) }

  const { data: profile } = await supabase
    .from("user_profiles")
    .select("active_org_id")
    .eq("user_id", userId)
    .maybeSingle()

  const orgId = (profile as { active_org_id?: string | null } | null)?.active_org_id ?? null
  if (!orgId) {
    return { error: NextResponse.json({ ok: false, message: "ワークスペースを選択してください" }, { status: 400 }) }
  }

  const { data: appUser } = await supabase
    .from("app_users")
    .select("role")
    .eq("user_id", userId)
    .eq("org_id", orgId)
    .maybeSingle()

  const role = (appUser as { role?: string } | null)?.role ?? null
  if (!role) {
    return { error: NextResponse.json({ ok: false, message: "組織メンバーではありません" }, { status: 403 }) }
  }

  return { supabase, userId, orgId, role }
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await getAuth(req)
    if ("error" in auth) return auth.error
    const { supabase, orgId } = auth
    const { id } = await params

    if (!id) return NextResponse.json({ ok: false, message: "id が不正です" }, { status: 400 })

    const primary = await supabase
      .from("pages")
      .select("id, org_id, title, content, updated_at, icon, cover_path, slug, updated_by, body_text")
      .eq("id", id)
      .eq("org_id", orgId)
      .maybeSingle()

    if (!primary.error && primary.data) {
      return NextResponse.json({ ok: true, page: primary.data }, { status: 200 })
    }

    const msg = (primary.error?.message || "").toLowerCase()
    const fallbackNeeded =
      primary.error?.code === "42703" ||
      msg.includes("column") ||
      msg.includes("body_text") ||
      msg.includes("icon") ||
      msg.includes("cover_path") ||
      msg.includes("slug")

    if (!fallbackNeeded) {
      if (!primary.data) return NextResponse.json({ ok: false, message: "ページが見つかりません" }, { status: 404 })
      return NextResponse.json({ ok: false, message: "ページの取得に失敗しました" }, { status: 500 })
    }

    const fallback = await supabase
      .from("pages")
      .select("id, org_id, title, content, updated_at, updated_by")
      .eq("id", id)
      .eq("org_id", orgId)
      .maybeSingle()

    if (fallback.error || !fallback.data) {
      return NextResponse.json({ ok: false, message: "ページの取得に失敗しました" }, { status: 500 })
    }

    return NextResponse.json(
      {
        ok: true,
        page: {
          ...fallback.data,
          body_text: null,
          icon: null,
          cover_path: null,
          slug: null,
        },
      },
      { status: 200 }
    )
  } catch (e) {
    console.error("[api/pages/[id] GET]", e)
    return NextResponse.json({ ok: false, message: "ページの取得に失敗しました" }, { status: 500 })
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await getAuth(req)
    if ("error" in auth) return auth.error
    const { supabase, userId, orgId, role } = auth

    if (role !== "owner" && role !== "executive_assistant") {
      return NextResponse.json({ ok: false, message: "更新権限がありません" }, { status: 403 })
    }

    const { id } = await params
    if (!id) return NextResponse.json({ ok: false, message: "id が不正です" }, { status: 400 })

    const body = (await req.json().catch(() => ({}))) as {
      title?: string
      content?: unknown
      body_text?: string | null
      icon?: string | null
      cover_path?: string | null
      slug?: string | null
    }

    const { data: page } = await supabase
      .from("pages")
      .select("id, title, content")
      .eq("id", id)
      .eq("org_id", orgId)
      .maybeSingle()

    if (!page) {
      return NextResponse.json({ ok: false, message: "ページが見つかりません" }, { status: 404 })
    }

    if (body.content !== undefined) {
      try {
        await supabase.from("page_revisions").insert({
          org_id: orgId,
          page_id: id,
          title: ((page as { title?: string }).title || "無題").trim() || "無題",
          body_json: (page as { content?: unknown }).content ?? {},
          updated_by_user_id: userId,
        })
      } catch {
        // revision insert failure should not block save
      }
    }

    const baseUpdate: Record<string, unknown> = {}
    if (body.title !== undefined) baseUpdate.title = (body.title || "無題").trim() || "無題"
    if (body.content !== undefined) baseUpdate.content = body.content ?? {}
    if (Object.keys(baseUpdate).length === 0) {
      return NextResponse.json({ ok: true }, { status: 200 })
    }

    const titleForSlug = (body.title !== undefined ? body.title : (page as { title?: string }).title) || "無題"
    const baseSlug =
      body.slug !== undefined && body.slug !== null && String(body.slug).trim() !== ""
        ? String(body.slug).trim().toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "")
        : titleToSlug(titleForSlug)

    if (baseSlug) {
      let slugs: string[] = []
      try {
        const existingPrimary = await supabase
          .from("pages")
          .select("slug")
          .eq("org_id", orgId)
          .eq("is_archived", false)
          .neq("id", id)

        if (!existingPrimary.error) {
          slugs = (existingPrimary.data ?? [])
            .map((r: { slug?: string | null }) => (r.slug || "").trim())
            .filter(Boolean)
        } else if (existingPrimary.error.code === "42703") {
          const existingFallback = await supabase
            .from("pages")
            .select("slug")
            .eq("org_id", orgId)
            .neq("id", id)

          if (!existingFallback.error) {
            slugs = (existingFallback.data ?? [])
              .map((r: { slug?: string | null }) => (r.slug || "").trim())
              .filter(Boolean)
          }
        }
      } catch {
        slugs = []
      }

      // slug は互換性のため optional 更新で扱う
      baseUpdate.slug = resolveSlugDuplicate(baseSlug, slugs)
    }
    // 1) 最小更新（title/content）を最優先で確実化
    const requiredOnly: Record<string, unknown> = {}
    if (baseUpdate.title !== undefined) requiredOnly.title = baseUpdate.title
    if (baseUpdate.content !== undefined) requiredOnly.content = baseUpdate.content
    const primary = await supabase
      .from("pages")
      .update(requiredOnly)
      .eq("id", id)
      .eq("org_id", orgId)

    if (primary.error) {
      if (primary.error.code === "42501") {
        return NextResponse.json({ ok: false, message: "更新権限がありません" }, { status: 403 })
      }
      if (process.env.NODE_ENV === "development") {
        console.error("[api/pages/[id] PATCH] required update failed", {
          code: primary.error.code,
          message: primary.error.message,
          keys: Object.keys(requiredOnly),
        })
      }
      return NextResponse.json({ ok: false, message: "更新に失敗しました" }, { status: 500 })
    }

    // 2) 追加列はベストエフォート（失敗しても保存成功扱い）
    const optional: Record<string, unknown> = {
      updated_by: userId,
      updated_at: new Date().toISOString(),
    }
    if (body.body_text !== undefined) optional.body_text = body.body_text ?? null
    if (body.icon !== undefined) optional.icon = body.icon ?? null
    if (body.cover_path !== undefined) optional.cover_path = body.cover_path ?? null
    if (baseUpdate.slug !== undefined) optional.slug = baseUpdate.slug

    const withSlug = await supabase
      .from("pages")
      .update(optional)
      .eq("id", id)
      .eq("org_id", orgId)
    if (withSlug.error && optional.slug !== undefined) {
      const noSlug = { ...optional }
      delete noSlug.slug
      await supabase.from("pages").update(noSlug).eq("id", id).eq("org_id", orgId)
    }

    const admin = createSupabaseAdmin()
    await writeAuditLog(admin, {
      org_id: orgId,
      user_id: userId,
      action: "page.update",
      resource_type: "page",
      resource_id: id,
      meta: {
        updated_fields: Object.keys(baseUpdate),
        optional_fields: Object.keys(optional),
      },
    })

    return NextResponse.json({ ok: true }, { status: 200 })
  } catch (e) {
    console.error("[api/pages/[id] PATCH]", e)
    return NextResponse.json({ ok: false, message: "更新に失敗しました" }, { status: 500 })
  }
}
