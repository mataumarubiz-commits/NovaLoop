import { NextRequest, NextResponse } from "next/server"
import { requireOrgAdmin } from "@/lib/adminApi"
import { writeAuditLog } from "@/lib/auditLog"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

type InvoiceRow = {
  id: string
  client_id: string | null
  invoice_title: string | null
  guest_client_name: string | null
  guest_company_name: string | null
  guest_client_email: string | null
  guest_client_address: string | null
}

type ClientRow = {
  id: string
  name: string
  billing_name: string | null
  billing_email: string | null
  billing_address: string | null
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

    if (invoiceIds.length === 0) {
      return NextResponse.json({ ok: false, error: "invoiceIds is required" }, { status: 400 })
    }

    const { admin, userId } = auth
    const { data: rows, error: fetchError } = await admin
      .from("invoices")
      .select("id, client_id, invoice_title, guest_client_name, guest_company_name, guest_client_email, guest_client_address")
      .eq("org_id", auth.orgId)
      .in("id", invoiceIds)

    if (fetchError) {
      return NextResponse.json({ ok: false, error: fetchError.message }, { status: 500 })
    }

    const invoices = (rows ?? []) as InvoiceRow[]
    const clientIds = Array.from(new Set(invoices.map((invoice) => invoice.client_id).filter(Boolean))) as string[]
    const { data: clientRows, error: clientError } = clientIds.length
      ? await admin
          .from("clients")
          .select("id, name, billing_name, billing_email, billing_address")
          .eq("org_id", auth.orgId)
          .in("id", clientIds)
      : { data: [], error: null }

    if (clientError) {
      return NextResponse.json({ ok: false, error: clientError.message }, { status: 500 })
    }

    const clientMap = new Map(
      ((clientRows ?? []) as ClientRow[]).map((client) => [client.id, client])
    )

    const preparedAt = new Date().toISOString()
    const { error: updateError } = await admin
      .from("invoices")
      .update({
        send_prepared_at: preparedAt,
        send_prepared_by: userId,
        updated_at: preparedAt,
      })
      .eq("org_id", auth.orgId)
      .in("id", invoices.map((invoice) => invoice.id))

    if (updateError) {
      return NextResponse.json({ ok: false, error: updateError.message }, { status: 500 })
    }

    const recipients = invoices.map((invoice) => {
      const client = invoice.client_id ? clientMap.get(invoice.client_id) ?? null : null
      const recipientName = client?.billing_name || client?.name || invoice.guest_client_name || "未設定"
      const companyName = invoice.guest_company_name || null
      const email = client?.billing_email || invoice.guest_client_email || null
      const address = client?.billing_address || invoice.guest_client_address || null
      const warning =
        !email && !address
          ? "メールアドレスも住所も未登録です。PDF生成後に送付先を確認してください。"
          : null

      return {
        invoiceId: invoice.id,
        invoiceTitle: invoice.invoice_title || "請求書",
        recipientName,
        companyName,
        email,
        address,
        warning,
      }
    })

    await admin.from("bulk_action_logs").insert({
      org_id: auth.orgId,
      action_type: "invoice.bulk_send_prepare",
      target_type: "invoice",
      target_ids: invoices.map((invoice) => invoice.id),
      target_count: invoices.length,
      payload: {
        prepared_at: preparedAt,
      },
      created_by: userId,
    })

    await writeAuditLog(admin, {
      org_id: auth.orgId,
      user_id: userId,
      action: "invoice.bulk_send_prepare",
      resource_type: "invoice",
      resource_id: null,
      meta: {
        invoice_ids: invoices.map((invoice) => invoice.id),
        prepared_at: preparedAt,
      },
    })

    return NextResponse.json({
      ok: true,
      preparedAt,
      count: invoices.length,
      recipients,
    })
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Server error" },
      { status: 500 }
    )
  }
}
