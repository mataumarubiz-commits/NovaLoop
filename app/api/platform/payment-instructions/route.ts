import { NextRequest, NextResponse } from "next/server"
import { requirePlatformUser } from "@/lib/platformAuth"
import { getPlatformBillingSettings } from "@/lib/platformServer"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(req: NextRequest) {
  const auth = await requirePlatformUser(req)
  if ("error" in auth) return auth.error

  const settings = await getPlatformBillingSettings()
  return NextResponse.json({
    ok: true,
    settings: {
      seller_name: settings.seller_name,
      seller_address: settings.seller_address,
      seller_phone: settings.seller_phone,
      seller_email: settings.seller_email,
      bank_name: settings.bank_name,
      bank_branch_name: settings.bank_branch_name,
      bank_branch_code: settings.bank_branch_code,
      bank_account_type: settings.bank_account_type,
      bank_account_number: settings.bank_account_number,
      bank_account_holder: settings.bank_account_holder,
      transfer_fee_note: settings.transfer_fee_note,
      invoice_registration_number: settings.invoice_registration_number,
      license_price_jpy: settings.license_price_jpy,
    },
  })
}
