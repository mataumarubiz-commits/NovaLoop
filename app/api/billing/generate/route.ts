import { NextRequest, NextResponse } from "next/server"
import { createSupabaseAdmin } from "@/lib/supabaseAdmin"
import { getOrgRole, getUserIdFromToken, isOrgAdmin } from "@/lib/apiAuth"
import {
  BillingDuplicateMode,
  buildInvoiceLineDescription,
  buildInvoiceTitle,
  issueDateYmd,
  loadBillingPreview,
  nextMonthEndFromBillingMonth,
} from "@/lib/monthlyBilling"
import { normalizeInvoiceSourceTypeForWrite } from "@/lib/invoiceSourceType"
import { writeAuditLog } from "@/lib/auditLog"
import { trackServerEvent } from "@/lib/analytics"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

type GenerateBody = {
  billing_month?: string
  client_ids?: string[]
  duplicate_mode?: BillingDuplicateMode
  issue_date?: string
  due_date?: string
}

function buildInvoiceNo(issueDate: string, seq: number) {
  return `INV-${issueDate.slice(0, 4)}-${String(seq).padStart(7, "0")}`
}

export async function POST(req: NextRequest) {
  try {
    const userId = await getUserIdFromToken(req)
    if (!userId) {
      return NextResponse.json({ ok: false, message: "ログインし直してください。" }, { status: 401 })
    }

    const body = (await req.json().catch(() => ({}))) as GenerateBody
    const billingMonth =
      typeof body.billing_month === "string" && /^\d{4}-\d{2}$/.test(body.billing_month)
        ? body.billing_month
        : null
    if (!billingMonth) {
      return NextResponse.json({ ok: false, message: "対象月は YYYY-MM 形式で指定してください。" }, { status: 400 })
    }
    const duplicateMode: BillingDuplicateMode =
      body.duplicate_mode === "allow_additional" ? "allow_additional" : "skip_existing"

    const admin = createSupabaseAdmin()
    const { data: profile } = await admin
      .from("user_profiles")
      .select("active_org_id")
      .eq("user_id", userId)
      .maybeSingle()
    const orgId = (profile as { active_org_id?: string | null } | null)?.active_org_id ?? null
    if (!orgId) {
      return NextResponse.json({ ok: false, message: "アクティブなワークスペースが見つかりません。" }, { status: 400 })
    }

    const role = await getOrgRole(admin, userId, orgId)
    if (!isOrgAdmin(role)) {
      return NextResponse.json(
        { ok: false, message: "請求生成は owner / executive_assistant のみ実行できます。" },
        { status: 403 }
      )
    }

    const selectedClientIds = Array.isArray(body.client_ids) ? body.client_ids.filter(Boolean) : []
    const preview = await loadBillingPreview({
      admin,
      orgId,
      billingMonth,
    })
    const targetClients = preview.clients.filter((client) =>
      selectedClientIds.length === 0 ? true : selectedClientIds.includes(client.client_id)
    )

    if (targetClients.length === 0) {
      return NextResponse.json({ ok: false, message: "生成対象のクライアントがありません。" }, { status: 400 })
    }

    const issueDate =
      typeof body.issue_date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.issue_date)
        ? body.issue_date
        : issueDateYmd()
    const dueDate =
      typeof body.due_date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.due_date)
        ? body.due_date
        : nextMonthEndFromBillingMonth(billingMonth)

    const { data: settings } = await admin
      .from("org_settings")
      .select("*")
      .eq("org_id", orgId)
      .maybeSingle()
    const initialSeq = Number((settings as { invoice_seq?: number } | null)?.invoice_seq ?? 1)

    const { data: defaultBank } = await admin
      .from("org_bank_accounts")
      .select("*")
      .eq("org_id", orgId)
      .eq("is_default", true)
      .maybeSingle()

    const issuerSnapshot = {
      issuer_name: (settings as Record<string, unknown> | null)?.issuer_name ?? null,
      issuer_zip: (settings as Record<string, unknown> | null)?.issuer_zip ?? null,
      issuer_address: (settings as Record<string, unknown> | null)?.issuer_address ?? null,
      issuer_phone: (settings as Record<string, unknown> | null)?.issuer_phone ?? null,
      issuer_email: (settings as Record<string, unknown> | null)?.issuer_email ?? null,
      issuer_registration_number:
        (settings as Record<string, unknown> | null)?.issuer_registration_number ?? null,
      business_entity_type:
        (settings as Record<string, unknown> | null)?.business_entity_type ?? "corporate",
      invoice_note_fixed:
        (settings as Record<string, unknown> | null)?.invoice_note_fixed ?? null,
    }

    const generated: Array<{ client_id: string; client_name: string; invoice_id: string; invoice_no: string; content_count: number }> = []
    const skipped: Array<{ client_id: string; client_name: string; reason: string }> = []
    const monthlyInvoiceSourceType = normalizeInvoiceSourceTypeForWrite("billing_monthly")
    let seq = initialSeq

    for (const client of targetClients) {
      if (client.target_count === 0) {
        skipped.push({ client_id: client.client_id, client_name: client.client_name, reason: "請求対象コンテンツがありません。" })
        continue
      }
      if (client.existing_invoice_count > 0 && duplicateMode === "skip_existing") {
        skipped.push({
          client_id: client.client_id,
          client_name: client.client_name,
          reason: "同月請求書があるためスキップしました。",
        })
        continue
      }

      const { data: freshContents, error: freshContentsError } = await admin
        .from("contents")
        .select("id, client_id, project_name, title, unit_price, status, due_client_at, delivery_month, invoice_id")
        .eq("org_id", orgId)
        .in("id", client.content_ids)
        .is("invoice_id", null)
        .order("due_client_at", { ascending: true })
      if (freshContentsError) {
        skipped.push({ client_id: client.client_id, client_name: client.client_name, reason: "最新の請求対象取得に失敗しました。" })
        continue
      }
      const rows = ((freshContents ?? []) as Array<Record<string, unknown>>).map((row) => ({
        id: String(row.id),
        project_name: String(row.project_name ?? ""),
        title: String(row.title ?? ""),
        unit_price: Number(row.unit_price ?? 0),
        status: String(row.status ?? ""),
        due_client_at: String(row.due_client_at ?? ""),
        delivery_month: String(row.delivery_month ?? ""),
      }))
      if (rows.length === 0) {
        skipped.push({ client_id: client.client_id, client_name: client.client_name, reason: "未請求の対象コンテンツがありません。" })
        continue
      }

      const invoiceId = crypto.randomUUID()
      const invoiceNo = buildInvoiceNo(issueDate, seq)
      const subtotal = rows.reduce((sum, row) => sum + Number(row.unit_price), 0)
      const now = new Date().toISOString()

      const { error: invoiceError } = await admin.from("invoices").insert({
        id: invoiceId,
        org_id: orgId,
        client_id: client.client_id,
        invoice_month: billingMonth,
        status: "issued",
        invoice_no: invoiceNo,
        invoice_title: buildInvoiceTitle(billingMonth),
        issue_date: issueDate,
        due_date: dueDate,
        subtotal,
        total: subtotal,
        tax_mode: "exempt",
        tax_rate: 0,
        tax_amount: 0,
        withholding_enabled: false,
        withholding_amount: 0,
        source_type: monthlyInvoiceSourceType,
        issuer_snapshot: issuerSnapshot,
        bank_snapshot: defaultBank ?? {},
        created_at: now,
        updated_at: now,
        issued_at: now,
      })
      if (invoiceError) {
        skipped.push({ client_id: client.client_id, client_name: client.client_name, reason: `請求書の作成に失敗しました: ${invoiceError.message}` })
        continue
      }

      const lineRows = rows.map((row, index) => ({
        id: crypto.randomUUID(),
        invoice_id: invoiceId,
        content_id: row.id,
        description: buildInvoiceLineDescription({
          id: row.id,
          client_id: client.client_id,
          project_name: row.project_name,
          title: row.title,
          unit_price: row.unit_price,
          status: row.status,
          due_client_at: row.due_client_at,
          delivery_month: row.delivery_month,
          invoice_id: null,
        }),
        quantity: 1,
        unit_price: row.unit_price,
        amount: row.unit_price,
        sort_order: index + 1,
        project_name: row.project_name,
        title: row.title,
      }))
      const { error: lineError } = await admin.from("invoice_lines").insert(lineRows)
      if (lineError) {
        await admin.from("invoices").delete().eq("id", invoiceId).eq("org_id", orgId)
        skipped.push({ client_id: client.client_id, client_name: client.client_name, reason: `明細作成に失敗しました: ${lineError.message}` })
        continue
      }

      const { error: contentUpdateError } = await admin
        .from("contents")
        .update({ invoice_id: invoiceId })
        .in("id", rows.map((row) => row.id))
        .eq("org_id", orgId)
      if (contentUpdateError) {
        await admin.from("invoice_lines").delete().eq("invoice_id", invoiceId)
        await admin.from("invoices").delete().eq("id", invoiceId).eq("org_id", orgId)
        skipped.push({ client_id: client.client_id, client_name: client.client_name, reason: `元コンテンツの関連付けに失敗しました: ${contentUpdateError.message}` })
        continue
      }

      const { error: logError } = await admin.from("invoice_generation_logs").insert({
        id: crypto.randomUUID(),
        org_id: orgId,
        billing_month: billingMonth,
        client_id: client.client_id,
        invoice_id: invoiceId,
        generated_content_count: rows.length,
        total_amount: subtotal,
        duplicate_mode: duplicateMode,
        source_type: monthlyInvoiceSourceType,
        created_by: userId,
      })
      if (logError) {
        console.error("[api/billing/generate] log insert failed", logError)
      }

      generated.push({
        client_id: client.client_id,
        client_name: client.client_name,
        invoice_id: invoiceId,
        invoice_no: invoiceNo,
        content_count: rows.length,
      })
      seq += 1
    }

    if (generated.length > 0) {
      await admin
        .from("org_settings")
        .upsert({ org_id: orgId, invoice_seq: seq }, { onConflict: "org_id" })

      await writeAuditLog(admin, {
        org_id: orgId,
        user_id: userId,
        action: "invoice.bulk_generate",
        resource_type: "billing",
        resource_id: null,
        meta: {
          billing_month: billingMonth,
          duplicate_mode: duplicateMode,
          generated_count: generated.length,
          skipped_count: skipped.length,
          invoice_ids: generated.map((row) => row.invoice_id),
        },
      })

      await trackServerEvent({
        orgId,
        userId,
        role,
        eventName: "billing.generated",
        source: "billing_generate_api",
        entityType: "billing_month",
        entityId: billingMonth,
        metadata: {
          generated_count: generated.length,
          skipped_count: skipped.length,
          duplicate_mode: duplicateMode,
        },
      })
    }

    return NextResponse.json({
      ok: true,
      billing_month: billingMonth,
      generated,
      skipped,
      duplicate_mode: duplicateMode,
    })
  } catch (error) {
    console.error("[api/billing/generate]", error)
    return NextResponse.json({ ok: false, message: "月次請求の生成に失敗しました。" }, { status: 500 })
  }
}
