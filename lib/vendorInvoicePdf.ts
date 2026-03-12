import puppeteer from "puppeteer-core"
import chromium from "@sparticuz/chromium"
import fs from "fs"
import { createSupabaseAdmin } from "@/lib/supabaseAdmin"
import { renderVendorInvoiceHtml } from "@/lib/pdf/renderVendorInvoiceHtml"

const BUCKET = "invoices"
const SIGNED_URL_EXPIRES = 60 * 10

const CHROME_CANDIDATES: string[] =
  process.platform === "win32"
    ? [
        process.env.PUPPETEER_EXECUTABLE_PATH ?? "",
        "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
        "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
      ]
    : process.platform === "darwin"
      ? [
          process.env.PUPPETEER_EXECUTABLE_PATH ?? "",
          "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
        ]
      : [
          process.env.PUPPETEER_EXECUTABLE_PATH ?? "",
          "/usr/bin/google-chrome",
          "/usr/bin/google-chrome-stable",
          "/usr/bin/chromium",
          "/usr/bin/chromium-browser",
        ]

async function getChromeExecutablePath(): Promise<string> {
  for (const p of CHROME_CANDIDATES) {
    if (!p) continue
    try {
      if (fs.existsSync(p)) return p
    } catch {
      // ignore
    }
  }
  return chromium.executablePath()
}

function safeFileName(s: string): string {
  return (s || "vendor-invoice")
    .replace(/[/\\:*?"<>|\s]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 100) || "vendor-invoice"
}

export async function generateVendorInvoicePdf(params: { orgId: string; invoiceId: string }) {
  const admin = createSupabaseAdmin()
  const { orgId, invoiceId } = params

  const { data: invoice, error: invoiceError } = await admin
    .from("vendor_invoices")
    .select("*")
    .eq("id", invoiceId)
    .eq("org_id", orgId)
    .maybeSingle()

  if (invoiceError || !invoice) throw new Error("Vendor invoice not found")

  const vendorId = (invoice as { vendor_id?: string }).vendor_id
  if (!vendorId) throw new Error("Vendor not found")

  const [{ data: vendor }, { data: lines }] = await Promise.all([
    admin.from("vendors").select("name, email").eq("id", vendorId).maybeSingle(),
    admin.from("vendor_invoice_lines").select("*").eq("vendor_invoice_id", invoiceId),
  ])

  if (!vendor) throw new Error("Vendor not found")

  const record = invoice as Record<string, unknown>
  const billingMonth = String(record.billing_month ?? "")
  const vendorName =
    String(
      (record.vendor_profile_snapshot as Record<string, unknown> | null)?.billing_name ??
        (vendor as { name?: string | null }).name ??
        "外注先"
    ) || "外注先"
  const invoiceNumber = String(record.invoice_number ?? `VENDOR-${billingMonth}`)
  const safeName = safeFileName(`${invoiceNumber}_${billingMonth}_${vendorName}`)
  const storagePath = `${orgId}/vendor-invoices/${billingMonth}/${safeName}.pdf`

  const html = renderVendorInvoiceHtml({
    invoice: record as Parameters<typeof renderVendorInvoiceHtml>[0]["invoice"],
    vendor: vendor as { name: string; email?: string | null },
    lines: (lines ?? []) as Parameters<typeof renderVendorInvoiceHtml>[0]["lines"],
  })

  let browser
  try {
    browser = await puppeteer.launch({
      headless: true,
      executablePath: await getChromeExecutablePath(),
      args: process.platform === "win32" ? [] : chromium.args,
    })

    const page = await browser.newPage()
    await page.setContent(html, { waitUntil: "networkidle0" })
    const pdfBuffer = await page.pdf({
      format: "A4",
      printBackground: true,
      margin: { top: "16mm", right: "12mm", bottom: "16mm", left: "12mm" },
    })

    const { error: uploadError } = await admin.storage
      .from(BUCKET)
      .upload(storagePath, pdfBuffer, { upsert: true, contentType: "application/pdf" })
    if (uploadError) throw new Error(`Upload failed: ${uploadError.message}`)

    const { error: updateError } = await admin
      .from("vendor_invoices")
      .update({ pdf_path: storagePath, updated_at: new Date().toISOString() })
      .eq("id", invoiceId)
      .eq("org_id", orgId)
    if (updateError) throw new Error("Failed to save pdf_path")

    const { data: signed } = await admin.storage.from(BUCKET).createSignedUrl(storagePath, SIGNED_URL_EXPIRES)

    return {
      pdfPath: storagePath,
      signedUrl: signed?.signedUrl ?? null,
    }
  } finally {
    if (browser) await browser.close().catch(() => {})
  }
}
