"use client"

import { useCallback, useEffect, useState } from "react"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import { shouldRedirectPendingPaymentToThanks } from "@/lib/platformFlow"
import { supabase } from "@/lib/supabase"

type BillingSettings = {
  bank_name: string
  bank_branch_name: string
  bank_branch_code: string
  bank_account_type: string
  bank_account_number: string
  bank_account_holder: string
  transfer_fee_note: string
  seller_email: string
  seller_address: string
  seller_phone: string
  seller_name: string
  invoice_registration_number: string | null
  license_price_jpy: number
}

type LicenseResponse = {
  entitlement: { status: string } | null
  paymentRequests: Array<{
    id: string
    request_number: string
    invoice_number: string
    amount_jpy: number
    due_date: string | null
    transfer_reference: string
    status: string
    client_notified_at?: string | null
    client_paid_at_claimed?: string | null
    client_paid_amount_claimed?: number | null
    client_transfer_name?: string | null
    client_notify_note?: string | null
  }>
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat("ja-JP", {
    style: "currency",
    currency: "JPY",
    maximumFractionDigits: 0,
  }).format(value)
}

function formatDate(value: string | null | undefined) {
  if (!value) return "-"
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString("ja-JP")
}

export default function PendingPaymentPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [license, setLicense] = useState<LicenseResponse | null>(null)
  const [settings, setSettings] = useState<BillingSettings | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busyDoc, setBusyDoc] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [localNotified, setLocalNotified] = useState(false)
  const [paidAt, setPaidAt] = useState(new Date().toISOString().slice(0, 10))
  const [paidAmount, setPaidAmount] = useState("")
  const [transferName, setTransferName] = useState("")
  const [note, setNote] = useState("")

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    const token = (await supabase.auth.getSession()).data.session?.access_token
    if (!token) {
      router.replace("/")
      return
    }

    const [licenseRes, settingsRes] = await Promise.all([
      fetch("/api/platform/my-license", { headers: { Authorization: `Bearer ${token}` } }),
      fetch("/api/platform/payment-instructions", { headers: { Authorization: `Bearer ${token}` } }),
    ])

    const licenseJson = await licenseRes.json().catch(() => null)
    const settingsJson = await settingsRes.json().catch(() => null)

    if (!licenseRes.ok || !licenseJson?.ok) {
      setError(licenseJson?.error ?? "購入状態を取得できませんでした。")
      setLoading(false)
      return
    }
    if (!settingsRes.ok || !settingsJson?.ok) {
      setError(settingsJson?.error ?? "振込先情報を取得できませんでした。")
      setLoading(false)
      return
    }

    const nextLicense = licenseJson as LicenseResponse
    const nextPayment = nextLicense.paymentRequests?.[0]
    setLicense(nextLicense)
    setSettings(settingsJson.settings ?? null)
    if (nextPayment) {
      setPaidAmount(String(nextPayment.client_paid_amount_claimed ?? nextPayment.amount_jpy))
      setPaidAt(nextPayment.client_paid_at_claimed ?? new Date().toISOString().slice(0, 10))
      setTransferName(nextPayment.client_transfer_name ?? "")
      setNote(nextPayment.client_notify_note ?? "")
      setLocalNotified(Boolean(nextPayment.client_notified_at))
    }
    setLoading(false)
  }, [router])

  useEffect(() => {
    void load()
  }, [load])

  const payment = license?.paymentRequests?.[0]
  const alreadyNotified = localNotified || Boolean(payment?.client_notified_at)
  const isActive = shouldRedirectPendingPaymentToThanks(
    (license?.entitlement?.status as "active" | "pending_payment" | null) ?? null
  )

  useEffect(() => {
    if (loading || !isActive) return
    router.replace("/thanks?from=pending-payment")
  }, [isActive, loading, router])

  useEffect(() => {
    if (loading || isActive) return
    const intervalId = window.setInterval(() => {
      void load()
    }, 15000)
    return () => window.clearInterval(intervalId)
  }, [isActive, load, loading])

  const openReceipt = useCallback(async () => {
    if (!payment) return
    const token = (await supabase.auth.getSession()).data.session?.access_token
    if (!token) {
      router.replace("/")
      return
    }

    setBusyDoc(true)
    setError(null)
    try {
      const res = await fetch(`/api/platform/payments/${payment.id}/receipt-pdf`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      })
      const json = (await res.json().catch(() => null)) as { ok?: boolean; signed_url?: string; error?: string } | null
      if (!res.ok || !json?.ok || !json.signed_url) {
        setError(json?.error ?? "領収書PDFを開けませんでした。")
        return
      }

      window.open(json.signed_url, "_blank", "noopener,noreferrer")
    } finally {
      setBusyDoc(false)
    }
  }, [payment, router])

  const submitNotify = useCallback(async () => {
    if (!payment) return

    const amount = Number(paidAmount)
    if (!paidAt || Number.isNaN(amount) || amount <= 0) {
      setSubmitError("入金日と入金額を確認してください。")
      return
    }

    setSubmitting(true)
    setSubmitError(null)
    const token = (await supabase.auth.getSession()).data.session?.access_token
    if (!token) {
      router.replace("/")
      return
    }

    try {
      const res = await fetch(`/api/platform/payments/${payment.id}/notify`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          paid_at: paidAt,
          paid_amount: amount,
          transfer_name: transferName.trim() || null,
          note: note.trim() || null,
        }),
      })
      const json = (await res.json().catch(() => null)) as { ok?: boolean; error?: string } | null
      if (!res.ok || !json?.ok) {
        setSubmitError(json?.error ?? "入金連絡の送信に失敗しました。")
        return
      }

      setLocalNotified(true)
      await load()
    } finally {
      setSubmitting(false)
    }
  }, [load, note, paidAmount, paidAt, payment, router, transferName])

  if (loading) {
    return <div style={{ padding: 32, color: "var(--muted)" }}>読み込み中...</div>
  }

  if (!payment || !settings) {
    return (
      <div style={{ padding: 32, display: "grid", gap: 12 }}>
        <p style={{ color: "var(--muted)", margin: 0 }}>進行中の購入申請が見つかりませんでした。</p>
        <Link href="/purchase-license">ライセンス購入へ進む</Link>
      </div>
    )
  }

  return (
    <div style={{ minHeight: "100vh", background: "var(--bg-grad)", padding: "32px 24px 80px" }}>
      <div style={{ maxWidth: 920, margin: "0 auto", display: "grid", gap: 16 }}>
        <header style={{ display: "grid", gap: 8 }}>
          <div style={{ fontSize: 12, color: "var(--muted)" }}>導入フロー 2 / 3</div>
          <h1 style={{ margin: 0, fontSize: 30, color: "var(--text)" }}>入金確認</h1>
          <p style={{ margin: 0, color: "var(--muted)", lineHeight: 1.8 }}>
            振込先の確認と入金連絡をこの画面でまとめて進めます。入金確認が完了すると、自動でサンクスページへ進みます。
          </p>
          {searchParams.get("existing") === "1" ? (
            <p style={{ margin: 0, color: "var(--success-text)" }}>進行中の購入申請に合流しました。</p>
          ) : null}
          {error ? <p style={{ margin: 0, color: "var(--error-text)" }}>{error}</p> : null}
        </header>

        <section style={sectionStyle}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 16, flexWrap: "wrap", alignItems: "center" }}>
            <div>
              <div style={{ fontSize: 12, color: "var(--muted)", letterSpacing: "0.08em", textTransform: "uppercase" }}>
                License Purchase
              </div>
              <div style={{ marginTop: 6, fontSize: 24, fontWeight: 700, color: "var(--text)" }}>
                {formatCurrency(payment.amount_jpy)}
              </div>
              <div style={{ marginTop: 6, color: "var(--muted)" }}>入金期限: {formatDate(payment.due_date)}</div>
            </div>
            {payment.status === "paid" ? (
              <button
                type="button"
                onClick={() => void openReceipt()}
                disabled={busyDoc}
                style={primaryButtonStyle}
              >
                {busyDoc ? "領収書PDFを開いています..." : "領収書PDFを開く"}
              </button>
            ) : null}
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12 }}>
            <InfoCard label="申請番号" value={payment.request_number} />
            <InfoCard label="振込識別子" value={payment.transfer_reference} />
            <InfoCard label="ライセンス状態" value={license?.entitlement?.status ?? "pending_payment"} />
          </div>
        </section>

        <section style={sectionStyle}>
          <h2 style={{ margin: 0, fontSize: 18, color: "var(--text)" }}>振込先</h2>
          <div style={{ display: "grid", gap: 6, color: "var(--text)" }}>
            <div>銀行名: {settings.bank_name}</div>
            <div>支店名: {settings.bank_branch_name} ({settings.bank_branch_code})</div>
            <div>口座種別: {settings.bank_account_type}</div>
            <div>口座番号: {settings.bank_account_number}</div>
            <div>口座名義: {settings.bank_account_holder}</div>
            <div>販売者: {settings.seller_name}</div>
          </div>
          <div style={{ color: "var(--muted)", fontSize: 13 }}>{settings.transfer_fee_note}</div>
        </section>

        <section style={sectionStyle}>
          <div>
            <h2 style={{ margin: 0, fontSize: 18, color: "var(--text)" }}>入金連絡</h2>
            <p style={{ margin: "6px 0 0", color: "var(--muted)", lineHeight: 1.8 }}>
              振込後にこのフォームから連絡してください。確認が完了したら、サンクスページから初回セットアップへ進めます。
            </p>
          </div>

          {alreadyNotified ? (
            <div style={{ borderRadius: 14, border: "1px solid #bbf7d0", background: "#f0fdf4", padding: 16, display: "grid", gap: 8 }}>
              <div style={{ fontSize: 15, fontWeight: 700, color: "#166534" }}>入金連絡を受け付けました</div>
              <div style={{ color: "#166534", fontSize: 14 }}>
                管理側の確認が完了すると、この画面から自動でサンクスページへ進みます。
              </div>
              <div style={{ display: "grid", gap: 4, color: "#166534", fontSize: 13 }}>
                <div>入金日: {formatDate(payment.client_paid_at_claimed)}</div>
                <div>入金額: {formatCurrency(payment.client_paid_amount_claimed ?? payment.amount_jpy)}</div>
                {payment.client_transfer_name ? <div>振込名義: {payment.client_transfer_name}</div> : null}
              </div>
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 4 }}>
                <button
                  type="button"
                  onClick={() => void load()}
                  style={{
                    padding: "10px 14px",
                    borderRadius: 10,
                    border: "1px solid #86efac",
                    background: "#fff",
                    color: "#166534",
                    cursor: "pointer",
                    fontWeight: 700,
                  }}
                >
                  状態を更新する
                </button>
                <Link href="/settings/license" style={successLinkStyle}>
                  ライセンス情報を見る
                </Link>
              </div>
            </div>
          ) : (
            <>
              {submitError ? <div style={{ color: "var(--error-text)", fontWeight: 600 }}>{submitError}</div> : null}
              <div style={{ display: "grid", gap: 14 }}>
                <label style={{ display: "grid", gap: 6 }}>
                  <span style={labelStyle}>入金日 *</span>
                  <input type="date" value={paidAt} onChange={(event) => setPaidAt(event.target.value)} style={fieldStyle} />
                </label>
                <label style={{ display: "grid", gap: 6 }}>
                  <span style={labelStyle}>入金額 *</span>
                  <input type="number" value={paidAmount} onChange={(event) => setPaidAmount(event.target.value)} min={1} step={1} style={fieldStyle} />
                  <span style={{ fontSize: 12, color: "var(--muted)" }}>請求額: {formatCurrency(payment.amount_jpy)}</span>
                </label>
                <label style={{ display: "grid", gap: 6 }}>
                  <span style={labelStyle}>振込名義</span>
                  <input
                    type="text"
                    value={transferName}
                    onChange={(event) => setTransferName(event.target.value)}
                    maxLength={100}
                    placeholder="通帳に表示される名義"
                    style={fieldStyle}
                  />
                </label>
                <label style={{ display: "grid", gap: 6 }}>
                  <span style={labelStyle}>補足</span>
                  <textarea
                    value={note}
                    onChange={(event) => setNote(event.target.value)}
                    rows={4}
                    maxLength={500}
                    placeholder="確認してほしいことがあれば入力してください。"
                    style={{ ...fieldStyle, resize: "vertical" }}
                  />
                </label>
              </div>

              <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                <button
                  type="button"
                  onClick={() => void submitNotify()}
                  disabled={submitting}
                  style={primaryButtonStyle}
                >
                  {submitting ? "送信中..." : "入金連絡を送る"}
                </button>
                <Link href="/settings/license" style={secondaryLinkStyle}>
                  ライセンス情報を見る
                </Link>
              </div>
            </>
          )}
        </section>
      </div>
    </div>
  )
}

function InfoCard({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ background: "var(--surface-2)", border: "1px solid var(--border)", borderRadius: 14, padding: 14 }}>
      <div style={{ fontSize: 12, color: "var(--muted)" }}>{label}</div>
      <div style={{ marginTop: 6, fontSize: 16, fontWeight: 700, color: "var(--text)" }}>{value}</div>
    </div>
  )
}

const sectionStyle = {
  background: "var(--surface)",
  border: "1px solid var(--border)",
  borderRadius: 18,
  padding: 22,
  display: "grid",
  gap: 14,
} as const

const fieldStyle = {
  width: "100%",
  borderRadius: 10,
  border: "1px solid var(--border)",
  background: "var(--surface-2)",
  color: "var(--text)",
  padding: "11px 12px",
  fontSize: 14,
  boxSizing: "border-box" as const,
} as const

const labelStyle = {
  fontSize: 13,
  fontWeight: 700,
  color: "var(--text)",
} as const

const primaryButtonStyle = {
  padding: "12px 16px",
  borderRadius: 10,
  border: "none",
  background: "var(--primary)",
  color: "#fff",
  cursor: "pointer",
  fontWeight: 700,
} as const

const secondaryLinkStyle = {
  padding: "12px 16px",
  borderRadius: 10,
  border: "1px solid var(--border)",
  background: "var(--surface-2)",
  color: "var(--text)",
  textDecoration: "none",
  fontWeight: 700,
} as const

const successLinkStyle = {
  padding: "10px 14px",
  borderRadius: 10,
  background: "#166534",
  color: "#fff",
  textDecoration: "none",
  fontWeight: 700,
} as const
