export type ExternalChannelType = "discord" | "line" | "internal"

export type ExternalActorRole = "owner" | "executive_assistant" | "member" | "vendor"

export type ExternalActorContext = {
  channelType: ExternalChannelType
  externalUserId: string | null
  linkedUserId: string
  orgId: string
  role: ExternalActorRole
  vendorId: string | null
  activeOrgName: string | null
  linkedDisplayName: string | null
}

export type InternalToolName =
  | "get_org_context"
  | "get_user_role_context"
  | "get_notifications_summary"
  | "search_pages_manuals"
  | "get_help_answer_candidates"
  | "get_org_dashboard_summary"
  | "get_overdue_items"
  | "get_recent_activity_summary"
  | "get_contents_summary"
  | "get_contents_by_client"
  | "get_delayed_contents"
  | "get_content_detail"
  | "get_billing_summary"
  | "get_invoices_summary"
  | "get_invoice_detail"
  | "get_unpaid_invoices"
  | "get_pending_invoice_requests"
  | "get_vendor_summary"
  | "get_vendor_invoice_summary"
  | "get_vendor_invoice_detail"
  | "get_unsubmitted_vendor_invoices"
  | "get_returned_vendor_invoices"
  | "get_payout_summary"
  | "get_upcoming_payouts"
  | "search_pages"
  | "get_page_summary"
  | "get_manual_steps_for_topic"

export type ToolExecutionResult = {
  tool: InternalToolName
  summary: string
  references: string[]
  data: Record<string, unknown>
}
