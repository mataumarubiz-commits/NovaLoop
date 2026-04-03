import { createSupabaseAdmin } from "@/lib/supabaseAdmin"
import { writeAuditLog } from "@/lib/auditLog"

const BUCKET = "invoices"
const SIGNED_URL_EXPIRES = 60 * 10

type SaveVendorInvoicePdfParams = {
  orgId: string
  invoiceId: string
  actorUserId: string
  fileName: string
  fileBytes: Buffer
  contentType?: string | null
  mode: "upload" | "replace"
}

function safeBaseName(value: string) {
  return value
    .replace(/[/\\:*?"<>|\s]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 120)
}

export async function saveVendorInvoicePdf(params: SaveVendorInvoicePdfParams) {
  const admin = createSupabaseAdmin()
  const { data: invoice, error: invoiceError } = await admin
    .from("vendor_invoices")
    .select("id, org_id, vendor_id, billing_month, invoice_number, pdf_path")
    .eq("id", params.invoiceId)
    .eq("org_id", params.orgId)
    .maybeSingle()

  if (invoiceError || !invoice) throw new Error("外注請求書が見つかりません。")

  const { data: vendor } = await admin
    .from("vendors")
    .select("name")
    .eq("id", (invoice as { vendor_id?: string | null }).vendor_id ?? "")
    .maybeSingle()

  const record = invoice as {
    id: string
    billing_month: string
    invoice_number?: string | null
    pdf_path?: string | null
  }

  const alreadyHasPdf = Boolean(record.pdf_path)
  if (params.mode === "upload" && alreadyHasPdf) {
    throw new Error("すでに PDF が登録されています。差し替えを使ってください。")
  }

  const vendorName = (vendor as { name?: string | null } | null)?.name?.trim() || "vendor"
  const baseName = safeBaseName(
    `${record.invoice_number?.trim() || "vendor-invoice"}_${record.billing_month}_${vendorName}_${record.id.slice(0, 8)}`
  )
  const storagePath = `${params.orgId}/vendor-invoices/${record.billing_month}/${baseName}.pdf`

  const { error: uploadError } = await admin.storage.from(BUCKET).upload(storagePath, params.fileBytes, {
    upsert: true,
    contentType: params.contentType || "application/pdf",
  })
  if (uploadError) throw new Error(`PDF の保存に失敗しました: ${uploadError.message}`)

  if (record.pdf_path && record.pdf_path !== storagePath) {
    await admin.storage.from(BUCKET).remove([record.pdf_path]).catch(() => undefined)
  }

  const { error: updateError } = await admin
    .from("vendor_invoices")
    .update({
      pdf_path: storagePath,
      updated_at: new Date().toISOString(),
    })
    .eq("id", params.invoiceId)
    .eq("org_id", params.orgId)
  if (updateError) throw new Error(`PDF パスの更新に失敗しました: ${updateError.message}`)

  const { data: signed } = await admin.storage.from(BUCKET).createSignedUrl(storagePath, SIGNED_URL_EXPIRES)

  await writeAuditLog(admin, {
    org_id: params.orgId,
    user_id: params.actorUserId,
    action: params.mode === "replace" ? "vendor_invoice.pdf_replace" : "vendor_invoice.pdf_upload",
    resource_type: "vendor_invoice",
    resource_id: params.invoiceId,
    meta: {
      pdf_path: storagePath,
      previous_pdf_path: record.pdf_path ?? null,
      original_file_name: params.fileName,
    },
  })

  return {
    pdfPath: storagePath,
    signedUrl: signed?.signedUrl ?? null,
  }
}
