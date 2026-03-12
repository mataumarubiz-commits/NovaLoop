import { NextRequest, NextResponse } from "next/server"
import { notifyVendorUser } from "@/lib/opsNotifications"
import { normalizeVendorBillingMonth, requireAdminActor, upsertVendorDraftInvoice } from "@/lib/vendorPortal"
import { createSupabaseAdmin } from "@/lib/supabaseAdmin"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(req: NextRequest) {
  try {
    const actor = await requireAdminActor(req)
    const body = (await req.json().catch(() => null)) as { month?: string; mode?: string } | null
    const month = normalizeVendorBillingMonth(body?.month)
    const mode = body?.mode === "request" ? "request" : "draft"

    if (!month) {
      return NextResponse.json({ ok: false, error: "month は必須です。" }, { status: 400 })
    }

    const admin = createSupabaseAdmin()
    const { data, error } = await admin.from("vendors").select("id, name, email, is_active").eq("org_id", actor.orgId).eq("is_active", true).order("name")
    if (error) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
    }

    const vendors = (data ?? []) as Array<{ id: string; name?: string | null; email?: string | null }>
    const results: Array<{ vendorId: string; vendorName: string; state: "created" | "updated" | "empty" | "locked"; invoiceId: string | null; amount: number; itemCount: number; reason?: string }> = []

    for (const vendor of vendors) {
      const result = await upsertVendorDraftInvoice({
        actor: {
          userId: actor.userId,
          orgId: actor.orgId,
          vendorId: vendor.id,
          vendorName: vendor.name?.trim() || "外注",
          vendorEmail: vendor.email?.trim() || null,
        },
        month,
        markRequested: mode === "request",
        requestSentBy: actor.userId,
      })

      if (result.ok && mode === "request") {
        await notifyVendorUser({
          orgId: actor.orgId,
          vendorId: vendor.id,
          type: "vendor_invoice.requested",
          payload: {
            vendor_id: vendor.id,
            vendor_invoice_id: result.invoiceId,
            billing_month: month,
            total: result.preview.counts.amount,
          },
        })
      }

      results.push({
        vendorId: vendor.id,
        vendorName: vendor.name?.trim() || "外注",
        state: result.state,
        invoiceId: result.invoiceId,
        amount: result.preview.counts.amount,
        itemCount: result.preview.counts.items,
        reason: result.ok ? undefined : result.reason,
      })
    }

    return NextResponse.json({
      ok: true,
      month,
      mode,
      summary: {
        totalVendors: results.length,
        created: results.filter((row) => row.state === "created").length,
        updated: results.filter((row) => row.state === "updated").length,
        empty: results.filter((row) => row.state === "empty").length,
        locked: results.filter((row) => row.state === "locked").length,
      },
      results,
    })
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "月次請求土台の作成に失敗しました。" },
      { status: 400 }
    )
  }
}
