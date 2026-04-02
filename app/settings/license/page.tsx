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
    invoice_document_status?: string | null
    receipt_document_status?: string | null
    invoice_signed_url?: string | null
    receipt_signed_url?: string | null
  }>
  paymentRequests: Array<{
    id: string
    request_number: string
    invoice_number?: string | null
    receipt_number?: string | null
    status: string
    invoice_document_status?: string | null
    receipt_document_status?: string | null
    invoice_signed_url?: string | null
    receipt_signed_url?: string | null
  }>
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
    const res = await fetch("/api/platform/my-license", { headers: { Authorization: `Bearer ${token}` } })
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
    // eslint-disable-next-line
    void load()
  }, [load])

  const openPaymentPdf = useCallback(async (paymentId: string, kind: "invoice" | "receipt") => {
    const token = (await supabase.auth.getSession()).data.session?.access_token
    if (!token) return
    setBusyKey(`${kind}:${paymentId}`)
    try {
      const res = await fetch(`/api/platform/payments/${paymentId}/${kind}-pdf`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      })
      const json = await res.json().catch(() => null) as { ok?: boolean; signed_url?: string; error?: string } | null
      if (!res.ok || !json?.ok || !json.signed_url) {
        setError(json?.error ?? `${kind} pdf を開けませんでした。`)
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

        <section style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 18, padding: 20, display: "grid", gap: 8 }}>
          <div>ライセンス状態: {data?.entitlement?.status ?? "未購入"}</div>
          <div>grant_type: {data?.entitlement?.grant_type ?? "-"}</div>
          <div>金額区分: {Number(data?.entitlement?.amount_total_jpy ?? 0).toLocaleString("ja-JP")}円</div>
          <div>有効化日: {data?.entitlement?.activated_at ? new Date(data.entitlement.activated_at).toLocaleString("ja-JP") : "-"}</div>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            <Link href="/request-org">新しい組織を作る</Link>
            <Link href="/recover-license">ライセンス再付与を申請する</Link>
          </div>
        </section>

        <section style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 18, padding: 20, display: "grid", gap: 10 }}>
          <h2 style={{ margin: 0, fontSize: 18 }}>購入履歴</h2>
          {(data?.purchaseRequests ?? []).length === 0 ? <div style={{ color: "var(--muted)" }}>購入履歴はありません。</div> : null}
          {(data?.purchaseRequests ?? []).map((purchase) => (
            <div key={purchase.id} style={{ borderTop: "1px solid var(--border)", paddingTop: 10, display: "grid", gap: 4 }}>
              <div>{purchase.request_number} / {purchase.invoice_number}</div>
              <div>状態: {purchase.status}</div>
              <div>請求書PDF: {purchase.invoice_document_status ?? "-"}</div>
              <div>領収書PDF: {purchase.receipt_document_status ?? "-"}</div>
              <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                {purchase.invoice_signed_url ? <a href={purchase.invoice_signed_url} target="_blank" rel="noreferrer">請求書PDF</a> : null}
                {purchase.receipt_signed_url ? <a href={purchase.receipt_signed_url} target="_blank" rel="noreferrer">領収書PDF</a> : null}
              </div>
            </div>
          ))}
        </section>

        <section style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 18, padding: 20, display: "grid", gap: 10 }}>
          <h2 style={{ margin: 0, fontSize: 18 }}>支払履歴</h2>
          {(data?.paymentRequests ?? []).length === 0 ? <div style={{ color: "var(--muted)" }}>支払履歴はありません。</div> : null}
          {(data?.paymentRequests ?? []).map((payment) => (
            <div key={payment.id} style={{ borderTop: "1px solid var(--border)", paddingTop: 10, display: "grid", gap: 4 }}>
              <div>{payment.request_number} / {payment.invoice_number ?? "-"}</div>
              <div>状態: {payment.status}</div>
              <div>領収書番号: {payment.receipt_number ?? "-"}</div>
              <div>請求書PDF: {payment.invoice_document_status ?? "-"}</div>
              <div>領収書PDF: {payment.receipt_document_status ?? "-"}</div>
              <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                <button
                  type="button"
                  onClick={() => void openPaymentPdf(payment.id, "invoice")}
                  disabled={busyKey === `invoice:${payment.id}`}
                  style={{ padding: "8px 12px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--surface-2)", color: "var(--text)", cursor: "pointer" }}
                >
                  {busyKey === `invoice:${payment.id}` ? "請求書PDF準備中..." : "請求書PDF"}
                </button>
                {payment.status === "paid" ? (
                  <button
                    type="button"
                    onClick={() => void openPaymentPdf(payment.id, "receipt")}
                    disabled={busyKey === `receipt:${payment.id}`}
                    style={{ padding: "8px 12px", borderRadius: 8, border: "1px solid var(--primary)", background: "var(--primary)", color: "#fff", cursor: "pointer" }}
                  >
                    {busyKey === `receipt:${payment.id}` ? "領収書PDF準備中..." : "領収書PDF"}
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
