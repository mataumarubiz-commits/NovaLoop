import { NextRequest, NextResponse } from "next/server"
import { requirePlatformAdmin } from "@/lib/platformAuth"
import { createPlatformDocumentSignedUrl } from "@/lib/platformDocuments"
import { processPlatformPaymentSuccess } from "@/lib/platformReceiptService"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requirePlatformAdmin(req)
  if ("error" in auth) return auth.error

  const { id } = await params
  const paymentId = id?.trim()
  if (!paymentId) {
    return NextResponse.json({ ok: false, error: "payment id is required" }, { status: 400 })
  }

  try {
    const body = await req.json().catch(() => ({}))
    const paidNote = typeof body?.paid_note === "string" ? body.paid_note.trim() : null
    const paidAtIso = typeof body?.paid_at === "string" && body.paid_at.trim() ? body.paid_at.trim() : undefined

    const result = await processPlatformPaymentSuccess({
      admin: auth.admin,
      paymentId,
      actorUserId: auth.user.id,
      paidAtIso,
      paidNote,
      providerPayload: {
        source: "platform_admin_mark_paid",
        request_body: body,
      },
      paymentProvider: "manual",
      paymentChannel: "bank_transfer",
      paymentMethod: "bank_transfer",
    })

    return NextResponse.json({
      ok: true,
      idempotent: result.idempotent,
      request_number: result.context.payment.request_number,
      receipt_number: result.receipt.receipt_number,
      receipt_pdf_path: result.receipt.pdf_path,
      receipt_signed_url: await createPlatformDocumentSignedUrl(
        typeof result.receipt.pdf_path === "string" ? result.receipt.pdf_path : null
      ),
    })
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Failed to mark payment paid" },
      { status: 500 }
    )
  }
}
