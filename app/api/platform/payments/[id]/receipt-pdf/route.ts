import { NextRequest, NextResponse } from "next/server"
import { requirePlatformUser } from "@/lib/platformAuth"
import { createSupabaseAdmin } from "@/lib/supabaseAdmin"
import { getPlatformReceiptDownload } from "@/lib/platformReceiptService"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requirePlatformUser(req)
  if ("error" in auth) return auth.error

  const { id } = await params
  const paymentId = id?.trim()
  if (!paymentId) {
    return NextResponse.json({ ok: false, error: "payment id is required" }, { status: 400 })
  }

  const admin = createSupabaseAdmin()
  const { data: payment, error } = await admin
    .from("platform_payment_requests")
    .select("id, user_id")
    .eq("id", paymentId)
    .maybeSingle()

  if (error || !payment || payment.user_id !== auth.user.id) {
    return NextResponse.json({ ok: false, error: "payment request not found" }, { status: 404 })
  }

  try {
    const { receipt, signedUrl } = await getPlatformReceiptDownload({
      admin,
      paymentId,
    })

    return NextResponse.json({
      ok: true,
      receipt_number: receipt.receipt_number,
      pdf_path: receipt.pdf_path,
      signed_url: signedUrl,
    })
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "failed to regenerate receipt pdf" },
      { status: 500 }
    )
  }
}
