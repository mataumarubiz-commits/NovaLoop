import Stripe from "stripe"
import { PLATFORM_STRIPE_PRODUCT_NAME } from "@/lib/platform"

let stripeClient: Stripe | null = null

export function getStripeServerClient() {
  const secretKey = process.env.STRIPE_SECRET_KEY?.trim()
  if (!secretKey) {
    throw new Error("STRIPE_SECRET_KEY is not configured")
  }

  if (!stripeClient) {
    stripeClient = new Stripe(secretKey)
  }

  return stripeClient
}

export function getStripePriceId() {
  const priceId = process.env.STRIPE_PRICE_ID?.trim()
  if (!priceId) {
    throw new Error("STRIPE_PRICE_ID is not configured")
  }

  return priceId
}

export function getStripeWebhookSecret() {
  const secret = process.env.STRIPE_WEBHOOK_SECRET?.trim()
  if (!secret) {
    throw new Error("STRIPE_WEBHOOK_SECRET is not configured")
  }

  return secret
}

export function getPlatformAppBaseUrl(fallbackOrigin?: string | null) {
  const configured = process.env.NEXT_PUBLIC_APP_URL?.trim()
  const baseUrl = configured || fallbackOrigin?.trim() || ""
  if (!baseUrl) {
    throw new Error("NEXT_PUBLIC_APP_URL is not configured")
  }

  return baseUrl.replace(/\/$/, "")
}

export function getStripeCheckoutUrls(baseUrl: string) {
  return {
    successUrl: `${baseUrl}/thanks?from=stripe-checkout&session_id={CHECKOUT_SESSION_ID}`,
    cancelUrl: `${baseUrl}/purchase-license?from=request-org&canceled=1`,
  }
}

export function getStripeProductName() {
  return PLATFORM_STRIPE_PRODUCT_NAME
}
