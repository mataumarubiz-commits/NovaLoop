"use client"

import { useEffect, useState, useCallback, type CSSProperties } from "react"
import { useParams } from "next/navigation"
import type {
  SubmissionLinkPublicInfo,
  ContentCandidate,
} from "@/lib/vendorSubmission"

// ── Styles ──────────────────────────────────────────────

const PAGE_BG = "var(--bg)"
const CARD_BG = "var(--surface)"
const PRIMARY = "var(--primary)"
const PRIMARY_HOVER = "var(--primary)"
const TEXT = "var(--text)"
const MUTED = "var(--muted)"
const BORDER = "var(--border)"
const ERROR_BG = "var(--error-bg)"
const ERROR_TEXT = "var(--error-text)"
const SUCCESS_BG = "var(--success-bg)"
const SUCCESS_TEXT = "var(--success-text)"
const WARNING_BG = "var(--warning-bg)"
const WARNING_TEXT = "var(--warning-text)"

const pageStyle: CSSProperties = {
  minHeight: "100vh",
  background: PAGE_BG,
  padding: "24px 16px 64px",
  fontFamily: "system-ui, -apple-system, sans-serif",
  color: TEXT,
}

const containerStyle: CSSProperties = {
  maxWidth: 560,
  margin: "0 auto",
}

const cardStyle: CSSProperties = {
  background: CARD_BG,
  borderRadius: 16,
  border: `1px solid ${BORDER}`,
  padding: "28px 24px",
  boxShadow: "var(--shadow-md)",
  marginBottom: 16,
}

const labelStyle: CSSProperties = {
  display: "block",
  fontSize: 13,
  fontWeight: 600,
  color: TEXT,
  marginBottom: 6,
}

const inputStyle: CSSProperties = {
  width: "100%",
  padding: "10px 12px",
  fontSize: 15,
  border: `1px solid ${BORDER}`,
  borderRadius: 10,
  outline: "none",
  background: "var(--input-bg)",
  color: TEXT,
  boxSizing: "border-box",
  transition: "border-color 0.15s",
}

const selectStyle: CSSProperties = {
  ...inputStyle,
  appearance: "none" as const,
  backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='8' viewBox='0 0 12 8'%3E%3Cpath d='M1 1l5 5 5-5' stroke='%2394a3b8' stroke-width='2' fill='none'/%3E%3C/svg%3E")`,
  backgroundRepeat: "no-repeat",
  backgroundPosition: "right 12px center",
  paddingRight: 36,
}

const btnPrimaryStyle: CSSProperties = {
  width: "100%",
  padding: "14px 24px",
  fontSize: 16,
  fontWeight: 700,
  color: "var(--primary-contrast)",
  background: PRIMARY,
  border: "none",
  borderRadius: 12,
  cursor: "pointer",
  transition: "background 0.15s",
}

const fieldGap: CSSProperties = { marginBottom: 16 }

// ── Steps indicator ──────────────────────────────────────

type Step = 1 | 2 | 3
const STEPS = [
  { num: 1, label: "確認" },
  { num: 2, label: "入力" },
  { num: 3, label: "完了" },
] as const

function StepIndicator({ current }: { current: Step }) {
  return (
    <div style={{ display: "flex", justifyContent: "center", gap: 0, marginBottom: 28 }}>
      {STEPS.map((s, i) => {
        const isActive = s.num === current
        const isDone = s.num < current
        return (
          <div key={s.num} style={{ display: "flex", alignItems: "center" }}>
            <div style={{ textAlign: "center" }}>
              <div
                style={{
                  width: 32,
                  height: 32,
                  borderRadius: "50%",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 14,
                  fontWeight: 700,
                  background: isDone ? SUCCESS_TEXT : isActive ? PRIMARY : "var(--surface-2)",
                  color: isDone || isActive ? "var(--primary-contrast)" : MUTED,
                  transition: "all 0.2s",
                }}
              >
                {isDone ? "✓" : s.num}
              </div>
              <div
                style={{
                  fontSize: 11,
                  fontWeight: isActive ? 700 : 500,
                  color: isActive ? PRIMARY : MUTED,
                  marginTop: 4,
                }}
              >
                {s.label}
              </div>
            </div>
            {i < STEPS.length - 1 && (
              <div
                style={{
                  width: 48,
                  height: 2,
                  background: isDone ? SUCCESS_TEXT : BORDER,
                  margin: "0 8px",
                  marginBottom: 18,
                  borderRadius: 1,
                  transition: "background 0.2s",
                }}
              />
            )}
          </div>
        )
      })}
    </div>
  )
}

// ── Format helpers ──────────────────────────────────────

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

function formatDate(iso: string) {
  const d = new Date(iso)
  return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`
}

// ── Main Component ──────────────────────────────────────

type FormData = {
  submitter_name: string
  submitter_email: string
  amount: string
  bank_name: string
  branch_name: string
  account_type: "ordinary" | "checking" | "savings"
  account_number: string
  account_holder: string
  notes: string
}

const INITIAL_FORM: FormData = {
  submitter_name: "",
  submitter_email: "",
  amount: "",
  bank_name: "",
  branch_name: "",
  account_type: "ordinary",
  account_number: "",
  account_holder: "",
  notes: "",
}

export default function VendorSubmitPage() {
  const params = useParams()
  const token = typeof params?.token === "string" ? params.token : ""

  const [loading, setLoading] = useState(true)
  const [info, setInfo] = useState<SubmissionLinkPublicInfo | null>(null)
  const [error, setError] = useState<string | null>(null)

  const [step, setStep] = useState<Step>(1)
  const [form, setForm] = useState<FormData>(INITIAL_FORM)
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<keyof FormData, string>>>({})
  const [submitting, setSubmitting] = useState(false)
  const [submitResult, setSubmitResult] = useState<{
    ok: boolean
    submittedAt?: string
    isResubmission?: boolean
  } | null>(null)

  // Load link info
  useEffect(() => {
    if (!token) return
    setLoading(true)
    fetch(`/api/vendor-submit/${token}`)
      .then((r) => r.json())
      .then((res) => {
        if (!res.ok) {
          setError(res.error || "リンクが無効です")
        } else {
          setInfo(res.data)
          // Pre-fill amount from content candidates
          if (res.data.content_candidates?.length > 0) {
            const total = res.data.content_candidates.reduce(
              (sum: number, c: ContentCandidate) => sum + (c.amount ?? 0),
              0
            )
            if (total > 0) {
              setForm((f) => ({ ...f, amount: String(total) }))
            }
          }
        }
      })
      .catch(() => setError("読み込みに失敗しました"))
      .finally(() => setLoading(false))
  }, [token])

  const updateField = useCallback(
    (key: keyof FormData, value: string) => {
      setForm((f) => ({ ...f, [key]: value }))
      setFieldErrors((e) => ({ ...e, [key]: undefined }))
    },
    []
  )

  // Validate step 2
  const validateForm = useCallback((): boolean => {
    const errors: Partial<Record<keyof FormData, string>> = {}
    if (!form.submitter_name.trim()) errors.submitter_name = "請求名義を入力してください"
    if (!form.submitter_email.trim()) errors.submitter_email = "メールアドレスを入力してください"
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.submitter_email.trim()))
      errors.submitter_email = "正しい形式で入力してください"
    const amount = Number(form.amount)
    if (!form.amount || isNaN(amount) || amount <= 0)
      errors.amount = "正しい金額を入力してください"
    if (!form.bank_name.trim()) errors.bank_name = "銀行名を入力してください"
    if (!form.branch_name.trim()) errors.branch_name = "支店名を入力してください"
    if (!form.account_number.trim()) errors.account_number = "口座番号を入力してください"
    else if (!/^\d{4,8}$/.test(form.account_number.trim()))
      errors.account_number = "4〜8桁の数字で入力してください"
    if (!form.account_holder.trim()) errors.account_holder = "口座名義を入力してください"

    setFieldErrors(errors)
    return Object.keys(errors).length === 0
  }, [form])

  // Submit
  const handleSubmit = useCallback(async () => {
    if (!validateForm()) return
    setSubmitting(true)
    try {
      const res = await fetch(`/api/vendor-submit/${token}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          submitter_name: form.submitter_name.trim(),
          submitter_email: form.submitter_email.trim(),
          amount: Number(form.amount),
          bank_name: form.bank_name.trim(),
          branch_name: form.branch_name.trim(),
          account_type: form.account_type,
          account_number: form.account_number.trim(),
          account_holder: form.account_holder.trim(),
          notes: form.notes.trim() || undefined,
        }),
      })
      const data = await res.json()
      if (!data.ok) {
        setError(data.error || "送信に失敗しました")
      } else {
        setSubmitResult(data)
        setStep(3)
      }
    } catch {
      setError("送信に失敗しました。通信環境を確認してもう一度お試しください。")
    } finally {
      setSubmitting(false)
    }
  }, [form, token, validateForm])

  // ── Render: Loading ──
  if (loading) {
    return (
      <div style={pageStyle}>
        <div style={containerStyle}>
          <div style={{ ...cardStyle, textAlign: "center", padding: 48 }}>
            <div style={{ fontSize: 14, color: MUTED }}>読み込み中…</div>
          </div>
        </div>
      </div>
    )
  }

  // ── Render: Error (invalid link) ──
  if (error && !info) {
    return (
      <div style={pageStyle}>
        <div style={containerStyle}>
          <div style={{ ...cardStyle, textAlign: "center", padding: 48 }}>
            <div style={{ fontSize: 40, marginBottom: 16 }}>⚠</div>
            <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 8 }}>
              リンクが無効です
            </div>
            <div style={{ fontSize: 14, color: MUTED, lineHeight: 1.6 }}>
              {error}
              <br />
              担当者にお問い合わせください。
            </div>
          </div>
        </div>
      </div>
    )
  }

  if (!info) return null

  // ── Render: Already submitted (no resubmission) ──
  if (info.already_submitted && !info.allow_resubmission && step === 1) {
    const sub = info.existing_submission
    return (
      <div style={pageStyle}>
        <div style={containerStyle}>
          <Header orgName={info.org_name} />
          <div style={cardStyle}>
            <div style={{ textAlign: "center" }}>
              <div
                style={{
                  width: 56,
                  height: 56,
                  borderRadius: "50%",
                  background: SUCCESS_BG,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  margin: "0 auto 16px",
                  fontSize: 28,
                  color: SUCCESS_TEXT,
                }}
              >
                ✓
              </div>
              <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 8 }}>
                提出済みです
              </div>
              <div style={{ fontSize: 14, color: MUTED, marginBottom: 20 }}>
                {formatMonth(info.target_month)}分の請求は提出済みです。
              </div>
              {sub && (
                <div
                  style={{
                    background: "#f8fafc",
                    borderRadius: 10,
                    padding: 16,
                    textAlign: "left",
                    fontSize: 13,
                  }}
                >
                  <div style={{ marginBottom: 8 }}>
                    <span style={{ color: MUTED }}>提出名義: </span>
                    <strong>{sub.submitter_name}</strong>
                  </div>
                  <div style={{ marginBottom: 8 }}>
                    <span style={{ color: MUTED }}>金額: </span>
                    <strong>{formatCurrency(sub.total)}</strong>
                  </div>
                  {sub.submitted_at && (
                    <div>
                      <span style={{ color: MUTED }}>提出日時: </span>
                      <strong>{formatDate(sub.submitted_at)}</strong>
                    </div>
                  )}
                </div>
              )}
              <div
                style={{
                  marginTop: 20,
                  fontSize: 13,
                  color: MUTED,
                  lineHeight: 1.6,
                }}
              >
                修正が必要な場合は担当者へご連絡ください。
              </div>
            </div>
          </div>
        </div>
      </div>
    )
  }

  // ── Step 1: Confirm ──
  if (step === 1) {
    return (
      <div style={pageStyle}>
        <div style={containerStyle}>
          <Header orgName={info.org_name} />
          <StepIndicator current={1} />

          <div style={cardStyle}>
            <div style={{ textAlign: "center", marginBottom: 20 }}>
              <div style={{ fontSize: 20, fontWeight: 700, marginBottom: 4 }}>
                請求提出のご案内
              </div>
              <div style={{ fontSize: 14, color: MUTED }}>
                以下の内容をご確認ください
              </div>
            </div>

            <InfoRow label="提出先" value={info.vendor_name} />
            <InfoRow label="対象月" value={formatMonth(info.target_month)} />
            {info.expires_at && (
              <InfoRow label="提出期限" value={formatDate(info.expires_at)} highlight />
            )}
            {info.custom_message && (
              <div
                style={{
                  background: WARNING_BG,
                  border: `1px solid #fde68a`,
                  borderRadius: 10,
                  padding: "12px 14px",
                  fontSize: 13,
                  color: WARNING_TEXT,
                  marginTop: 16,
                  lineHeight: 1.6,
                }}
              >
                {info.custom_message}
              </div>
            )}

            {/* Content candidates */}
            {info.content_candidates.length > 0 && (
              <div style={{ marginTop: 20 }}>
                <div
                  style={{
                    fontSize: 13,
                    fontWeight: 600,
                    marginBottom: 8,
                    color: TEXT,
                  }}
                >
                  対象案件（{info.content_candidates.length}件）
                </div>
                <div
                  style={{
                    background: "#f8fafc",
                    borderRadius: 10,
                    overflow: "hidden",
                  }}
                >
                  {info.content_candidates.map((c, i) => (
                    <div
                      key={c.id}
                      style={{
                        padding: "10px 14px",
                        borderBottom:
                          i < info.content_candidates.length - 1
                            ? `1px solid ${BORDER}`
                            : "none",
                        fontSize: 13,
                      }}
                    >
                      <div style={{ fontWeight: 600 }}>
                        {c.project_name || "（案件名なし）"}
                        {c.title ? ` / ${c.title}` : ""}
                      </div>
                      <div style={{ color: MUTED, marginTop: 2 }}>
                        {formatCurrency(c.unit_price ?? 0)} × {c.quantity ?? 1} ={" "}
                        <strong style={{ color: TEXT }}>
                          {formatCurrency(c.amount ?? 0)}
                        </strong>
                      </div>
                    </div>
                  ))}
                  <div
                    style={{
                      padding: "10px 14px",
                      background: "#f1f5f9",
                      fontWeight: 700,
                      fontSize: 14,
                      textAlign: "right",
                    }}
                  >
                    合計候補:{" "}
                    {formatCurrency(
                      info.content_candidates.reduce((s, c) => s + (c.amount ?? 0), 0)
                    )}
                  </div>
                </div>
                <div style={{ fontSize: 12, color: MUTED, marginTop: 6 }}>
                  ※ 最終的な請求金額は次の画面で変更できます
                </div>
              </div>
            )}
          </div>

          {info.already_submitted && info.allow_resubmission && (
            <div
              style={{
                background: WARNING_BG,
                border: `1px solid #fde68a`,
                borderRadius: 10,
                padding: "12px 14px",
                fontSize: 13,
                color: WARNING_TEXT,
                marginBottom: 16,
                textAlign: "center",
              }}
            >
              この月はすでに提出済みですが、再提出が許可されています。
            </div>
          )}

          <button
            style={btnPrimaryStyle}
            onMouseOver={(e) => {
              ;(e.target as HTMLButtonElement).style.background = PRIMARY_HOVER
            }}
            onMouseOut={(e) => {
              ;(e.target as HTMLButtonElement).style.background = PRIMARY
            }}
            onClick={() => setStep(2)}
          >
            請求情報を入力する →
          </button>
        </div>
      </div>
    )
  }

  // ── Step 2: Form ──
  if (step === 2) {
    return (
      <div style={pageStyle}>
        <div style={containerStyle}>
          <Header orgName={info.org_name} />
          <StepIndicator current={2} />

          {/* Back link */}
          <button
            onClick={() => setStep(1)}
            style={{
              background: "none",
              border: "none",
              color: PRIMARY,
              fontSize: 13,
              cursor: "pointer",
              marginBottom: 12,
              padding: 0,
            }}
          >
            ← 確認画面に戻る
          </button>

          <div style={cardStyle}>
            <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 20 }}>
              {info.vendor_name} 様 — {formatMonth(info.target_month)}分
            </div>

            {error && (
              <div
                style={{
                  background: ERROR_BG,
                  color: ERROR_TEXT,
                  padding: "10px 14px",
                  borderRadius: 10,
                  fontSize: 13,
                  marginBottom: 16,
                }}
              >
                {error}
              </div>
            )}

            {/* 請求名義 */}
            <div style={fieldGap}>
              <label style={labelStyle}>
                請求名義 <span style={{ color: ERROR_TEXT }}>*</span>
              </label>
              <input
                style={{
                  ...inputStyle,
                  borderColor: fieldErrors.submitter_name ? ERROR_TEXT : BORDER,
                }}
                placeholder="例: 株式会社サンプル / 山田太郎"
                value={form.submitter_name}
                onChange={(e) => updateField("submitter_name", e.target.value)}
              />
              {fieldErrors.submitter_name && (
                <FieldError msg={fieldErrors.submitter_name} />
              )}
            </div>

            {/* メールアドレス */}
            <div style={fieldGap}>
              <label style={labelStyle}>
                メールアドレス <span style={{ color: ERROR_TEXT }}>*</span>
              </label>
              <input
                type="email"
                style={{
                  ...inputStyle,
                  borderColor: fieldErrors.submitter_email ? ERROR_TEXT : BORDER,
                }}
                placeholder="example@email.com"
                value={form.submitter_email}
                onChange={(e) => updateField("submitter_email", e.target.value)}
                inputMode="email"
                autoComplete="email"
              />
              {fieldErrors.submitter_email && (
                <FieldError msg={fieldErrors.submitter_email} />
              )}
            </div>

            {/* 請求金額 */}
            <div style={fieldGap}>
              <label style={labelStyle}>
                請求金額（税込） <span style={{ color: ERROR_TEXT }}>*</span>
              </label>
              <div style={{ position: "relative" }}>
                <span
                  style={{
                    position: "absolute",
                    left: 12,
                    top: "50%",
                    transform: "translateY(-50%)",
                    color: MUTED,
                    fontSize: 15,
                    pointerEvents: "none",
                  }}
                >
                  ¥
                </span>
                <input
                  type="text"
                  inputMode="numeric"
                  style={{
                    ...inputStyle,
                    paddingLeft: 28,
                    borderColor: fieldErrors.amount ? ERROR_TEXT : BORDER,
                  }}
                  placeholder="0"
                  value={form.amount}
                  onChange={(e) => {
                    const v = e.target.value.replace(/[^\d]/g, "")
                    updateField("amount", v)
                  }}
                />
              </div>
              {form.amount && !isNaN(Number(form.amount)) && Number(form.amount) > 0 && (
                <div style={{ fontSize: 12, color: MUTED, marginTop: 4 }}>
                  {formatCurrency(Number(form.amount))}
                </div>
              )}
              {fieldErrors.amount && <FieldError msg={fieldErrors.amount} />}
            </div>

            {/* Separator */}
            <div
              style={{
                borderTop: `1px solid ${BORDER}`,
                margin: "20px 0",
                paddingTop: 16,
              }}
            >
              <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 14 }}>
                振込先口座情報
              </div>
            </div>

            {/* 銀行名 */}
            <div style={fieldGap}>
              <label style={labelStyle}>
                銀行名 <span style={{ color: ERROR_TEXT }}>*</span>
              </label>
              <input
                style={{
                  ...inputStyle,
                  borderColor: fieldErrors.bank_name ? ERROR_TEXT : BORDER,
                }}
                placeholder="例: みずほ銀行"
                value={form.bank_name}
                onChange={(e) => updateField("bank_name", e.target.value)}
              />
              {fieldErrors.bank_name && <FieldError msg={fieldErrors.bank_name} />}
            </div>

            {/* 支店名 */}
            <div style={fieldGap}>
              <label style={labelStyle}>
                支店名 <span style={{ color: ERROR_TEXT }}>*</span>
              </label>
              <input
                style={{
                  ...inputStyle,
                  borderColor: fieldErrors.branch_name ? ERROR_TEXT : BORDER,
                }}
                placeholder="例: 新宿支店"
                value={form.branch_name}
                onChange={(e) => updateField("branch_name", e.target.value)}
              />
              {fieldErrors.branch_name && (
                <FieldError msg={fieldErrors.branch_name} />
              )}
            </div>

            {/* 口座種別 */}
            <div style={fieldGap}>
              <label style={labelStyle}>
                口座種別 <span style={{ color: ERROR_TEXT }}>*</span>
              </label>
              <select
                style={selectStyle}
                value={form.account_type}
                onChange={(e) =>
                  updateField(
                    "account_type",
                    e.target.value as "ordinary" | "checking" | "savings"
                  )
                }
              >
                <option value="ordinary">普通</option>
                <option value="checking">当座</option>
                <option value="savings">貯蓄</option>
              </select>
            </div>

            {/* 口座番号 */}
            <div style={fieldGap}>
              <label style={labelStyle}>
                口座番号 <span style={{ color: ERROR_TEXT }}>*</span>
              </label>
              <input
                type="text"
                inputMode="numeric"
                style={{
                  ...inputStyle,
                  borderColor: fieldErrors.account_number ? ERROR_TEXT : BORDER,
                }}
                placeholder="1234567"
                value={form.account_number}
                onChange={(e) => {
                  const v = e.target.value.replace(/[^\d]/g, "")
                  updateField("account_number", v)
                }}
                maxLength={8}
              />
              {fieldErrors.account_number && (
                <FieldError msg={fieldErrors.account_number} />
              )}
            </div>

            {/* 口座名義 */}
            <div style={fieldGap}>
              <label style={labelStyle}>
                口座名義 <span style={{ color: ERROR_TEXT }}>*</span>
              </label>
              <input
                style={{
                  ...inputStyle,
                  borderColor: fieldErrors.account_holder ? ERROR_TEXT : BORDER,
                }}
                placeholder="例: ヤマダ タロウ"
                value={form.account_holder}
                onChange={(e) => updateField("account_holder", e.target.value)}
              />
              {fieldErrors.account_holder && (
                <FieldError msg={fieldErrors.account_holder} />
              )}
            </div>

            {/* 備考 */}
            <div style={fieldGap}>
              <label style={labelStyle}>備考（任意）</label>
              <textarea
                style={{ ...inputStyle, minHeight: 72, resize: "vertical" }}
                placeholder="補足事項があればご記入ください"
                value={form.notes}
                onChange={(e) => updateField("notes", e.target.value)}
              />
            </div>
          </div>

          {/* Submit button */}
          <button
            style={{
              ...btnPrimaryStyle,
              opacity: submitting ? 0.6 : 1,
              pointerEvents: submitting ? "none" : "auto",
            }}
            onMouseOver={(e) => {
              if (!submitting)
                (e.target as HTMLButtonElement).style.background = PRIMARY_HOVER
            }}
            onMouseOut={(e) => {
              ;(e.target as HTMLButtonElement).style.background = PRIMARY
            }}
            onClick={handleSubmit}
            disabled={submitting}
          >
            {submitting ? "送信中…" : "この内容で請求を提出する"}
          </button>

          <div
            style={{
              textAlign: "center",
              fontSize: 12,
              color: MUTED,
              marginTop: 12,
            }}
          >
            送信後の修正は担当者へご連絡ください
          </div>
        </div>
      </div>
    )
  }

  // ── Step 3: Complete ──
  return (
    <div style={pageStyle}>
      <div style={containerStyle}>
        <Header orgName={info.org_name} />
        <StepIndicator current={3} />

        <div style={cardStyle}>
          <div style={{ textAlign: "center" }}>
            <div
              style={{
                width: 64,
                height: 64,
                borderRadius: "50%",
                background: SUCCESS_BG,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                margin: "0 auto 16px",
                fontSize: 32,
                color: SUCCESS_TEXT,
              }}
            >
              ✓
            </div>
            <div style={{ fontSize: 20, fontWeight: 700, marginBottom: 6 }}>
              {submitResult?.isResubmission ? "再提出が完了しました" : "提出が完了しました"}
            </div>
            <div style={{ fontSize: 14, color: MUTED, marginBottom: 24 }}>
              ご請求を受け付けました。内容を確認後、担当者より連絡いたします。
            </div>
          </div>

          <div
            style={{
              background: "#f8fafc",
              borderRadius: 10,
              padding: 16,
              fontSize: 13,
              lineHeight: 1.8,
            }}
          >
            <SummaryRow label="提出先" value={info.vendor_name} />
            <SummaryRow label="対象月" value={formatMonth(info.target_month)} />
            <SummaryRow label="請求名義" value={form.submitter_name} />
            <SummaryRow label="請求金額" value={formatCurrency(Number(form.amount))} />
            <SummaryRow
              label="振込先"
              value={`${form.bank_name} ${form.branch_name} ${form.account_type === "ordinary" ? "普通" : form.account_type === "checking" ? "当座" : "貯蓄"} ${form.account_number}`}
            />
            <SummaryRow label="口座名義" value={form.account_holder} />
            {submitResult?.submittedAt && (
              <SummaryRow
                label="受付日時"
                value={formatDate(submitResult.submittedAt)}
              />
            )}
          </div>

          <div
            style={{
              marginTop: 20,
              fontSize: 13,
              color: MUTED,
              textAlign: "center",
              lineHeight: 1.6,
            }}
          >
            修正が必要な場合は担当者へご連絡ください。
            <br />
            このページは閉じていただいて構いません。
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Sub-components ──────────────────────────────────────

function Header({ orgName }: { orgName: string }) {
  return (
    <div style={{ textAlign: "center", marginBottom: 20 }}>
      <div
        style={{
          fontSize: 13,
          color: MUTED,
          fontWeight: 500,
          letterSpacing: 1,
          textTransform: "uppercase",
        }}
      >
        NovaLoop
      </div>
      {orgName && (
        <div style={{ fontSize: 14, fontWeight: 600, color: TEXT, marginTop: 2 }}>
          {orgName}
        </div>
      )}
    </div>
  )
}

function InfoRow({
  label,
  value,
  highlight,
}: {
  label: string
  value: string
  highlight?: boolean
}) {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        padding: "10px 0",
        borderBottom: `1px solid ${BORDER}`,
        fontSize: 14,
      }}
    >
      <span style={{ color: MUTED }}>{label}</span>
      <span style={{ fontWeight: 600, color: highlight ? WARNING_TEXT : TEXT }}>
        {value}
      </span>
    </div>
  )
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span style={{ color: MUTED }}>{label}: </span>
      <strong>{value}</strong>
    </div>
  )
}

function FieldError({ msg }: { msg: string }) {
  return (
    <div style={{ fontSize: 12, color: ERROR_TEXT, marginTop: 4 }}>{msg}</div>
  )
}
