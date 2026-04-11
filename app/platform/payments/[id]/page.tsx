"use client"

import { use, useCallback, useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { supabase } from "@/lib/supabase"
import PlatformAdminNav from "@/components/platform/PlatformAdminNav"

type PaymentDetail = {
  id: string
  request_number: string
  invoice_number: string
  receipt_number?: string | null
  status: string
  amount_jpy: number
  transfer_reference: string
  payment_provider?: string | null
  payment_channel?: string | null
  external_payment_id?: string | null
  latest_checkout_status?: string | null
  receipt_document_status?: string | null
  client_notified_at?: string | null
  client_paid_at_claimed?: string | null
  client_paid_amount_claimed?: number | null
  client_transfer_name?: string | null
  client_notify_note?: string | null
  receipt_signed_url?: string | null
  purchase?: {
    full_name: string | null
    company_name: string | null
    contact_email: string | null
    google_email: string | null
    address: string | null
    phone: string | null
    note: string | null
    receipt_name?: string | null
    billing_email?: string | null
    billing_address?: string | null
  } | null
  entitlement?: {
    status: string
    grant_type: string
    activated_at: string | null
  } | null
}

export default function PlatformPaymentDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const router = useRouter()
  const [detail, setDetail] = useState<PaymentDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    const token = (await supabase.auth.getSession()).data.session?.access_token
    if (!token) {
      setLoading(false)
      return
    }

    const res = await fetch(`/api/platform/payments/${id}`, { headers: { Authorization: `Bearer ${token}` } })
    const json = await res.json().catch(() => null)
    if (!res.ok || !json?.ok) {
      setError(json?.error ?? "決済詳細の取得に失敗しました。")
      setDetail(null)
      setLoading(false)
      return
    }

    setDetail(json.payment)
    setLoading(false)
  }, [id])

  useEffect(() => {
    const timer = setTimeout(() => {
      void load()
    }, 0)
    return () => clearTimeout(timer)
  }, [load])

  const markPaid = async () => {
    const token = (await supabase.auth.getSession()).data.session?.access_token
    if (!token) return
    setBusy(true)
    setError(null)
    const res = await fetch(`/api/platform/payments/${id}/mark-paid`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({}),
    })
    const json = await res.json().catch(() => null)
    setBusy(false)
    if (!res.ok || !json?.ok) {
      setError(json?.error ?? "mark-paid に失敗しました。")
      return
    }
    await load()
  }

  return (
    <div style={{ padding: "32px 24px 80px", minHeight: "100vh", background: "var(--bg-grad)" }}>
      <div style={{ maxWidth: 1080, margin: "0 auto", display: "grid", gap: 16 }}>
        <header style={{ display: "grid", gap: 8 }}>
          <div style={{ fontSize: 12, color: "var(--muted)" }}>Platform admin only</div>
          <h1 style={{ margin: 0, color: "var(--text)" }}>決済詳細</h1>
          {error ? <p style={{ margin: 0, color: "var(--error-text)" }}>{error}</p> : null}
        </header>

        <PlatformAdminNav />

        <div>
          <button
            type="button"
            onClick={() => router.back()}
            style={{
              padding: "8px 14px",
              borderRadius: 8,
              border: "1px solid var(--border)",
              background: "var(--surface)",
              color: "var(--text)",
              cursor: "pointer",
            }}
          >
            ← 一覧へ戻る
          </button>
        </div>

        {loading ? (
          <div style={{ color: "var(--muted)" }}>読み込み中...</div>
        ) : !detail ? (
          <div style={{ color: "var(--muted)" }}>データが見つかりません。</div>
        ) : (
          <div style={{ display: "grid", gap: 16 }}>
            <section style={sectionStyle}>
              <h2 style={sectionTitleStyle}>決済情報</h2>
              <div style={infoGridStyle}>
                <InfoRow label="購入番号" value={detail.request_number} />
                <InfoRow label="請求書番号" value={detail.invoice_number} />
                <InfoRow label="振込識別子" value={detail.transfer_reference} />
                <InfoRow label="支払い状態" value={detail.status === "paid" ? "入金確認済み" : detail.status} />
                <InfoRow label="payment provider" value={detail.payment_provider ?? "-"} />
                <InfoRow label="payment channel" value={detail.payment_channel ?? "-"} />
                <InfoRow label="checkout status" value={detail.latest_checkout_status ?? "-"} />
                <InfoRow label="external payment id" value={detail.external_payment_id ?? "-"} />
                <InfoRow label="ライセンス状態" value={detail.entitlement?.status ?? "-"} />
                <InfoRow label="金額" value={`${detail.amount_jpy.toLocaleString("ja-JP")}円`} />
              </div>
            </section>

            <section style={sectionStyle}>
              <h2 style={sectionTitleStyle}>購入者情報</h2>
              {detail.purchase ? (
                <div style={infoGridStyle}>
                  <InfoRow label="会社名" value={detail.purchase.company_name || "-"} />
                  <InfoRow label="氏名" value={detail.purchase.full_name || "-"} />
                  <InfoRow label="領収書名義" value={detail.purchase.receipt_name || "-"} />
                  <InfoRow label="連絡先メール" value={detail.purchase.contact_email || "-"} />
                  <InfoRow label="請求先メール" value={detail.purchase.billing_email || "-"} />
                  <InfoRow label="Google アカウント" value={detail.purchase.google_email || "-"} />
                  <InfoRow label="電話番号" value={detail.purchase.phone || "-"} />
                  <InfoRow label="住所" value={detail.purchase.address || "-"} />
                  <InfoRow label="請求先住所" value={detail.purchase.billing_address || "-"} />
                  <InfoRow label="備考" value={detail.purchase.note || "-"} />
                </div>
              ) : (
                <div style={{ color: "var(--muted)" }}>購入者情報はありません。</div>
              )}
            </section>

            <section style={sectionStyle}>
              <h2 style={sectionTitleStyle}>購入者からの入金連絡</h2>
              {detail.client_notified_at ? (
                <div style={infoGridStyle}>
                  <InfoRow label="受信時刻" value={detail.client_notified_at} />
                  <InfoRow label="振込日" value={detail.client_paid_at_claimed || "-"} />
                  <InfoRow
                    label="振込金額"
                    value={detail.client_paid_amount_claimed != null ? `${detail.client_paid_amount_claimed.toLocaleString("ja-JP")}円` : "-"}
                  />
                  <InfoRow label="振込名義" value={detail.client_transfer_name || "-"} />
                  <InfoRow label="備考" value={detail.client_notify_note || "-"} />
                </div>
              ) : (
                <div style={{ color: "var(--muted)" }}>購入者からの入金連絡はまだありません。</div>
              )}
            </section>

            <section style={sectionStyle}>
              <h2 style={sectionTitleStyle}>ドキュメントと反映</h2>
              <div style={infoGridStyle}>
                <InfoRow label="領収書番号" value={detail.receipt_number ?? "-"} />
                <InfoRow label="領収書PDF" value={detail.receipt_document_status ?? "-"} />
              </div>
              <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                {detail.receipt_signed_url ? (
                  <a href={detail.receipt_signed_url} target="_blank" rel="noreferrer" style={linkStyle}>
                    領収書PDFを表示
                  </a>
                ) : null}
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void markPaid()}
                  style={{
                    padding: "12px 24px",
                    borderRadius: 10,
                    border: "none",
                    background: detail.status === "paid" ? "var(--surface-3)" : "var(--primary)",
                    color: detail.status === "paid" ? "var(--text)" : "#fff",
                    fontWeight: 700,
                    cursor: busy ? "not-allowed" : "pointer",
                  }}
                >
                  {busy ? "処理中..." : detail.status === "paid" ? "mark-paid 再実行" : "mark-paid 実行"}
                </button>
              </div>
              {detail.status !== "paid" ? (
                <div style={{ fontSize: 13, color: "var(--muted)" }}>
                  手動確定すると status を paid に更新し、領収書 PDF を生成します。
                </div>
              ) : null}
            </section>
          </div>
        )}
      </div>
    </div>
  )
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <>
      <div style={{ color: "var(--muted)" }}>{label}</div>
      <div>{value}</div>
    </>
  )
}

const sectionStyle = {
  background: "var(--surface)",
  border: "1px solid var(--border)",
  borderRadius: 18,
  padding: 24,
  display: "grid",
  gap: 12,
} as const

const sectionTitleStyle = { fontSize: 18, margin: 0 } as const

const infoGridStyle = {
  display: "grid",
  gridTemplateColumns: "160px 1fr",
  gap: "8px 16px",
} as const

const linkStyle = {
  color: "var(--primary)",
  textDecoration: "none",
  fontWeight: 700,
} as const
