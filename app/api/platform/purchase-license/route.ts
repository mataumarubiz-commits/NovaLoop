import { NextRequest, NextResponse } from "next/server"
import { createSupabaseAdmin } from "@/lib/supabaseAdmin"
import { uploadPlatformInvoicePdf } from "@/lib/platformDocuments"
import { requirePlatformUser } from "@/lib/platformAuth"
import { buildInvoicePdfFileName, ensureNonEmpty, renderPlatformInvoiceHtml } from "@/lib/platform"
import {
  createPlatformNotification,
  getMyLicenseSnapshot,
  getPlatformBillingSettings,
  writePlatformAudit,
} from "@/lib/platformServer"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

type PurchaseRpcResult = {
  entitlement_id: string
  purchase_request_id: string
  payment_request_id: string
  request_number: string
  invoice_number: string
  transfer_reference: string
  issued_at: string
  due_date: string
  reused_existing: boolean
  invoice_pdf_path: string | null
  invoice_document_status: string | null
}

export async function POST(req: NextRequest) {
  const auth = await requirePlatformUser(req)
  if ("error" in auth) return auth.error

  try {
    const body = await req.json().catch(() => ({}))
    const fullName = ensureNonEmpty(body?.full_name, "full_name")
    const companyName = typeof body?.company_name === "string" ? body.company_name.trim() : ""
    const address = ensureNonEmpty(body?.address, "address")
    const phone = ensureNonEmpty(body?.phone, "phone")
    const contactEmail = ensureNonEmpty(body?.contact_email, "contact_email")
    const note = typeof body?.note === "string" ? body.note.trim() : ""

    const rpc = await auth.userClient.rpc("create_platform_purchase_request", {
      p_full_name: fullName,
      p_company_name: companyName,
      p_address: address,
      p_phone: phone,
      p_contact_email: contactEmail,
      p_note: note,
    })

    if (rpc.error || !Array.isArray(rpc.data) || rpc.data.length === 0) {
      const message = rpc.error?.message ?? "Failed to create purchase request"
      const status = message.includes("Active entitlement") ? 409 : 400
      return NextResponse.json({ ok: false, error: message }, { status })
    }

    const result = rpc.data[0] as PurchaseRpcResult
    const admin = createSupabaseAdmin()
    const settings = await getPlatformBillingSettings()
    const issueDate = result.issued_at.slice(0, 10)
    const invoiceMonth = issueDate.slice(0, 7)

    let invoicePdfPath = result.invoice_pdf_path
    let invoiceGeneratedNow = false

    if (!invoicePdfPath) {
      const invoiceHtml = renderPlatformInvoiceHtml({
        settings,
        requestNumber: result.request_number,
        invoiceNumber: result.invoice_number,
        invoiceMonth,
        issueDate,
        dueDate: result.due_date,
        recipientName: fullName,
        companyName,
        transferReference: result.transfer_reference,
        amountJpy: settings.license_price_jpy,
      })

      try {
        invoicePdfPath = await uploadPlatformInvoicePdf(result.request_number, invoiceHtml)
        invoiceGeneratedNow = true
      } catch (error) {
        const message = error instanceof Error ? error.message : "Failed to generate invoice PDF"
        const now = new Date().toISOString()
        await Promise.allSettled([
          admin
            .from("entitlement_purchase_requests")
            .update({
              invoice_document_status: "generation_failed",
              updated_at: now,
            })
            .eq("id", result.purchase_request_id),
          admin
            .from("platform_payment_requests")
            .update({
              invoice_document_status: "generation_failed",
              updated_at: now,
            })
            .eq("id", result.payment_request_id),
        ])

        const snapshot = await getMyLicenseSnapshot(auth.user.id).catch(() => null)
        return NextResponse.json(
          {
            ok: false,
            error: message,
            retryable: true,
            pending_purchase_exists: true,
            request_number: result.request_number,
            invoice_number: result.invoice_number,
            transfer_reference: result.transfer_reference,
            due_date: result.due_date,
            my_license: snapshot,
          },
          { status: 503 }
        )
      }
    }

    const now = new Date().toISOString()
    const [purchaseUpdate, paymentUpdate] = await Promise.all([
      admin
        .from("entitlement_purchase_requests")
        .update({
          status: "invoice_issued",
          issued_at: result.issued_at,
          due_date: result.due_date,
          invoice_pdf_path: invoicePdfPath,
          invoice_document_status: "ready",
          updated_at: now,
        })
        .eq("id", result.purchase_request_id),
      admin
        .from("platform_payment_requests")
        .update({
          invoice_pdf_path: invoicePdfPath,
          invoice_document_status: "ready",
          updated_at: now,
        })
        .eq("id", result.payment_request_id),
    ])

    if (purchaseUpdate.error) {
      throw new Error(`Failed to persist purchase request: ${purchaseUpdate.error.message}`)
    }
    if (paymentUpdate.error) {
      throw new Error(`Failed to persist payment request: ${paymentUpdate.error.message}`)
    }

    if (invoiceGeneratedNow || !result.reused_existing) {
      await Promise.allSettled([
        createPlatformNotification({
          recipientUserId: auth.user.id,
          type: "platform.payment_pending",
          payload: {
            request_number: result.request_number,
            invoice_number: result.invoice_number,
            due_date: result.due_date,
            transfer_reference: result.transfer_reference,
          },
        }),
        writePlatformAudit({
          userId: auth.user.id,
          action: "platform.purchase.request",
          resourceType: "platform_purchase_request",
          resourceId: result.purchase_request_id,
          meta: {
            request_number: result.request_number,
            invoice_number: result.invoice_number,
            reused_existing: result.reused_existing,
            invoice_file_name: buildInvoicePdfFileName({
              invoiceMonth,
              recipientName: companyName || fullName,
              invoiceTitle: "新規組織作成ライセンス購入",
            }),
          },
        }),
      ])
    }

    const snapshot = await getMyLicenseSnapshot(auth.user.id)
    return NextResponse.json({
      ok: true,
      reused_existing: result.reused_existing,
      request_number: result.request_number,
      invoice_number: result.invoice_number,
      transfer_reference: result.transfer_reference,
      due_date: result.due_date,
      my_license: snapshot,
    })
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Failed to purchase license" },
      { status: 500 }
    )
  }
}
