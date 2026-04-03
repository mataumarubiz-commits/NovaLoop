import { NextRequest, NextResponse } from "next/server"
import { selectWithColumnFallback } from "@/lib/postgrestCompat"
import { createSupabaseAdmin } from "@/lib/supabaseAdmin"
import { requireVendorActor } from "@/lib/vendorPortal"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const actor = await requireVendorActor(req)
    const { id } = await params
    if (!id) return NextResponse.json({ ok: false, error: "請求IDが不正です。" }, { status: 400 })

    const admin = createSupabaseAdmin()
    const { data: invoice } = await selectWithColumnFallback<Record<string, unknown>>({
      table: "vendor_invoices",
      columns: [
        "id",
        "invoice_number",
        "billing_month",
        "status",
        "total",
        "item_count",
        "memo",
        "submit_deadline",
        "pay_date",
        "submitted_at",
        "first_submitted_at",
        "resubmitted_at",
        "approved_at",
        "returned_at",
        "rejected_category",
        "rejected_reason",
        "return_count",
        "return_history",
        "recipient_snapshot",
        "vendor_profile_snapshot",
        "vendor_bank_snapshot",
        "pdf_path",
      ],
      execute: async (columnsCsv) => {
        const result = await admin
          .from("vendor_invoices")
          .select(columnsCsv)
          .eq("id", id)
          .eq("org_id", actor.orgId)
          .eq("vendor_id", actor.vendorId)
          .maybeSingle()
        return {
          data: (result.data ?? null) as Record<string, unknown> | null,
          error: result.error,
        }
      },
    })

    if (!invoice) return NextResponse.json({ ok: false, error: "請求が見つかりません。" }, { status: 404 })
    const invoiceRow = invoice as {
      id?: string
      invoice_number?: string | null
      billing_month?: string | null
      status?: string | null
      total?: number | null
      item_count?: number | null
      memo?: string | null
      submit_deadline?: string | null
      pay_date?: string | null
      submitted_at?: string | null
      first_submitted_at?: string | null
      resubmitted_at?: string | null
      approved_at?: string | null
      returned_at?: string | null
      rejected_category?: string | null
      rejected_reason?: string | null
      return_count?: number | null
      return_history?: Array<Record<string, unknown>>
      recipient_snapshot?: Record<string, unknown> | null
      vendor_profile_snapshot?: Record<string, unknown> | null
      vendor_bank_snapshot?: Record<string, unknown> | null
      pdf_path?: string | null
    }

    const { data: lines } = await admin
      .from("vendor_invoice_lines")
      .select("content_id, description, qty, unit_price, amount, work_type, source_meta")
      .eq("vendor_invoice_id", id)
      .order("created_at", { ascending: true })

    const normalizedLines = ((lines ?? []) as Array<Record<string, unknown>>).map((line) => {
      const sourceMeta = (line.source_meta as Record<string, unknown> | null) ?? null
      return {
        content_id: String(line.content_id ?? sourceMeta?.content_id ?? crypto.randomUUID()),
        project_name: String(sourceMeta?.project_name ?? "案件"),
        title: String(sourceMeta?.title ?? line.description ?? "コンテンツ"),
        client_name: String(sourceMeta?.client_name ?? "クライアント"),
        qty: Number(line.qty ?? 1),
        unit_price: Number(line.unit_price ?? 0),
        amount: Number(line.amount ?? 0),
        description: String(line.description ?? ""),
        work_type: String(line.work_type ?? "editor"),
      }
    })

    return NextResponse.json({
      ok: true,
      invoice: {
        id: invoiceRow.id ?? null,
        invoice_number: invoiceRow.invoice_number ?? null,
        billing_month: invoiceRow.billing_month ?? null,
        status: invoiceRow.status ?? null,
        total: Number(invoiceRow.total ?? 0),
        item_count: Number(invoiceRow.item_count ?? 0),
        memo: invoiceRow.memo ?? null,
        submit_deadline: invoiceRow.submit_deadline ?? null,
        pay_date: invoiceRow.pay_date ?? null,
        submitted_at: invoiceRow.submitted_at ?? null,
        first_submitted_at: invoiceRow.first_submitted_at ?? null,
        resubmitted_at: invoiceRow.resubmitted_at ?? null,
        approved_at: invoiceRow.approved_at ?? null,
        returned_at: invoiceRow.returned_at ?? null,
        rejected_category: invoiceRow.rejected_category ?? null,
        rejected_reason: invoiceRow.rejected_reason ?? null,
        return_count: Number(invoiceRow.return_count ?? 0),
        return_history: invoiceRow.return_history ?? [],
        recipient_snapshot: invoiceRow.recipient_snapshot ?? null,
        profile_snapshot: invoiceRow.vendor_profile_snapshot ?? null,
        bank_snapshot: invoiceRow.vendor_bank_snapshot ?? null,
        pdf_path: invoiceRow.pdf_path ?? null,
        lines: normalizedLines,
      },
    })
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "請求詳細の取得に失敗しました。" },
      { status: 400 }
    )
  }
}
