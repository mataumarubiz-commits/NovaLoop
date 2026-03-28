import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"
import { trackServerEvent } from "@/lib/analytics"
import { writeAuditLog } from "@/lib/auditLog"
import {
  applyTemplateUpdateToInstall,
  deleteTemplateInstall,
  getTemplateVersionDiffForInstall,
  listAccessibleTemplateCatalog,
  queueTemplateInstall,
  runQueuedTemplateInstall,
  setTemplateCatalogStatus,
  shareTemplateInstall,
} from "@/lib/pageTemplateCatalogServer"
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

async function getRequestContext(req: NextRequest) {
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

  return { userId, orgId, role }
}

function isSchemaMissing(error: unknown): boolean {
  const message =
    typeof error === "object" && error !== null && "message" in error
      ? String((error as { message?: string }).message ?? "")
      : ""
  return (
    message.includes("template_catalog") ||
    message.includes("template_page_definitions") ||
    message.includes("org_template_installs") ||
    message.includes("page_template_bindings") ||
    message.includes("template_release_history")
  )
}

function requireTemplateAdmin(role: string) {
  return role === "owner" || role === "executive_assistant"
}

export async function GET(req: NextRequest) {
  try {
    const context = await getRequestContext(req)
    if ("error" in context) return context.error

    const admin = createSupabaseAdmin()
    const view = req.nextUrl.searchParams.get("view")
    const installId = req.nextUrl.searchParams.get("installId")?.trim() || ""

    if (view === "diff" && installId) {
      const diff = await getTemplateVersionDiffForInstall({
        admin,
        orgId: context.orgId,
        installId,
      })
      return NextResponse.json({ ok: true, diff }, { status: 200 })
    }

    const templates = await listAccessibleTemplateCatalog({
      admin,
      orgId: context.orgId,
    })

    return NextResponse.json({ ok: true, templates }, { status: 200 })
  } catch (error) {
    console.error("[api/pages/templates GET]", error)
    if (isSchemaMissing(error)) {
      return NextResponse.json(
        { ok: false, message: "最新の Pages テンプレ SQL が未適用です。`059_page_template_catalog.sql` と `060_page_template_lifecycle.sql` を適用してください。" },
        { status: 500 }
      )
    }
    return NextResponse.json({ ok: false, message: "テンプレ一覧の取得に失敗しました" }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const context = await getRequestContext(req)
    if ("error" in context) return context.error

    const body = (await req.json().catch(() => ({}))) as {
      action?: string
      templateKey?: string
      installId?: string
      installName?: string
      includeSampleContent?: boolean
      groupUnderRoot?: boolean
      shareName?: string
      shareDescription?: string
      sharingScope?: "org" | "industry"
      industryTag?: string
      targetTemplateKey?: string
      status?: "active" | "archived"
      selectedPageKeys?: string[]
    }
    const action = typeof body.action === "string" ? body.action : "queue_install"
    const admin = createSupabaseAdmin()

    if (!requireTemplateAdmin(context.role)) {
      return NextResponse.json({ ok: false, message: "テンプレ操作の権限がありません" }, { status: 403 })
    }

    if (action === "queue_install") {
      const templateKey = typeof body.templateKey === "string" ? body.templateKey.trim() : ""
      if (!templateKey) {
        return NextResponse.json({ ok: false, message: "テンプレキーが不正です" }, { status: 400 })
      }

      const queued = await queueTemplateInstall({
        admin,
        orgId: context.orgId,
        userId: context.userId,
        templateKey,
        installName: typeof body.installName === "string" ? body.installName.trim() : "",
        includeSampleContent: body.includeSampleContent !== false,
        groupUnderRoot: body.groupUnderRoot !== false,
      })

      await writeAuditLog(admin, {
        org_id: context.orgId,
        user_id: context.userId,
        action: "page.template.install",
        resource_type: "template_install",
        resource_id: queued.installId,
        meta: {
          template_key: queued.templateKey,
          page_count: queued.pageCount,
        },
      })

      return NextResponse.json(
        {
          ok: true,
          queued: true,
          installId: queued.installId,
          installName: queued.installName,
          templateName: queued.templateName,
          templateKey: queued.templateKey,
          pageCount: queued.pageCount,
        },
        { status: 202 }
      )
    }

    if (action === "run_install") {
      const installId = typeof body.installId === "string" ? body.installId.trim() : ""
      if (!installId) {
        return NextResponse.json({ ok: false, message: "installId が不正です" }, { status: 400 })
      }

      const selectedPageKeys = Array.isArray(body.selectedPageKeys) ? (body.selectedPageKeys as string[]).filter((k) => typeof k === "string") : undefined
      const installed = await runQueuedTemplateInstall({
        admin,
        orgId: context.orgId,
        userId: context.userId,
        installId,
        selectedPageKeys: selectedPageKeys && selectedPageKeys.length > 0 ? selectedPageKeys : undefined,
      })

      await trackServerEvent({
        orgId: context.orgId,
        userId: context.userId,
        eventName: "page.template_used",
        source: "pages_template_install_api",
        entityType: "template_install",
        entityId: installed.installId,
        metadata: {
          templateKey: installed.templateKey,
          pageCount: installed.createdPages.length,
        },
      })

      return NextResponse.json(
        {
          ok: true,
          installId: installed.installId,
          rootPageId: installed.rootPageId,
          pageCount: installed.createdPages.length,
          createdPages: installed.createdPages,
          templateName: installed.templateName,
          templateKey: installed.templateKey,
        },
        { status: 200 }
      )
    }

    if (action === "apply_update") {
      const installId = typeof body.installId === "string" ? body.installId.trim() : ""
      if (!installId) {
        return NextResponse.json({ ok: false, message: "installId が不正です" }, { status: 400 })
      }

      const result = await applyTemplateUpdateToInstall({
        admin,
        orgId: context.orgId,
        userId: context.userId,
        installId,
      })
      return NextResponse.json({ ok: true, ...result }, { status: 200 })
    }

    if (action === "share_install") {
      const installId = typeof body.installId === "string" ? body.installId.trim() : ""
      const shareName = typeof body.shareName === "string" ? body.shareName.trim() : ""
      if (!installId || !shareName) {
        return NextResponse.json({ ok: false, message: "共有テンプレ情報が不足しています" }, { status: 400 })
      }

      const shared = await shareTemplateInstall({
        admin,
        orgId: context.orgId,
        userId: context.userId,
        installId,
        name: shareName,
        description: typeof body.shareDescription === "string" ? body.shareDescription.trim() : "",
        sharingScope: body.sharingScope === "industry" ? "industry" : "org",
        industryTag: typeof body.industryTag === "string" ? body.industryTag.trim() : "",
        targetTemplateKey: typeof body.targetTemplateKey === "string" ? body.targetTemplateKey.trim() : "",
      })

      return NextResponse.json({ ok: true, shared }, { status: 200 })
    }

    if (action === "set_template_status") {
      const templateKey = typeof body.templateKey === "string" ? body.templateKey.trim() : ""
      if (!templateKey || (body.status !== "active" && body.status !== "archived")) {
        return NextResponse.json({ ok: false, message: "テンプレ状態の更新情報が不正です" }, { status: 400 })
      }

      await setTemplateCatalogStatus({
        admin,
        orgId: context.orgId,
        templateKey,
        status: body.status,
      })
      return NextResponse.json({ ok: true }, { status: 200 })
    }

    return NextResponse.json({ ok: false, message: "不明なテンプレ操作です" }, { status: 400 })
  } catch (error) {
    console.error("[api/pages/templates POST]", error)
    if (isSchemaMissing(error)) {
      return NextResponse.json(
        { ok: false, message: "最新の Pages テンプレ SQL が未適用です。`059_page_template_catalog.sql` と `060_page_template_lifecycle.sql` を適用してください。" },
        { status: 500 }
      )
    }
    return NextResponse.json({ ok: false, message: "テンプレ操作に失敗しました" }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const context = await getRequestContext(req)
    if ("error" in context) return context.error
    if (!requireTemplateAdmin(context.role)) {
      return NextResponse.json({ ok: false, message: "テンプレ削除の権限がありません" }, { status: 403 })
    }

    const installId = req.nextUrl.searchParams.get("installId")?.trim() || ""
    if (!installId) {
      return NextResponse.json({ ok: false, message: "installId が不正です" }, { status: 400 })
    }

    const admin = createSupabaseAdmin()
    await deleteTemplateInstall({
      admin,
      orgId: context.orgId,
      installId,
    })

    await writeAuditLog(admin, {
      org_id: context.orgId,
      user_id: context.userId,
      action: "page.template.install",
      resource_type: "template_install",
      resource_id: installId,
      meta: {},
    })

    return NextResponse.json({ ok: true }, { status: 200 })
  } catch (error) {
    console.error("[api/pages/templates DELETE]", error)
    if (isSchemaMissing(error)) {
      return NextResponse.json(
        { ok: false, message: "最新の Pages テンプレ SQL が未適用です。`059_page_template_catalog.sql` と `060_page_template_lifecycle.sql` を適用してください。" },
        { status: 500 }
      )
    }
    return NextResponse.json({ ok: false, message: "テンプレ削除に失敗しました" }, { status: 500 })
  }
}
