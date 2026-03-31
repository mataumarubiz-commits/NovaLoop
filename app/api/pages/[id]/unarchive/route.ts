import { NextRequest, NextResponse } from "next/server"
import { requireOrgPermission } from "@/lib/adminApi"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireOrgPermission(req, "pages_write")
    if (!auth.ok) return auth.response
    const { admin, orgId } = auth
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

    const { error: updateErr } = await admin
      .from("pages")
      .update({ is_archived: false, archived_at: null })
      .eq("id", id)
      .eq("org_id", orgId)

    if (updateErr) return NextResponse.json({ ok: false, message: "アーカイブ解除に失敗しました" }, { status: 500 })
    return NextResponse.json({ ok: true }, { status: 200 })
  } catch (e) {
    console.error("[api/pages/unarchive]", e)
    return NextResponse.json({ ok: false, message: "アーカイブ解除に失敗しました" }, { status: 500 })
  }
}
