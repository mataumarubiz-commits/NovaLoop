import fs from "fs"
import chromium from "@sparticuz/chromium"
import puppeteer from "puppeteer-core"
import { createSupabaseAdmin } from "@/lib/supabaseAdmin"
import {
  PLATFORM_DOCUMENT_BUCKET,
  PLATFORM_DOCUMENT_URL_EXPIRES_SECONDS,
  buildPlatformInvoicePath,
  buildPlatformReceiptPath,
} from "@/lib/platform"

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
  for (const candidate of CHROME_CANDIDATES) {
    if (!candidate) continue
    try {
      if (fs.existsSync(candidate)) return candidate
    } catch {
      // ignore
    }
  }
  return chromium.executablePath()
}

export async function renderPdfBuffer(html: string) {
  let browser: Awaited<ReturnType<typeof puppeteer.launch>> | null = null
  try {
    browser = await puppeteer.launch({
      headless: true,
      executablePath: await getChromeExecutablePath(),
      args: process.platform === "win32" ? [] : chromium.args,
    })
    const page = await browser.newPage()
    await page.setContent(html, { waitUntil: "networkidle0" })
    return await page.pdf({
      format: "A4",
      printBackground: true,
      margin: { top: "14mm", right: "12mm", bottom: "14mm", left: "12mm" },
    })
  } finally {
    if (browser) await browser.close().catch(() => {})
  }
}

export async function uploadPlatformInvoicePdf(requestNumber: string, html: string) {
  const admin = createSupabaseAdmin()
  const storagePath = buildPlatformInvoicePath(requestNumber)
  const pdf = await renderPdfBuffer(html)
  const { error } = await admin.storage
    .from(PLATFORM_DOCUMENT_BUCKET)
    .upload(storagePath, pdf, { upsert: true, contentType: "application/pdf" })
  if (error) throw new Error(`Failed to upload invoice PDF: ${error.message}`)
  return storagePath
}

export async function uploadPlatformReceiptPdf(receiptNumber: string, issuedAt: string, html: string) {
  const admin = createSupabaseAdmin()
  const storagePath = buildPlatformReceiptPath(receiptNumber, issuedAt.slice(0, 7))
  const pdf = await renderPdfBuffer(html)
  const { error } = await admin.storage
    .from(PLATFORM_DOCUMENT_BUCKET)
    .upload(storagePath, pdf, { upsert: true, contentType: "application/pdf" })
  if (error) throw new Error(`Failed to upload receipt PDF: ${error.message}`)
  return storagePath
}

export async function createPlatformDocumentSignedUrl(path: string | null | undefined) {
  if (!path) return null
  const admin = createSupabaseAdmin()
  const { data } = await admin.storage
    .from(PLATFORM_DOCUMENT_BUCKET)
    .createSignedUrl(path, PLATFORM_DOCUMENT_URL_EXPIRES_SECONDS)
  return data?.signedUrl ?? null
}
