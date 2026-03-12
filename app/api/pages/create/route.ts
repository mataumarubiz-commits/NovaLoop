import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"
import { PAGE_TEMPLATES, type PageTemplateKey } from "@/lib/pageTemplates"
import { createSupabaseAdmin } from "@/lib/supabaseAdmin"
import { writeAuditLog } from "@/lib/auditLog"
import { trackServerEvent } from "@/lib/analytics"

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

export async function POST(req: NextRequest) {
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

    const { data: profile } = await supabase
      .from("user_profiles")
      .select("active_org_id")
      .eq("user_id", userId)
      .maybeSingle()
    const orgId = (profile as { active_org_id?: string | null } | null)?.active_org_id ?? null
    if (!orgId) {
      return NextResponse.json({ ok: false, message: "ワークスペースを選択してください" }, { status: 400 })
    }

    let templateKey: Exclude<PageTemplateKey, "blank"> | null = null
    try {
      const body = await req.json().catch(() => ({}))
      const candidate = typeof body?.template === "string" ? body.template.trim() : ""
      if (candidate && candidate in PAGE_TEMPLATES) {
        templateKey = candidate as Exclude<PageTemplateKey, "blank">
      }
    } catch {
      // body is optional
    }

    const template = templateKey ? PAGE_TEMPLATES[templateKey] : null
    const initialTitle = template?.title ?? "新規ページ"
    const initialContent = template?.content ?? {}

    let nextOrder = 0
    const { data: maxRow } = await supabase
      .from("pages")
      .select("sort_order")
      .eq("org_id", orgId)
      .order("sort_order", { ascending: false })
      .limit(1)
      .maybeSingle()

    nextOrder =
      typeof (maxRow as { sort_order?: number } | null)?.sort_order === "number"
        ? (maxRow as { sort_order: number }).sort_order + 100
        : 0

    const insertBase = {
      org_id: orgId,
      title: initialTitle,
      content: initialContent,
      created_by: userId,
      updated_by: userId,
    }

    let row: { id: string } | null = null
    let error: { code?: string; message?: string } | null = null

    const primaryInsert = await supabase
      .from("pages")
      .insert({ ...insertBase, sort_order: nextOrder })
      .select("id")
      .single()

    row = primaryInsert.data as { id: string } | null
    error = primaryInsert.error as { code?: string; message?: string } | null

    if (error && (error.code === "42703" || (error.message || "").includes("sort_order"))) {
      const fallbackInsert = await supabase.from("pages").insert(insertBase).select("id").single()
      row = fallbackInsert.data as { id: string } | null
      error = fallbackInsert.error as { code?: string; message?: string } | null
    }

    if (error || !row) {
      const message = (error?.message || "").toLowerCase()
      if (message.includes("row-level security") || message.includes("permission denied")) {
        return NextResponse.json({ ok: false, message: "ページ作成の権限がありません" }, { status: 403 })
      }
      return NextResponse.json({ ok: false, message: "ページの作成に失敗しました" }, { status: 500 })
    }

    const admin = createSupabaseAdmin()
    await writeAuditLog(admin, {
      org_id: orgId,
      user_id: userId,
      action: "page.create",
      resource_type: "page",
      resource_id: row.id,
      meta: {
        template: templateKey ?? "blank",
      },
    })

    await trackServerEvent({
      orgId,
      userId,
      eventName: templateKey ? "page.template_used" : "page.created",
      source: "pages_create_api",
      entityType: "page",
      entityId: row.id,
      metadata: { template: templateKey ?? "blank" },
    })

    return NextResponse.json({ ok: true, id: row.id }, { status: 200 })
  } catch (error) {
    console.error("[api/pages/create]", error)
    return NextResponse.json({ ok: false, message: "ページの作成に失敗しました" }, { status: 500 })
  }
}
