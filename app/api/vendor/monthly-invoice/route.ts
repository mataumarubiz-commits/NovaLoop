import { NextRequest, NextResponse } from "next/server"
import { createSupabaseAdmin } from "@/lib/supabaseAdmin"
import { writeAuditLog } from "@/lib/auditLog"
import { generateVendorInvoicePdf } from "@/lib/vendorInvoicePdf"
import { notifyAdminRoles } from "@/lib/opsNotifications"
import { selectWithColumnFallback, writeWithColumnFallback } from "@/lib/postgrestCompat"
import {
  buildVendorInvoicePreview,
  loadRecipientSnapshot,
  loadVendorProfileAndBank,
  normalizeVendorBillingMonth,
  requireVendorActor,
  resolveVendorPortalMonth,
  upsertVendorDraftInvoice,
  validateVendorBank,
  validateVendorProfile,
} from "@/lib/vendorPortal"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

async function loadHistory(orgId: string, vendorId: string) {
  const admin = createSupabaseAdmin()
  const { data } = await selectWithColumnFallback<Record<string, unknown>[]>({
    table: "vendor_invoices",
    columns: [
      "id",
      "invoice_number",
      "billing_month",
      "status",
      "total",
      "item_count",
      "memo",
      "pdf_path",
      "submitted_at",
      "first_submitted_at",
      "resubmitted_at",
      "approved_at",
      "returned_at",
      "rejected_category",
      "rejected_reason",
      "return_count",
      "pay_date",
    ],
    execute: async (columnsCsv) => {
      const result = await admin
        .from("vendor_invoices")
        .select(columnsCsv)
        .eq("org_id", orgId)
        .eq("vendor_id", vendorId)
        .order("billing_month", { ascending: false })
        .limit(12)
      return {
        data: (result.data ?? []) as unknown as Record<string, unknown>[],
        error: result.error,
      }
    },
  })

  return data ?? []
}

async function nextVendorInvoiceNumber(orgId: string, billingMonth: string) {
  const admin = createSupabaseAdmin()
  const { data: settings, error: settingsError } = await admin
    .from("org_settings")
    .select("invoice_seq")
    .eq("org_id", orgId)
    .maybeSingle()

  if (settingsError) throw new Error(settingsError.message)

  const nextSeq = Number((settings as { invoice_seq?: number } | null)?.invoice_seq ?? 1)
  const invoiceNumber = `VINV-${billingMonth.slice(0, 4)}-${String(nextSeq).padStart(7, "0")}`

  const { error: updateError } = await admin
    .from("org_settings")
    .upsert({ org_id: orgId, invoice_seq: nextSeq + 1 }, { onConflict: "org_id" })
  if (updateError) throw new Error(updateError.message)

  return invoiceNumber
}

function parseRequestedMonth(value: string | null) {
  if (value == null || value.trim() === "") return null
  return normalizeVendorBillingMonth(value)
}

export async function GET(req: NextRequest) {
  try {
    const actor = await requireVendorActor(req)
    const rawMonth = req.nextUrl.searchParams.get("month")
    const requestedMonth = parseRequestedMonth(rawMonth)

    if (rawMonth && !requestedMonth) {
      return NextResponse.json({ ok: false, error: "month は YYYY-MM 形式で指定してください。" }, { status: 400 })
    }

    const resolved = await resolveVendorPortalMonth(actor, requestedMonth)
    let preview = resolved.preview
    let autoPrepared = false

    if (!preview.editableInvoice && !preview.lockedInvoice && preview.lines.length > 0) {
      await upsertVendorDraftInvoice({
        actor,
        month: resolved.month,
      })
      preview = await buildVendorInvoicePreview(actor, resolved.month)
      autoPrepared = true
    }

    const [{ profile, bank }, history] = await Promise.all([
      loadVendorProfileAndBank(actor),
      loadHistory(actor.orgId, actor.vendorId),
    ])

    return NextResponse.json({
      ok: true,
      month: resolved.month,
      requestedMonth,
      resolvedFrom: resolved.source,
      autoPrepared,
      vendor: {
        name: actor.vendorName,
        email: actor.vendorEmail,
      },
      profile,
      bankAccount: bank,
      preview,
      history,
    })
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "今月の請求を読み込めませんでした。" },
      { status: 400 }
    )
  }
}

export async function POST(req: NextRequest) {
  try {
    const actor = await requireVendorActor(req)
    const body = (await req.json().catch(() => null)) as { month?: string | null } | null
    const rawMonth = typeof body?.month === "string" ? body.month : null
    const requestedMonth = parseRequestedMonth(rawMonth)

    if (rawMonth && !requestedMonth) {
      return NextResponse.json({ ok: false, error: "month は YYYY-MM 形式で指定してください。" }, { status: 400 })
    }

    const resolved = requestedMonth
      ? {
          month: requestedMonth,
          preview: await buildVendorInvoicePreview(actor, requestedMonth),
          source: "query" as const,
        }
      : await resolveVendorPortalMonth(actor, null)

    const month = resolved.month
    const preview = resolved.preview

    const admin = createSupabaseAdmin()
    const [{ profile, bank }, recipient] = await Promise.all([
      loadVendorProfileAndBank(actor),
      loadRecipientSnapshot(actor.orgId),
    ])

    if (!validateVendorProfile(profile)) {
      return NextResponse.json({ ok: false, error: "プロフィール情報を先に登録してください。" }, { status: 400 })
    }
    if (!validateVendorBank(bank)) {
      return NextResponse.json({ ok: false, error: "振込先口座を先に登録してください。" }, { status: 400 })
    }
    if (preview.lines.length === 0) {
      return NextResponse.json({ ok: false, error: "この月に請求対象の案件がありません。" }, { status: 400 })
    }
    if (preview.lockedInvoice) {
      return NextResponse.json(
        { ok: false, error: `この月の請求はすでに ${preview.lockedInvoice.status} です。` },
        { status: 409 }
      )
    }

    const existing = preview.editableInvoice
    const invoiceId = existing?.id ?? crypto.randomUUID()
    const now = new Date().toISOString()
    const isResubmission = existing?.status === "rejected"
    const invoiceNumber = existing?.invoice_number ?? (await nextVendorInvoiceNumber(actor.orgId, month))

    const invoicePayload = {
      id: invoiceId,
      org_id: actor.orgId,
      vendor_id: actor.vendorId,
      invoice_number: invoiceNumber,
      billing_month: month,
      status: "submitted",
      submit_deadline: preview.dates.submitDeadline,
      pay_date: preview.dates.payDate,
      total: preview.counts.amount,
      item_count: preview.counts.items,
      memo: preview.memo,
      submitted_at: now,
      first_submitted_at: existing?.first_submitted_at ?? now,
      resubmitted_at: isResubmission ? now : null,
      approved_at: existing?.approved_at ?? null,
      confirmed_at: null,
      returned_at: null,
      rejected_category: null,
      rejected_reason: null,
      return_count: existing?.return_count ?? 0,
      return_history: existing?.return_history ?? [],
      recipient_snapshot: recipient,
      vendor_profile_snapshot: profile,
      vendor_bank_snapshot: bank,
      updated_at: now,
    }

    if (existing?.id) {
      try {
        await writeWithColumnFallback({
          table: "vendor_invoices",
          payload: invoicePayload,
          execute: async (safePayload) => {
            const result = await admin
              .from("vendor_invoices")
              .update(safePayload)
              .eq("id", existing.id)
              .eq("org_id", actor.orgId)
            return { data: null, error: result.error }
          },
        })
      } catch (error) {
        return NextResponse.json(
          { ok: false, error: error instanceof Error ? error.message : "外注請求の更新に失敗しました。" },
          { status: 500 }
        )
      }

      await admin.from("vendor_invoice_lines").delete().eq("vendor_invoice_id", existing.id)
    } else {
      try {
        await writeWithColumnFallback({
          table: "vendor_invoices",
          payload: { ...invoicePayload, created_at: now },
          execute: async (safePayload) => {
            const result = await admin.from("vendor_invoices").insert(safePayload)
            return { data: null, error: result.error }
          },
        })
      } catch (error) {
        return NextResponse.json(
          { ok: false, error: error instanceof Error ? error.message : "外注請求の作成に失敗しました。" },
          { status: 500 }
        )
      }
    }

    const lineRows = preview.lines.map((line) => ({
      vendor_invoice_id: invoiceId,
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
    if (lineError) return NextResponse.json({ ok: false, error: lineError.message }, { status: 500 })

    const pdf = await generateVendorInvoicePdf({ orgId: actor.orgId, invoiceId, actorUserId: actor.userId })

    await notifyAdminRoles({
      orgId: actor.orgId,
      type: "vendor_invoice.submitted",
      payload: {
        vendor_id: actor.vendorId,
        vendor_name: actor.vendorName,
        vendor_invoice_id: invoiceId,
        billing_month: month,
        total: preview.counts.amount,
        invoice_number: invoiceNumber,
        resubmitted: isResubmission,
      },
    })

    await writeAuditLog(admin, {
      org_id: actor.orgId,
      user_id: actor.userId,
      action: "vendor_invoice.create",
      resource_type: "vendor_invoice",
      resource_id: invoiceId,
      meta: {
        billing_month: month,
        invoice_number: invoiceNumber,
        line_count: preview.counts.items,
        total: preview.counts.amount,
        flow: isResubmission ? "vendor_self_resubmit" : "vendor_self_submit",
      },
    })

    return NextResponse.json({
      ok: true,
      invoice: {
        id: invoiceId,
        invoice_number: invoiceNumber,
        billing_month: month,
        status: "submitted",
        total: preview.counts.amount,
        submitted_at: now,
        pdf_path: pdf.pdfPath,
        signed_url: pdf.signedUrl,
      },
    })
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "請求を提出できませんでした。" },
      { status: 400 }
    )
  }
}
