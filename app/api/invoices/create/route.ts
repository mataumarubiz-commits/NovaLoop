import { NextRequest, NextResponse } from "next/server"
import { createUserClient, getBearerToken } from "@/lib/userClient"
import { createSupabaseAdmin } from "@/lib/supabaseAdmin"
import { writeAuditLog } from "@/lib/auditLog"
import { normalizeInvoiceSourceTypeForWrite } from "@/lib/invoiceSourceType"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

type CreateInvoiceBody = {
  client_id?: string | null
  guest_client_name?: string
  guest_company_name?: string
  guest_client_email?: string
  guest_client_address?: string
  invoice_title?: string
  invoice_month?: string
  issue_date?: string
  due_date?: string
  tax_mode?: "exempt" | "exclusive" | "inclusive"
  tax_rate?: number
  withholding_enabled?: boolean
  withholding_rate?: number
  bank_account_id?: string | null
  notes?: string
  request_id?: string | null
  source_type?: "manual" | "copy" | "request" | "billing" | "billing_monthly" | "billing_bulk"
  copied_from_invoice_id?: string | null
  lines?: Array<{ description: string; quantity: number; unit_price: number }>
}

function floorYen(value: number): number {
  return Math.floor(Number.isFinite(value) ? value : 0)
}

function calcTotals(
  subtotal: number,
  taxMode: "exempt" | "exclusive" | "inclusive",
  taxRate: number,
  withholdingEnabled: boolean,
  withholdingRate: number
) {
  const safeSubtotal = floorYen(subtotal)
  const safeTaxRate = Number.isFinite(taxRate) ? taxRate : 0
  const taxAmount =
    taxMode === "exclusive"
      ? floorYen((safeSubtotal * safeTaxRate) / 100)
      : taxMode === "inclusive"
        ? floorYen(safeSubtotal - safeSubtotal / (1 + safeTaxRate / 100))
        : 0
  const withholdingAmount = withholdingEnabled ? floorYen((safeSubtotal * withholdingRate) / 100) : 0
  const total = safeSubtotal + taxAmount - withholdingAmount
  return { subtotal: safeSubtotal, taxAmount, withholdingAmount, total }
}

async function getAuth(req: NextRequest) {
  const token = getBearerToken(req)
  if (!token) return { error: NextResponse.json({ ok: false, message: "認証が必要です" }, { status: 401 }) }
  const supabase = createUserClient(token)
  if (!supabase) {
    return { error: NextResponse.json({ ok: false, message: "Supabase 設定が不足しています" }, { status: 500 }) }
  }
  const { data } = await supabase.auth.getUser(token)
  const userId = data.user?.id ?? null
  if (!userId) return { error: NextResponse.json({ ok: false, message: "認証が必要です" }, { status: 401 }) }
  const [{ data: profile }, { data: appUser }] = await Promise.all([
    supabase.from("user_profiles").select("active_org_id").eq("user_id", userId).maybeSingle(),
    supabase.from("app_users").select("org_id, role").eq("user_id", userId),
  ])
  const orgId = (profile as { active_org_id?: string | null } | null)?.active_org_id ?? null
  const role = ((appUser ?? []) as { org_id: string; role: string }[]).find((row) => row.org_id === orgId)?.role ?? null
  if (!orgId || (role !== "owner" && role !== "executive_assistant")) {
    return { error: NextResponse.json({ ok: false, message: "権限がありません" }, { status: 403 }) }
  }
  return { supabase, userId, orgId }
}

export async function POST(req: NextRequest) {
  try {
    const auth = await getAuth(req)
    if ("error" in auth) return auth.error
    const { supabase, userId, orgId } = auth
    const body = (await req.json().catch(() => ({}))) as CreateInvoiceBody

    const lines = Array.isArray(body.lines) ? body.lines : []
    const normalizedLines = lines
      .map((line) => ({
        description: typeof line.description === "string" ? line.description.trim() : "",
        quantity: Math.max(1, Number(line.quantity ?? 1)),
        unit_price: floorYen(Number(line.unit_price ?? 0)),
      }))
      .filter((line) => line.description.length > 0)

    if (normalizedLines.length === 0) {
      return NextResponse.json({ ok: false, message: "明細を1行以上入力してください" }, { status: 400 })
    }
    if (!body.client_id && !body.guest_client_name?.trim()) {
      return NextResponse.json({ ok: false, message: "取引先またはゲスト宛先を指定してください" }, { status: 400 })
    }

    const settingsRes = await supabase.from("org_settings").select("*").eq("org_id", orgId).maybeSingle()
    const settings = (settingsRes.data ?? {}) as Record<string, unknown>
    const issueDate = typeof body.issue_date === "string" && body.issue_date ? body.issue_date : new Date().toISOString().slice(0, 10)
    const dueDate = typeof body.due_date === "string" && body.due_date ? body.due_date : issueDate
    const invoiceMonth =
      typeof body.invoice_month === "string" && /^\d{4}-\d{2}$/.test(body.invoice_month)
        ? body.invoice_month
        : issueDate.slice(0, 7)
    const taxMode = body.tax_mode === "exclusive" || body.tax_mode === "inclusive" ? body.tax_mode : "exempt"
    const taxRate = Number.isFinite(Number(body.tax_rate)) ? Number(body.tax_rate) : 0
    const withholdingEnabled = Boolean(body.withholding_enabled)
    const withholdingRate = Number.isFinite(Number(body.withholding_rate)) ? Number(body.withholding_rate) : 10.21
    const subtotal = normalizedLines.reduce((sum, line) => sum + line.quantity * line.unit_price, 0)
    const totals = calcTotals(subtotal, taxMode, taxRate, withholdingEnabled, withholdingRate)
    const sourceType = normalizeInvoiceSourceTypeForWrite(body.source_type)
    const bankAccountId = typeof body.bank_account_id === "string" && body.bank_account_id ? body.bank_account_id : null

    let bankSnapshot: Record<string, unknown> = {}
    if (bankAccountId) {
      const { data: bankAccount } = await supabase
        .from("org_bank_accounts")
        .select("*")
        .eq("id", bankAccountId)
        .eq("org_id", orgId)
        .maybeSingle()
      bankSnapshot = (bankAccount as Record<string, unknown> | null) ?? {}
    } else {
      const { data: defaultBank } = await supabase
        .from("org_bank_accounts")
        .select("*")
        .eq("org_id", orgId)
        .eq("is_default", true)
        .maybeSingle()
      if (defaultBank) {
        bankSnapshot = defaultBank as Record<string, unknown>
      }
    }

    const issuerSnapshot = {
      issuer_name: settings.issuer_name ?? null,
      issuer_zip: settings.issuer_zip ?? null,
      issuer_address: settings.issuer_address ?? null,
      issuer_phone: settings.issuer_phone ?? null,
      issuer_email: settings.issuer_email ?? null,
      issuer_registration_number: settings.issuer_registration_number ?? null,
      business_entity_type: settings.business_entity_type ?? "corporate",
      invoice_note_fixed: settings.invoice_note_fixed ?? null,
      org_name: settings.org_name ?? null,
    }

    const invoiceId = crypto.randomUUID()
    const insertInvoice = {
      id: invoiceId,
      org_id: orgId,
      client_id: body.client_id ?? null,
      invoice_month: invoiceMonth,
      status: "draft",
      invoice_no: null,
      invoice_title: body.invoice_title?.trim() || "請求書",
      issue_date: issueDate,
      due_date: dueDate,
      subtotal: totals.subtotal,
      total: totals.total,
      tax_mode: taxMode,
      tax_rate: taxRate,
      tax_amount: totals.taxAmount,
      withholding_enabled: withholdingEnabled,
      withholding_amount: totals.withholdingAmount,
      bank_account_id: bankAccountId,
      issuer_snapshot: issuerSnapshot,
      bank_snapshot: bankSnapshot,
      guest_client_name: body.client_id ? null : body.guest_client_name?.trim() || null,
      guest_company_name: body.client_id ? null : body.guest_company_name?.trim() || null,
      guest_client_email: body.client_id ? null : body.guest_client_email?.trim() || null,
      guest_client_address: body.client_id ? null : body.guest_client_address?.trim() || null,
      request_id: body.request_id ?? null,
      copied_from_invoice_id: body.copied_from_invoice_id ?? null,
      source_type: sourceType,
      notes: body.notes?.trim() || null,
      created_at: new Date().toISOString(),
    }

    const { error: invoiceError } = await supabase.from("invoices").insert(insertInvoice)
    if (invoiceError) {
      return NextResponse.json({ ok: false, message: invoiceError.message }, { status: 500 })
    }

    const lineRows = normalizedLines.map((line, index) => ({
      id: crypto.randomUUID(),
      invoice_id: invoiceId,
      description: line.description,
      quantity: line.quantity,
      unit_price: line.unit_price,
      amount: line.quantity * line.unit_price,
      sort_order: index + 1,
    }))
    const { error: lineError } = await supabase.from("invoice_lines").insert(lineRows)
    if (lineError) {
      await supabase.from("invoices").delete().eq("id", invoiceId).eq("org_id", orgId)
      return NextResponse.json({ ok: false, message: lineError.message }, { status: 500 })
    }

    if (body.request_id) {
      await supabase
        .from("invoice_requests")
        .update({ issued_invoice_id: invoiceId, updated_at: new Date().toISOString() })
        .eq("id", body.request_id)
        .eq("org_id", orgId)
    }

    const admin = createSupabaseAdmin()
    await writeAuditLog(admin, {
      org_id: orgId,
      user_id: userId,
      action: "invoice.create",
      resource_type: "invoice",
      resource_id: invoiceId,
      meta: {
        source_type: sourceType,
        invoice_no: null,
        invoice_status: "draft",
        invoice_month: invoiceMonth,
        total: totals.total,
      },
    })

    return NextResponse.json({ ok: true, invoiceId, invoiceNo: null, createdBy: userId }, { status: 200 })
  } catch (e) {
    console.error("[api/invoices/create]", e)
    return NextResponse.json({ ok: false, message: "請求書の作成に失敗しました" }, { status: 500 })
  }
}
