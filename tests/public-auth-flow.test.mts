import test from "node:test"
import assert from "node:assert/strict"

const publicAuthFlowModuleUrl = new URL("../lib/publicAuthFlow.ts", import.meta.url).href
const notificationLinksModuleUrl = new URL("../lib/notificationLinks.ts", import.meta.url).href

const {
  AUTH_FINISH_PATH,
  DEFAULT_PUBLIC_AUTH_TARGET,
  buildAuthFinishRedirectPath,
  normalizePublicAuthTarget,
} = await import(publicAuthFlowModuleUrl)

const { resolvePlatformNotificationHref } = await import(notificationLinksModuleUrl)

test("public auth target normalization keeps only internal paths", () => {
  assert.equal(normalizePublicAuthTarget(null), DEFAULT_PUBLIC_AUTH_TARGET)
  assert.equal(normalizePublicAuthTarget(""), DEFAULT_PUBLIC_AUTH_TARGET)
  assert.equal(normalizePublicAuthTarget("https://example.com"), DEFAULT_PUBLIC_AUTH_TARGET)
  assert.equal(normalizePublicAuthTarget("//evil.example"), DEFAULT_PUBLIC_AUTH_TARGET)
  assert.equal(normalizePublicAuthTarget("/request-org?from=lp"), "/request-org?from=lp")
})

test("auth finish redirect path preserves the intended in-app destination", () => {
  assert.equal(
    buildAuthFinishRedirectPath("https://novaloop.example.com/", "/request-org?from=lp"),
    `https://novaloop.example.com${AUTH_FINISH_PATH}?next=%2Frequest-org%3Ffrom%3Dlp`
  )
})

test("platform activation notifications default to the thanks handoff", () => {
  assert.equal(
    resolvePlatformNotificationHref("platform.license_activated", {}),
    "/thanks?from=notification"
  )
})

test("notification payload can override action href only with safe internal paths", () => {
  assert.equal(
    resolvePlatformNotificationHref("platform.license_activated", { action_href: "/thanks?from=custom" }),
    "/thanks?from=custom"
  )
  assert.equal(
    resolvePlatformNotificationHref("platform.license_activated", { action_href: "https://example.com" }),
    "/thanks?from=notification"
  )
})
