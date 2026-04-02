"use client"

/**
 * /pay/[token] — 認証不要の公開ページ
 *
 * 請求書受取人が銀行振込後に「支払い完了」を通知するためのフォーム。
 * - public_token（UUID）でページを特定
 * - 請求書の基本情報を表示（金額・件名・支払期限）
 * - 振込日・振込金額・振込名義・備考を送信
 * - 既に通知済みの場合は完了メッセージを表示
 */

import { useEffect, useState } from "react"
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

const fmtCur = (v: number) =>
  new Intl.NumberFormat("ja-JP", { style: "currency", currency: "JPY", maximumFractionDigits: 0 }).format(v)

const fmtDate = (d: string) => {
  const m = d.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!m) return d
  return `${m[1]}年${parseInt(m[2])}月${parseInt(m[3])}日`
}

export default function PayNotifyPage() {
  const params = useParams()
  const token = typeof params.token === "string" ? params.token : null

  const [summary, setSummary] = useState<InvoiceSummary | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  // フォーム
  const [paidAt, setPaidAt] = useState(new Date().toISOString().slice(0, 10))
  const [paidAmount, setPaidAmount] = useState("")
  const [transferName, setTransferName] = useState("")
  const [note, setNote] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  useEffect(() => {
    if (!token) { setLoadError("URLが正しくありません"); setLoading(false); return }
    const load = async () => {
      try {
        const res = await fetch(`/api/public/invoices/${token}/notify`)
        const json = await res.json().catch(() => null) as InvoiceSummary & { error?: string } | null
        if (!res.ok || !json) { setLoadError(json?.error ?? "請求書が見つかりません"); return }
        if (json.error) { setLoadError(json.error); return }
        setSummary(json)
        if (json.total) setPaidAmount(String(json.total))
      } catch {
        setLoadError("読み込みに失敗しました。URLをご確認ください")
      } finally {
        setLoading(false)
      }
    }
    void load()
  }, [token])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSubmitError(null)
    const amount = Number(paidAmount)
    if (!paidAt || isNaN(amount) || amount <= 0) {
      setSubmitError("振込日と振込金額は必須です")
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
      const json = await res.json().catch(() => null) as { ok?: boolean; message?: string; error?: string } | null
      if (!res.ok) { setSubmitError(json?.error ?? "送信に失敗しました"); return }
      setDone(true)
    } catch {
      setSubmitError("通信エラーが発生しました。再度お試しください")
    } finally {
      setSubmitting(false)
    }
  }

  // ── スタイル定数 ────────────────────────────────────────────────
  const pageStyle: React.CSSProperties = {
    minHeight: "100vh",
    background: "#f8fafc",
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "center",
    padding: "48px 16px 80px",
    fontFamily: '"Hiragino Kaku Gothic ProN", "Hiragino Sans", "Yu Gothic", sans-serif',
  }
  const cardStyle: React.CSSProperties = {
    background: "#fff",
    borderRadius: 16,
    padding: "36px 32px",
    maxWidth: 520,
    width: "100%",
    boxShadow: "0 4px 24px rgba(0,0,0,0.08)",
  }
  const inputStyle: React.CSSProperties = {
    width: "100%",
    padding: "10px 12px",
    borderRadius: 8,
    border: "1px solid #d1d5db",
    fontSize: 15,
    background: "#fff",
    outline: "none",
  }
  const labelStyle: React.CSSProperties = {
    display: "block",
    fontSize: 13,
    fontWeight: 600,
    color: "#374151",
    marginBottom: 5,
  }

  // ── ローディング ─────────────────────────────────────────────────
  if (loading) {
    return (
      <div style={pageStyle}>
        <div style={cardStyle}>
          <p style={{ textAlign: "center", color: "#6b7280", padding: "40px 0" }}>読み込み中...</p>
        </div>
      </div>
    )
  }

  // ── エラー ───────────────────────────────────────────────────────
  if (loadError || !summary) {
    return (
      <div style={pageStyle}>
        <div style={cardStyle}>
          <div style={{ textAlign: "center", padding: "24px 0" }}>
            <div style={{ fontSize: 40, marginBottom: 16 }}>⚠️</div>
            <p style={{ color: "#dc2626", fontWeight: 600 }}>{loadError ?? "ページを読み込めませんでした"}</p>
            <p style={{ color: "#6b7280", fontSize: 13, marginTop: 8 }}>URLをご確認いただくか、請求書を送付した担当者までお問い合わせください。</p>
          </div>
        </div>
      </div>
    )
  }

  // ── 送信完了 ─────────────────────────────────────────────────────
  if (done || summary.already_notified) {
    return (
      <div style={pageStyle}>
        <div style={cardStyle}>
          <div style={{ textAlign: "center", padding: "16px 0 24px" }}>
            <div style={{ fontSize: 48, marginBottom: 12 }}>✅</div>
            <h1 style={{ fontSize: 20, fontWeight: 700, margin: "0 0 10px", color: "#111" }}>
              {done ? "ご連絡ありがとうございます" : "既にご連絡いただいています"}
            </h1>
            <p style={{ color: "#374151", lineHeight: 1.8, fontSize: 14, margin: "0 0 16px" }}>
              お支払い完了のご連絡を受け付けました。<br/>
              担当者が確認の上、領収書をお送りいたします。
            </p>
            {summary.client_paid_at_claimed && (
              <div style={{ background: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: 8, padding: "12px 16px", fontSize: 13, color: "#166534", textAlign: "left", display: "inline-block", minWidth: 240 }}>
                <div>振込日：{fmtDate(summary.client_paid_at_claimed)}</div>
                {summary.client_paid_amount_claimed && (
                  <div>振込金額：{fmtCur(summary.client_paid_amount_claimed)}</div>
                )}
              </div>
            )}
          </div>

          {/* 請求書情報 */}
          <div style={{ borderTop: "1px solid #e5e7eb", paddingTop: 20, marginTop: 8 }}>
            <p style={{ fontSize: 12, color: "#9ca3af", marginBottom: 6 }}>ご請求情報</p>
            {summary.invoice_no && <p style={{ fontSize: 13, color: "#374151" }}>請求書番号：{summary.invoice_no}</p>}
            <p style={{ fontSize: 13, color: "#374151" }}>ご請求金額：<strong>{fmtCur(summary.total)}</strong></p>
            {summary.issuer_name && <p style={{ fontSize: 13, color: "#6b7280", marginTop: 4 }}>発行者：{summary.issuer_name}</p>}
          </div>
        </div>
      </div>
    )
  }

  // ── メインフォーム ────────────────────────────────────────────────
  return (
    <div style={pageStyle}>
      <div style={cardStyle}>
        {/* ヘッダー */}
        <div style={{ marginBottom: 24 }}>
          <p style={{ fontSize: 12, color: "#9ca3af", marginBottom: 4 }}>
            {summary.issuer_name ? `${summary.issuer_name} より` : "請求書"}
          </p>
          <h1 style={{ fontSize: 22, fontWeight: 700, margin: "0 0 8px", color: "#111" }}>
            お支払い完了のご連絡
          </h1>
          <p style={{ fontSize: 13, color: "#6b7280", lineHeight: 1.7, margin: 0 }}>
            銀行振込が完了しましたら、下記フォームよりご連絡ください。<br/>
            担当者が確認の上、領収書をお送りいたします。
          </p>
        </div>

        {/* 請求書サマリー */}
        <div style={{ background: "#f8fafc", border: "1px solid #e5e7eb", borderRadius: 10, padding: "14px 16px", marginBottom: 24 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
            <div>
              {summary.invoice_no && <div style={{ fontSize: 12, color: "#9ca3af" }}>請求書番号：{summary.invoice_no}</div>}
              {(summary.invoice_title || summary.invoice_month) && (
                <div style={{ fontSize: 14, fontWeight: 600, color: "#111", marginTop: 2 }}>
                  {summary.invoice_title ?? `${summary.invoice_month} 分`}
                </div>
              )}
              <div style={{ fontSize: 12, color: "#6b7280", marginTop: 2 }}>
                お支払期限：<strong style={{ color: "#374151" }}>{fmtDate(summary.due_date)}</strong>
              </div>
            </div>
            <div style={{ textAlign: "right", flexShrink: 0 }}>
              <div style={{ fontSize: 11, color: "#9ca3af" }}>ご請求金額</div>
              <div style={{ fontSize: 22, fontWeight: 700, color: "#111", letterSpacing: "-0.01em" }}>
                {fmtCur(summary.total)}
              </div>
            </div>
          </div>
        </div>

        {/* フォーム */}
        <form onSubmit={(e) => void handleSubmit(e)} noValidate>
          {submitError && (
            <div style={{ background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 8, padding: "10px 14px", marginBottom: 16, color: "#dc2626", fontSize: 13 }}>
              {submitError}
            </div>
          )}

          <div style={{ display: "grid", gap: 18 }}>
            <label>
              <span style={labelStyle}>振込日 <span style={{ color: "#dc2626" }}>*</span></span>
              <input
                type="date"
                value={paidAt}
                onChange={e => setPaidAt(e.target.value)}
                required
                style={inputStyle}
              />
            </label>

            <label>
              <span style={labelStyle}>振込金額（円） <span style={{ color: "#dc2626" }}>*</span></span>
              <input
                type="number"
                value={paidAmount}
                onChange={e => setPaidAmount(e.target.value)}
                min={1}
                step={1}
                required
                placeholder={String(summary.total)}
                style={inputStyle}
              />
              <span style={{ fontSize: 12, color: "#9ca3af", marginTop: 3, display: "block" }}>
                ご請求金額：{fmtCur(summary.total)}
              </span>
            </label>

            <label>
              <span style={labelStyle}>振込名義（任意）</span>
              <input
                type="text"
                value={transferName}
                onChange={e => setTransferName(e.target.value)}
                placeholder="例：ヤマダ タロウ"
                maxLength={100}
                style={inputStyle}
              />
            </label>

            <label>
              <span style={labelStyle}>備考（任意）</span>
              <textarea
                value={note}
                onChange={e => setNote(e.target.value)}
                placeholder="分割振込など、特記事項があればご記入ください"
                maxLength={500}
                rows={3}
                style={{ ...inputStyle, resize: "vertical" }}
              />
            </label>
          </div>

          <button
            type="submit"
            disabled={submitting}
            style={{
              marginTop: 24,
              width: "100%",
              padding: "13px 0",
              borderRadius: 10,
              border: "none",
              background: submitting ? "#9ca3af" : "#1d4ed8",
              color: "#fff",
              fontSize: 15,
              fontWeight: 700,
              cursor: submitting ? "not-allowed" : "pointer",
              letterSpacing: "0.02em",
            }}
          >
            {submitting ? "送信中..." : "支払い完了を通知する"}
          </button>

          <p style={{ textAlign: "center", fontSize: 11.5, color: "#9ca3af", marginTop: 12, lineHeight: 1.6 }}>
            このフォームの情報は請求書を発行した担当者にのみ共有されます。
          </p>
        </form>
      </div>
    </div>
  )
}
