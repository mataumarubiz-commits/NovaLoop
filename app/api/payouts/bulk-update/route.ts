import { NextRequest, NextResponse } from "next/server"
import { createSupabaseAdmin } from "@/lib/supabaseAdmin"
import { getOrgRole, getUserIdFromToken, isOrgAdmin } from "@/lib/apiAuth"
import { writeAuditLog } from "@/lib/auditLog"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

type BulkStatus = "approved" | "rejected" | "paid"

function isBulkStatus(value: unknown): value is BulkStatus {
  return value === "approved" || value === "rejected" || value === "paid"
}

export async function POST(req: NextRequest) {
  try {
    const userId = await getUserIdFromToken(req)
    if (!userId) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 })
    }

    const body = await req.json().catch(() => ({}))
    const orgId = typeof body?.orgId === "string" ? body.orgId.trim() : null
    const invoiceIds = Array.isArray(body?.invoiceIds)
      ? body.invoiceIds.filter((value: unknown): value is string => typeof value === "string" && value.length > 0)
      : []
    const status = isBulkStatus(body?.status) ? body.status : null

    if (!orgId || !status || invoiceIds.length === 0) {
      return NextResponse.json({ ok: false, error: "orgId, invoiceIds, status is required" }, { status: 400 })
    }

    const admin = createSupabaseAdmin()
    const role = await getOrgRole(admin, userId, orgId)
    if (!isOrgAdmin(role)) {
      return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 })
    }

    const { data: invoiceRows, error: invoiceError } = await admin
      .from("vendor_invoices")
      .select("id, vendor_id, pay_date, total, status")
      .eq("org_id", orgId)
      .in("id", invoiceIds)

    if (invoiceError) {
      return NextResponse.json({ ok: false, error: invoiceError.message }, { status: 500 })
    }

    const invoices = (invoiceRows ?? []) as Array<{
      id: string
      vendor_id: string
      pay_date: string
      total: number
      status: string
    }>

    if (invoices.length === 0) {
      return NextResponse.json({ ok: false, error: "Vendor invoices not found" }, { status: 404 })
    }

    const now = new Date().toISOString()
    const nextVendorStatus = status === "paid" ? "paid" : status
    const { error: updateError } = await admin
      .from("vendor_invoices")
      .update({ status: nextVendorStatus, updated_at: now })
      .eq("org_id", orgId)
      .in("id", invoices.map((row) => row.id))

    if (updateError) {
      return NextResponse.json({ ok: false, error: updateError.message }, { status: 500 })
    }

    const { data: existingPayoutRows } = await admin
      .from("payouts")
      .select("id, vendor_invoice_id, status")
      .eq("org_id", orgId)
      .in("vendor_invoice_id", invoices.map((row) => row.id))

    const payoutsByInvoiceId = new Map(
      ((existingPayoutRows ?? []) as Array<{ id: string; vendor_invoice_id: string; status: string }>).map((row) => [
        row.vendor_invoice_id,
        row,
      ])
    )

    const generatedPayoutIds: string[] = []
    const markedPaidPayoutIds: string[] = []

    for (const invoice of invoices) {
      const currentPayout = payoutsByInvoiceId.get(invoice.id)

      if (status === "approved" || status === "paid") {
        if (!currentPayout) {
          const payoutId = crypto.randomUUID()
          const payoutStatus = status === "paid" ? "paid" : "scheduled"
          const { error } = await admin.from("payouts").insert({
            id: payoutId,
            org_id: orgId,
            vendor_id: invoice.vendor_id,
            vendor_invoice_id: invoice.id,
            pay_date: invoice.pay_date,
            amount: invoice.total,
            status: payoutStatus,
            paid_at: status === "paid" ? now : null,
          })
          if (!error) {
            generatedPayoutIds.push(payoutId)
            payoutsByInvoiceId.set(invoice.id, {
              id: payoutId,
              vendor_invoice_id: invoice.id,
              status: payoutStatus,
            })
            await writeAuditLog(admin, {
              org_id: orgId,
              user_id: userId,
              action: "payout.generate",
              resource_type: "payout",
              resource_id: payoutId,
              meta: {
                vendor_invoice_id: invoice.id,
                amount: invoice.total,
                pay_date: invoice.pay_date,
              },
            })
          }
        }
      }

      if (status === "paid") {
        const payout = payoutsByInvoiceId.get(invoice.id)
        if (payout) {
          const { error } = await admin
            .from("payouts")
            .update({ status: "paid", paid_at: now })
            .eq("id", payout.id)
            .eq("org_id", orgId)
          if (!error) {
            markedPaidPayoutIds.push(payout.id)
          }
        }
      }

      await writeAuditLog(admin, {
        org_id: orgId,
        user_id: userId,
        action:
          status === "approved"
            ? "vendor_invoice.approve"
            : status === "rejected"
              ? "vendor_invoice.reject"
              : "payout.mark_paid",
        resource_type: status === "paid" ? "payout" : "vendor_invoice",
        resource_id: status === "paid" ? payoutsByInvoiceId.get(invoice.id)?.id ?? null : invoice.id,
        meta: {
          vendor_invoice_id: invoice.id,
          previous_status: invoice.status,
          next_status: nextVendorStatus,
        },
      })
    }

    return NextResponse.json({
      ok: true,
      updatedCount: invoices.length,
      generatedPayoutCount: generatedPayoutIds.length,
      markedPaidCount: markedPaidPayoutIds.length,
    })
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Server error" },
      { status: 500 }
    )
  }
}
