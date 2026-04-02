"use client"

import { useEffect, useState, type CSSProperties, type FormEvent } from "react"
import { useParams } from "next/navigation"

type InvoiceSummary = {
  invoice_no: string | null
  invoice_title: string | null
  invoice_month: string | null
  due_date: string
  total: number
  status: string
  issuer_name: string | null
  already_notified: boolean
  client_paid_at_claimed: string | null
  client_paid_amount_claimed: number | null
}

const fmtCur = (value: number) =>
  new Intl.NumberFormat("ja-JP", {
    style: "currency",
    currency: "JPY",
    maximumFractionDigits: 0,
  }).format(value)

const fmtDate = (value: string) => {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!match) return value
  return `${match[1]}年${Number(match[2])}月${Number(match[3])}日`
}

const pageStyle: CSSProperties = {
  minHeight: "100vh",
  background:
    "radial-gradient(circle at top left, rgba(219,234,254,0.9), rgba(255,255,255,0) 36%), linear-gradient(180deg, #f8fafc 0%, #eef2f7 100%)",
  padding: "48px 16px 72px",
  display: "flex",
  justifyContent: "center",
  fontFamily: '"Hiragino Sans", "Yu Gothic", sans-serif',
}

const shellStyle: CSSProperties = {
  width: "100%",
  maxWidth: 760,
  display: "grid",
  gap: 18,
}

const cardStyle: CSSProperties = {
  background: "rgba(255,255,255,0.92)",
  border: "1px solid rgba(203,213,225,0.9)",
  borderRadius: 24,
  padding: 28,
  boxShadow: "0 20px 60px rgba(15,23,42,0.08)",
  backdropFilter: "blur(10px)",
}

const fieldStyle: CSSProperties = {
  width: "100%",
  borderRadius: 12,
  border: "1px solid #cbd5e1",
  background: "#fff",
  padding: "12px 14px",
  fontSize: 15,
  color: "#0f172a",
}

const labelStyle: CSSProperties = {
  display: "grid",
  gap: 6,
}

function SummaryCard({ label, value }: { label: string; value: string }) {
  return (
    <div
      style={{
        border: "1px solid #e2e8f0",
        borderRadius: 16,
        padding: "14px 16px",
        background: "#fff",
      }}
    >
      <div style={{ fontSize: 11, color: "#64748b", letterSpacing: "0.08em", textTransform: "uppercase" }}>
        {label}
      </div>
      <div style={{ marginTop: 6, fontSize: 18, fontWeight: 700, color: "#0f172a" }}>{value}</div>
    </div>
  )
}

export default function PayNotifyPage() {
  const params = useParams()
  const token = typeof params.token === "string" ? params.token : null

  const [summary, setSummary] = useState<InvoiceSummary | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)

  const [paidAt, setPaidAt] = useState(new Date().toISOString().slice(0, 10))
  const [paidAmount, setPaidAmount] = useState("")
  const [transferName, setTransferName] = useState("")
  const [note, setNote] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  useEffect(() => {
    if (!token) {
      setLoadError("URL が正しくありません。")
      setLoading(false)
      return
    }

    const load = async () => {
      try {
        const res = await fetch(`/api/public/invoices/${token}/notify`)
        const json = (await res.json().catch(() => null)) as (InvoiceSummary & { error?: string }) | null
        if (!res.ok || !json) {
          setLoadError(json?.error ?? "請求情報を読み込めませんでした。")
          return
        }
        if (json.error) {
          setLoadError(json.error)
          return
        }
        setSummary(json)
        setPaidAmount(String(json.total))
      } catch {
        setLoadError("通信に失敗しました。時間をおいて再度お試しください。")
      } finally {
        setLoading(false)
      }
    }

    void load()
  }, [token])

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault()
    if (!token) return

    setSubmitError(null)
    const amount = Number(paidAmount)
    if (!paidAt || Number.isNaN(amount) || amount <= 0) {
      setSubmitError("振込日と振込金額を正しく入力してください。")
      return
    }

    setSubmitting(true)
    try {
      const res = await fetch(`/api/public/invoices/${token}/notify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          paid_at: paidAt,
          paid_amount: amount,
          transfer_name: transferName.trim() || null,
          note: note.trim() || null,
        }),
      })
      const json = (await res.json().catch(() => null)) as { error?: string } | null
      if (!res.ok) {
        setSubmitError(json?.error ?? "送信に失敗しました。")
        return
      }
      setDone(true)
    } catch {
      setSubmitError("送信に失敗しました。時間をおいて再度お試しください。")
    } finally {
      setSubmitting(false)
    }
  }

  if (loading) {
    return (
      <div style={pageStyle}>
        <div style={shellStyle}>
          <section style={cardStyle}>
            <p style={{ margin: 0, textAlign: "center", color: "#64748b", padding: "36px 0" }}>読み込み中...</p>
          </section>
        </div>
      </div>
    )
  }

  if (loadError || !summary) {
    return (
      <div style={pageStyle}>
        <div style={shellStyle}>
          <section style={cardStyle}>
            <div style={{ textAlign: "center", padding: "12px 0 6px" }}>
              <p style={{ margin: 0, fontSize: 42 }}>!</p>
              <h1 style={{ margin: "12px 0 8px", fontSize: 24, color: "#0f172a" }}>ページを表示できません</h1>
              <p style={{ margin: 0, color: "#dc2626", fontWeight: 700 }}>{loadError ?? "URL を確認してください。"}</p>
              <p style={{ margin: "10px 0 0", color: "#64748b", fontSize: 14, lineHeight: 1.7 }}>
                期限切れまたは無効なURLの可能性があります。請求元に確認してください。
              </p>
            </div>
          </section>
        </div>
      </div>
    )
  }

  if (done || summary.already_notified) {
    return (
      <div style={pageStyle}>
        <div style={shellStyle}>
          <section style={cardStyle}>
            <div style={{ textAlign: "center", padding: "8px 0 2px" }}>
              <div
                style={{
                  width: 72,
                  height: 72,
                  borderRadius: "50%",
                  margin: "0 auto 16px",
                  background: "#dcfce7",
                  color: "#166534",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 30,
                  fontWeight: 700,
                }}
              >
                ✓
              </div>
              <h1 style={{ margin: "0 0 10px", fontSize: 28, color: "#0f172a" }}>
                {done ? "お支払い完了通知を受け付けました" : "すでにご連絡を受け付けています"}
              </h1>
              <p style={{ margin: 0, color: "#475569", lineHeight: 1.8 }}>
                ご連絡ありがとうございます。担当者が確認のうえ、入金処理と領収書発行を進めます。
              </p>
            </div>

            {(summary.client_paid_at_claimed || summary.client_paid_amount_claimed) && (
              <div
                style={{
                  marginTop: 22,
                  padding: 18,
                  borderRadius: 18,
                  border: "1px solid #bbf7d0",
                  background: "#f0fdf4",
                  color: "#166534",
                  display: "grid",
                  gap: 6,
                }}
              >
                {summary.client_paid_at_claimed && <div>振込日: {fmtDate(summary.client_paid_at_claimed)}</div>}
                {summary.client_paid_amount_claimed && <div>振込金額: {fmtCur(summary.client_paid_amount_claimed)}</div>}
              </div>
            )}
          </section>

          <section style={cardStyle}>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12 }}>
              {summary.invoice_no ? <SummaryCard label="Invoice No." value={summary.invoice_no} /> : null}
              <SummaryCard label="Amount" value={fmtCur(summary.total)} />
              <SummaryCard label="Due Date" value={fmtDate(summary.due_date)} />
            </div>
          </section>
        </div>
      </div>
    )
  }

  return (
    <div style={pageStyle}>
      <div style={shellStyle}>
        <section style={cardStyle}>
          <div style={{ display: "grid", gap: 10 }}>
            <p style={{ margin: 0, fontSize: 12, letterSpacing: "0.14em", textTransform: "uppercase", color: "#64748b" }}>
              Payment Notification
            </p>
            <h1 style={{ margin: 0, fontSize: 30, lineHeight: 1.2, color: "#0f172a" }}>お振込後のご連絡</h1>
            <p style={{ margin: 0, color: "#475569", lineHeight: 1.8 }}>
              お振込が完了したら、下記フォームからご連絡ください。振込日と振込金額が分かれば受け付けできます。
            </p>
          </div>

          <div
            style={{
              marginTop: 20,
              border: "1px solid #dbe2ea",
              borderRadius: 20,
              padding: 18,
              background: "linear-gradient(180deg, #ffffff 0%, #f8fafc 100%)",
            }}
          >
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12 }}>
              {summary.invoice_no ? <SummaryCard label="Invoice No." value={summary.invoice_no} /> : null}
              <SummaryCard label="Amount" value={fmtCur(summary.total)} />
              <SummaryCard label="Due Date" value={fmtDate(summary.due_date)} />
            </div>
            {(summary.invoice_title || summary.invoice_month || summary.issuer_name) && (
              <div style={{ marginTop: 14, color: "#475569", fontSize: 14, lineHeight: 1.8 }}>
                {summary.invoice_title ? <div>件名: {summary.invoice_title}</div> : null}
                {summary.invoice_month ? <div>対象月: {summary.invoice_month}</div> : null}
                {summary.issuer_name ? <div>請求元: {summary.issuer_name}</div> : null}
              </div>
            )}
          </div>
        </section>

        <section style={cardStyle}>
          <div style={{ display: "grid", gap: 12 }}>
            <div style={{ display: "grid", gap: 4 }}>
              <h2 style={{ margin: 0, fontSize: 20, color: "#0f172a" }}>ご連絡の流れ</h2>
              <p style={{ margin: 0, color: "#64748b", lineHeight: 1.8 }}>
                次の3点だけ入力してください。担当者側で入金確認を行います。
              </p>
            </div>
            <div style={{ display: "grid", gap: 10 }}>
              {[
                ["1", "振込日を入力", "実際にお振込いただいた日付を選択してください。"],
                ["2", "振込金額を入力", `通常は ${fmtCur(summary.total)} です。差額がある場合は実際の振込額を入力してください。`],
                ["3", "振込名義を入力", "必要に応じて、通帳に表示される名義や補足事項を記載してください。"],
              ].map(([index, title, copy]) => (
                <div
                  key={index}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "28px 1fr",
                    gap: 12,
                    alignItems: "start",
                    padding: 14,
                    borderRadius: 16,
                    background: "#f8fafc",
                    border: "1px solid #e2e8f0",
                  }}
                >
                  <div
                    style={{
                      width: 28,
                      height: 28,
                      borderRadius: "50%",
                      background: "#0f172a",
                      color: "#fff",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontSize: 12,
                      fontWeight: 700,
                    }}
                  >
                    {index}
                  </div>
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 700, color: "#0f172a" }}>{title}</div>
                    <div style={{ marginTop: 3, color: "#475569", fontSize: 13, lineHeight: 1.7 }}>{copy}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section style={cardStyle}>
          <form onSubmit={(event) => void handleSubmit(event)} noValidate style={{ display: "grid", gap: 18 }}>
            <div style={{ display: "grid", gap: 6 }}>
              <h2 style={{ margin: 0, fontSize: 20, color: "#0f172a" }}>支払完了通知フォーム</h2>
              <p style={{ margin: 0, color: "#64748b", lineHeight: 1.8 }}>
                入力内容は請求元の担当者に共有されます。
              </p>
            </div>

            {submitError && (
              <div
                style={{
                  borderRadius: 14,
                  padding: "12px 14px",
                  background: "#fef2f2",
                  border: "1px solid #fecaca",
                  color: "#dc2626",
                  fontSize: 14,
                  fontWeight: 600,
                }}
              >
                {submitError}
              </div>
            )}

            <div style={{ display: "grid", gap: 16 }}>
              <label style={labelStyle}>
                <span style={{ fontSize: 13, fontWeight: 700, color: "#334155" }}>振込日 *</span>
                <input type="date" value={paidAt} onChange={(e) => setPaidAt(e.target.value)} required style={fieldStyle} />
              </label>

              <label style={labelStyle}>
                <span style={{ fontSize: 13, fontWeight: 700, color: "#334155" }}>振込金額 *</span>
                <input
                  type="number"
                  min={1}
                  step={1}
                  value={paidAmount}
                  onChange={(e) => setPaidAmount(e.target.value)}
                  required
                  style={fieldStyle}
                />
                <span style={{ fontSize: 12, color: "#64748b" }}>請求金額: {fmtCur(summary.total)}</span>
              </label>

              <label style={labelStyle}>
                <span style={{ fontSize: 13, fontWeight: 700, color: "#334155" }}>振込名義</span>
                <input
                  type="text"
                  maxLength={100}
                  value={transferName}
                  onChange={(e) => setTransferName(e.target.value)}
                  placeholder="例: カ)ノヴァループ"
                  style={fieldStyle}
                />
              </label>

              <label style={labelStyle}>
                <span style={{ fontSize: 13, fontWeight: 700, color: "#334155" }}>備考</span>
                <textarea
                  rows={4}
                  maxLength={500}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="分割振込や差額がある場合のみご記入ください。"
                  style={{ ...fieldStyle, resize: "vertical" }}
                />
              </label>
            </div>

            <button
              type="submit"
              disabled={submitting}
              style={{
                border: "none",
                borderRadius: 14,
                padding: "14px 18px",
                background: submitting ? "#94a3b8" : "#0f172a",
                color: "#fff",
                fontSize: 15,
                fontWeight: 700,
                cursor: submitting ? "not-allowed" : "pointer",
              }}
            >
              {submitting ? "送信中..." : "支払完了を通知する"}
            </button>
          </form>
        </section>
      </div>
    </div>
  )
}
