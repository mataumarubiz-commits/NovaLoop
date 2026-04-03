"use client"

import { useCallback, useEffect, useState } from "react"
import Link from "next/link"
import { supabase } from "@/lib/supabase"

type LicenseResponse = {
  entitlement: {
    status: string
    grant_type?: string | null
    activated_at?: string | null
    amount_total_jpy?: number | null
  } | null
  purchaseRequests: Array<{
    id: string
    request_number: string
    invoice_number: string
    status: string
    receipt_document_status?: string | null
    receipt_signed_url?: string | null
  }>
  paymentRequests: Array<{
    id: string
    request_number: string
    invoice_number?: string | null
    receipt_number?: string | null
    status: string
    receipt_document_status?: string | null
    receipt_signed_url?: string | null
  }>
  receipts: Array<{
    id: string
    receipt_number: string
    purchaser_company_name?: string | null
    purchaser_name: string
    total_amount: number
    issued_at: string
    paid_at: string
    receipt_signed_url?: string | null
  }>
}

function formatDateTime(value: string | null | undefined) {
  if (!value) return "-"
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString("ja-JP")
}

export default function LicenseSettingsPage() {
  const [data, setData] = useState<LicenseResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busyKey, setBusyKey] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    const token = (await supabase.auth.getSession()).data.session?.access_token
    if (!token) return

    const res = await fetch("/api/platform/my-license", {
      headers: { Authorization: `Bearer ${token}` },
    })
    const json = await res.json().catch(() => null)
    if (!res.ok || !json?.ok) {
      setError(json?.error ?? "ライセンス情報を取得できませんでした。")
      setLoading(false)
      return
    }

    setData(json)
    setLoading(false)
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const openPaymentPdf = useCallback(async (paymentId: string) => {
    const token = (await supabase.auth.getSession()).data.session?.access_token
    if (!token) return

    setBusyKey(`receipt:${paymentId}`)
    try {
      const res = await fetch(`/api/platform/payments/${paymentId}/receipt-pdf`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      })
      const json = await res.json().catch(() => null) as { ok?: boolean; signed_url?: string; error?: string } | null
      if (!res.ok || !json?.ok || !json.signed_url) {
        setError(json?.error ?? "領収書PDFを開けませんでした。")
        return
      }

      window.open(json.signed_url, "_blank", "noopener,noreferrer")
    } finally {
      setBusyKey(null)
    }
  }, [])

  if (loading) {
    return <div style={{ padding: 32, color: "var(--muted)" }}>読み込み中...</div>
  }

  return (
    <div style={{ minHeight: "100vh", background: "var(--bg-grad)", padding: "32px 24px 80px" }}>
      <div style={{ maxWidth: 920, margin: "0 auto", display: "grid", gap: 16 }}>
        <header style={{ display: "grid", gap: 8 }}>
          <div style={{ fontSize: 12, color: "var(--muted)" }}>Platform License</div>
          <h1 style={{ margin: 0, fontSize: 30, color: "var(--text)" }}>ライセンス設定</h1>
          {error ? <p style={{ margin: 0, color: "var(--error-text)" }}>{error}</p> : null}
        </header>

        <section style={sectionStyle}>
          <div>ライセンス状態: {data?.entitlement?.status ?? "未購入"}</div>
          <div>grant_type: {data?.entitlement?.grant_type ?? "-"}</div>
          <div>金額合計: {Number(data?.entitlement?.amount_total_jpy ?? 0).toLocaleString("ja-JP")}円</div>
          <div>有効化日時: {formatDateTime(data?.entitlement?.activated_at)}</div>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            <Link href="/request-org">新しい組織を作成</Link>
            <Link href="/recover-license">ライセンス移管を申請</Link>
          </div>
        </section>

        <section style={sectionStyle}>
          <h2 style={sectionTitleStyle}>発行済み領収書</h2>
          {(data?.receipts ?? []).length === 0 ? <div style={{ color: "var(--muted)" }}>領収書はまだありません。</div> : null}
          {(data?.receipts ?? []).map((receipt) => (
            <div key={receipt.id} style={rowStyle}>
              <div>{receipt.receipt_number}</div>
              <div>
                宛名: {receipt.purchaser_company_name ? `${receipt.purchaser_company_name} / ` : ""}
                {receipt.purchaser_name}
              </div>
              <div>金額: {Number(receipt.total_amount ?? 0).toLocaleString("ja-JP")}円</div>
              <div>発行日: {formatDateTime(receipt.issued_at)}</div>
              <div>入金日: {formatDateTime(receipt.paid_at)}</div>
              <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                {receipt.receipt_signed_url ? (
                  <a href={receipt.receipt_signed_url} target="_blank" rel="noreferrer">
                    領収書PDF
                  </a>
                ) : null}
              </div>
            </div>
          ))}
        </section>

        <section style={sectionStyle}>
          <h2 style={sectionTitleStyle}>購入申請履歴</h2>
          {(data?.purchaseRequests ?? []).length === 0 ? <div style={{ color: "var(--muted)" }}>購入申請履歴はありません。</div> : null}
          {(data?.purchaseRequests ?? []).map((purchase) => (
            <div key={purchase.id} style={rowStyle}>
              <div>{purchase.request_number} / {purchase.invoice_number}</div>
              <div>状態: {purchase.status}</div>
              <div>領収書PDF: {purchase.receipt_document_status ?? "-"}</div>
              <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                {purchase.receipt_signed_url ? (
                  <a href={purchase.receipt_signed_url} target="_blank" rel="noreferrer">
                    領収書PDF
                  </a>
                ) : null}
              </div>
            </div>
          ))}
        </section>

        <section style={sectionStyle}>
          <h2 style={sectionTitleStyle}>入金履歴</h2>
          {(data?.paymentRequests ?? []).length === 0 ? <div style={{ color: "var(--muted)" }}>入金履歴はありません。</div> : null}
          {(data?.paymentRequests ?? []).map((payment) => (
            <div key={payment.id} style={rowStyle}>
              <div>{payment.request_number} / {payment.invoice_number ?? "-"}</div>
              <div>状態: {payment.status}</div>
              <div>領収書番号: {payment.receipt_number ?? "-"}</div>
              <div>領収書PDF: {payment.receipt_document_status ?? "-"}</div>
              <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                {payment.status === "paid" ? (
                  <button
                    type="button"
                    onClick={() => void openPaymentPdf(payment.id)}
                    disabled={busyKey === `receipt:${payment.id}`}
                    style={buttonStyle}
                  >
                    {busyKey === `receipt:${payment.id}` ? "領収書PDF取得中..." : "領収書PDF"}
                  </button>
                ) : null}
              </div>
            </div>
          ))}
        </section>
      </div>
    </div>
  )
}

const sectionStyle = {
  background: "var(--surface)",
  border: "1px solid var(--border)",
  borderRadius: 18,
  padding: 20,
  display: "grid",
  gap: 10,
} as const

const sectionTitleStyle = {
  margin: 0,
  fontSize: 18,
} as const

const rowStyle = {
  borderTop: "1px solid var(--border)",
  paddingTop: 10,
  display: "grid",
  gap: 4,
} as const

const buttonStyle = {
  padding: "8px 12px",
  borderRadius: 8,
  border: "1px solid var(--primary)",
  background: "var(--primary)",
  color: "#fff",
  cursor: "pointer",
} as const
