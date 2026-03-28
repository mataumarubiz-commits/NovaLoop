"use client"

import Link from "next/link"
import { useEffect, useState, useCallback, type CSSProperties } from "react"
import { supabase } from "@/lib/supabase"
import { useAuthOrg } from "@/hooks/useAuthOrg"

type SubmissionRow = {
  id: string
  vendor_id: string
  vendor_name: string
  billing_month: string
  status: string
  total: number
  submitted_at: string | null
  submitter_name: string | null
  submitter_email: string | null
  submission_count: number
  submitter_bank_json: Record<string, string> | null
  submitter_notes: string | null
  payout_status: string | null
}


type StatusFilter = "all" | "submitted" | "approved" | "rejected" | "paid"

const STATUS_META: Record<string, { label: string; bg: string; text: string }> = {
  draft: { label: "下書き", bg: "#f8fafc", text: "#475569" },
  submitted: { label: "提出済み", bg: "#eff6ff", text: "#1d4ed8" },
  approved: { label: "承認済み", bg: "var(--success-bg)", text: "var(--success-text)" },
  rejected: { label: "差し戻し", bg: "var(--warning-bg)", text: "var(--warning-text)" },
  paid: { label: "支払済み", bg: "#f3e8ff", text: "#7e22ce" },
}

const cardStyle: CSSProperties = {
  border: "1px solid var(--border)",
  borderRadius: 16,
  padding: 18,
  background: "var(--surface)",
  boxShadow: "var(--shadow-md)",
}

function currentMonth() {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`
}

function formatMonth(m: string) {
  const [y, mo] = m.split("-")
  return `${y}年${parseInt(mo, 10)}月`
}

function formatCurrency(v: number) {
  return new Intl.NumberFormat("ja-JP", {
    style: "currency",
    currency: "JPY",
    maximumFractionDigits: 0,
  }).format(v)
}

function formatDate(iso: string | null) {
  if (!iso) return "—"
  const d = new Date(iso)
  return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`
}

async function getAccessToken() {
  const { data } = await supabase.auth.getSession()
  return data.session?.access_token ?? null
}

export default function VendorSubmissionsPage() {
  const { activeOrgId, role, loading: authLoading } = useAuthOrg({ redirectToOnboarding: true })
  const canUse = role === "owner" || role === "executive_assistant"

  const [submissions, setSubmissions] = useState<SubmissionRow[]>([])
  const [loading, setLoading] = useState(true)
  const [month, setMonth] = useState(currentMonth())
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all")
  const [reviewingId, setReviewingId] = useState<string | null>(null)
  const [rejectReason, setRejectReason] = useState("")
  const [showRejectDialog, setShowRejectDialog] = useState<string | null>(null)
  const [expandedId, setExpandedId] = useState<string | null>(null)

  const loadData = useCallback(async () => {
    if (!activeOrgId) return
    setLoading(true)
    try {
      const token = await getAccessToken()
      if (!token) return
      const params = new URLSearchParams({ orgId: activeOrgId })
      if (month) params.set("month", month)
      if (statusFilter !== "all") params.set("status", statusFilter)
      const res = await fetch(`/api/vendor-submissions?${params}`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      const data = await res.json()
      if (data.ok) {
        setSubmissions(data.submissions ?? [])
      }
    } catch {
      // silent
    } finally {
      setLoading(false)
    }
  }, [activeOrgId, month, statusFilter])

  useEffect(() => {
    if (activeOrgId && canUse) loadData()
  }, [activeOrgId, canUse, loadData])

  const handleReview = useCallback(
    async (invoiceId: string, action: "approve" | "reject", reason?: string) => {
      setReviewingId(invoiceId)
      try {
        const token = await getAccessToken()
        if (!token) return
        const res = await fetch("/api/vendor-submissions/review", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            orgId: activeOrgId,
            invoiceId,
            action,
            reason: reason || undefined,
          }),
        })
        const data = await res.json()
        if (data.ok) {
          loadData()
          setShowRejectDialog(null)
          setRejectReason("")
        } else {
          alert(data.error || "操作に失敗しました")
        }
      } catch {
        alert("通信エラーが発生しました")
      } finally {
        setReviewingId(null)
      }
    },
    [activeOrgId, loadData]
  )

  if (authLoading) {
    return (
      <div style={{ padding: 32, color: "var(--muted)" }}>読み込み中…</div>
    )
  }

  if (!canUse) {
    return (
      <div style={{ padding: 32, color: "var(--muted)" }}>
        この機能を利用する権限がありません。
      </div>
    )
  }

  const submittedCount = submissions.filter((s) => s.status === "submitted").length

  return (
    <div style={{ maxWidth: 1100, margin: "0 auto", padding: "24px 16px" }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 800, margin: 0, color: "var(--text)" }}>
            外注請求提出一覧
          </h1>
          <p style={{ fontSize: 13, color: "var(--muted)", margin: "4px 0 0" }}>
            URL経由で外注から提出された請求の管理
          </p>
        </div>
        <Link
          href="/vendors"
          style={{
            fontSize: 13,
            color: "var(--primary)",
            textDecoration: "none",
          }}
        >
          ← 外注一覧に戻る
        </Link>
      </div>

      {/* Filters */}
      <div
        style={{
          display: "flex",
          gap: 12,
          marginBottom: 16,
          flexWrap: "wrap",
          alignItems: "center",
        }}
      >
        <input
          type="month"
          value={month}
          onChange={(e) => setMonth(e.target.value)}
          style={{
            padding: "6px 10px",
            borderRadius: 8,
            border: "1px solid var(--border)",
            background: "var(--input-bg)",
            color: "var(--text)",
            fontSize: 13,
          }}
        />
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
          style={{
            padding: "6px 10px",
            borderRadius: 8,
            border: "1px solid var(--border)",
            background: "var(--input-bg)",
            color: "var(--text)",
            fontSize: 13,
          }}
        >
          <option value="all">全ステータス</option>
          <option value="submitted">提出済み</option>
          <option value="approved">承認済み</option>
          <option value="rejected">差し戻し</option>
          <option value="paid">支払済み</option>
        </select>
        {submittedCount > 0 && (
          <span
            style={{
              fontSize: 12,
              fontWeight: 600,
              background: "#eff6ff",
              color: "#1d4ed8",
              padding: "4px 10px",
              borderRadius: 20,
            }}
          >
            未確認 {submittedCount}件
          </span>
        )}
      </div>

      {/* Submissions list */}
      {loading ? (
        <div style={{ ...cardStyle, padding: 32, textAlign: "center", color: "var(--muted)" }}>
          読み込み中…
        </div>
      ) : submissions.length === 0 ? (
        <div style={{ ...cardStyle, padding: 32, textAlign: "center", color: "var(--muted)" }}>
          該当する提出データはありません
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {submissions.map((sub) => {
            const meta = STATUS_META[sub.status] || STATUS_META.draft
            const isExpanded = expandedId === sub.id
            return (
              <div key={sub.id} style={cardStyle}>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 12,
                    flexWrap: "wrap",
                    cursor: "pointer",
                  }}
                  onClick={() => setExpandedId(isExpanded ? null : sub.id)}
                >
                  {/* Status badge */}
                  <span
                    style={{
                      fontSize: 12,
                      fontWeight: 600,
                      padding: "3px 10px",
                      borderRadius: 20,
                      background: meta.bg,
                      color: meta.text,
                      whiteSpace: "nowrap",
                    }}
                  >
                    {meta.label}
                  </span>

                  {/* Vendor name */}
                  <span style={{ fontWeight: 700, fontSize: 14, color: "var(--text)" }}>
                    {sub.vendor_name}
                  </span>

                  {/* Month */}
                  <span style={{ fontSize: 13, color: "var(--muted)" }}>
                    {formatMonth(sub.billing_month)}
                  </span>

                  {/* Amount */}
                  <span style={{ fontWeight: 700, fontSize: 14, color: "var(--text)", marginLeft: "auto" }}>
                    {formatCurrency(sub.total)}
                  </span>

                  {/* Submitted at */}
                  <span style={{ fontSize: 12, color: "var(--muted)", whiteSpace: "nowrap" }}>
                    {formatDate(sub.submitted_at)}
                  </span>

                  {/* Submission count */}
                  {sub.submission_count > 1 && (
                    <span
                      style={{
                        fontSize: 11,
                        padding: "2px 6px",
                        borderRadius: 8,
                        background: "var(--warning-bg)",
                        color: "var(--warning-text)",
                      }}
                    >
                      再提出{sub.submission_count - 1}回
                    </span>
                  )}

                  {/* Payout status */}
                  {sub.payout_status && (
                    <span
                      style={{
                        fontSize: 11,
                        padding: "2px 6px",
                        borderRadius: 8,
                        background: sub.payout_status === "paid" ? "#f3e8ff" : "var(--success-bg)",
                        color: sub.payout_status === "paid" ? "#7e22ce" : "var(--success-text)",
                      }}
                    >
                      {sub.payout_status === "paid" ? "支払済" : "支払予定"}
                    </span>
                  )}

                  {/* Expand icon */}
                  <span style={{ fontSize: 12, color: "var(--muted)" }}>
                    {isExpanded ? "▲" : "▼"}
                  </span>
                </div>

                {/* Expanded detail */}
                {isExpanded && (
                  <div style={{ marginTop: 14, paddingTop: 14, borderTop: "1px solid var(--border)" }}>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px 24px", fontSize: 13 }}>
                      <DetailItem label="請求名義" value={sub.submitter_name} />
                      <DetailItem label="メール" value={sub.submitter_email} />
                      {sub.submitter_bank_json && (
                        <>
                          <DetailItem
                            label="銀行"
                            value={`${sub.submitter_bank_json.bank_name} ${sub.submitter_bank_json.branch_name}`}
                          />
                          <DetailItem
                            label="口座"
                            value={`${sub.submitter_bank_json.account_type === "ordinary" ? "普通" : sub.submitter_bank_json.account_type === "checking" ? "当座" : "貯蓄"} ${sub.submitter_bank_json.account_number}`}
                          />
                          <DetailItem label="口座名義" value={sub.submitter_bank_json.account_holder} />
                        </>
                      )}
                      {sub.submitter_notes && (
                        <DetailItem label="備考" value={sub.submitter_notes} />
                      )}
                    </div>

                    {/* Action buttons */}
                    {sub.status === "submitted" && (
                      <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            handleReview(sub.id, "approve")
                          }}
                          disabled={reviewingId === sub.id}
                          style={{
                            padding: "8px 20px",
                            fontSize: 13,
                            fontWeight: 600,
                            border: "none",
                            borderRadius: 8,
                            background: "#16a34a",
                            color: "#fff",
                            cursor: reviewingId === sub.id ? "not-allowed" : "pointer",
                            opacity: reviewingId === sub.id ? 0.6 : 1,
                          }}
                        >
                          承認する
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            setShowRejectDialog(sub.id)
                          }}
                          disabled={reviewingId === sub.id}
                          style={{
                            padding: "8px 20px",
                            fontSize: 13,
                            fontWeight: 600,
                            border: "1px solid var(--error-border)",
                            borderRadius: 8,
                            background: "var(--error-bg)",
                            color: "#dc2626",
                            cursor: reviewingId === sub.id ? "not-allowed" : "pointer",
                            opacity: reviewingId === sub.id ? 0.6 : 1,
                          }}
                        >
                          差し戻す
                        </button>
                      </div>
                    )}

                    {/* Reject dialog */}
                    {showRejectDialog === sub.id && (
                      <div
                        style={{
                          marginTop: 12,
                          padding: 14,
                          background: "var(--error-bg)",
                          borderRadius: 10,
                          border: "1px solid var(--error-border)",
                        }}
                      >
                        <div style={{ fontSize: 13, fontWeight: 600, color: "#dc2626", marginBottom: 8 }}>
                          差し戻し理由（任意）
                        </div>
                        <textarea
                          value={rejectReason}
                          onChange={(e) => setRejectReason(e.target.value)}
                          placeholder="修正が必要な箇所をご記入ください"
                          style={{
                            width: "100%",
                            padding: "8px 10px",
                            border: "1px solid var(--error-border)",
                            borderRadius: 8,
                            fontSize: 13,
                            minHeight: 60,
                            resize: "vertical",
                            boxSizing: "border-box",
                          }}
                        />
                        <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                          <button
                            onClick={() => handleReview(sub.id, "reject", rejectReason)}
                            disabled={reviewingId === sub.id}
                            style={{
                              padding: "6px 16px",
                              fontSize: 13,
                              fontWeight: 600,
                              border: "none",
                              borderRadius: 8,
                              background: "#dc2626",
                              color: "#fff",
                              cursor: "pointer",
                            }}
                          >
                            差し戻す
                          </button>
                          <button
                            onClick={() => {
                              setShowRejectDialog(null)
                              setRejectReason("")
                            }}
                            style={{
                              padding: "6px 16px",
                              fontSize: 13,
                              border: "1px solid var(--border)",
                              borderRadius: 8,
                              background: "var(--surface)",
                              color: "var(--text)",
                              cursor: "pointer",
                            }}
                          >
                            キャンセル
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

function DetailItem({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div>
      <span style={{ color: "var(--muted)", fontSize: 12 }}>{label}</span>
      <div style={{ fontWeight: 500, color: "var(--text)" }}>{value || "—"}</div>
    </div>
  )
}
