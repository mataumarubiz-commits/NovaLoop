import { NextRequest, NextResponse } from "next/server"
import { requireOrgPermission } from "@/lib/adminApi"
import { titleToSlug, resolveSlugDuplicate } from "@/lib/slug"
import { writeAuditLog } from "@/lib/auditLog"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireOrgPermission(req, "pages_write")
    if (!auth.ok) return auth.response
    const { admin, userId, orgId } = auth
    const { id } = await params
    if (!id) return NextResponse.json({ ok: false, message: "id は必須です" }, { status: 400 })

    const { data: src, error: fetchErr } = await admin
      .from("pages")
      .select("id, title, content, body_text, sort_order, icon, cover_path")
      .eq("id", id)
      .eq("org_id", orgId)
      .maybeSingle()
    if (fetchErr || !src) {
      return NextResponse.json({ ok: false, message: "ページが見つかりません" }, { status: 404 })
    }
    const row = src as { title?: string; content?: unknown; body_text?: string | null; sort_order?: number; icon?: string | null; cover_path?: string | null }
    const newTitle = ((row.title || "").trim() || "") + " のコピー"
    const baseSlug = titleToSlug(newTitle)
    const { data: existing } = await admin
      .from("pages")
      .select("slug")
      .eq("org_id", orgId)
      .eq("is_archived", false)
    const slugs = (existing ?? []).map((r: { slug?: string | null }) => (r.slug || "").trim()).filter(Boolean)
    const slug = resolveSlugDuplicate(baseSlug, slugs)

    const { data: maxOrder } = await admin
      .from("pages")
      .select("sort_order")
      .eq("org_id", orgId)
      .order("sort_order", { ascending: false })
      .limit(1)
      .maybeSingle()
    const nextOrder = typeof (maxOrder as { sort_order?: number } | null)?.sort_order === "number"
      ? (maxOrder as { sort_order: number }).sort_order + 100
      : 0

    const insertPayload: Record<string, unknown> = {
      org_id: orgId,
      title: newTitle,
      content: row.content ?? {},
      body_text: row.body_text ?? null,
      sort_order: nextOrder,
      created_by: userId,
      updated_by: userId,
      slug: slug || null,
      icon: row.icon ?? null,
      cover_path: row.cover_path ?? null,
    }
    const { data: inserted, error: insertErr } = await admin
      .from("pages")
      .insert(insertPayload)
      .select("id")
      .single()
    if (insertErr) {
      if (insertErr.code === "42703") {
        const { data: ins2, error: e2 } = await admin
          .from("pages")
          .insert({
            org_id: orgId,
            title: newTitle,
            content: row.content ?? {},
            created_by: userId,
            updated_by: userId,
            sort_order: nextOrder,
          })
          .select("id")
          .single()
        if (e2 || !ins2) return NextResponse.json({ ok: false, message: "複製に失敗しました" }, { status: 500 })
        const newId = (ins2 as { id: string }).id
        await writeAuditLog(admin, { org_id: orgId, user_id: userId, action: "page.duplicate", resource_type: "page", resource_id: newId, meta: { source_page_id: id } })
        return NextResponse.json({ ok: true, id: newId }, { status: 200 })
      }
      return NextResponse.json({ ok: false, message: "複製に失敗しました" }, { status: 500 })
    }
    const newId = (inserted as { id: string }).id
    await writeAuditLog(admin, { org_id: orgId, user_id: userId, action: "page.duplicate", resource_type: "page", resource_id: newId, meta: { source_page_id: id } })
    return NextResponse.json({ ok: true, id: newId }, { status: 200 })
  } catch (e) {
    console.error("[api/pages/duplicate]", e)
    return NextResponse.json({ ok: false, message: "複製に失敗しました" }, { status: 500 })
  }
}
