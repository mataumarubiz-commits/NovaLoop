import { NextRequest, NextResponse } from "next/server"
import { createSupabaseAdmin } from "@/lib/supabaseAdmin"
import { requirePlatformUser } from "@/lib/platformAuth"
import { getPlatformAppBaseUrl, getStripeCheckoutUrls, getStripePriceId, getStripeServerClient } from "@/lib/stripeServer"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(req: NextRequest) {
  const auth = await requirePlatformUser(req)
  if ("error" in auth) return auth.error

  try {
    const body = await req.json().catch(() => ({}))
    const paymentRequestId =
      typeof body?.payment_request_id === "string" ? body.payment_request_id.trim() : ""

    if (!paymentRequestId) {
      return NextResponse.json({ ok: false, error: "payment_request_id is required" }, { status: 400 })
    }

    const admin = createSupabaseAdmin()
    const { data: payment, error } = await admin
      .from("platform_payment_requests")
      .select(`
        *,
        purchase:entitlement_purchase_requests(
          id,
          request_number,
          full_name,
          company_name,
          contact_email,
          billing_email,
          billing_address
        )
      `)
      .eq("id", paymentRequestId)
      .eq("user_id", auth.user.id)
      .maybeSingle()

    if (error || !payment) {
      return NextResponse.json({ ok: false, error: "payment request not found" }, { status: 404 })
    }

    if (payment.status === "paid") {
      return NextResponse.json({ ok: false, error: "payment request is already paid" }, { status: 409 })
    }

    const stripe = getStripeServerClient()
    const baseUrl = getPlatformAppBaseUrl(req.nextUrl.origin)
    const { successUrl, cancelUrl } = getStripeCheckoutUrls(baseUrl)
    const purchaseRequestId =
      typeof payment.purchase_request_id === "string"
        ? payment.purchase_request_id
        : typeof payment.purchase?.id === "string"
          ? payment.purchase.id
          : null
    const customerEmail =
      (typeof payment.billing_email === "string" && payment.billing_email.trim()) ||
      (typeof payment.purchase?.billing_email === "string" && payment.purchase.billing_email.trim()) ||
      (typeof payment.purchase?.contact_email === "string" && payment.purchase.contact_email.trim()) ||
      auth.user.email ||
      undefined

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      line_items: [
        {
          price: getStripePriceId(),
          quantity: 1,
        },
      ],
      client_reference_id: String(payment.id),
      customer_email: customerEmail,
      success_url: successUrl,
      cancel_url: cancelUrl,
      locale: "ja",
      metadata: {
        platform_payment_request_id: String(payment.id),
        platform_purchase_request_id: purchaseRequestId ?? "",
        platform_user_id: auth.user.id,
        request_number: String(payment.request_number ?? ""),
      },
      payment_intent_data: {
        metadata: {
          platform_payment_request_id: String(payment.id),
          platform_purchase_request_id: purchaseRequestId ?? "",
          platform_user_id: auth.user.id,
          request_number: String(payment.request_number ?? ""),
        },
      },
    })

    const now = new Date().toISOString()
    const paymentIntentId =
      typeof session.payment_intent === "string" ? session.payment_intent : null

    const { error: checkoutInsertError } = await admin.from("platform_checkout_sessions").insert({
      payment_request_id: String(payment.id),
      purchase_request_id: purchaseRequestId,
      user_id: auth.user.id,
      provider: "stripe",
      checkout_session_id: session.id,
      payment_intent_id: paymentIntentId,
      status: session.status === "complete" ? "completed" : session.status ?? "open",
      success_url: successUrl,
      cancel_url: cancelUrl,
      customer_email: customerEmail ?? null,
      raw_payload_json: session,
      created_at: now,
      updated_at: now,
    })

    if (checkoutInsertError) {
      throw new Error(`Failed to persist checkout session: ${checkoutInsertError.message}`)
    }

    const { error: paymentUpdateError } = await admin
      .from("platform_payment_requests")
      .update({
        payment_provider: "stripe",
        payment_channel: "checkout",
        payment_method: "card",
        external_payment_id: paymentIntentId,
        updated_at: now,
      })
      .eq("id", String(payment.id))

    if (paymentUpdateError) {
      throw new Error(`Failed to update payment request: ${paymentUpdateError.message}`)
    }

    if (!session.url) {
      throw new Error("Stripe Checkout session URL is missing")
    }

    return NextResponse.json({
      ok: true,
      payment_request_id: String(payment.id),
      checkout_session_id: session.id,
      checkout_url: session.url,
    })
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Failed to create checkout session" },
      { status: 500 }
    )
  }
}
