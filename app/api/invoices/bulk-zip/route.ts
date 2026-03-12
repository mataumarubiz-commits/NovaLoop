import { NextRequest, NextResponse } from "next/server"
import puppeteer from "puppeteer-core"
import chromium from "@sparticuz/chromium"
import fs from "fs"
import { createSupabaseAdmin } from "@/lib/supabaseAdmin"
import { getOrgRole, getUserIdFromToken, isOrgAdmin } from "@/lib/apiAuth"
import { createZip } from "@/lib/zip"
import { renderInvoiceHtml } from "@/lib/pdf/renderInvoiceHtml"

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

function safeFileName(value: string): string {
  return (value || "invoice")
    .replace(/[/\\:*?"<>|\s]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 100) || "invoice"
}

async function buildPdfBuffer(admin: ReturnType<typeof createSupabaseAdmin>, orgId: string, invoiceId: string) {
  const { data: invoice, error: invoiceError } = await admin
    .from("invoices")
    .select("*")
    .eq("id", invoiceId)
    .eq("org_id", orgId)
    .maybeSingle()
  if (invoiceError || !invoice) throw new Error("請求書が見つかりません。")

  const clientId = (invoice as { client_id?: string | null }).client_id
  if (!clientId) throw new Error("請求先情報が設定されていません。")

  const [{ data: client, error: clientError }, { data: lines, error: linesError }] = await Promise.all([
    admin.from("clients").select("name").eq("id", clientId).maybeSingle(),
    admin.from("invoice_lines").select("*").eq("invoice_id", invoiceId).order("sort_order", { ascending: true }),
  ])
  if (clientError || !client) throw new Error("請求先の取得に失敗しました。")
  if (linesError) throw new Error("請求明細の取得に失敗しました。")

  const html = renderInvoiceHtml({
    invoice: invoice as Parameters<typeof renderInvoiceHtml>[0]["invoice"],
    client: client as { name: string },
    org: null,
    lines: (lines ?? []) as Parameters<typeof renderInvoiceHtml>[0]["lines"],
  })

  const browser = await puppeteer.launch({
    headless: true,
    executablePath: await getChromeExecutablePath(),
    args: process.platform === "win32" ? [] : chromium.args,
  })

  try {
    const page = await browser.newPage()
    await page.setContent(html, { waitUntil: "networkidle0" })
    const pdfBuffer = await page.pdf({
      format: "A4",
      printBackground: true,
      margin: { top: "16mm", right: "12mm", bottom: "16mm", left: "12mm" },
    })
    return {
      pdfBuffer: new Uint8Array(pdfBuffer),
      fileName: `${safeFileName(`請求書_${String((invoice as { invoice_month?: string }).invoice_month ?? "")}_${(client as { name: string }).name}_${String((invoice as { invoice_title?: string }).invoice_title ?? "請求書")}`)}.pdf`,
    }
  } finally {
    await browser.close().catch(() => {})
  }
}

async function ensureSignedInUser(req: NextRequest) {
  const userId = await getUserIdFromToken(req)
  if (!userId) {
    return { error: NextResponse.json({ ok: false, message: "ログインし直してください。" }, { status: 401 }) }
  }
  const admin = createSupabaseAdmin()
  const { data: profile } = await admin
    .from("user_profiles")
    .select("active_org_id")
    .eq("user_id", userId)
    .maybeSingle()
  const orgId = (profile as { active_org_id?: string | null } | null)?.active_org_id ?? null
  if (!orgId) {
    return { error: NextResponse.json({ ok: false, message: "アクティブなワークスペースが見つかりません。" }, { status: 400 }) }
  }
  const role = await getOrgRole(admin, userId, orgId)
  if (!isOrgAdmin(role)) {
    return {
      error: NextResponse.json(
        { ok: false, message: "請求書 ZIP 出力は owner / executive_assistant のみ実行できます。" },
        { status: 403 }
      ),
    }
  }
  return { admin, orgId }
}

export async function POST(req: NextRequest) {
  try {
    const auth = await ensureSignedInUser(req)
    if ("error" in auth) return auth.error
    const { admin, orgId } = auth

    const body = (await req.json().catch(() => ({}))) as { invoiceIds?: string[] }
    const invoiceIds = Array.isArray(body.invoiceIds) ? body.invoiceIds.filter(Boolean) : []
    if (invoiceIds.length === 0) {
      return NextResponse.json({ ok: false, message: "invoiceIds を指定してください。" }, { status: 400 })
    }

    const files: Array<{ name: string; data: Uint8Array }> = []
    for (const invoiceId of invoiceIds) {
      const { data: invoice } = await admin
        .from("invoices")
        .select("pdf_path")
        .eq("id", invoiceId)
        .eq("org_id", orgId)
        .maybeSingle()
      if (!invoice) continue

      const pdfPath = (invoice as { pdf_path?: string | null }).pdf_path
      if (pdfPath) {
        const { data: fileData, error: downloadError } = await admin.storage.from(BUCKET).download(pdfPath)
        if (!downloadError && fileData) {
          const arrayBuffer = await fileData.arrayBuffer()
          const name = `${safeFileName(String(pdfPath.split("/").slice(-1)[0] ?? `invoice_${invoiceId}.pdf`))}`
          files.push({ name, data: new Uint8Array(arrayBuffer) })
          continue
        }
      }

      const generated = await buildPdfBuffer(admin, orgId, invoiceId)
      files.push({ name: generated.fileName, data: generated.pdfBuffer })
    }

    if (files.length === 0) {
      return NextResponse.json({ ok: false, message: "ZIP に含める請求書がありません。" }, { status: 400 })
    }

    const zipBuffer = createZip(files)
    return new NextResponse(Buffer.from(zipBuffer), {
      status: 200,
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="invoices_${new Date().toISOString().slice(0, 10)}.zip"`,
      },
    })
  } catch (error) {
    console.error("[api/invoices/bulk-zip]", error)
    return NextResponse.json({ ok: false, message: "請求書 ZIP の生成に失敗しました。" }, { status: 500 })
  }
}
