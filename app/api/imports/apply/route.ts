import { randomUUID } from "crypto"
import { NextRequest, NextResponse } from "next/server"
import { createSupabaseAdmin } from "@/lib/supabaseAdmin"
import { getOrgRole, getUserIdFromToken, isOrgAdmin } from "@/lib/apiAuth"
import { writeAuditLog } from "@/lib/auditLog"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

type ExportData = {
  clients?: Array<{ id?: string; name?: string; client_type?: string }>
  contents?: Array<{
    id?: string
    client_id?: string
    client_name?: string
    client_type?: string
    title?: string
    due_client_at?: string
    due_editor_at?: string
    project_name?: string
    status?: string
    delivery_month?: string
    unit_price?: number
    billable_flag?: boolean
    thumbnail_done?: boolean
  }>
  pages?: Array<{
    title?: string
    content?: unknown
    body_text?: string
    sort_order?: number
    is_archived?: boolean
  }>
  content_templates?: Array<{
    id?: string
    client_id?: string | null
    name?: string
    default_title?: string
    default_unit_price?: number
    default_project_name?: string
    default_billable_flag?: boolean
    default_status?: string
    default_due_offset_days?: number
    sort_order?: number
  }>
  vendors?: Array<{ id?: string; name?: string; vendor_type?: string; email?: string; notes?: string; is_active?: boolean }>
  vendor_invoices?: Array<{
    id?: string
    vendor_id?: string
    vendor_name?: string
    vendor_type?: string
    billing_month?: string
    target_month?: string
    status?: string
    total?: number
    total_amount?: number
    submit_deadline?: string
    pay_date?: string
  }>
  vendor_invoice_lines?: Array<{
    vendor_invoice_id?: string
    content_id?: string
    work_type?: string
    description?: string
    qty?: number
    unit_price?: number
    amount?: number
  }>
  payouts?: Array<{
    vendor_id?: string
    vendor_name?: string
    vendor_invoice_id?: string
    pay_date?: string
    amount?: number
    status?: string
  }>
  invoices?: Array<{
    id?: string
    client_id?: string
    client_name?: string
    client_type?: string
    invoice_month?: string
    issue_date?: string
    target_month?: string
    due_date?: string
    invoice_title?: string
    invoice_name?: string
    subtotal?: number
    total?: number
    status?: string
  }>
  invoice_lines?: Array<{
    invoice_id?: string
    content_id?: string
    description?: string
    quantity?: number
    unit_price?: number
    amount?: number
    project_name?: string
    title?: string
    sort_order?: number
  }>
}

/** DB にそのまま入れられる制作シート status（066 以降） */
const INSERTABLE_CONTENT_STATUSES = new Set([
  "not_started",
  "internal_production",
  "internal_revision",
  "client_submission",
  "client_revision_work",
  "delivered",
  "invoiced",
  "paused",
  "completed",
  "canceled",
])

/** エクスポート JSON に残る旧値 → 新 status */
const LEGACY_CONTENT_STATUS_IMPORT_MAP: Record<string, string> = {
  materials_checked: "internal_production",
  editing: "internal_production",
  internal_revision: "internal_revision",
  editing_revision: "internal_revision",
  submitted_to_client: "client_submission",
  client_revision: "client_revision_work",
  scheduling: "client_submission",
  published: "delivered",
  billable: "not_started",
  operating: "internal_production",
  approved: "delivered",
  launched: "delivered",
}

function normalizeImportedContentStatus(raw: unknown): string {
  if (typeof raw !== "string" || !raw.trim()) return "not_started"
  const v = raw.trim()
  if (INSERTABLE_CONTENT_STATUSES.has(v)) return v
  if (v === "cancelled") return "canceled"
  return LEGACY_CONTENT_STATUS_IMPORT_MAP[v] ?? "not_started"
}

function addDays(iso: string, days: number): string {
  const date = new Date(iso)
  date.setDate(date.getDate() + days)
  return date.toISOString().slice(0, 10)
}

function toBillingDefaults(month: string) {
  const [year, rawMonth] = month.split("-").map(Number)
  const issueDate = new Date(year, (rawMonth ?? 1) - 1, 1)
  const dueDate = new Date(year, rawMonth ?? 1, 0)
  return {
    submit_deadline: issueDate.toISOString().slice(0, 10),
    pay_date: dueDate.toISOString().slice(0, 10),
  }
}

async function tableExists(admin: ReturnType<typeof createSupabaseAdmin>, table: string) {
  const { error } = await admin.from(table).select("id").limit(1)
  return !error || error.code !== "42P01"
}

export async function POST(req: NextRequest) {
  let jobId: string | null = null

  try {
    const userId = await getUserIdFromToken(req)
    if (!userId) {
      return NextResponse.json({ ok: false, message: "Unauthorized" }, { status: 401 })
    }

    const body = await req.json().catch(() => ({}))
    const orgId = typeof body?.orgId === "string" ? body.orgId.trim() : null
    if (!orgId) {
      return NextResponse.json({ ok: false, message: "orgId is required" }, { status: 400 })
    }

    const admin = createSupabaseAdmin()
    const callerRole = await getOrgRole(admin, userId, orgId)
    if (!isOrgAdmin(callerRole)) {
      return NextResponse.json({ ok: false, message: "Forbidden" }, { status: 403 })
    }

    let exportData: ExportData = {}
    if (body.exportData && typeof body.exportData === "object") {
      exportData = body.exportData as ExportData
    } else if (typeof body.exportData === "string") {
      try {
        exportData = JSON.parse(body.exportData) as ExportData
      } catch {
        return NextResponse.json({ ok: false, message: "Invalid exportData JSON" }, { status: 400 })
      }
    } else {
      return NextResponse.json({ ok: false, message: "exportData is required" }, { status: 400 })
    }

    const { data: jobRow, error: jobError } = await admin
      .from("import_jobs")
      .insert({ org_id: orgId, created_by: userId, status: "previewed" })
      .select("id")
      .single()
    if (jobError || !jobRow) {
      return NextResponse.json({ ok: false, message: jobError?.message ?? "Failed to create import job" }, { status: 500 })
    }
    jobId = (jobRow as { id: string }).id

    const exportClients = Array.isArray(exportData.clients) ? exportData.clients : []
    const exportContents = Array.isArray(exportData.contents) ? exportData.contents : []
    const exportPages = Array.isArray(exportData.pages) ? exportData.pages : []
    const exportTemplates = Array.isArray(exportData.content_templates) ? exportData.content_templates : []
    const exportVendors = Array.isArray(exportData.vendors) ? exportData.vendors : []
    const exportVendorInvoices = Array.isArray(exportData.vendor_invoices) ? exportData.vendor_invoices : []
    const exportVendorInvoiceLines = Array.isArray(exportData.vendor_invoice_lines) ? exportData.vendor_invoice_lines : []
    const exportPayouts = Array.isArray(exportData.payouts) ? exportData.payouts : []
    const exportInvoices = Array.isArray(exportData.invoices) ? exportData.invoices : []
    const exportInvoiceLines = Array.isArray(exportData.invoice_lines) ? exportData.invoice_lines : []

    const summaryJson = {
      clientsCreated: 0,
      contentsCreated: 0,
      pagesCreated: 0,
      templatesCreated: 0,
      invoicesCreated: 0,
      invoiceLinesCreated: 0,
      vendorsCreated: 0,
      vendorInvoicesCreated: 0,
      vendorInvoiceLinesCreated: 0,
      payoutsCreated: 0,
    }

    const clientMap = new Map<string, string>()
    const contentMap = new Map<string, string>()
    const vendorMap = new Map<string, string>()
    const vendorInvoiceMap = new Map<string, string>()
    const invoiceMap = new Map<string, string>()

    const { data: existingClients } = await admin.from("clients").select("id, name, client_type").eq("org_id", orgId)
    for (const row of (existingClients ?? []) as Array<{ id: string; name: string; client_type: string }>) {
      clientMap.set(`${row.name.trim()}__${row.client_type}`, row.id)
    }

    for (const row of exportClients) {
      const name = typeof row.name === "string" ? row.name.trim() : ""
      if (!name) continue
      const clientType = row.client_type === "individual" ? "individual" : "corporate"
      const key = `${name}__${clientType}`
      let clientId = clientMap.get(key) ?? null
      if (!clientId) {
        const nextId = randomUUID()
        const { error } = await admin.from("clients").insert({ id: nextId, org_id: orgId, name, client_type: clientType })
        if (error) continue
        clientId = nextId
        clientMap.set(key, nextId)
        summaryJson.clientsCreated += 1
      }
      if (row.id) {
        await admin.from("import_mappings").insert({ job_id: jobId, source_type: "client", source_id: row.id, source_key: null, new_id: clientId })
        clientMap.set(row.id, clientId)
      }
    }

    const { data: existingContents } = await admin.from("contents").select("id, client_id, title, due_client_at").eq("org_id", orgId)
    const contentDedup = new Set<string>()
    for (const row of (existingContents ?? []) as Array<{ id: string; client_id: string | null; title: string; due_client_at: string }>) {
      contentDedup.add(`${row.client_id ?? ""}\t${row.title}\t${row.due_client_at}`)
    }

    for (const row of exportContents) {
      const title = typeof row.title === "string" ? row.title.trim() : ""
      const dueClientAt = typeof row.due_client_at === "string" ? row.due_client_at.slice(0, 10) : ""
      if (!title || !dueClientAt) continue
      const clientType = row.client_type === "individual" ? "individual" : "corporate"
      const mappedClientId =
        (row.client_id && clientMap.get(row.client_id)) ||
        (typeof row.client_name === "string" ? clientMap.get(`${row.client_name.trim()}__${clientType}`) : null) ||
        null
      const dedupKey = `${mappedClientId ?? ""}\t${title}\t${dueClientAt}`
      if (contentDedup.has(dedupKey)) continue
      const contentId = randomUUID()
      const status = normalizeImportedContentStatus(row.status)
      const { error } = await admin.from("contents").insert({
        id: contentId,
        org_id: orgId,
        client_id: mappedClientId,
        project_name: typeof row.project_name === "string" ? row.project_name : "",
        title,
        unit_price: typeof row.unit_price === "number" ? row.unit_price : 0,
        due_client_at: dueClientAt,
        due_editor_at: typeof row.due_editor_at === "string" && row.due_editor_at ? row.due_editor_at.slice(0, 10) : addDays(dueClientAt, -3),
        status,
        thumbnail_done: typeof row.thumbnail_done === "boolean" ? row.thumbnail_done : false,
        billable_flag: typeof row.billable_flag === "boolean" ? row.billable_flag : true,
        delivery_month: typeof row.delivery_month === "string" && /^\d{4}-\d{2}$/.test(row.delivery_month) ? row.delivery_month : dueClientAt.slice(0, 7),
      })
      if (error) continue
      contentDedup.add(dedupKey)
      if (row.id) {
        contentMap.set(row.id, contentId)
        await admin.from("import_mappings").insert({ job_id: jobId, source_type: "content", source_id: row.id, source_key: null, new_id: contentId })
      }
      summaryJson.contentsCreated += 1
    }

    for (const row of exportPages) {
      const title = typeof row.title === "string" ? row.title.trim() : ""
      if (!title) continue
      const insertBase = {
        id: randomUUID(),
        org_id: orgId,
        title,
        content: row.content ?? null,
        body_text: typeof row.body_text === "string" ? row.body_text : "",
        is_archived: typeof row.is_archived === "boolean" ? row.is_archived : false,
        sort_order: typeof row.sort_order === "number" ? row.sort_order : 0,
      }
      const res = await admin.from("pages").insert(insertBase)
      if (res.error && (res.error.code === "42703" || (res.error.message ?? "").includes("sort_order"))) {
        const fallback = {
          id: insertBase.id,
          org_id: insertBase.org_id,
          title: insertBase.title,
          content: insertBase.content,
          body_text: insertBase.body_text,
          is_archived: insertBase.is_archived,
        }
        const retry = await admin.from("pages").insert(fallback)
        if (retry.error) continue
      } else if (res.error) {
        continue
      }
      summaryJson.pagesCreated += 1
    }

    for (const row of exportTemplates) {
      const name = typeof row.name === "string" ? row.name.trim() : ""
      if (!name) continue
      const clientId = row.client_id ? clientMap.get(row.client_id) ?? null : null
      const { error } = await admin.from("content_templates").insert({
        id: randomUUID(),
        org_id: orgId,
        client_id: clientId,
        name,
        default_project_name: typeof row.default_project_name === "string" ? row.default_project_name : null,
        default_title: typeof row.default_title === "string" ? row.default_title : null,
        default_unit_price: typeof row.default_unit_price === "number" ? row.default_unit_price : 0,
        default_billable_flag: typeof row.default_billable_flag === "boolean" ? row.default_billable_flag : true,
        default_status: typeof row.default_status === "string" ? row.default_status : "not_started",
        default_due_offset_days: typeof row.default_due_offset_days === "number" ? row.default_due_offset_days : 0,
        sort_order: typeof row.sort_order === "number" ? row.sort_order : 0,
      })
      if (!error) summaryJson.templatesCreated += 1
    }

    const { data: existingVendors } = await admin.from("vendors").select("id, name").eq("org_id", orgId)
    for (const row of (existingVendors ?? []) as Array<{ id: string; name: string }>) {
      vendorMap.set(`${row.name.trim().toLowerCase()}__`, row.id)
    }

    for (const row of exportVendors) {
      const name = typeof row.name === "string" ? row.name.trim() : ""
      if (!name) continue
      const key = `${name.toLowerCase()}__`
      let vendorId = vendorMap.get(key) ?? null
      if (!vendorId) {
        const nextId = randomUUID()
        const { error } = await admin.from("vendors").insert({
          id: nextId,
          org_id: orgId,
          name,
          email: typeof row.email === "string" ? row.email : null,
          notes: typeof row.notes === "string" ? row.notes : null,
          is_active: typeof row.is_active === "boolean" ? row.is_active : true,
        })
        if (error) continue
        vendorId = nextId
        vendorMap.set(key, nextId)
        summaryJson.vendorsCreated += 1
      }
      if (row.id) {
        vendorMap.set(row.id, vendorId)
        await admin.from("import_mappings").insert({ job_id: jobId, source_type: "vendor", source_id: row.id, source_key: null, new_id: vendorId })
      }
    }

    for (const row of exportVendorInvoices) {
      const billingMonth =
        typeof row.billing_month === "string" && /^\d{4}-\d{2}$/.test(row.billing_month)
          ? row.billing_month
          : typeof row.target_month === "string" && /^\d{4}-\d{2}$/.test(row.target_month)
            ? row.target_month
            : null
      if (!billingMonth) continue
      const vendorId =
        (row.vendor_id && vendorMap.get(row.vendor_id)) ||
        (typeof row.vendor_name === "string" ? vendorMap.get(`${row.vendor_name.trim().toLowerCase()}__`) : null) ||
        null
      if (!vendorId) continue
      const defaults = toBillingDefaults(billingMonth)
      const nextId = randomUUID()
      const { error } = await admin.from("vendor_invoices").insert({
        id: nextId,
        org_id: orgId,
        vendor_id: vendorId,
        billing_month: billingMonth,
        status: typeof row.status === "string" ? row.status : "draft",
        submit_deadline: typeof row.submit_deadline === "string" ? row.submit_deadline.slice(0, 10) : defaults.submit_deadline,
        pay_date: typeof row.pay_date === "string" ? row.pay_date.slice(0, 10) : defaults.pay_date,
        total: typeof row.total === "number" ? row.total : typeof row.total_amount === "number" ? row.total_amount : 0,
      })
      if (error) continue
      if (row.id) {
        vendorInvoiceMap.set(row.id, nextId)
        await admin.from("import_mappings").insert({ job_id: jobId, source_type: "vendor_invoice", source_id: row.id, source_key: null, new_id: nextId })
      }
      summaryJson.vendorInvoicesCreated += 1
    }

    for (const row of exportVendorInvoiceLines) {
      const invoiceId = row.vendor_invoice_id ? vendorInvoiceMap.get(row.vendor_invoice_id) ?? null : null
      if (!invoiceId) continue
      const { error } = await admin.from("vendor_invoice_lines").insert({
        vendor_invoice_id: invoiceId,
        content_id: row.content_id ? contentMap.get(row.content_id) ?? null : null,
        work_type: typeof row.work_type === "string" ? row.work_type : null,
        description: typeof row.description === "string" ? row.description : "Imported line",
        qty: typeof row.qty === "number" ? row.qty : 1,
        unit_price: typeof row.unit_price === "number" ? row.unit_price : 0,
        amount: typeof row.amount === "number" ? row.amount : 0,
      })
      if (!error) summaryJson.vendorInvoiceLinesCreated += 1
    }

    for (const row of exportInvoices) {
      const clientType = row.client_type === "individual" ? "individual" : "corporate"
      const clientId =
        (row.client_id && clientMap.get(row.client_id)) ||
        (typeof row.client_name === "string" ? clientMap.get(`${row.client_name.trim()}__${clientType}`) : null) ||
        null
      if (!clientId) continue
      const billingMonth =
        typeof row.invoice_month === "string" && /^\d{4}-\d{2}$/.test(row.invoice_month)
          ? row.invoice_month
          : typeof row.target_month === "string" && /^\d{4}-\d{2}$/.test(row.target_month)
            ? row.target_month
            : null
      if (!billingMonth) continue
      const nextId = randomUUID()
      const defaults = toBillingDefaults(billingMonth)
      const subtotal = typeof row.subtotal === "number" ? row.subtotal : typeof row.total === "number" ? row.total : 0
      const { error } = await admin.from("invoices").insert({
        id: nextId,
        org_id: orgId,
        client_id: clientId,
        invoice_month: billingMonth,
        issue_date: typeof row.issue_date === "string" ? row.issue_date.slice(0, 10) : defaults.submit_deadline,
        due_date: typeof row.due_date === "string" ? row.due_date.slice(0, 10) : defaults.pay_date,
        invoice_title: typeof row.invoice_title === "string" ? row.invoice_title : typeof row.invoice_name === "string" ? row.invoice_name : `${billingMonth} 請求書`,
        invoice_no: `IMP-${billingMonth.replace("-", "")}-${String(summaryJson.invoicesCreated + 1).padStart(4, "0")}`,
        status: typeof row.status === "string" ? row.status : "draft",
        subtotal,
        total: typeof row.total === "number" ? row.total : subtotal,
        tax_mode: "exempt",
        tax_rate: 0,
        tax_amount: 0,
        withholding_enabled: false,
        withholding_amount: 0,
      })
      if (error) continue
      if (row.id) {
        invoiceMap.set(row.id, nextId)
        await admin.from("import_mappings").insert({ job_id: jobId, source_type: "invoice", source_id: row.id, source_key: null, new_id: nextId })
      }
      summaryJson.invoicesCreated += 1
    }

    for (const row of exportInvoiceLines) {
      const invoiceId = row.invoice_id ? invoiceMap.get(row.invoice_id) ?? null : null
      if (!invoiceId) continue
      const contentId = row.content_id ? contentMap.get(row.content_id) ?? null : null
      const { error } = await admin.from("invoice_lines").insert({
        id: randomUUID(),
        invoice_id: invoiceId,
        content_id: contentId,
        description: typeof row.description === "string" ? row.description : typeof row.title === "string" ? row.title : "Imported line",
        quantity: typeof row.quantity === "number" ? row.quantity : 1,
        unit_price: typeof row.unit_price === "number" ? row.unit_price : 0,
        amount: typeof row.amount === "number" ? row.amount : 0,
        project_name: typeof row.project_name === "string" ? row.project_name : null,
        title: typeof row.title === "string" ? row.title : null,
        sort_order: typeof row.sort_order === "number" ? row.sort_order : 0,
      })
      if (error) continue
      if (contentId) {
        await admin.from("contents").update({ invoice_id: invoiceId }).eq("id", contentId).eq("org_id", orgId)
      }
      summaryJson.invoiceLinesCreated += 1
    }

    if (await tableExists(admin, "payouts")) {
      for (const row of exportPayouts) {
        const vendorId =
          (row.vendor_id && vendorMap.get(row.vendor_id)) ||
          (typeof row.vendor_name === "string" ? vendorMap.get(`${row.vendor_name.trim().toLowerCase()}__`) : null) ||
          null
        if (!vendorId) continue
        const payDate = typeof row.pay_date === "string" ? row.pay_date.slice(0, 10) : ""
        if (!payDate) continue
        const { error } = await admin.from("payouts").insert({
          id: randomUUID(),
          org_id: orgId,
          vendor_id: vendorId,
          vendor_invoice_id: row.vendor_invoice_id ? vendorInvoiceMap.get(row.vendor_invoice_id) ?? null : null,
          pay_date: payDate,
          amount: typeof row.amount === "number" ? row.amount : 0,
          status: typeof row.status === "string" ? row.status : "scheduled",
        })
        if (!error) summaryJson.payoutsCreated += 1
      }
    }

    await admin.from("import_jobs").update({ status: "applied", summary_json: summaryJson }).eq("id", jobId)

    await writeAuditLog(admin, {
      org_id: orgId,
      user_id: userId,
      action: "import.run",
      resource_type: "import",
      resource_id: jobId,
      meta: { counts: summaryJson },
    })

    return NextResponse.json({ ok: true, jobId, createdCounts: summaryJson })
  } catch (error) {
    if (jobId) {
      const admin = createSupabaseAdmin()
      await admin
        .from("import_jobs")
        .update({ status: "failed", error_message: error instanceof Error ? error.message : "Server error" })
        .eq("id", jobId)
    }
    return NextResponse.json(
      { ok: false, message: error instanceof Error ? error.message : "Server error" },
      { status: 500 }
    )
  }
}
