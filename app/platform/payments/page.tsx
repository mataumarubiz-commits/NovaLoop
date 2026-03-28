"use client"

import { useCallback, useEffect, useState } from "react"
import { supabase } from "@/lib/supabase"
import PlatformAdminNav from "@/components/platform/PlatformAdminNav"

type PaymentRow = {
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
}

export default function PlatformPaymentsPage() {
  const [rows, setRows] = useState<PaymentRow[]>([])
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    const token = (await supabase.auth.getSession()).data.session?.access_token
    if (!token) {
      setLoading(false)
      return
    }
    const res = await fetch("/api/platform/payments", { headers: { Authorization: `Bearer ${token}` } })
    const json = await res.json().catch(() => null)
    if (!res.ok || !json?.ok) {
      setError(json?.error ?? "入金確認一覧を取得できませんでした。")
      setRows([])
      setLoading(false)
      return
    }
    setRows(Array.isArray(json.payments) ? json.payments : [])
    setLoading(false)
  }, [])

  /* eslint-disable */
  useEffect(() => {
    void load()
  }, [load])
  /* eslint-enable */

  const markPaid = useCallback(async (id: string) => {
    const token = (await supabase.auth.getSession()).data.session?.access_token
    if (!token) return
    setBusyId(id)
    setError(null)
    const res = await fetch(`/api/platform/payments/${id}/mark-paid`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({}),
    })
    const json = await res.json().catch(() => null)
    setBusyId(null)
    if (!res.ok || !json?.ok) {
      setError(json?.error ?? "mark-paid に失敗しました。")
      return
    }
    await load()
  }, [load])

  return (
    <div style={{ padding: "32px 24px 80px", minHeight: "100vh", background: "var(--bg-grad)" }}>
      <div style={{ maxWidth: 1080, margin: "0 auto", display: "grid", gap: 16 }}>
        <header style={{ display: "grid", gap: 8 }}>
          <div style={{ fontSize: 12, color: "var(--muted)" }}>Platform admin only</div>
          <h1 style={{ margin: 0, color: "var(--text)" }}>入金確認</h1>
          {error ? <p style={{ margin: 0, color: "var(--error-text)" }}>{error}</p> : null}
        </header>

        <PlatformAdminNav />

        {loading ? <div style={{ color: "var(--muted)" }}>読み込み中...</div> : null}
        {!loading && rows.length === 0 ? <div style={{ color: "var(--muted)" }}>支払レコードはありません。</div> : null}

        {rows.map((row) => (
          <section
            key={row.id}
            style={{
              background: "var(--surface)",
              border: "1px solid var(--border)",
              borderRadius: 18,
              padding: 18,
              display: "grid",
              gap: 6,
            }}
          >
            <div>{row.request_number} / {row.invoice_number}</div>
            <div>振込識別子: {row.transfer_reference}</div>
            <div>状態: {row.status}</div>
            <div>金額: {row.amount_jpy.toLocaleString("ja-JP")}円</div>
            <div>領収書番号: {row.receipt_number ?? "-"}</div>
            <div>請求書PDF: {row.invoice_document_status ?? "-"}</div>
            <div>領収書PDF: {row.receipt_document_status ?? "-"}</div>
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
              {row.invoice_signed_url ? <a href={row.invoice_signed_url} target="_blank" rel="noreferrer">請求書PDF</a> : null}
              {row.receipt_signed_url ? <a href={row.receipt_signed_url} target="_blank" rel="noreferrer">領収書PDF</a> : null}
            </div>
            <button
              type="button"
              disabled={busyId === row.id}
              onClick={() => void markPaid(row.id)}
              style={{
                width: "fit-content",
                padding: "10px 14px",
                borderRadius: 10,
                border: "1px solid var(--primary)",
                background: "var(--primary)",
                color: "#fff",
              }}
            >
              {row.status === "paid" ? "mark-paid を再実行" : "mark-paid を実行"}
            </button>
          </section>
        ))}
      </div>
    </div>
  )
}
