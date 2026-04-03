import { NextRequest, NextResponse } from "next/server"
import { createSupabaseAdmin } from "@/lib/supabaseAdmin"
import { processPlatformPaymentSuccess } from "@/lib/platformReceiptService"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

type WebhookBody = {
  id?: string
  event_id?: string
  type?: string
  provider?: string
  payment_request_id?: string
  paid_at?: string
  paid_note?: string | null
  data?: Record<string, unknown> | null
}

const SUCCESS_EVENT_TYPES = new Set([
  "payment.succeeded",
  "payment_intent.succeeded",
  "checkout.session.completed",
  "platform.payment.succeeded",
])

function isAuthorized(req: NextRequest) {
  const secret = process.env.PLATFORM_PAYMENT_WEBHOOK_SECRET || process.env.CRON_SECRET
  if (!secret) return false
  const bearer = req.headers.get("authorization")
  if (bearer === `Bearer ${secret}`) return true
  return req.headers.get("x-platform-payment-webhook-secret") === secret
}

function stringOrNull(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null
}

function resolvePaymentRequestId(body: WebhookBody, existingPaymentRequestId?: string | null) {
  return (
    stringOrNull(body.payment_request_id) ||
    stringOrNull(body.data?.payment_request_id) ||
    stringOrNull(body.data?.["paymentRequestId"]) ||
    existingPaymentRequestId ||
    null
  )
}

function resolveExternalPaymentId(body: WebhookBody) {
  return (
    stringOrNull(body.data?.payment_intent) ||
    stringOrNull(body.data?.["paymentIntentId"]) ||
    stringOrNull(body.data?.external_payment_id) ||
    null
  )
}

export async function POST(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 })
  }

  const body = (await req.json().catch(() => ({}))) as WebhookBody
  const eventId = stringOrNull(body.event_id) || stringOrNull(body.id)
  const eventType = stringOrNull(body.type)
  const provider = stringOrNull(body.provider) || "platform_manual"

  if (!eventId || !eventType) {
    return NextResponse.json({ ok: false, error: "event_id and type are required" }, { status: 400 })
  }

  const admin = createSupabaseAdmin()
  const { data: existingEvent } = await admin
    .from("payment_webhook_events")
    .select("*")
    .eq("provider_event_id", eventId)
    .maybeSingle()

  if (existingEvent?.status === "processed") {
    return NextResponse.json({ ok: true, idempotent: true, status: "processed" })
  }

  const paymentRequestId = resolvePaymentRequestId(body, stringOrNull(existingEvent?.payment_request_id))
  const now = new Date().toISOString()
  const baseEventRow = {
    provider,
    provider_event_id: eventId,
    event_type: eventType,
    payment_request_id: paymentRequestId,
    payload_json: body,
    updated_at: now,
  }

  if (existingEvent) {
    await admin
      .from("payment_webhook_events")
      .update({
        ...baseEventRow,
        status: "received",
        last_error: null,
      })
      .eq("id", String(existingEvent.id))
  } else {
    await admin.from("payment_webhook_events").insert({
      ...baseEventRow,
      status: SUCCESS_EVENT_TYPES.has(eventType) ? "received" : "ignored",
      created_at: now,
      last_error: null,
    })
  }

  if (!SUCCESS_EVENT_TYPES.has(eventType)) {
    return NextResponse.json({ ok: true, ignored: true, status: "ignored" })
  }

  if (!paymentRequestId) {
    await admin
      .from("payment_webhook_events")
      .update({
        status: "failed",
        last_error: "payment_request_id is required for success events",
        updated_at: new Date().toISOString(),
      })
      .eq("provider_event_id", eventId)

    return NextResponse.json(
      { ok: false, error: "payment_request_id is required for success events" },
      { status: 400 }
    )
  }

  try {
    const result = await processPlatformPaymentSuccess({
      admin,
      paymentId: paymentRequestId,
      actorUserId: null,
      paidAtIso: stringOrNull(body.paid_at) ?? undefined,
      paidNote: stringOrNull(body.paid_note),
      providerPayload: body,
      notifyUser: true,
      paymentProvider: provider === "stripe" ? "stripe" : undefined,
      paymentChannel: provider === "stripe" ? "checkout" : undefined,
      paymentMethod: provider === "stripe" ? "stripe_checkout" : undefined,
      externalPaymentId: resolveExternalPaymentId(body),
      checkoutCompletedAtIso: stringOrNull(body.paid_at) ?? undefined,
    })

    await admin
      .from("payment_webhook_events")
      .update({
        payment_request_id: paymentRequestId,
        processed_at: new Date().toISOString(),
        status: "processed",
        last_error: null,
        updated_at: new Date().toISOString(),
      })
      .eq("provider_event_id", eventId)

    return NextResponse.json({
      ok: true,
      status: "processed",
      idempotent: result.idempotent,
      receipt_number: result.receipt.receipt_number,
    })
  } catch (error) {
    await admin
      .from("payment_webhook_events")
      .update({
        payment_request_id: paymentRequestId,
        status: "failed",
        last_error: error instanceof Error ? error.message : "webhook processing failed",
        updated_at: new Date().toISOString(),
      })
      .eq("provider_event_id", eventId)

    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "webhook processing failed", retryable: true },
      { status: 500 }
    )
  }
}
