import { NextRequest, NextResponse } from "next/server"
import { createSupabaseAdmin } from "@/lib/supabaseAdmin"
import { loadVendorProfileAndBank, requireVendorActor } from "@/lib/vendorPortal"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(req: NextRequest) {
  try {
    const actor = await requireVendorActor(req)
    const { bank } = await loadVendorProfileAndBank(actor)
    return NextResponse.json({ ok: true, bankAccount: bank })
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "口座情報を取得できませんでした。" },
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
      bank_name: typeof body.bank_name === "string" ? body.bank_name.trim() : "",
      branch_name: typeof body.branch_name === "string" ? body.branch_name.trim() : "",
      account_type: body.account_type === "checking" || body.account_type === "savings" ? String(body.account_type) : "ordinary",
      account_number: typeof body.account_number === "string" ? body.account_number.trim() : "",
      account_holder: typeof body.account_holder === "string" ? body.account_holder.trim() : "",
      is_default: true,
      updated_at: new Date().toISOString(),
    }

    if (!payload.bank_name || !payload.branch_name || !payload.account_number || !payload.account_holder) {
      return NextResponse.json({ ok: false, error: "口座情報をすべて入力してください。" }, { status: 400 })
    }

    const admin = createSupabaseAdmin()
    const { data: current } = await admin.from("vendor_bank_accounts").select("id").eq("org_id", actor.orgId).eq("vendor_id", actor.vendorId).eq("is_default", true).maybeSingle()

    if (current?.id) {
      const { error } = await admin.from("vendor_bank_accounts").update(payload).eq("id", current.id).eq("org_id", actor.orgId)
      if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
    } else {
      const { error } = await admin.from("vendor_bank_accounts").insert(payload)
      if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
    }

    return NextResponse.json({ ok: true, bankAccount: payload })
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "口座情報を保存できませんでした。" },
      { status: 400 }
    )
  }
}
