export const NOTIFICATION_TYPES = [
  "membership.requested",
  "membership.approved",
  "membership.rejected",
  "platform.payment_pending",
  "platform.license_activated",
  "platform.transfer_completed",
  "contents.client_due_overdue",
  "contents.editor_due_overdue",
  "billing.month_close_ready",
  "billing.request_sent",
  "billing.request_due_soon",
  "billing.request_overdue",
  "payouts.pending_action",
  "vendor_invoice.submitted",
  "vendor_invoice.requested",
  "vendor_invoice.request_due_soon",
  "vendor_invoice.request_overdue",
  "vendor_invoice.approved",
  "vendor_invoice.rejected",
  "vendor_portal.invited",
] as const

export type NotificationType = (typeof NOTIFICATION_TYPES)[number]

const LEGACY_TYPE_MAP: Record<string, NotificationType> = {
  join_request: "membership.requested",
  join_approved: "membership.approved",
  join_rejected: "membership.rejected",
  deadline_alert: "contents.client_due_overdue",
  vendor_delay: "contents.editor_due_overdue",
  payout_due: "payouts.pending_action",
}

type NotificationLike = {
  type: string
  payload?: Record<string, unknown> | null
}

export function normalizeNotificationType(type: string): NotificationType | "unknown" {
  if ((NOTIFICATION_TYPES as readonly string[]).includes(type)) return type as NotificationType
  return LEGACY_TYPE_MAP[type] ?? "unknown"
}

export function notificationPriority(n: NotificationLike): number {
  switch (normalizeNotificationType(n.type)) {
    case "contents.client_due_overdue":
      return 100
    case "contents.editor_due_overdue":
      return 90
    case "membership.requested":
      return 85
    case "platform.payment_pending":
      return 82
    case "platform.license_activated":
      return 81
    case "billing.month_close_ready":
      return 80
    case "platform.transfer_completed":
      return 79
    case "billing.request_overdue":
      return 78
    case "billing.request_due_soon":
      return 76
    case "vendor_invoice.submitted":
      return 74
    case "vendor_invoice.requested":
      return 73
    case "vendor_invoice.request_overdue":
      return 72
    case "vendor_invoice.request_due_soon":
      return 71
    case "billing.request_sent":
      return 70
    case "payouts.pending_action":
      return 68
    case "vendor_invoice.rejected":
      return 66
    case "vendor_portal.invited":
      return 64
    case "vendor_invoice.approved":
      return 62
    case "membership.rejected":
      return 60
    case "membership.approved":
      return 50
    default:
      return 10
  }
}

export function notificationSeverity(n: NotificationLike): { label: string; bg: string; text: string } {
  switch (normalizeNotificationType(n.type)) {
    case "contents.client_due_overdue":
      return { label: "納期注意", bg: "#fff1f2", text: "#9f1239" }
    case "contents.editor_due_overdue":
      return { label: "外注遅延", bg: "#fff7ed", text: "#9a3412" }
    case "membership.requested":
      return { label: "承認待ち", bg: "#eef2ff", text: "#3730a3" }
    case "platform.payment_pending":
      return { label: "支払確認", bg: "#eff6ff", text: "#1d4ed8" }
    case "platform.license_activated":
      return { label: "ライセンス有効", bg: "#f0fdf4", text: "#166534" }
    case "platform.transfer_completed":
      return { label: "移行完了", bg: "#ecfeff", text: "#155e75" }
    case "billing.month_close_ready":
      return { label: "月次請求", bg: "#fffbeb", text: "#92400e" }
    case "billing.request_sent":
      return { label: "請求送信済み", bg: "#eff6ff", text: "#1d4ed8" }
    case "billing.request_due_soon":
      return { label: "期限接近", bg: "#fff7ed", text: "#9a3412" }
    case "billing.request_overdue":
      return { label: "期限超過", bg: "#fff1f2", text: "#9f1239" }
    case "payouts.pending_action":
      return { label: "支払い待ち", bg: "#ecfeff", text: "#155e75" }
    case "vendor_invoice.submitted":
      return { label: "外注提出", bg: "#eff6ff", text: "#1d4ed8" }
    case "vendor_invoice.requested":
      return { label: "請求依頼", bg: "#eef2ff", text: "#4338ca" }
    case "vendor_invoice.request_due_soon":
      return { label: "期限接近", bg: "#fff7ed", text: "#9a3412" }
    case "vendor_invoice.request_overdue":
      return { label: "期限超過", bg: "#fff1f2", text: "#9f1239" }
    case "vendor_invoice.approved":
      return { label: "承認済み", bg: "#f0fdf4", text: "#166534" }
    case "vendor_invoice.rejected":
      return { label: "差し戻し", bg: "#fff7ed", text: "#9a3412" }
    case "vendor_portal.invited":
      return { label: "招待", bg: "#f5f3ff", text: "#6d28d9" }
    case "membership.approved":
      return { label: "承認済み", bg: "#f0fdf4", text: "#166534" }
    case "membership.rejected":
      return { label: "却下", bg: "#f5f3ff", text: "#5b21b6" }
    default:
      return { label: "通知", bg: "var(--surface-2)", text: "var(--muted)" }
  }
}

export function notificationTitle(n: NotificationLike): string {
  const payload = n.payload ?? {}
  switch (normalizeNotificationType(n.type)) {
    case "membership.requested": {
      const orgName = String(payload.org_name ?? "")
      return orgName ? `参加申請: ${orgName}` : "参加申請が届いています"
    }
    case "membership.approved": {
      const orgName = String(payload.org_name ?? "")
      return orgName ? `参加が承認されました: ${orgName}` : "参加が承認されました"
    }
    case "membership.rejected": {
      const orgName = String(payload.org_name ?? "")
      return orgName ? `参加申請が却下されました: ${orgName}` : "参加申請が却下されました"
    }
    case "platform.payment_pending":
      return "支払確認が必要です"
    case "platform.license_activated":
      return "ライセンスが有効になりました"
    case "platform.transfer_completed":
      return "ライセンス移行が完了しました"
    case "contents.client_due_overdue":
      return `先方提出日を過ぎた案件: ${Number(payload.client_overdue_count ?? payload.count ?? 0)}件`
    case "contents.editor_due_overdue":
      return `編集提出が遅れている案件: ${Number(payload.editor_overdue_count ?? payload.delayed_count ?? payload.count ?? 0)}件`
    case "billing.month_close_ready": {
      const month = String(payload.target_month ?? payload.month ?? "")
      return `${month || "対象月"} の月次請求準備: ${Number(payload.pending_invoice_count ?? payload.count ?? 0)}件`
    }
    case "billing.request_sent": {
      const email = String(payload.recipient_email ?? "")
      const guestName = String(payload.guest_name ?? "")
      return email ? `請求依頼を送信しました: ${email}` : guestName ? `請求依頼を送信しました: ${guestName}` : "請求依頼を送信しました"
    }
    case "billing.request_due_soon": {
      const deadline = String(payload.request_deadline ?? "")
      return deadline ? `請求依頼の期限が近づいています: ${deadline}` : "請求依頼の期限が近づいています"
    }
    case "billing.request_overdue": {
      const deadline = String(payload.request_deadline ?? "")
      return deadline ? `請求依頼の期限を過ぎています: ${deadline}` : "請求依頼の期限を過ぎています"
    }
    case "payouts.pending_action": {
      const month = String(payload.target_month ?? payload.month ?? "")
      return `${month || "対象月"} の支払い待ち: ${Number(payload.pending_payout_count ?? payload.count ?? 0)}件`
    }
    case "vendor_invoice.submitted": {
      const vendorName = String(payload.vendor_name ?? "")
      const month = String(payload.billing_month ?? "")
      if (payload.resubmitted === true) {
        return vendorName ? `${vendorName} の ${month} 外注請求が再提出されました` : "外注請求が再提出されました"
      }
      return vendorName ? `${vendorName} の ${month} 外注請求が提出されました` : "外注請求が提出されました"
    }
    case "vendor_invoice.requested": {
      const month = String(payload.billing_month ?? "")
      return month ? `${month} の外注請求依頼を送信しました` : "外注請求依頼を送信しました"
    }
    case "vendor_invoice.request_due_soon": {
      const deadline = String(payload.submit_deadline ?? "")
      return deadline ? `外注請求の提出期限が近づいています: ${deadline}` : "外注請求の提出期限が近づいています"
    }
    case "vendor_invoice.request_overdue": {
      const deadline = String(payload.submit_deadline ?? "")
      return deadline ? `外注請求の提出期限を過ぎています: ${deadline}` : "外注請求の提出期限を過ぎています"
    }
    case "vendor_invoice.approved": {
      const vendorName = String(payload.vendor_name ?? "")
      return vendorName ? `${vendorName} の外注請求を承認しました` : "外注請求を承認しました"
    }
    case "vendor_invoice.rejected": {
      const vendorName = String(payload.vendor_name ?? "")
      const category = String(payload.return_category ?? "")
      return vendorName
        ? `${vendorName} の外注請求を差し戻しました${category ? ` (${category})` : ""}`
        : `外注請求を差し戻しました${category ? ` (${category})` : ""}`
    }
    case "vendor_portal.invited":
      return "NovaLoop に招待されました。ログインしてプロフィールと口座情報を登録してください"
    default:
      return n.type
  }
}

export function notificationActionHref(n: NotificationLike): string {
  const payload = n.payload ?? {}
  const month = String(payload.target_month ?? payload.month ?? "")
  const monthQuery = month ? `?month=${encodeURIComponent(month)}` : ""

  switch (normalizeNotificationType(n.type)) {
    case "membership.requested":
    case "membership.approved":
    case "membership.rejected":
      return "/settings/members"
    case "platform.payment_pending":
      return "/pending-payment"
    case "platform.license_activated":
    case "platform.transfer_completed":
      return "/settings/license"
    case "contents.client_due_overdue":
      return "/contents?filter=client_overdue"
    case "contents.editor_due_overdue":
      return "/contents?filter=editor_overdue"
    case "billing.month_close_ready":
    case "billing.request_sent":
    case "billing.request_due_soon":
    case "billing.request_overdue":
      return `/billing${monthQuery}`
    case "payouts.pending_action":
      return `/payouts${monthQuery}`
    case "vendor_invoice.requested":
    case "vendor_invoice.request_due_soon":
    case "vendor_invoice.request_overdue":
      return month ? `/vendor/invoices/current?month=${encodeURIComponent(month)}` : "/vendor/invoices/current"
    case "vendor_portal.invited":
      return "/vendor"
    case "vendor_invoice.submitted":
    case "vendor_invoice.approved":
    case "vendor_invoice.rejected": {
      const vendorId = String(payload.vendor_id ?? "")
      const invoiceId = String(payload.vendor_invoice_id ?? "")
      return vendorId && invoiceId ? `/vendors/${vendorId}/invoices/${invoiceId}` : "/vendors"
    }
    default:
      return "/notifications"
  }
}

export function notificationResolved(n: NotificationLike): boolean {
  if (n.payload?.resolved === true) return true
  const normalized = normalizeNotificationType(n.type)
  return (
    normalized === "membership.approved" ||
    normalized === "membership.rejected" ||
    normalized === "vendor_invoice.approved" ||
    normalized === "platform.license_activated" ||
    normalized === "platform.transfer_completed"
  )
}
