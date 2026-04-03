import { NextRequest } from "next/server"
import { createClient } from "@supabase/supabase-js"
import { createSupabaseAdmin } from "@/lib/supabaseAdmin"
import { selectWithColumnFallback, writeWithColumnFallback } from "@/lib/postgrestCompat"

const BILLABLE_VENDOR_CONTENT_STATUSES = new Set(["delivered", "published"])
const LOCKED_VENDOR_INVOICE_STATUSES = new Set(["submitted", "approved", "paid"])
const EDITABLE_VENDOR_INVOICE_STATUSES = new Set(["draft", "rejected"])

export type VendorActor = {
  userId: string
  orgId: string
  vendorId: string
  vendorName: string
  vendorEmail: string | null
}

export type VendorProfileSnapshot = {
  display_name: string
  legal_name: string
  company_name: string
  email: string
  billing_name: string
  postal_code: string
  address: string
  registration_number: string
  notes: string
}

export type VendorBankSnapshot = {
  bank_name: string
  branch_name: string
  account_type: string
  account_number: string
  account_holder: string
}

export type VendorRecipientSnapshot = {
  organization_name: string
  recipient_name: string
  business_entity_type: string
  postal_code: string
  address: string
  email: string
  phone: string
  registration_number: string
}

export type VendorPreviewLine = {
  content_id: string
  project_name: string
  title: string
  client_name: string
  qty: number
  unit_price: number
  amount: number
  description: string
  work_type: string
}

export type VendorExistingInvoice = {
  id: string
  invoice_number: string | null
  status: string
  billing_month: string
  submit_deadline: string | null
  pay_date: string | null
  total: number | null
  item_count: number | null
  memo: string | null
  pdf_path: string | null
  submitted_at: string | null
  first_submitted_at: string | null
  resubmitted_at: string | null
  approved_at: string | null
  confirmed_at: string | null
  returned_at: string | null
  rejected_category: string | null
  rejected_reason: string | null
  return_count: number
  return_history: Array<Record<string, unknown>>
  recipient_snapshot: Record<string, unknown> | null
  vendor_profile_snapshot: Record<string, unknown> | null
  vendor_bank_snapshot: Record<string, unknown> | null
  created_at: string | null
}

export type VendorInvoicePreview = {
  month: string
  counts: {
    items: number
    amount: number
  }
  lines: VendorPreviewLine[]
  existingInvoice: VendorExistingInvoice | null
  editableInvoice: VendorExistingInvoice | null
  lockedInvoice: VendorExistingInvoice | null
  existingInvoices: VendorExistingInvoice[]
  extraEditableInvoices: VendorExistingInvoice[]
  dates: {
    submitDeadline: string
    payDate: string
  }
  memo: string
}

export type UpsertVendorDraftParams = {
  actor: VendorActor
  month: string
  requestSentBy?: string | null
  markRequested?: boolean
}

export type UpsertVendorDraftResult =
  | {
      ok: true
      state: "created" | "updated"
      invoiceId: string
      preview: VendorInvoicePreview
    }
  | {
      ok: false
      state: "empty" | "locked"
      invoiceId: string | null
      preview: VendorInvoicePreview
      reason: string
    }

export type ResolvedVendorPortalMonth = {
  month: string
  preview: VendorInvoicePreview
  source: "query" | "editable" | "preview" | "locked" | "fallback"
}

function createAnonClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !anonKey) throw new Error("Supabase public settings are missing.")
  return createClient(url, anonKey, { auth: { persistSession: false } })
}

export function normalizeVendorBillingMonth(value: unknown) {
  return typeof value === "string" && /^\d{4}-\d{2}$/.test(value) ? value : null
}

function currentBillingMonth() {
  const today = new Date()
  return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}`
}

function previousBillingMonth(month: string) {
  const [year, mon] = month.split("-").map(Number)
  const date = new Date(Date.UTC(year, mon - 2, 1))
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`
}

function compareBillingMonthDesc(a: string, b: string) {
  if (a === b) return 0
  return a > b ? -1 : 1
}

export async function getUserIdFromRequest(req: NextRequest): Promise<string | null> {
  const authHeader = req.headers.get("Authorization")
  const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7).trim() : null
  if (!token) return null
  const supabase = createAnonClient()
  const {
    data: { user },
  } = await supabase.auth.getUser(token)
  return user?.id ?? null
}

export async function requireVendorActor(req: NextRequest): Promise<VendorActor> {
  const userId = await getUserIdFromRequest(req)
  if (!userId) throw new Error("Unauthorized")

  const admin = createSupabaseAdmin()
  const { data: vendorUser } = await admin
    .from("vendor_users")
    .select("org_id, vendor_id, vendor:vendors(name, email)")
    .eq("user_id", userId)
    .maybeSingle()

  const row = vendorUser as
    | {
        org_id?: string
        vendor_id?: string
        vendor?: { name?: string | null; email?: string | null } | null
      }
    | null

  if (!row?.org_id || !row?.vendor_id) {
    throw new Error("外注アカウントが有効な外注先に紐づいていません。")
  }

  return {
    userId,
    orgId: row.org_id,
    vendorId: row.vendor_id,
    vendorName: row.vendor?.name?.trim() || "外注先",
    vendorEmail: row.vendor?.email?.trim() || null,
  }
}

export async function requireAdminActor(req: NextRequest): Promise<{ userId: string; orgId: string }> {
  const userId = await getUserIdFromRequest(req)
  if (!userId) throw new Error("Unauthorized")

  const admin = createSupabaseAdmin()
  const { data: profile } = await admin.from("user_profiles").select("active_org_id").eq("user_id", userId).maybeSingle()
  const orgId = (profile as { active_org_id?: string | null } | null)?.active_org_id ?? null
  if (!orgId) throw new Error("No active org")

  const { data: appUser } = await admin
    .from("app_users")
    .select("role")
    .eq("user_id", userId)
    .eq("org_id", orgId)
    .maybeSingle()
  const role = (appUser as { role?: string } | null)?.role ?? null
  if (role !== "owner" && role !== "executive_assistant") throw new Error("Forbidden")

  return { userId, orgId }
}

export async function loadVendorProfileAndBank(actor: VendorActor) {
  const admin = createSupabaseAdmin()
  const [{ data: profile }, { data: bank }] = await Promise.all([
    admin.from("vendor_profiles").select("*").eq("org_id", actor.orgId).eq("vendor_id", actor.vendorId).maybeSingle(),
    admin
      .from("vendor_bank_accounts")
      .select("*")
      .eq("org_id", actor.orgId)
      .eq("vendor_id", actor.vendorId)
      .eq("is_default", true)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ])

  const profileRow = (profile as Record<string, unknown> | null) ?? null
  const bankRow = (bank as Record<string, unknown> | null) ?? null

  const normalizedProfile: VendorProfileSnapshot = {
    display_name: String(profileRow?.display_name ?? actor.vendorName ?? ""),
    legal_name: String(profileRow?.legal_name ?? ""),
    company_name: String(profileRow?.company_name ?? ""),
    email: String(profileRow?.email ?? actor.vendorEmail ?? ""),
    billing_name: String(profileRow?.billing_name ?? profileRow?.company_name ?? profileRow?.legal_name ?? actor.vendorName ?? ""),
    postal_code: String(profileRow?.postal_code ?? ""),
    address: String(profileRow?.address ?? ""),
    registration_number: String(profileRow?.registration_number ?? ""),
    notes: String(profileRow?.notes ?? ""),
  }

  const normalizedBank: VendorBankSnapshot | null = bankRow
    ? {
        bank_name: String(bankRow.bank_name ?? ""),
        branch_name: String(bankRow.branch_name ?? ""),
        account_type: String(bankRow.account_type ?? "ordinary"),
        account_number: String(bankRow.account_number ?? ""),
        account_holder: String(bankRow.account_holder ?? ""),
      }
    : null

  return {
    profile: normalizedProfile,
    bank: normalizedBank,
    profileRow,
    bankRow,
  }
}

export async function loadRecipientSnapshot(orgId: string): Promise<VendorRecipientSnapshot> {
  const admin = createSupabaseAdmin()
  const [{ data: organization }, { data: settings }] = await Promise.all([
    admin.from("organizations").select("name").eq("id", orgId).maybeSingle(),
    admin
      .from("org_settings")
      .select("business_entity_type, issuer_name, issuer_zip, issuer_address, issuer_phone, issuer_email, issuer_registration_number")
      .eq("org_id", orgId)
      .maybeSingle(),
  ])

  const orgName = ((organization as { name?: string | null } | null)?.name ?? "").trim()
  const row = (settings as Record<string, unknown> | null) ?? null
  return {
    organization_name: orgName,
    recipient_name: String(row?.issuer_name ?? orgName),
    business_entity_type: String(row?.business_entity_type ?? "corporate"),
    postal_code: String(row?.issuer_zip ?? ""),
    address: String(row?.issuer_address ?? ""),
    email: String(row?.issuer_email ?? ""),
    phone: String(row?.issuer_phone ?? ""),
    registration_number: String(row?.issuer_registration_number ?? ""),
  }
}

export function validateVendorProfile(profile: VendorProfileSnapshot) {
  return Boolean(profile.display_name.trim() && profile.billing_name.trim() && profile.email.trim())
}

export function validateVendorBank(bank: VendorBankSnapshot | null) {
  return Boolean(bank && bank.bank_name.trim() && bank.branch_name.trim() && bank.account_number.trim() && bank.account_holder.trim())
}

function billingDates(month: string) {
  const [year, mon] = month.split("-").map(Number)
  const submitMonth = mon === 12 ? 1 : mon + 1
  const submitYear = mon === 12 ? year + 1 : year
  let payMonth = mon + 2
  let payYear = year
  if (payMonth > 12) {
    payMonth -= 12
    payYear += 1
  }

  return {
    submitDeadline: `${submitYear}-${String(submitMonth).padStart(2, "0")}-05`,
    payDate: `${payYear}-${String(payMonth).padStart(2, "0")}-05`,
  }
}

function buildMonthlyMemo(month: string, itemCount: number) {
  return `${month} の案件データから自動組み立てした外注請求です。対象件数は ${itemCount} 件です。`
}

function normalizeExistingInvoice(row: Record<string, unknown>): VendorExistingInvoice {
  return {
    id: String(row.id ?? ""),
    invoice_number: typeof row.invoice_number === "string" ? row.invoice_number : null,
    status: String(row.status ?? ""),
    billing_month: String(row.billing_month ?? ""),
    submit_deadline: typeof row.submit_deadline === "string" ? row.submit_deadline : null,
    pay_date: typeof row.pay_date === "string" ? row.pay_date : null,
    total: typeof row.total === "number" ? row.total : Number(row.total ?? 0),
    item_count: typeof row.item_count === "number" ? row.item_count : Number(row.item_count ?? 0),
    memo: typeof row.memo === "string" ? row.memo : null,
    pdf_path: typeof row.pdf_path === "string" ? row.pdf_path : null,
    submitted_at: typeof row.submitted_at === "string" ? row.submitted_at : null,
    first_submitted_at: typeof row.first_submitted_at === "string" ? row.first_submitted_at : null,
    resubmitted_at: typeof row.resubmitted_at === "string" ? row.resubmitted_at : null,
    approved_at: typeof row.approved_at === "string" ? row.approved_at : null,
    confirmed_at: typeof row.confirmed_at === "string" ? row.confirmed_at : null,
    returned_at: typeof row.returned_at === "string" ? row.returned_at : null,
    rejected_category: typeof row.rejected_category === "string" ? row.rejected_category : null,
    rejected_reason: typeof row.rejected_reason === "string" ? row.rejected_reason : null,
    return_count: typeof row.return_count === "number" ? row.return_count : Number(row.return_count ?? 0),
    return_history: Array.isArray(row.return_history) ? (row.return_history as Array<Record<string, unknown>>) : [],
    recipient_snapshot: (row.recipient_snapshot as Record<string, unknown> | null) ?? null,
    vendor_profile_snapshot: (row.vendor_profile_snapshot as Record<string, unknown> | null) ?? null,
    vendor_bank_snapshot: (row.vendor_bank_snapshot as Record<string, unknown> | null) ?? null,
    created_at: typeof row.created_at === "string" ? row.created_at : null,
  }
}

export async function buildVendorInvoicePreview(actor: VendorActor, month: string): Promise<VendorInvoicePreview> {
  const admin = createSupabaseAdmin()

  const { data: assignmentsData, error: assignmentsError } = await admin
    .from("content_vendor_assignments")
    .select("content_id, role, unit_price_override")
    .eq("org_id", actor.orgId)
    .eq("vendor_id", actor.vendorId)

  if (assignmentsError) {
    throw new Error(`外注アサインの取得に失敗しました: ${assignmentsError.message}`)
  }

  const assignments = (assignmentsData ?? []) as Array<{
    content_id: string
    role?: string | null
    unit_price_override?: number | null
  }>

  const dates = billingDates(month)
  if (assignments.length === 0) {
    return {
      month,
      counts: { items: 0, amount: 0 },
      lines: [],
      existingInvoice: null,
      editableInvoice: null,
      lockedInvoice: null,
      existingInvoices: [],
      extraEditableInvoices: [],
      dates,
      memo: buildMonthlyMemo(month, 0),
    }
  }

  const contentIds = assignments.map((row) => row.content_id)
  const { data: contentsData, error: contentsError } = await admin
    .from("contents")
    .select("id, project_name, title, client_id, delivery_month, status, unit_price, billable_flag")
    .in("id", contentIds)
    .eq("org_id", actor.orgId)
    .eq("delivery_month", month)

  if (contentsError) {
    throw new Error(`案件データの取得に失敗しました: ${contentsError.message}`)
  }

  const contents = (contentsData ?? []) as Array<{
    id: string
    project_name?: string | null
    title?: string | null
    client_id?: string | null
    status?: string | null
    unit_price?: number | null
    billable_flag?: boolean | null
  }>

  const clientIds = Array.from(new Set(contents.map((row) => row.client_id).filter(Boolean))) as string[]
  const { data: clientsData } = clientIds.length
    ? await admin.from("clients").select("id, name").in("id", clientIds)
    : { data: [] }
  const clientNameById = new Map(
    ((clientsData ?? []) as Array<{ id: string; name: string | null }>).map((row) => [row.id, row.name?.trim() || "クライアント"])
  )

  const { data: existingInvoiceData } = await selectWithColumnFallback<Record<string, unknown>[]>({
    table: "vendor_invoices",
    columns: [
      "id",
      "invoice_number",
      "status",
      "billing_month",
      "submit_deadline",
      "pay_date",
      "total",
      "item_count",
      "memo",
      "pdf_path",
      "submitted_at",
      "first_submitted_at",
      "resubmitted_at",
      "approved_at",
      "confirmed_at",
      "returned_at",
      "rejected_category",
      "rejected_reason",
      "return_count",
      "return_history",
      "recipient_snapshot",
      "vendor_profile_snapshot",
      "vendor_bank_snapshot",
      "created_at",
    ],
    execute: async (columnsCsv) => {
      const result = await admin
        .from("vendor_invoices")
        .select(columnsCsv)
        .eq("org_id", actor.orgId)
        .eq("vendor_id", actor.vendorId)
        .eq("billing_month", month)
        .order("created_at", { ascending: false })
      return {
        data: (result.data ?? []) as unknown as Record<string, unknown>[],
        error: result.error,
      }
    },
  })

  const existingInvoices = ((existingInvoiceData ?? []) as Record<string, unknown>[]).map(normalizeExistingInvoice)
  const lockedInvoice = existingInvoices.find((row) => LOCKED_VENDOR_INVOICE_STATUSES.has(row.status)) ?? null
  const editableInvoice = existingInvoices.find((row) => EDITABLE_VENDOR_INVOICE_STATUSES.has(row.status)) ?? null
  const extraEditableInvoices = existingInvoices.filter(
    (row) => EDITABLE_VENDOR_INVOICE_STATUSES.has(row.status) && row.id !== editableInvoice?.id
  )

  const lockedInvoiceIds = existingInvoices.filter((row) => LOCKED_VENDOR_INVOICE_STATUSES.has(row.status)).map((row) => row.id)
  const alreadyLinked = new Set<string>()

  if (lockedInvoiceIds.length > 0) {
    const { data: linkedLinesData } = await admin
      .from("vendor_invoice_lines")
      .select("content_id, vendor_invoice_id")
      .in("vendor_invoice_id", lockedInvoiceIds)

    for (const row of (linkedLinesData ?? []) as Array<{ content_id?: string | null }>) {
      if (row.content_id) alreadyLinked.add(row.content_id)
    }
  }

  const assignmentByContentId = new Map(assignments.map((row) => [row.content_id, row]))
  const lines: VendorPreviewLine[] = contents
    .filter((row) => BILLABLE_VENDOR_CONTENT_STATUSES.has(String(row.status ?? "")))
    .filter((row) => row.billable_flag === true)
    .filter((row) => !alreadyLinked.has(row.id))
    .map((row) => {
      const assignment = assignmentByContentId.get(row.id)
      const unitPrice = Number(assignment?.unit_price_override ?? row.unit_price ?? 0)
      const projectName = row.project_name?.trim() || "案件"
      const title = row.title?.trim() || "コンテンツ"
      return {
        content_id: row.id,
        project_name: projectName,
        title,
        client_name: clientNameById.get(row.client_id ?? "") ?? "クライアント",
        qty: 1,
        unit_price: unitPrice,
        amount: unitPrice,
        description: `${projectName} / ${title}`,
        work_type: assignment?.role?.trim() || "editor",
      }
    })
    .sort((a, b) => a.project_name.localeCompare(b.project_name, "ja") || a.title.localeCompare(b.title, "ja"))

  const amount = lines.reduce((sum, row) => sum + row.amount, 0)

  return {
    month,
    counts: {
      items: lines.length,
      amount,
    },
    lines,
    existingInvoice: editableInvoice ?? lockedInvoice,
    editableInvoice,
    lockedInvoice,
    existingInvoices,
    extraEditableInvoices,
    dates,
    memo: buildMonthlyMemo(month, lines.length),
  }
}

async function listVendorCandidateBillingMonths(actor: VendorActor) {
  const admin = createSupabaseAdmin()

  const { data: assignmentRows, error: assignmentError } = await admin
    .from("content_vendor_assignments")
    .select("content_id")
    .eq("org_id", actor.orgId)
    .eq("vendor_id", actor.vendorId)

  if (assignmentError) {
    throw new Error(assignmentError.message)
  }

  const contentIds = ((assignmentRows ?? []) as Array<{ content_id?: string | null }>)
    .map((row) => String(row.content_id ?? ""))
    .filter(Boolean)

  const months = new Set<string>([currentBillingMonth()])

  if (contentIds.length > 0) {
    const { data: contentRows, error: contentError } = await admin
      .from("contents")
      .select("delivery_month, status, billable_flag")
      .eq("org_id", actor.orgId)
      .in("id", contentIds)
      .not("delivery_month", "is", null)

    if (contentError) {
      throw new Error(contentError.message)
    }

    for (const row of (contentRows ?? []) as Array<{ delivery_month?: string | null; status?: string | null; billable_flag?: boolean | null }>) {
      const month = normalizeVendorBillingMonth(row.delivery_month)
      if (!month) continue
      if (!BILLABLE_VENDOR_CONTENT_STATUSES.has(String(row.status ?? ""))) continue
      if (row.billable_flag !== true) continue
      months.add(month)
    }
  }

  const { data: invoiceRows, error: invoiceError } = await admin
    .from("vendor_invoices")
    .select("billing_month")
    .eq("org_id", actor.orgId)
    .eq("vendor_id", actor.vendorId)
    .order("billing_month", { ascending: false })
    .limit(12)

  if (invoiceError) {
    throw new Error(invoiceError.message)
  }

  for (const row of (invoiceRows ?? []) as Array<{ billing_month?: string | null }>) {
    const month = normalizeVendorBillingMonth(row.billing_month)
    if (month) months.add(month)
  }

  const currentMonth = currentBillingMonth()
  months.add(previousBillingMonth(currentMonth))

  return Array.from(months).sort(compareBillingMonthDesc).slice(0, 12)
}

export async function resolveVendorPortalMonth(
  actor: VendorActor,
  requestedMonth: string | null
): Promise<ResolvedVendorPortalMonth> {
  if (requestedMonth) {
    return {
      month: requestedMonth,
      preview: await buildVendorInvoicePreview(actor, requestedMonth),
      source: "query",
    }
  }

  const candidateMonths = await listVendorCandidateBillingMonths(actor)
  let latestPreviewMonth: ResolvedVendorPortalMonth | null = null
  let latestLockedMonth: ResolvedVendorPortalMonth | null = null

  for (const month of candidateMonths) {
    const preview = await buildVendorInvoicePreview(actor, month)

    if (preview.editableInvoice) {
      return {
        month,
        preview,
        source: "editable",
      }
    }

    if (!latestPreviewMonth && preview.lines.length > 0) {
      latestPreviewMonth = {
        month,
        preview,
        source: "preview",
      }
    }

    if (!latestLockedMonth && preview.lockedInvoice) {
      latestLockedMonth = {
        month,
        preview,
        source: "locked",
      }
    }
  }

  if (latestPreviewMonth) return latestPreviewMonth
  if (latestLockedMonth) return latestLockedMonth

  const fallbackMonth = currentBillingMonth()
  return {
    month: fallbackMonth,
    preview: await buildVendorInvoicePreview(actor, fallbackMonth),
    source: "fallback",
  }
}

export async function upsertVendorDraftInvoice(params: UpsertVendorDraftParams): Promise<UpsertVendorDraftResult> {
  const { actor, month, requestSentBy, markRequested = false } = params
  const preview = await buildVendorInvoicePreview(actor, month)

  if (preview.lockedInvoice) {
    return {
      ok: false,
      state: "locked",
      invoiceId: preview.lockedInvoice.id,
      preview,
      reason: `この月の請求はすでに ${preview.lockedInvoice.status} です。`,
    }
  }

  if (preview.lines.length === 0) {
    return {
      ok: false,
      state: "empty",
      invoiceId: null,
      preview,
      reason: "この月の請求対象案件がありません。",
    }
  }

  const admin = createSupabaseAdmin()
  const [{ profile, bank }, recipient] = await Promise.all([loadVendorProfileAndBank(actor), loadRecipientSnapshot(actor.orgId)])
  const now = new Date().toISOString()
  const targetInvoiceId = preview.editableInvoice?.id ?? crypto.randomUUID()

  const payload = {
    id: targetInvoiceId,
    org_id: actor.orgId,
    vendor_id: actor.vendorId,
    billing_month: month,
    status: "draft",
    submit_deadline: preview.dates.submitDeadline,
    pay_date: preview.dates.payDate,
    total: preview.counts.amount,
    item_count: preview.counts.items,
    memo: preview.memo,
    rejected_reason: null,
    rejected_category: null,
    submitted_at: null,
    first_submitted_at: null,
    resubmitted_at: null,
    approved_at: null,
    confirmed_at: null,
    returned_at: null,
    pdf_path: null,
    return_count: preview.editableInvoice?.return_count ?? 0,
    return_history: preview.editableInvoice?.return_history ?? [],
    recipient_snapshot: recipient,
    vendor_profile_snapshot: profile,
    vendor_bank_snapshot: bank,
    request_sent_at: markRequested ? now : null,
    request_sent_by: markRequested ? requestSentBy ?? actor.userId : null,
    updated_at: now,
  }

  if (preview.extraEditableInvoices.length > 0) {
    const extraIds = preview.extraEditableInvoices.map((row) => row.id)
    await admin.from("vendor_invoice_lines").delete().in("vendor_invoice_id", extraIds)
    await admin.from("vendor_invoices").delete().in("id", extraIds).eq("org_id", actor.orgId)
  }

  if (preview.editableInvoice?.id) {
    await writeWithColumnFallback({
      table: "vendor_invoices",
      payload,
      execute: async (safePayload) => {
        const result = await admin.from("vendor_invoices").update(safePayload).eq("id", preview.editableInvoice!.id).eq("org_id", actor.orgId)
        return { data: null, error: result.error }
      },
    })
    await admin.from("vendor_invoice_lines").delete().eq("vendor_invoice_id", preview.editableInvoice.id)
  } else {
    await writeWithColumnFallback({
      table: "vendor_invoices",
      payload: { ...payload, created_at: now },
      execute: async (safePayload) => {
        const result = await admin.from("vendor_invoices").insert(safePayload)
        return { data: null, error: result.error }
      },
    })
  }

  const lineRows = preview.lines.map((line) => ({
    vendor_invoice_id: targetInvoiceId,
    content_id: line.content_id,
    work_type: line.work_type,
    description: line.description,
    qty: line.qty,
    unit_price: line.unit_price,
    amount: line.amount,
    source_type: "content_auto",
    source_meta: {
      content_id: line.content_id,
      project_name: line.project_name,
      title: line.title,
      client_name: line.client_name,
      subtotal: line.amount,
    },
  }))

  const { error: lineError } = await admin.from("vendor_invoice_lines").insert(lineRows)
  if (lineError) throw new Error(lineError.message)

  return {
    ok: true,
    state: preview.editableInvoice ? "updated" : "created",
    invoiceId: targetInvoiceId,
    preview,
  }
}
