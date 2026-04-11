import { NextRequest, NextResponse } from "next/server"
import { createSupabaseAdmin } from "@/lib/supabaseAdmin"
import { recordTransferWebhook } from "@/lib/transferAutomation"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(req: NextRequest) {
  const configuredSecret = process.env.TRANSFER_WEBHOOK_SECRET?.trim()
  if (configuredSecret) {
    const suppliedSecret = req.headers.get("x-transfer-webhook-secret")?.trim()
    if (suppliedSecret !== configuredSecret) {
      return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 })
    }
  }

  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
    const result = await recordTransferWebhook({
      admin: createSupabaseAdmin(),
      provider: String(body.provider ?? "manual"),
      providerTransferId: typeof body.providerTransferId === "string" ? body.providerTransferId : typeof body.provider_transfer_id === "string" ? body.provider_transfer_id : null,
      idempotencyKey: typeof body.idempotencyKey === "string" ? body.idempotencyKey : typeof body.idempotency_key === "string" ? body.idempotency_key : null,
      status: String(body.status ?? ""),
      failureCode: typeof body.failureCode === "string" ? body.failureCode : typeof body.failure_code === "string" ? body.failure_code : null,
      failureMessage: typeof body.failureMessage === "string" ? body.failureMessage : typeof body.failure_message === "string" ? body.failure_message : null,
      payload: body,
    })
    return NextResponse.json(result, { status: result.ok ? 200 : 404 })
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "failed to process transfer webhook" },
      { status: 500 }
    )
  }
}
