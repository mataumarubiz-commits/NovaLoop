import { NextRequest, NextResponse } from "next/server"
import { requirePlatformAdmin } from "@/lib/platformAuth"
import { DEFAULT_PLATFORM_BILLING_SETTINGS, PLATFORM_PRICE_JPY } from "@/lib/platform"
import { getPlatformBillingSettings } from "@/lib/platformServer"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(req: NextRequest) {
  const auth = await requirePlatformAdmin(req)
  if ("error" in auth) return auth.error

  const settings = await getPlatformBillingSettings()
  return NextResponse.json({ ok: true, settings })
}

export async function POST(req: NextRequest) {
  const auth = await requirePlatformAdmin(req)
  if ("error" in auth) return auth.error

  try {
    const body = await req.json().catch(() => ({}))
    const payload = {
      id: true,
      seller_name: typeof body?.seller_name === "string" ? body.seller_name.trim() : DEFAULT_PLATFORM_BILLING_SETTINGS.seller_name,
      seller_address:
        typeof body?.seller_address === "string" ? body.seller_address.trim() : DEFAULT_PLATFORM_BILLING_SETTINGS.seller_address,
      seller_phone: typeof body?.seller_phone === "string" ? body.seller_phone.trim() : DEFAULT_PLATFORM_BILLING_SETTINGS.seller_phone,
      seller_email: typeof body?.seller_email === "string" ? body.seller_email.trim() : DEFAULT_PLATFORM_BILLING_SETTINGS.seller_email,
      bank_name: typeof body?.bank_name === "string" ? body.bank_name.trim() : DEFAULT_PLATFORM_BILLING_SETTINGS.bank_name,
      bank_branch_name:
        typeof body?.bank_branch_name === "string" ? body.bank_branch_name.trim() : DEFAULT_PLATFORM_BILLING_SETTINGS.bank_branch_name,
      bank_branch_code:
        typeof body?.bank_branch_code === "string" ? body.bank_branch_code.trim() : DEFAULT_PLATFORM_BILLING_SETTINGS.bank_branch_code,
      bank_account_type:
        typeof body?.bank_account_type === "string" ? body.bank_account_type.trim() : DEFAULT_PLATFORM_BILLING_SETTINGS.bank_account_type,
      bank_account_number:
        typeof body?.bank_account_number === "string" ? body.bank_account_number.trim() : DEFAULT_PLATFORM_BILLING_SETTINGS.bank_account_number,
      bank_account_holder:
        typeof body?.bank_account_holder === "string" ? body.bank_account_holder.trim() : DEFAULT_PLATFORM_BILLING_SETTINGS.bank_account_holder,
      transfer_fee_note:
        typeof body?.transfer_fee_note === "string" ? body.transfer_fee_note.trim() : DEFAULT_PLATFORM_BILLING_SETTINGS.transfer_fee_note,
      qualified_invoice_enabled: body?.qualified_invoice_enabled === true,
      invoice_registration_number:
        typeof body?.invoice_registration_number === "string" ? body.invoice_registration_number.trim() || null : null,
      default_tax_mode: DEFAULT_PLATFORM_BILLING_SETTINGS.default_tax_mode,
      license_price_jpy: PLATFORM_PRICE_JPY,
      updated_at: new Date().toISOString(),
    }

    const { error } = await auth.admin.from("platform_billing_settings").upsert(payload, { onConflict: "id" })
    if (error) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
    }

    return NextResponse.json({ ok: true, settings: await getPlatformBillingSettings() })
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "failed to update billing settings" },
      { status: 500 }
    )
  }
}
