import { NextRequest, NextResponse } from "next/server"
import { requireOrgPermission } from "@/lib/adminApi"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(req: NextRequest) {
  try {
    const auth = await requireOrgPermission(req, "pages_write")
    if (!auth.ok) return auth.response
    const { admin, orgId } = auth

    let body: { ordered_ids?: string[] }
    try {
      body = await req.json()
    } catch {
      return NextResponse.json({ ok: false, message: "JSON が不正です" }, { status: 400 })
    }

    const orderedIds = Array.isArray(body?.ordered_ids) ? body.ordered_ids : []
    if (orderedIds.length === 0) {
      return NextResponse.json({ ok: true }, { status: 200 })
    }

    for (let i = 0; i < orderedIds.length; i++) {
      const id = orderedIds[i]
      if (typeof id !== "string" || !id.trim()) continue
      await admin
        .from("pages")
        .update({ sort_order: i * 100 })
        .eq("id", id.trim())
        .eq("org_id", orgId)
    }

    return NextResponse.json({ ok: true }, { status: 200 })
  } catch (e) {
    console.error("[api/pages/reorder]", e)
    return NextResponse.json(
      { ok: false, message: "並び順の保存に失敗しました" },
      { status: 500 }
    )
  }
}
