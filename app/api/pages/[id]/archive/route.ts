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
    const { id } = await params
    if (!id) return NextResponse.json({ ok: false, message: "id は必須です" }, { status: 400 })

    const { data: page, error: fetchErr } = await admin
      .from("pages")
      .select("id, org_id")
      .eq("id", id)
      .eq("org_id", orgId)
      .maybeSingle()
    if (fetchErr || !page) {
      return NextResponse.json({ ok: false, message: "ページが見つかりません" }, { status: 404 })
    }

    const now = new Date().toISOString()
    const updatePayload: Record<string, unknown> = { is_archived: true, updated_at: now }
    const primary = await admin.from("pages").update({ ...updatePayload, archived_at: now }).eq("id", id).eq("org_id", orgId)
    if (primary.error?.code === "42703") {
      await admin.from("pages").update(updatePayload).eq("id", id).eq("org_id", orgId)
    }

    await writeAuditLog(admin, { org_id: orgId, user_id: userId, action: "page.archive", resource_type: "page", resource_id: id })
    return NextResponse.json({ ok: true }, { status: 200 })
  } catch (e) {
    console.error("[api/pages/archive]", e)
    return NextResponse.json({ ok: false, message: "アーカイブに失敗しました" }, { status: 500 })
  }
}
