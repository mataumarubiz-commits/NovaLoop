/**
 * Shared audit log writer.
 * Uses the existing audit_logs schema:
 * org_id, user_id, action, resource_type, resource_id, meta, created_at
 */

export type AuditAction =
  | "page.create"
  | "page.update"
  | "page.duplicate"
  | "page.archive"
  | "page.restore"
  | "page.template.install"
  | "page.comment.create"
  | "page.comment.delete"
  | "page.revision.restore"
  | "invoice.create"
  | "invoice.bulk_generate"
  | "invoice.bulk_status"
  | "invoice.bulk_send_prepare"
  | "invoice.pdf_generate"
  | "vendor_invoice.create"
  | "vendor_invoice.approve"
  | "vendor_invoice.reject"
  | "payout.generate"
  | "payout.mark_paid"
  | "payout.csv_export"
  | "export.run"
  | "import.run"
  | "asset.copy"
  | "asset.verify"
  | "membership.approve"
  | "membership.reject"
  | "role.update"
  | "platform.purchase.request"
  | "platform.payment.mark_paid"
  | "platform.transfer.approve"
  | "platform.entitlement.grant"
  | "platform.entitlement.revoke"
  | "org.create"

type AuditParams = {
  org_id: string | null
  user_id: string
  action: AuditAction
  resource_type?: string
  resource_id?: string | null
  meta?: Record<string, unknown>
}

export async function writeAuditLog(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: any,
  params: AuditParams
): Promise<void> {
  try {
    await admin.from("audit_logs").insert({
      org_id: params.org_id,
      user_id: params.user_id,
      action: params.action,
      resource_type: params.resource_type ?? "system",
      resource_id: params.resource_id ?? null,
      meta: params.meta ?? {},
    })
  } catch (error) {
    console.error("[auditLog]", params.action, error)
  }
}
