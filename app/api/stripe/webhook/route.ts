import type Stripe from "stripe"
import { NextRequest, NextResponse } from "next/server"
import { createSupabaseAdmin } from "@/lib/supabaseAdmin"
import { processPlatformPaymentSuccess } from "@/lib/platformReceiptService"
import { getStripeServerClient, getStripeWebhookSecret } from "@/lib/stripeServer"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(req: NextRequest) {
  const signature = req.headers.get("stripe-signature")
  if (!signature) {
    return NextResponse.json({ ok: false, error: "missing stripe-signature header" }, { status: 400 })
  }

  let event: Stripe.Event
  try {
    const payload = await req.text()
    event = getStripeServerClient().webhooks.constructEvent(payload, signature, getStripeWebhookSecret())
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "invalid stripe signature" },
      { status: 400 }
    )
  }

  const admin = createSupabaseAdmin()
  const now = new Date().toISOString()
  const session =
    event.type === "checkout.session.completed" ? (event.data.object as Stripe.Checkout.Session) : null
  const paymentRequestId = resolveStripePaymentRequestId(session)

  const { data: existingEvent } = await admin
    .from("payment_webhook_events")
    .select("*")
    .eq("provider_event_id", event.id)
    .maybeSingle()

  if (existingEvent?.status === "processed") {
    return NextResponse.json({ ok: true, idempotent: true, status: "processed" })
  }

  const baseEventRow = {
    provider: "stripe",
    provider_event_id: event.id,
    event_type: event.type,
    payment_request_id: paymentRequestId,
    payload_json: event,
    updated_at: now,
  }

  if (existingEvent) {
    await admin
      .from("payment_webhook_events")
      .update({
        ...baseEventRow,
        status: event.type === "checkout.session.completed" ? "received" : "ignored",
        last_error: null,
      })
      .eq("id", String(existingEvent.id))
  } else {
    await admin.from("payment_webhook_events").insert({
      ...baseEventRow,
      status: event.type === "checkout.session.completed" ? "received" : "ignored",
      last_error: null,
      created_at: now,
    })
  }

  if (event.type !== "checkout.session.completed") {
    return NextResponse.json({ ok: true, ignored: true, status: "ignored" })
  }

  if (!session || !paymentRequestId) {
    await admin
      .from("payment_webhook_events")
      .update({
        status: "failed",
        last_error: "platform payment request metadata is missing",
        updated_at: new Date().toISOString(),
      })
      .eq("provider_event_id", event.id)

    return NextResponse.json(
      { ok: false, error: "platform payment request metadata is missing" },
      { status: 400 }
    )
  }

  const paymentIntentId = typeof session.payment_intent === "string" ? session.payment_intent : null
  const { data: paymentRow } = await admin
    .from("platform_payment_requests")
    .select("id, user_id, purchase_request_id")
    .eq("id", paymentRequestId)
    .maybeSingle()

  const checkoutUserId = resolveString(session.metadata?.platform_user_id) ?? resolveString(paymentRow?.user_id)
  const purchaseRequestId =
    resolveString(session.metadata?.platform_purchase_request_id) ?? resolveString(paymentRow?.purchase_request_id)

  if (!checkoutUserId) {
    await admin
      .from("payment_webhook_events")
      .update({
        status: "failed",
        last_error: "platform checkout user is missing",
        updated_at: new Date().toISOString(),
      })
      .eq("provider_event_id", event.id)

    return NextResponse.json({ ok: false, error: "platform checkout user is missing" }, { status: 400 })
  }

  await upsertPlatformCheckoutSession(admin, {
    paymentRequestId,
    purchaseRequestId,
    userId: checkoutUserId,
    checkoutSessionId: session.id,
    paymentIntentId,
    status: "completed",
    successUrl: typeof session.success_url === "string" ? session.success_url : "",
    cancelUrl: typeof session.cancel_url === "string" ? session.cancel_url : "",
    customerEmail: typeof session.customer_email === "string" ? session.customer_email : null,
    rawPayload: session,
  })

  try {
    const result = await processPlatformPaymentSuccess({
      admin,
      paymentId: paymentRequestId,
      paidAtIso: new Date(event.created * 1000).toISOString(),
      providerPayload: event as unknown as Record<string, unknown>,
      notifyUser: true,
      paymentProvider: "stripe",
      paymentChannel: "checkout",
      paymentMethod: "stripe_checkout",
      externalPaymentId: paymentIntentId ?? session.id,
      checkoutCompletedAtIso: new Date(event.created * 1000).toISOString(),
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
      .eq("provider_event_id", event.id)

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
        last_error: error instanceof Error ? error.message : "stripe webhook processing failed",
        updated_at: new Date().toISOString(),
      })
      .eq("provider_event_id", event.id)

    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "stripe webhook processing failed" },
      { status: 500 }
    )
  }
}

function resolveStripePaymentRequestId(session: Stripe.Checkout.Session | null) {
  return (
    resolveString(session?.metadata?.platform_payment_request_id) ||
    resolveString(session?.client_reference_id) ||
    null
  )
}

async function upsertPlatformCheckoutSession(
  admin: ReturnType<typeof createSupabaseAdmin>,
  input: {
    paymentRequestId: string
    purchaseRequestId: string | null
    userId: string | null
    checkoutSessionId: string
    paymentIntentId: string | null
    status: "completed"
    successUrl: string
    cancelUrl: string
    customerEmail: string | null
    rawPayload: Stripe.Checkout.Session
  }
) {
  const now = new Date().toISOString()
  const { data: existing } = await admin
    .from("platform_checkout_sessions")
    .select("id")
    .eq("checkout_session_id", input.checkoutSessionId)
    .maybeSingle()

  const payload = {
    payment_request_id: input.paymentRequestId,
    purchase_request_id: input.purchaseRequestId,
    user_id: input.userId,
    provider: "stripe",
    checkout_session_id: input.checkoutSessionId,
    payment_intent_id: input.paymentIntentId,
    status: input.status,
    success_url: input.successUrl || "/thanks",
    cancel_url: input.cancelUrl || "/purchase-license",
    customer_email: input.customerEmail,
    raw_payload_json: input.rawPayload,
    updated_at: now,
  }

  if (existing?.id) {
    await admin.from("platform_checkout_sessions").update(payload).eq("id", String(existing.id))
    return
  }

  await admin.from("platform_checkout_sessions").insert({
    ...payload,
    created_at: now,
  })
}

function resolveString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null
}
