import { NextRequest, NextResponse } from "next/server"
import { createSupabaseAdmin } from "@/lib/supabaseAdmin"
import { notifyVendorUser } from "@/lib/opsNotifications"
import {
  normalizeVendorBillingMonth,
  requireAdminActor,
  upsertVendorDraftInvoice,
} from "@/lib/vendorPortal"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(req: NextRequest) {
  try {
    const actor = await requireAdminActor(req)
    const body = (await req.json().catch(() => null)) as { vendorId?: string; month?: string } | null
    const vendorId = typeof body?.vendorId === "string" ? body.vendorId.trim() : null
    const month = normalizeVendorBillingMonth(body?.month)

    if (!vendorId || !month) {
      return NextResponse.json({ ok: false, error: "vendorId と month は必須です。" }, { status: 400 })
    }

    const admin = createSupabaseAdmin()
    const { data: vendor } = await admin
      .from("vendors")
      .select("id, name, email")
      .eq("id", vendorId)
      .eq("org_id", actor.orgId)
      .maybeSingle()
    if (!vendor) {
      return NextResponse.json({ ok: false, error: "外注先が見つかりません。" }, { status: 404 })
    }

    const result = await upsertVendorDraftInvoice({
      actor: {
        userId: actor.userId,
        orgId: actor.orgId,
        vendorId,
        vendorName: (vendor as { name?: string | null }).name?.trim() || "外注先",
        vendorEmail: (vendor as { email?: string | null }).email?.trim() || null,
      },
      month,
      markRequested: true,
      requestSentBy: actor.userId,
    })

    if (!result.ok) {
      const status = result.state === "locked" ? 409 : 400
      return NextResponse.json(
        {
          ok: false,
          error: result.reason,
          state: result.state,
          invoiceId: result.invoiceId,
          counts: result.preview.counts,
        },
        { status }
      )
    }

    await notifyVendorUser({
      orgId: actor.orgId,
      vendorId,
      type: "vendor_invoice.requested",
      payload: {
        vendor_id: vendorId,
        vendor_invoice_id: result.invoiceId,
        billing_month: month,
        total: result.preview.counts.amount,
      },
    })

    return NextResponse.json({
      ok: true,
      state: result.state,
      invoiceId: result.invoiceId,
      counts: result.preview.counts,
    })
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "請求依頼の送信に失敗しました。" },
      { status: 400 }
    )
  }
}
