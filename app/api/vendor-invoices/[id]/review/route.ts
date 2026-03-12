import { NextRequest, NextResponse } from "next/server"
import { createSupabaseAdmin } from "@/lib/supabaseAdmin"
import { notifyAdminRoles, notifyVendorUser } from "@/lib/opsNotifications"
import { requireAdminActor } from "@/lib/vendorPortal"
import { trackServerEvent } from "@/lib/analytics"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const actor = await requireAdminActor(req)
    const { id } = await params
    const body = (await req.json().catch(() => null)) as {
      action?: string
      reason?: string
      category?: string
    } | null
    const action = body?.action === "approve" || body?.action === "reject" ? body.action : null

    if (!id || !action) {
      return NextResponse.json({ ok: false, error: "操作が不正です。" }, { status: 400 })
    }

    const admin = createSupabaseAdmin()
    const { data: invoice } = await admin
      .from("vendor_invoices")
      .select("id, org_id, status, vendor_id, billing_month, total, invoice_number, return_count, return_history")
      .eq("id", id)
      .eq("org_id", actor.orgId)
      .maybeSingle()

    if (!invoice) {
      return NextResponse.json({ ok: false, error: "請求が見つかりません。" }, { status: 404 })
    }

    const category = typeof body?.category === "string" ? body.category.trim() : ""
    const reason = typeof body?.reason === "string" ? body.reason.trim() : ""
    const now = new Date().toISOString()

    if (action === "reject" && (!category || !reason)) {
      return NextResponse.json({ ok: false, error: "差し戻しカテゴリと理由を入力してください。" }, { status: 400 })
    }

    const payload =
      action === "approve"
        ? {
            status: "approved",
            approved_at: now,
            rejected_category: null,
            rejected_reason: null,
            returned_at: null,
            updated_at: now,
          }
        : {
            status: "rejected",
            approved_at: null,
            rejected_category: category,
            rejected_reason: reason,
            returned_at: now,
            return_count: Number((invoice as { return_count?: number }).return_count ?? 0) + 1,
            return_history: [
              ...(((invoice as { return_history?: Array<Record<string, unknown>> }).return_history ?? []) as Array<Record<string, unknown>>),
              {
                category,
                reason,
                returned_at: now,
                returned_by: actor.userId,
              },
            ],
            updated_at: now,
          }

    const { error } = await admin.from("vendor_invoices").update(payload).eq("id", id).eq("org_id", actor.orgId)
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })

    const { data: vendor } = await admin.from("vendors").select("name").eq("id", (invoice as { vendor_id: string }).vendor_id).maybeSingle()
    const vendorName = (vendor as { name?: string | null } | null)?.name ?? ""
    const basePayload = {
      vendor_id: (invoice as { vendor_id: string }).vendor_id,
      vendor_name: vendorName,
      vendor_invoice_id: id,
      billing_month: (invoice as { billing_month?: string }).billing_month ?? "",
      total: (invoice as { total?: number }).total ?? 0,
      invoice_number: (invoice as { invoice_number?: string | null }).invoice_number ?? null,
    }

    await notifyAdminRoles({
      orgId: actor.orgId,
      type: action === "approve" ? "vendor_invoice.approved" : "vendor_invoice.rejected",
      payload: {
        ...basePayload,
        resolved: action === "approve",
        return_category: category,
        return_reason: reason,
      },
    })

    await notifyVendorUser({
      orgId: actor.orgId,
      vendorId: (invoice as { vendor_id: string }).vendor_id,
      type: action === "approve" ? "vendor_invoice.approved" : "vendor_invoice.rejected",
      payload: {
        ...basePayload,
        return_category: category,
        return_reason: reason,
      },
    })

    if (action === "approve") {
      await trackServerEvent({
        orgId: actor.orgId,
        userId: actor.userId,
        eventName: "vendor_invoice.approved_first",
        source: "vendor_invoice_review",
        entityType: "vendor_invoice",
        entityId: id,
        metadata: {
          billing_month: (invoice as { billing_month?: string }).billing_month ?? "",
          total: (invoice as { total?: number }).total ?? 0,
        },
      })
    }

    return NextResponse.json({
      ok: true,
      status: payload.status,
      approved_at: action === "approve" ? now : null,
      rejected_category: action === "reject" ? category : null,
      rejected_reason: action === "reject" ? reason : null,
      returned_at: action === "reject" ? now : null,
    })
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "承認処理に失敗しました。" },
      { status: 400 }
    )
  }
}
