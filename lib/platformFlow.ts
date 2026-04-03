import type { CreatorEntitlementStatus } from "@/lib/platform"

export const PLATFORM_PURCHASE_ENTRY_PATH = "/request-org?from=lp"
export const PLATFORM_THANKS_PATH = "/thanks"
export const POST_PURCHASE_ONBOARDING_PATH = "/onboarding?flow=post-purchase"

export function resolvePlatformEntryPath(membershipCount: number) {
  if (membershipCount > 1) return "/orgs"
  if (membershipCount === 1) return "/home"
  return PLATFORM_PURCHASE_ENTRY_PATH
}

export function resolvePostPurchaseNextAction(membershipCount: number) {
  if (membershipCount > 1) {
    return {
      href: "/orgs",
      label: "ワークスペースを選ぶ",
      description: "利用する組織を選んで、そのまま運用を再開します。",
    }
  }

  if (membershipCount === 1) {
    return {
      href: "/home",
      label: "ホームへ進む",
      description: "利用できる組織があります。ホームから作業を開始します。",
    }
  }

  return {
    href: POST_PURCHASE_ONBOARDING_PATH,
    label: "初回セットアップを始める",
    description: "新しい組織を作成するか、既存組織に参加して利用を開始します。",
  }
}

export function shouldRedirectPendingPaymentToThanks(status: CreatorEntitlementStatus | null | undefined) {
  return status === "active"
}

export function resolvePendingPurchasePath(params: {
  entitlementStatus?: CreatorEntitlementStatus | null
  paymentProvider?: string | null
  paymentChannel?: string | null
  checkoutStatus?: string | null
}) {
  if (params.entitlementStatus === "active") {
    return PLATFORM_THANKS_PATH
  }

  if (params.paymentProvider === "stripe" && params.paymentChannel === "checkout") {
    return normalizeCheckoutStatus(params.checkoutStatus) === "completed"
      ? `${PLATFORM_THANKS_PATH}?from=stripe-checkout`
      : "/purchase-license?resume=1"
  }

  return "/pending-payment"
}

export function shouldUseManualPendingPayment(params: {
  paymentProvider?: string | null
  paymentChannel?: string | null
}) {
  return !(params.paymentProvider === "stripe" && params.paymentChannel === "checkout")
}

function normalizeCheckoutStatus(value: unknown) {
  if (value === "completed" || value === "complete") return "completed"
  if (value === "open" || value === "expired" || value === "canceled") return value
  return null
}
