import { NextRequest, NextResponse } from "next/server"
import { createSupabaseAdmin } from "@/lib/supabaseAdmin"
import { loadVendorProfileAndBank, requireVendorActor } from "@/lib/vendorPortal"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(req: NextRequest) {
  try {
    const actor = await requireVendorActor(req)
    const { profile } = await loadVendorProfileAndBank(actor)
    return NextResponse.json({ ok: true, profile })
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "プロフィール情報を取得できませんでした。" },
      { status: 400 }
    )
  }
}

export async function PUT(req: NextRequest) {
  try {
    const actor = await requireVendorActor(req)
    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null
    if (!body) return NextResponse.json({ ok: false, error: "リクエスト形式が不正です。" }, { status: 400 })

    const payload = {
      org_id: actor.orgId,
      vendor_id: actor.vendorId,
      display_name: typeof body.display_name === "string" ? body.display_name.trim() : "",
      legal_name: typeof body.legal_name === "string" ? body.legal_name.trim() : "",
      company_name: typeof body.company_name === "string" ? body.company_name.trim() : "",
      email: typeof body.email === "string" ? body.email.trim() : "",
      billing_name: typeof body.billing_name === "string" ? body.billing_name.trim() : "",
      postal_code: typeof body.postal_code === "string" ? body.postal_code.trim() : "",
      address: typeof body.address === "string" ? body.address.trim() : "",
      registration_number: typeof body.registration_number === "string" ? body.registration_number.trim() : "",
      notes: typeof body.notes === "string" ? body.notes.trim() : "",
      updated_at: new Date().toISOString(),
    }

    const admin = createSupabaseAdmin()
    const { error } = await admin.from("vendor_profiles").upsert(payload, { onConflict: "org_id,vendor_id" })
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })

    await admin.from("vendors").update({
      name: payload.display_name || payload.legal_name || payload.company_name || actor.vendorName,
      email: payload.email || null,
    }).eq("id", actor.vendorId).eq("org_id", actor.orgId)

    return NextResponse.json({ ok: true, profile: payload })
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "プロフィール情報を保存できませんでした。" },
      { status: 400 }
    )
  }
}
