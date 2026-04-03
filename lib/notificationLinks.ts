const PLATFORM_THANKS_NOTIFICATION_PATH = "/thanks"

export function safeNotificationHref(value: unknown) {
  if (typeof value !== "string") return null
  const normalized = value.trim()
  if (!normalized.startsWith("/")) return null
  if (normalized.startsWith("//")) return null
  return normalized
}

export function resolvePlatformNotificationHref(type: string, payload?: Record<string, unknown> | null) {
  const explicitHref = safeNotificationHref(payload?.action_href ?? payload?.actionHref)
  if (explicitHref) return explicitHref

  if (type === "platform.payment_pending") return "/pending-payment"
  if (type === "platform.license_activated") return `${PLATFORM_THANKS_NOTIFICATION_PATH}?from=notification`
  if (type === "platform.transfer_completed") return "/settings/license"
  return null
}
