import { NextRequest, NextResponse } from "next/server"
import { requirePlatformUser } from "@/lib/platformAuth"
import { isManualPlatformPaymentEnabled } from "@/lib/platform"
import { getMyLicenseSnapshot } from "@/lib/platformServer"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(req: NextRequest) {
  const auth = await requirePlatformUser(req)
  if ("error" in auth) return auth.error

  const snapshot = await getMyLicenseSnapshot(auth.user.id)
  return NextResponse.json({
    ok: true,
    manual_payment_enabled: isManualPlatformPaymentEnabled(),
    ...snapshot,
  })
}
