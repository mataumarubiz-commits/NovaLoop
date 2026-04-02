import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"
import { createSupabaseAdmin } from "@/lib/supabaseAdmin"
import { buildInvoicePdfBaseName, resolveInvoiceRecipientName, safeInvoicePdfFileName } from "@/lib/invoiceNaming"
import { renderInvoiceHtml } from "@/lib/pdf/renderInvoiceHtml"
import puppeteer from "puppeteer-core"
import chromium from "@sparticuz/chromium"
import fs from "fs"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const BUCKET = "invoices"
const SIGNED_URL_EXPIRES = 60 * 10 // 10 min

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

async function ensureAuth(req: NextRequest): Promise<{ userId: string; orgId: string } | NextResponse> {
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
  const { data: appUser, error: appError } = await admin
    .from("app_users")
    .select("org_id, role")
    .eq("user_id", user.id)
    .maybeSingle()
  if (appError || !appUser) {
    return NextResponse.json({ error: "User org/role not found" }, { status: 403 })
  }
  const role = (appUser as { role?: string }).role
  const orgId = (appUser as { org_id?: string }).org_id
  if (role !== "owner" && role !== "executive_assistant" || !orgId) {
    return NextResponse.json({ error: "Forbidden: owner or executive_assistant only" }, { status: 403 })
  }
  return { userId: user.id, orgId }
}

/** GET: 既存 pdf_path の署名URLを返す */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authResult = await ensureAuth(req)
  if (authResult instanceof NextResponse) return authResult
  const { orgId } = authResult
  const { id: invoiceId } = await params
  if (!invoiceId) {
    return NextResponse.json({ error: "Invoice ID required" }, { status: 400 })
  }

  const admin = createSupabaseAdmin()
  const { data: invoice, error: invError } = await admin
    .from("invoices")
    .select("pdf_path")
    .eq("id", invoiceId)
    .eq("org_id", orgId)
    .maybeSingle()
  if (invError || !invoice) {
    return NextResponse.json({ error: "Invoice not found or access denied" }, { status: 404 })
  }

  const pdfPath = (invoice as { pdf_path?: string | null }).pdf_path
  if (!pdfPath) {
    return NextResponse.json({ error: "PDF not generated yet" }, { status: 404 })
  }

  const { data, error } = await admin.storage.from(BUCKET).createSignedUrl(pdfPath, SIGNED_URL_EXPIRES)
  if (error) {
    return NextResponse.json({ error: `Signed URL failed: ${error.message}` }, { status: 500 })
  }
  return NextResponse.json({ signed_url: data?.signedUrl ?? null })
}

/** POST: HTML→PDF 生成 → Storage アップロード → pdf_path 更新 → 署名URL返却 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authResult = await ensureAuth(req)
  if (authResult instanceof NextResponse) return authResult
  const { orgId } = authResult
  const { id: invoiceId } = await params
  if (!invoiceId) {
    return NextResponse.json({ error: "Invoice ID required" }, { status: 400 })
  }

  const admin = createSupabaseAdmin()

  const { data: invoice, error: invError } = await admin
    .from("invoices")
    .select("*")
    .eq("id", invoiceId)
    .eq("org_id", orgId)
    .maybeSingle()
  if (invError || !invoice) {
    return NextResponse.json({ error: "Invoice not found or access denied" }, { status: 404 })
  }

  const clientId = (invoice as { client_id?: string | null }).client_id
  let clientName = ""
  if (clientId) {
    const { data: client, error: clientError } = await admin
      .from("clients")
      .select("name")
      .eq("id", clientId)
      .maybeSingle()
    if (clientError || !client) {
      return NextResponse.json({ error: "Client not found" }, { status: 404 })
    }
    clientName = (client as { name?: string } | null)?.name?.trim() ?? ""
  }

  const { data: lines, error: linesError } = await admin
    .from("invoice_lines")
    .select("*")
    .eq("invoice_id", invoiceId)
    .order("sort_order", { ascending: true })
  if (linesError) {
    return NextResponse.json({ error: "Failed to load invoice lines" }, { status: 500 })
  }

  const inv = invoice as Record<string, unknown>
  const invoiceMonth = (inv.invoice_month as string) || ""
  const recipientName = resolveInvoiceRecipientName({
    clientName,
    guestCompanyName: typeof inv.guest_company_name === "string" ? inv.guest_company_name : null,
    guestClientName: typeof inv.guest_client_name === "string" ? inv.guest_client_name : null,
  })
  const safeName = safeInvoicePdfFileName(
    buildInvoicePdfBaseName({
      invoiceMonth,
      clientName,
      guestCompanyName: typeof inv.guest_company_name === "string" ? inv.guest_company_name : null,
      guestClientName: typeof inv.guest_client_name === "string" ? inv.guest_client_name : null,
      invoiceTitle: typeof inv.invoice_title === "string" ? inv.invoice_title : null,
      invoiceName: typeof inv.invoice_name === "string" ? inv.invoice_name : null,
    })
  )
  const storagePath = `${orgId}/invoices/${invoiceMonth}/${safeName}.pdf`

  // クライアント情報（billing_name / contact_name も取得）
  let clientBillingName: string | null = null
  let clientContactName: string | null = null
  if (clientId) {
    const { data: clientFull } = await admin
      .from("clients")
      .select("billing_name, contact_name")
      .eq("id", clientId)
      .maybeSingle()
    clientBillingName = (clientFull as { billing_name?: string | null } | null)?.billing_name ?? null
    clientContactName = (clientFull as { contact_name?: string | null } | null)?.contact_name ?? null
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || req.nextUrl.origin || ""

  const html = renderInvoiceHtml({
    invoice: inv as Parameters<typeof renderInvoiceHtml>[0]["invoice"],
    client: {
      name: recipientName,
      billing_name: clientBillingName ?? (typeof inv.guest_company_name === "string" ? inv.guest_company_name : null),
      contact_name: clientContactName ?? (typeof inv.guest_client_name === "string" ? inv.guest_client_name : null),
    },
    org: null,
    lines: (lines ?? []) as Parameters<typeof renderInvoiceHtml>[0]["lines"],
    appUrl,
  })

  let browser
  try {
    browser = await puppeteer.launch({
      headless: true,
      executablePath: await getChromeExecutablePath(),
      args: process.platform === "win32" ? [] : chromium.args,
    })
  } catch (e) {
    return NextResponse.json(
      { error: `Failed to launch browser: ${e instanceof Error ? e.message : String(e)}` },
      { status: 500 }
    )
  }

  try {
    const page = await browser.newPage()
    await page.setContent(html, { waitUntil: "networkidle0" })
    const pdfBuffer = await page.pdf({
      format: "A4",
      printBackground: true,
      margin: { top: "16mm", right: "12mm", bottom: "16mm", left: "12mm" },
    })
    await browser.close()

    const { error: uploadError } = await admin.storage
      .from(BUCKET)
      .upload(storagePath, pdfBuffer, { upsert: true, contentType: "application/pdf" })
    if (uploadError) {
      return NextResponse.json(
        { error: `Storage upload failed: ${uploadError.message}` },
        { status: 500 }
      )
    }

    const { error: updateError } = await admin
      .from("invoices")
      .update({ pdf_path: storagePath })
      .eq("id", invoiceId)
      .eq("org_id", orgId)
    if (updateError) {
      return NextResponse.json(
        { error: `Failed to save pdf_path: ${updateError.message}` },
        { status: 500 }
      )
    }

    const { data: signed } = await admin.storage.from(BUCKET).createSignedUrl(storagePath, SIGNED_URL_EXPIRES)
    return NextResponse.json({
      pdf_path: storagePath,
      signed_url: signed?.signedUrl ?? null,
    })
  } catch (e) {
    if (browser) await browser.close().catch(() => {})
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "PDF generation failed" },
      { status: 500 }
    )
  }
}
