import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"
import { createSupabaseAdmin } from "@/lib/supabaseAdmin"
import { renderVendorInvoiceHtml } from "@/lib/pdf/renderVendorInvoiceHtml"
import { createZip } from "@/lib/zip"
import puppeteer from "puppeteer-core"
import chromium from "@sparticuz/chromium"
import fs from "fs"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const BUCKET = "invoices"

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

async function ensureAuth(req: NextRequest): Promise<{ orgId: string } | NextResponse> {
  const authHeader = req.headers.get("Authorization")
  const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7).trim() : null
  if (!token) {
    return NextResponse.json({ error: "Authorization Bearer token required" }, { status: 401 })
  }
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !anonKey) {
    return NextResponse.json({ error: "Server configuration error" }, { status: 500 })
  }
  const supabase = createClient(url, anonKey)
  const { data: { user }, error: userError } = await supabase.auth.getUser(token)
  if (userError || !user) {
    return NextResponse.json({ error: "Invalid or expired token" }, { status: 401 })
  }
  const admin = createSupabaseAdmin()
  const { data: profile } = await admin.from("user_profiles").select("active_org_id").eq("user_id", user.id).maybeSingle()
  const orgId = (profile as { active_org_id?: string | null } | null)?.active_org_id ?? null
  if (!orgId) return NextResponse.json({ error: "No active org" }, { status: 400 })
  const { data: appUser } = await admin.from("app_users").select("role").eq("user_id", user.id).eq("org_id", orgId).maybeSingle()
  const role = (appUser as { role?: string } | null)?.role
  if (role !== "owner" && role !== "executive_assistant") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }
  return { orgId }
}

function safeFileName(s: string): string {
  return (s || "invoice")
    .replace(/[/\\:*?"<>|\s]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 100) || "invoice"
}

async function generatePdfBuffer(admin: ReturnType<typeof createSupabaseAdmin>, orgId: string, invoiceId: string) {
  const { data: inv, error: invErr } = await admin
    .from("vendor_invoices")
    .select("*")
    .eq("id", invoiceId)
    .eq("org_id", orgId)
    .maybeSingle()
  if (invErr || !inv) throw new Error("Vendor invoice not found")

  const vendorId = (inv as { vendor_id?: string }).vendor_id
  if (!vendorId) throw new Error("Vendor not found")

  const [{ data: vendor, error: vendorErr }, { data: lines, error: linesErr }] = await Promise.all([
    admin.from("vendors").select("name, email").eq("id", vendorId).maybeSingle(),
    admin.from("vendor_invoice_lines").select("*").eq("vendor_invoice_id", invoiceId),
  ])
  if (vendorErr || !vendor) throw new Error("Vendor not found")
  if (linesErr) throw new Error("Vendor invoice lines not found")

  const html = renderVendorInvoiceHtml({
    invoice: inv as Parameters<typeof renderVendorInvoiceHtml>[0]["invoice"],
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
    return { pdfBuffer: new Uint8Array(pdfBuffer), invoice: inv as Record<string, unknown>, vendor: vendor as { name: string } }
  } finally {
    if (browser) await browser.close().catch(() => {})
  }
}

export async function POST(req: NextRequest) {
  try {
    const authResult = await ensureAuth(req)
    if (authResult instanceof NextResponse) return authResult
    const { orgId } = authResult
    const body = (await req.json().catch(() => ({}))) as { invoiceIds?: string[] }
    const invoiceIds = Array.isArray(body.invoiceIds) ? body.invoiceIds.filter(Boolean) : []
    if (invoiceIds.length === 0) {
      return NextResponse.json({ error: "invoiceIds are required" }, { status: 400 })
    }

    const admin = createSupabaseAdmin()
    const files: Array<{ name: string; data: Uint8Array }> = []
    for (const invoiceId of invoiceIds) {
      const { data: row } = await admin
        .from("vendor_invoices")
        .select("pdf_path, billing_month, vendor_id")
        .eq("id", invoiceId)
        .eq("org_id", orgId)
        .maybeSingle()
      if (!row) continue

      let dataBuffer: Uint8Array | null = null
      let fileName = `vendor-invoice-${invoiceId}.pdf`

      const pdfPath = (row as { pdf_path?: string | null }).pdf_path
      if (pdfPath) {
        const download = await admin.storage.from(BUCKET).download(pdfPath)
        if (!download.error && download.data) {
          const arrayBuffer = await download.data.arrayBuffer()
          dataBuffer = new Uint8Array(arrayBuffer)
          const parts = pdfPath.split("/")
          fileName = parts[parts.length - 1] || fileName
        }
      }

      if (!dataBuffer) {
        const generated = await generatePdfBuffer(admin, orgId, invoiceId)
        dataBuffer = generated.pdfBuffer
        const billingMonth = String(generated.invoice.billing_month ?? "")
        fileName = `${safeFileName(`受領請求書_${billingMonth}_${generated.vendor.name}`)}.pdf`
      }

      files.push({ name: fileName, data: dataBuffer })
    }

    if (files.length === 0) {
      return NextResponse.json({ error: "No PDF files available" }, { status: 404 })
    }

    const zip = createZip(files)
    const response = new NextResponse(Buffer.from(zip))
    response.headers.set("Content-Type", "application/zip")
    response.headers.set("Content-Disposition", `attachment; filename="vendor_invoices_${new Date().toISOString().slice(0, 10)}.zip"`)
    return response
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "ZIP generation failed" },
      { status: 500 }
    )
  }
}
