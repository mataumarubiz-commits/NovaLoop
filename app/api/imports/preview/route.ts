import { NextRequest, NextResponse } from "next/server"
import { createSupabaseAdmin } from "@/lib/supabaseAdmin"
import { getUserIdFromToken, getOrgRole, isOrgAdmin } from "@/lib/apiAuth"

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
    project_name?: string
    [k: string]: unknown
  }>
  pages?: unknown[]
  content_templates?: unknown[]
  vendors?: Array<{ id?: string; name?: string; vendor_type?: string; [k: string]: unknown }>
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
    [k: string]: unknown
  }>
  vendor_invoice_lines?: Array<{
    id?: string
    vendor_invoice_id?: string
    description?: string
    amount?: number
    [k: string]: unknown
  }>
  payouts?: Array<{
    id?: string
    vendor_id?: string
    vendor_name?: string
    vendor_invoice_id?: string
    pay_date?: string
    amount?: number
    status?: string
    paid_at?: string
    [k: string]: unknown
  }>
  invoices?: Array<{
    id?: string
    client_id?: string
    client_name?: string
    client_type?: string
    invoice_month?: string
    issue_date?: string
    target_month?: string
    invoice_title?: string
    invoice_name?: string
    subtotal?: number
    total?: number
    [k: string]: unknown
  }>
  invoice_lines?: Array<{
    invoice_id?: string
    description?: string
    quantity?: number
    unit_price?: number
    amount?: number
    project_name?: string
    title?: string
    [k: string]: unknown
  }>
}

async function safeSelect<T>(
  admin: ReturnType<typeof createSupabaseAdmin>,
  table: string,
  columns: string,
  orgId: string,
  opts?: { whereOrgIdColumn?: string }
): Promise<T[] | null> {
  const orgColumn = opts?.whereOrgIdColumn ?? "org_id"
  try {
    const { data, error } = await admin.from(table).select(columns).eq(orgColumn, orgId)
    if (error) {
      if (error.code === "42P01" || error.message?.includes("does not exist")) return null
      throw error
    }
    return (data ?? []) as T[]
  } catch {
    return null
  }
}

export async function POST(req: NextRequest) {
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
      exportData = body.exportData
    } else if (typeof body.exportData === "string") {
      try {
        exportData = JSON.parse(body.exportData) as ExportData
      } catch {
        return NextResponse.json({ ok: false, message: "Invalid exportData JSON" }, { status: 400 })
      }
    } else {
      return NextResponse.json({ ok: false, message: "exportData is required" }, { status: 400 })
    }

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

    const existingClients = await safeSelect<{ id: string; name: string; client_type: string }>(
      admin,
      "clients",
      "id, name, client_type",
      orgId
    )
    const existingClientsList = existingClients ?? []
    const clientKeyMap = new Map<string, { id: string }>()
    for (const c of existingClientsList) {
      const key = `${String(c.name).trim()}__${c.client_type}`
      clientKeyMap.set(key, { id: c.id })
    }

    const clientsAdd: Array<{ name: string; client_type: string }> = []
    const clientsReuse: Array<{ name: string; client_type: string }> = []
    const clientsSkip: Array<{ name?: string; client_type?: string; reason?: string }> = []

    for (const row of exportClients) {
      const name = typeof row.name === "string" ? row.name.trim() : ""
      const clientType = row.client_type === "corporate" || row.client_type === "individual" ? row.client_type : "corporate"
      if (!name) {
        clientsSkip.push({ name: row.name as string, client_type: clientType, reason: "name_empty" })
        continue
      }
      const key = `${name}__${clientType}`
      if (clientKeyMap.has(key)) {
        clientsReuse.push({ name, client_type: clientType })
        continue
      }
      clientsAdd.push({ name, client_type: clientType })
      clientKeyMap.set(key, { id: "" }) // placeholder; real id after apply
    }

    const existingContents = await admin
      .from("contents")
      .select("id, client_id, title, due_client_at")
      .eq("org_id", orgId)
    const existingContentsList = (existingContents.data ?? []) as Array<{
      id: string
      client_id: string | null
      title: string
      due_client_at: string
    }>

    const clientIdToKey = new Map<string, string>()
    for (const c of existingClientsList) {
      clientIdToKey.set(c.id, `${c.name}__${c.client_type}`)
    }
    const contentDupKeySet = new Set<string>()
    for (const c of existingContentsList) {
      const clientKey = c.client_id ? clientIdToKey.get(c.client_id) ?? c.client_id : ""
      contentDupKeySet.add(`${clientKey}\t${c.title}\t${c.due_client_at}`)
    }

    const contentsAdd: Array<{ title: string; due_client_at: string; client_name?: string }> = []
    const contentsDupSkip: Array<{ title: string; due_client_at: string }> = []
    const contentsInvalidSkip: Array<{ title?: string; due_client_at?: string; reason?: string }> = []

    const exportClientById = new Map<string, { name: string; client_type: string }>()
    for (const c of exportClients) {
      const id = c.id
      if (id && (c.name || c.client_type)) {
        exportClientById.set(id, {
          name: typeof c.name === "string" ? c.name.trim() : "",
          client_type: c.client_type === "individual" ? "individual" : "corporate",
        })
      }
    }

    for (const row of exportContents) {
      const title = typeof row.title === "string" ? row.title.trim() : ""
      const dueClientAt = typeof row.due_client_at === "string" ? row.due_client_at.trim() : ""
      if (!title || !dueClientAt) {
        contentsInvalidSkip.push({
          title: row.title as string,
          due_client_at: row.due_client_at as string,
          reason: !title ? "title_empty" : "due_client_at_empty",
        })
        continue
      }
      let clientKey: string
      const clientName = typeof row.client_name === "string" ? row.client_name.trim() : ""
      const clientType = row.client_type === "corporate" || row.client_type === "individual" ? row.client_type : "corporate"
      if (clientName) {
        clientKey = `${clientName}__${clientType}`
      } else if (row.client_id && exportClientById.has(row.client_id)) {
        const c = exportClientById.get(row.client_id)!
        clientKey = c.name ? `${c.name}__${c.client_type}` : row.client_id
      } else {
        clientKey = (row.client_id as string) ?? ""
      }
      const dupKey = `${clientKey}\t${title}\t${dueClientAt}`
      if (contentDupKeySet.has(dupKey)) {
        contentsDupSkip.push({ title, due_client_at: dueClientAt })
        continue
      }
      contentsAdd.push({ title, due_client_at: dueClientAt, client_name: clientName || undefined })
      contentDupKeySet.add(dupKey)
    }

    // --- vendors ---
    const existingVendors = await safeSelect<{ id: string; name: string }>(
      admin,
      "vendors",
      "id, name",
      orgId
    )
    const existingVendorsList = existingVendors ?? []
    const vendorKeyMap = new Map<string, { id: string }>()
    for (const v of existingVendorsList) {
      const key = `${String(v.name).trim().toLowerCase()}__${""}`
      vendorKeyMap.set(key, { id: v.id })
    }
    const vendorsAdd: Array<{ name: string; vendor_type?: string }> = []
    const vendorsReuse: Array<{ name: string; vendor_type?: string }> = []
    const vendorsSkip: Array<{ name?: string; reason?: string }> = []
    for (const row of exportVendors) {
      const name = typeof row.name === "string" ? row.name.trim() : ""
      const vendorType = typeof row.vendor_type === "string" ? row.vendor_type : ""
      if (!name) {
        vendorsSkip.push({ name: row.name as string, reason: "name_empty" })
        continue
      }
      const key = `${name.toLowerCase()}__${vendorType}`
      if (vendorKeyMap.has(key)) {
        vendorsReuse.push({ name, vendor_type: vendorType || undefined })
        continue
      }
      vendorsAdd.push({ name, vendor_type: vendorType || undefined })
      vendorKeyMap.set(key, { id: "" })
    }

    // --- vendor_invoices ---
    const existingVendorInvoices = await safeSelect<
      { id: string; vendor_id: string; billing_month: string; status: string }
    >(admin, "vendor_invoices", "id, vendor_id, billing_month, status", orgId)
    const existingVIList = existingVendorInvoices ?? []
    const exportVendorById = new Map<string, { name: string }>()
    for (const v of exportVendors) {
      if (v.id && v.name) {
        exportVendorById.set(v.id, { name: String(v.name).trim() })
      }
    }
    const vendorIdToName = new Map<string, string>()
    for (const v of existingVendorsList) {
      vendorIdToName.set(v.id, v.name.trim())
    }
    const viDupKeySet = new Set<string>()
    for (const vi of existingVIList) {
      const vName = vendorIdToName.get(vi.vendor_id) ?? vi.vendor_id
      viDupKeySet.add(`${vName}\t${vi.billing_month}\t${vi.status}`)
    }
    const viAdd: Array<{ billing_month: string; status: string; vendor_name?: string }> = []
    const viDupSkip: Array<{ billing_month: string; status: string }> = []
    const viInvalidSkip: Array<{ reason?: string }> = []
    for (const row of exportVendorInvoices) {
      const month = typeof row.billing_month === "string" ? row.billing_month.trim() : typeof row.target_month === "string" ? row.target_month.trim() : ""
      const status = typeof row.status === "string" ? row.status : "draft"
      let vendorLabel = typeof row.vendor_name === "string" ? row.vendor_name.trim() : ""
      if (!vendorLabel && row.vendor_id && exportVendorById.has(row.vendor_id)) {
        vendorLabel = exportVendorById.get(row.vendor_id)!.name
      }
      if (!vendorLabel && !row.vendor_id) {
        viInvalidSkip.push({ reason: "vendor_unresolved" })
        continue
      }
      if (!month || !/^\d{4}-\d{2}$/.test(month)) {
        viInvalidSkip.push({ reason: "month_invalid" })
        continue
      }
      const dupKey = `${vendorLabel || row.vendor_id}\t${month}\t${status}`
      if (viDupKeySet.has(dupKey)) {
        viDupSkip.push({ billing_month: month, status })
        continue
      }
      viAdd.push({ billing_month: month, status, vendor_name: vendorLabel || undefined })
      viDupKeySet.add(dupKey)
    }

    // --- vendor_invoice_lines (add vs skip by invoice resolvable) ---
    const exportVIIds = new Set(exportVendorInvoices.map((vi) => vi.id).filter(Boolean) as string[])
    let linesAddCount = 0
    let linesSkipCount = 0
    for (const line of exportVendorInvoiceLines) {
      if (line.vendor_invoice_id && exportVIIds.has(line.vendor_invoice_id)) {
        linesAddCount++
      } else {
        linesSkipCount++
      }
    }

    // --- payouts (existing may be from payouts table if exists) ---
    let existingPayouts: Array<{ vendor_id: string; pay_date: string; amount: number }> = []
    try {
      const res = await admin.from("payouts").select("vendor_id, pay_date, amount").eq("org_id", orgId)
      if (!res.error && Array.isArray(res.data)) {
        existingPayouts = res.data as Array<{ vendor_id: string; pay_date: string; amount: number }>
      }
    } catch {
      // テーブルが無ければスキップ
    }
    const vendorIdToNameForPayout = new Map<string, string>()
    for (const v of existingVendorsList) {
      vendorIdToNameForPayout.set(v.id, v.name)
    }
    for (const v of exportVendors) {
      if (v.id && v.name) vendorIdToNameForPayout.set(v.id, String(v.name).trim())
    }
    const payoutDupKeySet = new Set<string>()
    for (const p of existingPayouts) {
      const vLabel = vendorIdToNameForPayout.get(p.vendor_id) ?? p.vendor_id
      payoutDupKeySet.add(`${vLabel}\t${p.pay_date}\t${p.amount}`)
    }
    const payoutsAdd: Array<{ pay_date: string; amount: number; vendor_name?: string }> = []
    const payoutsDupSkip: Array<{ pay_date: string; amount: number }> = []
    const payoutsInvalidSkip: Array<{ reason?: string }> = []
    for (const row of exportPayouts) {
      const payDate = typeof row.pay_date === "string" ? row.pay_date.slice(0, 10) : ""
      const amount = typeof row.amount === "number" ? row.amount : Number(row.amount)
      let vendorLabel = typeof row.vendor_name === "string" ? row.vendor_name.trim() : ""
      if (!vendorLabel && row.vendor_id && exportVendorById.has(row.vendor_id)) {
        vendorLabel = exportVendorById.get(row.vendor_id)!.name
      }
      if (!vendorLabel && !row.vendor_id) {
        payoutsInvalidSkip.push({ reason: "vendor_unresolved" })
        continue
      }
      if (payDate === "" || (typeof amount !== "number" && isNaN(amount))) {
        payoutsInvalidSkip.push({ reason: "pay_date_or_amount_invalid" })
        continue
      }
      const dupKey = `${vendorLabel || row.vendor_id}\t${payDate}\t${amount}`
      if (payoutDupKeySet.has(dupKey)) {
        payoutsDupSkip.push({ pay_date: payDate, amount })
        continue
      }
      payoutsAdd.push({ pay_date: payDate, amount, vendor_name: vendorLabel || undefined })
      payoutDupKeySet.add(dupKey)
    }

    // --- invoices ---
    const existingInvoices = await safeSelect<{
      id: string
      client_id: string
      invoice_month: string
      invoice_title: string
      total: number
    }>(admin, "invoices", "id, client_id, invoice_month, invoice_title, total", orgId)
    const existingInvList = existingInvoices ?? []
    const clientIdToKeyForInv = new Map<string, string>()
    for (const c of existingClientsList) {
      clientIdToKeyForInv.set(c.id, `${c.name}__${c.client_type}`)
    }
    const invDupKeySet = new Set<string>()
    for (const inv of existingInvList) {
      const clientKey = clientIdToKeyForInv.get(inv.client_id) ?? inv.client_id
      const total = typeof inv.total === "number" ? inv.total : 0
      invDupKeySet.add(`${clientKey}\t${inv.invoice_month}\t${String(inv.invoice_title ?? "").trim()}\t${total}`)
    }
    const exportClientByIdForInv = new Map<string, { name: string; client_type: string }>()
    for (const c of exportClients) {
      if (c.id && (c.name || c.client_type)) {
        exportClientByIdForInv.set(c.id, {
          name: typeof c.name === "string" ? c.name.trim() : "",
          client_type: c.client_type === "individual" ? "individual" : "corporate",
        })
      }
    }
    const invAdd: Array<{ invoice_month: string; invoice_title: string; total: number; client_name?: string }> = []
    const invDupSkip: Array<{ invoice_month: string; invoice_title?: string }> = []
    const invInvalidSkip: Array<{ reason?: string }> = []
    const invAddIds = new Set<string>()
    for (const row of exportInvoices) {
      let clientKey = ""
      const clientName = typeof row.client_name === "string" ? row.client_name.trim() : ""
      const clientType = row.client_type === "individual" ? "individual" : "corporate"
      if (clientName) {
        clientKey = `${clientName}__${clientType}`
      } else if (row.client_id && exportClientByIdForInv.has(row.client_id)) {
        const ec = exportClientByIdForInv.get(row.client_id)!
        clientKey = ec.name ? `${ec.name}__${ec.client_type}` : row.client_id
      }
      if (!clientKey) {
        invInvalidSkip.push({ reason: "client_unresolved" })
        continue
      }
      const issueMonth =
        (typeof row.invoice_month === "string" && /^\d{4}-\d{2}$/.test(row.invoice_month) ? row.invoice_month : null) ||
        (typeof row.issue_date === "string" ? row.issue_date.slice(0, 7) : null) ||
        (typeof row.target_month === "string" && /^\d{4}-\d{2}$/.test(row.target_month) ? row.target_month : null)
      if (!issueMonth) {
        invInvalidSkip.push({ reason: "issue_month_invalid" })
        continue
      }
      const title = typeof row.invoice_title === "string" ? row.invoice_title.trim() : (typeof row.invoice_name === "string" ? row.invoice_name.trim() : "")
      const total = typeof row.total === "number" ? row.total : typeof row.subtotal === "number" ? row.subtotal : 0
      const dupKey = `${clientKey}\t${issueMonth}\t${title}\t${total}`
      if (invDupKeySet.has(dupKey)) {
        invDupSkip.push({ invoice_month: issueMonth, invoice_title: title || undefined })
        continue
      }
      invAdd.push({ invoice_month: issueMonth, invoice_title: title || "請求書", total, client_name: clientName || undefined })
      invDupKeySet.add(dupKey)
      if (row.id) invAddIds.add(row.id)
    }

    // --- invoice_lines (add = lines whose invoice is in add set, skip = rest) ---
    let invoiceLinesAddCount = 0
    let invoiceLinesSkipCount = 0
    for (const line of exportInvoiceLines) {
      const invId = line.invoice_id
      if (invId && invAddIds.has(invId)) {
        invoiceLinesAddCount++
      } else {
        invoiceLinesSkipCount++
      }
    }

    const summary = {
      pages: { addCount: exportPages.length, samples: exportPages.slice(0, 5) },
      content_templates: { addCount: exportTemplates.length, samples: exportTemplates.slice(0, 5) },
      clients: {
        addCount: clientsAdd.length,
        reuseCount: clientsReuse.length,
        skipCount: clientsSkip.length,
        samples: {
          add: clientsAdd.slice(0, 10),
          reuse: clientsReuse.slice(0, 10),
          skip: clientsSkip.slice(0, 10),
        },
      },
      contents: {
        addCount: contentsAdd.length,
        dupSkipCount: contentsDupSkip.length,
        invalidSkipCount: contentsInvalidSkip.length,
        samples: {
          add: contentsAdd.slice(0, 10),
          dupSkip: contentsDupSkip.slice(0, 5),
          invalidSkip: contentsInvalidSkip.slice(0, 5),
        },
      },
      vendors: {
        addCount: vendorsAdd.length,
        reuseCount: vendorsReuse.length,
        skipCount: vendorsSkip.length,
        samples: {
          add: vendorsAdd.slice(0, 10),
          reuse: vendorsReuse.slice(0, 10),
          skip: vendorsSkip.slice(0, 10),
        },
      },
      vendor_invoices: {
        addCount: viAdd.length,
        dupSkipCount: viDupSkip.length,
        invalidSkipCount: viInvalidSkip.length,
        samples: {
          add: viAdd.slice(0, 10),
          dupSkip: viDupSkip.slice(0, 5),
          invalidSkip: viInvalidSkip.slice(0, 5),
        },
      },
      vendor_invoice_lines: {
        addCount: linesAddCount,
        skipCount: linesSkipCount,
        samples: { add: linesAddCount, skip: linesSkipCount },
      },
      payouts: {
        addCount: payoutsAdd.length,
        dupSkipCount: payoutsDupSkip.length,
        invalidSkipCount: payoutsInvalidSkip.length,
        samples: {
          add: payoutsAdd.slice(0, 10),
          dupSkip: payoutsDupSkip.slice(0, 5),
          invalidSkip: payoutsInvalidSkip.slice(0, 5),
        },
      },
      invoices: {
        addCount: invAdd.length,
        dupSkipCount: invDupSkip.length,
        invalidSkipCount: invInvalidSkip.length,
        samples: {
          add: invAdd.slice(0, 10),
          dupSkip: invDupSkip.slice(0, 5),
          invalidSkip: invInvalidSkip.slice(0, 5),
        },
      },
      invoice_lines: {
        addCount: invoiceLinesAddCount,
        skipCount: invoiceLinesSkipCount,
        samples: { add: invoiceLinesAddCount, skip: invoiceLinesSkipCount },
      },
    }

    return NextResponse.json({ ok: true, summary })
  } catch (e) {
    return NextResponse.json(
      { ok: false, message: e instanceof Error ? e.message : "Server error" },
      { status: 500 }
    )
  }
}
