import { NextRequest, NextResponse } from "next/server"
import { requireAdminContext } from "@/lib/adminApi"
import { writeAuditLog } from "@/lib/auditLog"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(req: NextRequest) {
  const auth = await requireAdminContext(req)
  if ("error" in auth) return auth.error
  const { admin, orgId } = auth

  const { data: pages } = await admin
    .from("pages")
    .select("id, title, cover_path")
    .eq("org_id", orgId)
    .order("updated_at", { ascending: false })
    .limit(20)

  const { data: folders, error } = await admin.storage
    .from("page-assets")
    .list(`${orgId}/pages`, { limit: 100 })

  return NextResponse.json({
    ok: !error,
    error: error?.message ?? null,
    pageCount: (pages ?? []).length,
    assetFolderCount: (folders ?? []).length,
    pages: pages ?? [],
  })
}

export async function POST(req: NextRequest) {
  const auth = await requireAdminContext(req)
  if ("error" in auth) return auth.error
  const { admin, userId, orgId } = auth

  const body = await req.json().catch(() => ({}))
  const mode = typeof body?.mode === "string" ? body.mode : null
  const path = typeof body?.path === "string" ? body.path : null

  if (mode === "verify") {
    const { data, error } = await admin.storage.from("page-assets").list(`${orgId}/pages`, { limit: 100 })
    await writeAuditLog(admin, {
      org_id: orgId,
      user_id: userId,
      action: "asset.verify",
      resource_type: "asset",
      resource_id: null,
      meta: {
        folder_count: (data ?? []).length,
        error: error?.message ?? null,
      },
    })
    return NextResponse.json({
      ok: !error,
      error: error?.message ?? null,
      folderCount: (data ?? []).length,
    })
  }

  if (mode === "copy" && path) {
    const signed = await admin.storage.from("page-assets").createSignedUrl(path, 300)
    if (signed.error || !signed.data?.signedUrl) {
      return NextResponse.json({ ok: false, error: signed.error?.message ?? "署名 URL の発行に失敗しました" }, { status: 400 })
    }

    await writeAuditLog(admin, {
      org_id: orgId,
      user_id: userId,
      action: "asset.copy",
      resource_type: "asset",
      resource_id: null,
      meta: {
        path,
      },
    })

    return NextResponse.json({
      ok: true,
      url: signed.data.signedUrl,
    })
  }

  return NextResponse.json({ ok: false, error: "mode is required" }, { status: 400 })
}
