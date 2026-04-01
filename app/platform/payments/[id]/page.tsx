"use client"

import { useCallback, useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { supabase } from "@/lib/supabase"
import PlatformAdminNav from "@/components/platform/PlatformAdminNav"
import { use } from "react"

type PaymentDetail = {
  id: string
  request_number: string
  invoice_number: string
  receipt_number?: string | null
  status: string
  amount_jpy: number
  transfer_reference: string
  invoice_document_status?: string | null
  receipt_document_status?: string | null
  invoice_signed_url?: string | null
  receipt_signed_url?: string | null
  purchase?: {
    full_name: string | null
    company_name: string | null
    contact_email: string | null
    google_email: string | null
    address: string | null
    phone: string | null
    note: string | null
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
      setError(json?.error ?? "支払詳細を取得できませんでした。")
      setDetail(null)
      setLoading(false)
      return
    }
    setDetail(json.payment)
    setLoading(false)
  }, [id])

  /* eslint-disable */
  useEffect(() => {
    void load()
  }, [load])
  /* eslint-enable */

  const markPaid = async () => {
    if (!id) return
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
          <h1 style={{ margin: 0, color: "var(--text)" }}>支払申請の詳細</h1>
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
            &larr; 一覧へ戻る
          </button>
        </div>

        {loading ? (
          <div style={{ color: "var(--muted)" }}>読み込み中...</div>
        ) : !detail ? (
          <div style={{ color: "var(--muted)" }}>データが見つかりません。</div>
        ) : (
          <div style={{ display: "grid", gap: 16 }}>
            <section
              style={{
                background: "var(--surface)",
                border: "1px solid var(--border)",
                borderRadius: 18,
                padding: 24,
                display: "grid",
                gap: 12,
              }}
            >
              <h2 style={{ fontSize: 18, margin: 0 }}>申請基本情報</h2>
              <div style={{ display: "grid", gridTemplateColumns: "140px 1fr", gap: "8px 16px" }}>
                <div style={{ color: "var(--muted)" }}>リクエスト番号</div>
                <div>{detail.request_number}</div>
                
                <div style={{ color: "var(--muted)" }}>請求書番号</div>
                <div>{detail.invoice_number}</div>
                
                <div style={{ color: "var(--muted)" }}>振込識別子</div>
                <div style={{ fontWeight: 600 }}>{detail.transfer_reference}</div>
                
                <div style={{ color: "var(--muted)" }}>支払ステータス</div>
                <div>
                  {detail.status === "paid" ? (
                    <span style={{ color: "var(--success-text)", fontWeight: 600 }}>入金確認済み (Paid)</span>
                  ) : (
                    <span style={{ color: "var(--warning-text)", fontWeight: 600 }}>{detail.status}</span>
                  )}
                </div>

                <div style={{ color: "var(--muted)" }}>権利ステータス</div>
                <div>
                  {detail.entitlement?.status === "active" ? (
                    <span style={{ color: "var(--success-text)", fontWeight: 600 }}>利用可能 (Active)</span>
                  ) : (
                    <span style={{ color: "var(--warning-text)", fontWeight: 600 }}>{detail.entitlement?.status ?? "不明"}</span>
                  )}
                </div>
                
                <div style={{ color: "var(--muted)" }}>金額</div>
                <div>{detail.amount_jpy.toLocaleString("ja-JP")}円</div>
              </div>
            </section>

            <section
              style={{
                background: "var(--surface)",
                border: "1px solid var(--border)",
                borderRadius: 18,
                padding: 24,
                display: "grid",
                gap: 12,
              }}
            >
              <h2 style={{ fontSize: 18, margin: 0 }}>申込者情報</h2>
              {detail.purchase ? (
                <div style={{ display: "grid", gridTemplateColumns: "140px 1fr", gap: "8px 16px" }}>
                  <div style={{ color: "var(--muted)" }}>会社名</div>
                  <div>{detail.purchase.company_name || "-"}</div>

                  <div style={{ color: "var(--muted)" }}>氏名</div>
                  <div>{detail.purchase.full_name || "-"}</div>

                  <div style={{ color: "var(--muted)" }}>連絡先メール</div>
                  <div>{detail.purchase.contact_email}</div>

                  <div style={{ color: "var(--muted)" }}>Googleアカウント</div>
                  <div>{detail.purchase.google_email}</div>

                  <div style={{ color: "var(--muted)" }}>電話番号</div>
                  <div>{detail.purchase.phone}</div>

                  <div style={{ color: "var(--muted)" }}>住所</div>
                  <div>{detail.purchase.address}</div>

                  <div style={{ color: "var(--muted)" }}>備考</div>
                  <div>{detail.purchase.note || "-"}</div>
                </div>
              ) : (
                <div style={{ color: "var(--muted)" }}>申込者情報がありません</div>
              )}
            </section>

            <section
              style={{
                background: "var(--surface)",
                border: "1px solid var(--border)",
                borderRadius: 18,
                padding: 24,
                display: "grid",
                gap: 12,
              }}
            >
              <h2 style={{ fontSize: 18, margin: 0 }}>ドキュメント・操作</h2>
              <div style={{ display: "grid", gridTemplateColumns: "140px 1fr", gap: "8px 16px", alignItems: "center" }}>
                <div style={{ color: "var(--muted)" }}>請求書PDF</div>
                <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
                  <span>{detail.invoice_document_status ?? "-"}</span>
                  {detail.invoice_signed_url && (
                    <a href={detail.invoice_signed_url} target="_blank" rel="noreferrer" style={{ color: "var(--primary)" }}>表示</a>
                  )}
                </div>

                <div style={{ color: "var(--muted)" }}>領収書番号</div>
                <div>{detail.receipt_number ?? "-"}</div>

                <div style={{ color: "var(--muted)" }}>領収書PDF</div>
                <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
                  <span>{detail.receipt_document_status ?? "-"}</span>
                  {detail.receipt_signed_url && (
                    <a href={detail.receipt_signed_url} target="_blank" rel="noreferrer" style={{ color: "var(--primary)" }}>表示</a>
                  )}
                </div>

                <div style={{ color: "var(--muted)", paddingTop: 16 }}>アクション</div>
                <div style={{ paddingTop: 16 }}>
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
                      fontWeight: 600,
                      cursor: busy ? "not-allowed" : "pointer",
                    }}
                  >
                    {busy ? "処理中..." : detail.status === "paid" ? "mark-paid を再実行" : "mark-paid を実行"}
                  </button>
                  {detail.status !== "paid" && (
                    <div style={{ fontSize: 13, color: "var(--muted)", marginTop: 6 }}>
                      実行するとステータスが paid / active に変更され、領収書と通知が発行されます。
                    </div>
                  )}
                </div>
              </div>
            </section>
          </div>
        )}
      </div>
    </div>
  )
}
