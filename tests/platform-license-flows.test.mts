import test from "node:test"
import assert from "node:assert/strict"

const platformModuleUrl = new URL("../lib/platform.ts", import.meta.url).href
const platformFlowModuleUrl = new URL("../lib/platformFlow.ts", import.meta.url).href
const {
  PLATFORM_PRICE_JPY,
  buildInvoicePdfFileName,
  buildPlatformInvoicePath,
  buildPlatformReceiptPath,
  buildSoftDueDate,
  licenseAccessState,
} = await import(platformModuleUrl)
const {
  PLATFORM_PURCHASE_ENTRY_PATH,
  POST_PURCHASE_ONBOARDING_PATH,
  resolvePlatformEntryPath,
  resolvePostPurchaseNextAction,
  shouldRedirectPendingPaymentToThanks,
} = await import(platformFlowModuleUrl)

test("invoice file name follows the required format", () => {
  assert.equal(
    buildInvoicePdfFileName({
      invoiceMonth: "2026-03",
      recipientName: "株式会社サンプル",
      invoiceTitle: "新規Organization導入ライセンス購入",
    }),
    "【御請求書】2026-03_株式会社サンプル_新規Organization導入ライセンス購入.pdf"
  )
})

test("soft due date is issue date plus seven days", () => {
  assert.equal(buildSoftDueDate("2026-03-28"), "2026-04-04")
})

test("platform document paths stay separate from tenant invoice paths", () => {
  assert.equal(buildPlatformInvoicePath("NVL-2026-001001"), "invoices/NVL-2026-001001.pdf")
  assert.equal(buildPlatformReceiptPath("RCT-202604-000001"), "receipts/2026-04/RCT-202604-000001.pdf")
})

test("license access state only allows org creation for active entitlements", () => {
  assert.equal(licenseAccessState("active"), "can_create_org")
  assert.equal(licenseAccessState("pending_payment"), "pending_payment")
  assert.equal(licenseAccessState("transferred"), "purchase_required")
  assert.equal(licenseAccessState(null), "purchase_required")
})

test("platform price remains fixed at 300000 JPY", () => {
  assert.equal(PLATFORM_PRICE_JPY, 300000)
})

test("LP purchase entry routes existing users away from the purchase gate", () => {
  assert.equal(resolvePlatformEntryPath(0), PLATFORM_PURCHASE_ENTRY_PATH)
  assert.equal(resolvePlatformEntryPath(1), "/home")
  assert.equal(resolvePlatformEntryPath(2), "/orgs")
})

test("post purchase next action sends first-time buyers into onboarding", () => {
  assert.deepEqual(resolvePostPurchaseNextAction(0), {
    href: POST_PURCHASE_ONBOARDING_PATH,
    label: "初回セットアップを始める",
    description: "新しい組織を作成するか、既存組織に参加して利用を開始します。",
  })
  assert.equal(resolvePostPurchaseNextAction(1).href, "/home")
  assert.equal(resolvePostPurchaseNextAction(2).href, "/orgs")
})

test("pending payment only redirects to thanks after activation", () => {
  assert.equal(shouldRedirectPendingPaymentToThanks("active"), true)
  assert.equal(shouldRedirectPendingPaymentToThanks("pending_payment"), false)
  assert.equal(shouldRedirectPendingPaymentToThanks(null), false)
})
