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
  | "invoice.issue"
  | "invoice.bulk_send_prepare"
  | "invoice.pdf_generate"
  | "invoice.pdf_regenerate"
  | "vendor_invoice.create"
  | "vendor_invoice.approve"
  | "vendor_invoice.reject"
  | "vendor_invoice.pdf_generate"
  | "vendor_invoice.pdf_upload"
  | "vendor_invoice.pdf_replace"
  | "payout.generate"
  | "payout.mark_paid"
  | "payout.csv_export"
  | "payout.batch.create"
  | "payout.batch.approve_stage1"
  | "payout.batch.execute_stage2"
  | "close.checks.run"
  | "close.complete"
  | "expense.create"
  | "expense.parse"
  | "expense.link"
  | "expense.receipt_request"
  | "expense.receipt_upload"
  | "freee.connect"
  | "freee.sync"
  | "freee.sync.retry"
  | "project.notify.send"
  | "content.review.round.create"
  | "content.review.comment.create"
  | "content.review.comment.resolve"
  | "vendor_invoice.evidence.upload"
  | "vendor_invoice.evidence.delete"
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
  | "discord.add.created"
  | "discord.info.search"
  | "discord.audit.search"
  | "discord.notify.send"
  | "payment.recorded"
  | "payment.updated"
  | "receipt.created"
  | "receipt.issued"
  | "receipt.downloaded"
  | "receipt.voided"
  | "receipt.pdf_generate"

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
