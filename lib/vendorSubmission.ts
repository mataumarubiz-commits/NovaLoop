/**
 * Vendor Submission Link types and utilities
 * 外注向け請求提出URLフロー
 */
import crypto from "crypto"

// ── Types ──────────────────────────────────────────────

export type VendorSubmissionLink = {
  id: string
  org_id: string
  vendor_id: string
  token: string
  target_month: string // YYYY-MM
  expires_at: string | null
  is_active: boolean
  allow_resubmission: boolean
  custom_message: string | null
  created_by: string | null
  created_at: string
  updated_at: string
}

export type SubmissionLinkPublicInfo = {
  token: string
  org_name: string
  vendor_name: string
  target_month: string
  custom_message: string | null
  expires_at: string | null
  allow_resubmission: boolean
  already_submitted: boolean
  existing_submission: ExistingSubmissionSummary | null
  content_candidates: ContentCandidate[]
}

export type ExistingSubmissionSummary = {
  id: string
  status: string
  total: number
  submitted_at: string | null
  submitter_name: string | null
}

export type ContentCandidate = {
  id: string
  project_name: string | null
  title: string | null
  unit_price: number | null
  quantity: number | null
  amount: number | null
  delivery_month: string | null
}

export type VendorSubmissionPayload = {
  submitter_name: string
  submitter_email: string
  amount: number
  bank_name: string
  branch_name: string
  account_type: "ordinary" | "checking" | "savings"
  account_number: string
  account_holder: string
  notes?: string
  line_items?: SubmissionLineItem[]
}

export type SubmissionLineItem = {
  content_id?: string
  description: string
  qty: number
  unit_price: number
  amount: number
}

export type VendorSubmissionRow = {
  id: string
  org_id: string
  vendor_id: string
  billing_month: string
  status: string
  total: number
  submitted_at: string | null
  submitter_name: string | null
  submitter_email: string | null
  submission_count: number
  submission_link_id: string | null
  vendor_bank_snapshot: Record<string, unknown>
  submitter_bank_json: Record<string, unknown> | null
  submitter_notes: string | null
  created_at: string
  updated_at: string
  // joined
  vendor_name?: string
}

export type SubmissionStatus =
  | "draft"
  | "submitted"
  | "approved"
  | "rejected"
  | "paid"

// ── Utilities ──────────────────────────────────────────

/** Generate a cryptographically secure token (64 hex chars = 256 bits) */
export function generateSubmissionToken(): string {
  return crypto.randomBytes(32).toString("hex")
}

/** Check if a submission link is still valid */
export function isLinkValid(link: {
  is_active: boolean
  expires_at: string | null
}): boolean {
  if (!link.is_active) return false
  if (link.expires_at && new Date(link.expires_at) < new Date()) return false
  return true
}

/** Format target_month for display: "2026-03" → "2026年3月" */
export function formatTargetMonth(month: string): string {
  const [y, m] = month.split("-")
  return `${y}年${parseInt(m, 10)}月`
}

/** Validate YYYY-MM format */
export function isValidMonth(month: string): boolean {
  return /^\d{4}-\d{2}$/.test(month)
}

/** Validate submission payload */
export function validateSubmissionPayload(
  payload: Partial<VendorSubmissionPayload>
): string | null {
  if (!payload.submitter_name?.trim()) return "請求名義を入力してください"
  if (!payload.submitter_email?.trim()) return "メールアドレスを入力してください"
  if (
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(payload.submitter_email?.trim() ?? "")
  )
    return "メールアドレスの形式が正しくありません"
  if (typeof payload.amount !== "number" || payload.amount <= 0)
    return "請求金額を正しく入力してください"
  if (!payload.bank_name?.trim()) return "銀行名を入力してください"
  if (!payload.branch_name?.trim()) return "支店名を入力してください"
  if (!payload.account_number?.trim()) return "口座番号を入力してください"
  if (!/^\d{4,8}$/.test(payload.account_number?.trim() ?? ""))
    return "口座番号は4〜8桁の数字で入力してください"
  if (!payload.account_holder?.trim()) return "口座名義を入力してください"
  if (
    !payload.account_type ||
    !["ordinary", "checking", "savings"].includes(payload.account_type)
  )
    return "口座種別を選択してください"
  return null
}

/** Generate copy-paste message template */
export function generateShareMessage(
  url: string,
  vendorName: string,
  targetMonth: string
): string {
  const monthLabel = formatTargetMonth(targetMonth)
  return `${vendorName}様\n\n${monthLabel}分のご請求はこちらからお願いいたします。\n5分ほどで完了します。\n\n${url}\n\nご不明点がございましたらお気軽にご連絡ください。`
}
