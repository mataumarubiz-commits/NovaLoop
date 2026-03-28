import test from "node:test"
import assert from "node:assert/strict"

const platformModuleUrl = new URL("../lib/platform.ts", import.meta.url).href
const {
  PLATFORM_PRICE_JPY,
  buildInvoicePdfFileName,
  buildPlatformInvoicePath,
  buildPlatformReceiptPath,
  buildSoftDueDate,
  licenseAccessState,
} = await import(platformModuleUrl)

test("invoice file name follows the required format", () => {
  assert.equal(
    buildInvoicePdfFileName({
      invoiceMonth: "2026-03",
      recipientName: "株式会社サンプル",
      invoiceTitle: "新規Organization作成ライセンス購入",
    }),
    "【御請求書】2026-03_株式会社サンプル_新規Organization作成ライセンス購入.pdf"
  )
})

test("soft due date is issue date plus seven days", () => {
  assert.equal(buildSoftDueDate("2026-03-28"), "2026-04-04")
})

test("platform document paths stay separate from tenant invoice paths", () => {
  assert.equal(buildPlatformInvoicePath("NVL-2026-001001"), "invoices/NVL-2026-001001.pdf")
  assert.equal(buildPlatformReceiptPath("NVL-2026-001001"), "receipts/NVL-2026-001001.pdf")
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
