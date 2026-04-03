export const DEFAULT_PUBLIC_AUTH_TARGET = "/onboarding"
export const AUTH_FINISH_PATH = "/auth/finish"

export function normalizePublicAuthTarget(value: string | null | undefined, fallback = DEFAULT_PUBLIC_AUTH_TARGET) {
  if (!value || !value.startsWith("/")) return fallback
  if (value.startsWith("//")) return fallback
  return value
}

export function buildAuthFinishRedirectPath(origin: string, target: string) {
  const normalizedOrigin = origin.replace(/\/$/, "")
  const normalizedTarget = normalizePublicAuthTarget(target)
  return `${normalizedOrigin}${AUTH_FINISH_PATH}?next=${encodeURIComponent(normalizedTarget)}`
}
