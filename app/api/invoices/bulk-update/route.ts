import { NextRequest, NextResponse } from "next/server"
import { requireOrgAdmin } from "@/lib/adminApi"
import { writeAuditLog } from "@/lib/auditLog"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

type InvoiceBulkStatus = "draft" | "issued" | "void"

function isInvoiceBulkStatus(value: unknown): value is InvoiceBulkStatus {
  return value === "draft" || value === "issued" || value === "void"
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}))
    const orgId = typeof body?.orgId === "string" ? body.orgId.trim() : null
    const auth = await requireOrgAdmin(req, orgId)
    if (!auth.ok) return auth.response

    const invoiceIds = Array.isArray(body?.invoiceIds)
      ? body.invoiceIds.filter((value: unknown): value is string => typeof value === "string" && value.trim().length > 0)
      : []
    const status = isInvoiceBulkStatus(body?.status) ? body.status : null
    const note = typeof body?.note === "string" ? body.note.trim() : ""

    if (!status || invoiceIds.length === 0) {
      return NextResponse.json({ ok: false, error: "invoiceIds and status are required" }, { status: 400 })
    }

    const { admin, userId } = auth
    const { data: rows, error: fetchError } = await admin
      .from("invoices")
      .select("id, status, issue_date, send_prepared_at")
      .eq("org_id", auth.orgId)
      .in("id", invoiceIds)

    if (fetchError) {
      return NextResponse.json({ ok: false, error: fetchError.message }, { status: 500 })
    }

    const invoices = (rows ?? []) as Array<{
      id: string
      status: string
      issue_date: string | null
      send_prepared_at: string | null
    }>

    if (invoices.length === 0) {
      return NextResponse.json({ ok: false, error: "Invoices not found" }, { status: 404 })
    }

    const now = new Date().toISOString()
    const nextIssueDate = now.slice(0, 10)
    const payload: Record<string, unknown> = {
      status,
      updated_at: now,
    }
    if (status === "issued") {
      payload.issue_date = nextIssueDate
    }

    const { error: updateError } = await admin
      .from("invoices")
      .update(payload)
      .eq("org_id", auth.orgId)
      .in("id", invoices.map((invoice) => invoice.id))

    if (updateError) {
      return NextResponse.json({ ok: false, error: updateError.message }, { status: 500 })
    }

    await admin.from("bulk_action_logs").insert({
      org_id: auth.orgId,
      action_type: "invoice.bulk_update",
      target_type: "invoice",
      target_ids: invoices.map((invoice) => invoice.id),
      target_count: invoices.length,
      payload: {
        status,
        note: note || null,
      },
      created_by: userId,
    })

    await writeAuditLog(admin, {
      org_id: auth.orgId,
      user_id: userId,
      action: "invoice.bulk_status",
      resource_type: "invoice",
      resource_id: null,
      meta: {
        invoice_ids: invoices.map((invoice) => invoice.id),
        next_status: status,
        note: note || null,
      },
    })

    return NextResponse.json({
      ok: true,
      updatedCount: invoices.length,
      status,
    })
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Server error" },
      { status: 500 }
    )
  }
}
