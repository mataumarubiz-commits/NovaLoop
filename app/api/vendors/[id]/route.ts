import { NextRequest, NextResponse } from "next/server"
import { createSupabaseAdmin } from "@/lib/supabaseAdmin"
import { requireAdminActor } from "@/lib/vendorPortal"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id?: string }> }) {
  try {
    const actor = await requireAdminActor(req)
    const resolvedParams = await params
    const queryVendorId = new URL(req.url).searchParams.get("vendorId")
    const vendorId =
      typeof resolvedParams?.id === "string" && resolvedParams.id.trim()
        ? resolvedParams.id.trim()
        : typeof queryVendorId === "string" && queryVendorId.trim()
        ? queryVendorId.trim()
        : null

    if (!vendorId) {
      return NextResponse.json({ ok: false, error: "vendorId が存在しません" }, { status: 400 })
    }

    const admin = createSupabaseAdmin()
    const { data: vendor } = await admin
      .from("vendors")
      .select("id")
      .eq("id", vendorId)
      .eq("org_id", actor.orgId)
      .maybeSingle()

    if (!vendor) {
      return NextResponse.json({ ok: false, error: "外注先が見つかりません" }, { status: 404 })
    }

    const { error } = await admin
      .from("vendors")
      .update({ is_active: false })
      .eq("id", vendorId)
      .eq("org_id", actor.orgId)

    if (error) {
      throw new Error(error.message)
    }

    return NextResponse.json({ ok: true })
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "外注先の削除に失敗しました" },
      { status: 400 }
    )
  }
}
