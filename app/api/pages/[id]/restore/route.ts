import { NextRequest, NextResponse } from "next/server"
import { requireOrgPermission } from "@/lib/adminApi"
import { writeAuditLog } from "@/lib/auditLog"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireOrgPermission(req, "pages_write")
    if (!auth.ok) return auth.response
    const { admin, userId, orgId } = auth
    const { id: pageId } = await params
    if (!pageId) return NextResponse.json({ ok: false, message: "page id は必須です" }, { status: 400 })

    let body: { revision_id?: string }
    try {
      body = await req.json()
    } catch {
      return NextResponse.json({ ok: false, message: "JSON が不正です" }, { status: 400 })
    }
    const revisionId = typeof body?.revision_id === "string" ? body.revision_id.trim() : ""
    if (!revisionId) return NextResponse.json({ ok: false, message: "revision_id は必須です" }, { status: 400 })

    const { data: page } = await admin.from("pages").select("id, org_id").eq("id", pageId).eq("org_id", orgId).maybeSingle()
    if (!page) return NextResponse.json({ ok: false, message: "ページが見つかりません" }, { status: 404 })

    const { data: rev } = await admin
      .from("page_revisions")
      .select("id, title, body_json")
      .eq("id", revisionId)
      .eq("page_id", pageId)
      .eq("org_id", orgId)
      .maybeSingle()

    if (!rev) return NextResponse.json({ ok: false, message: "リビジョンが見つかりません" }, { status: 404 })

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

    if (updateErr) return NextResponse.json({ ok: false, message: "復元に失敗しました" }, { status: 500 })

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
    return NextResponse.json({ ok: false, message: "復元に失敗しました" }, { status: 500 })
  }
}
