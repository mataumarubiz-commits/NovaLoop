import { NextRequest, NextResponse } from "next/server"
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
    const { data: invoice } = await admin
      .from("vendor_invoices")
      .select(
        "id, invoice_number, billing_month, status, total, item_count, memo, submit_deadline, pay_date, submitted_at, first_submitted_at, resubmitted_at, approved_at, returned_at, rejected_category, rejected_reason, return_count, return_history, recipient_snapshot, vendor_profile_snapshot, vendor_bank_snapshot, pdf_path"
      )
      .eq("id", id)
      .eq("org_id", actor.orgId)
      .eq("vendor_id", actor.vendorId)
      .maybeSingle()

    if (!invoice) return NextResponse.json({ ok: false, error: "請求が見つかりません。" }, { status: 404 })

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
        id: invoice.id,
        invoice_number: invoice.invoice_number,
        billing_month: invoice.billing_month,
        status: invoice.status,
        total: invoice.total,
        item_count: invoice.item_count,
        memo: invoice.memo,
        submit_deadline: invoice.submit_deadline,
        pay_date: invoice.pay_date,
        submitted_at: invoice.submitted_at,
        first_submitted_at: invoice.first_submitted_at,
        resubmitted_at: invoice.resubmitted_at,
        approved_at: invoice.approved_at,
        returned_at: invoice.returned_at,
        rejected_category: invoice.rejected_category,
        rejected_reason: invoice.rejected_reason,
        return_count: invoice.return_count,
        return_history: invoice.return_history ?? [],
        recipient_snapshot: invoice.recipient_snapshot,
        profile_snapshot: invoice.vendor_profile_snapshot,
        bank_snapshot: invoice.vendor_bank_snapshot,
        pdf_path: invoice.pdf_path,
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
