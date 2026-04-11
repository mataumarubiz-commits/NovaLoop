import { NextRequest, NextResponse } from "next/server"
import { requireAdminContext } from "@/lib/adminApi"
import { writeAuditLog } from "@/lib/auditLog"
import { issueInvoices } from "@/lib/invoiceIssuance"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireAdminContext(req)
    if ("error" in auth) return auth.error

    const { id: invoiceId } = await params
    if (!invoiceId) {
      return NextResponse.json({ ok: false, error: "Invoice ID required" }, { status: 400 })
    }

    const now = new Date().toISOString()
    const result = await issueInvoices({
      admin: auth.admin,
      orgId: auth.orgId,
      invoiceIds: [invoiceId],
      nowIso: now,
    })
    const issued = result.updates[0]
    if (!issued) {
      return NextResponse.json({ ok: false, error: "Invoice not found" }, { status: 404 })
    }

    await writeAuditLog(auth.admin, {
      org_id: auth.orgId,
      user_id: auth.userId,
      action: "invoice.issue",
      resource_type: "invoice",
      resource_id: invoiceId,
      meta: {
        invoice_no: issued.invoiceNo,
        issue_date: issued.issueDate,
        assigned_new_number: issued.assignedNewNumber,
      },
    })

    return NextResponse.json({
      ok: true,
      invoiceId,
      invoiceNo: issued.invoiceNo,
      issueDate: issued.issueDate,
      assignedNewNumber: issued.assignedNewNumber,
      updatedCount: result.updatedCount,
      status: "issued",
    })
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Server error" },
      { status: 500 }
    )
  }
}
