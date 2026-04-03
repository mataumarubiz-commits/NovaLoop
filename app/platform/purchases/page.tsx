"use client"

import { useCallback, useEffect, useState } from "react"
import { supabase } from "@/lib/supabase"
import PlatformAdminNav from "@/components/platform/PlatformAdminNav"

type PurchaseRow = {
  id: string
  request_number: string
  invoice_number: string
  full_name: string
  company_name?: string | null
  status: string
  license_price_jpy: number
  receipt_document_status?: string | null
  receipt_signed_url?: string | null
}

export default function PlatformPurchasesPage() {
  const [rows, setRows] = useState<PurchaseRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    const token = (await supabase.auth.getSession()).data.session?.access_token
    if (!token) {
      setLoading(false)
      return
    }
    const res = await fetch("/api/platform/purchases", { headers: { Authorization: `Bearer ${token}` } })
    const json = await res.json().catch(() => null)
    if (!res.ok || !json?.ok) {
      setError(json?.error ?? "購入申請一覧を取得できませんでした。")
      setRows([])
      setLoading(false)
      return
    }
    setRows(Array.isArray(json.purchases) ? json.purchases : [])
    setLoading(false)
  }, [])

  /* eslint-disable */
  useEffect(() => {
    void load()
  }, [load])
  /* eslint-enable */

  return (
    <div style={{ padding: "32px 24px 80px", minHeight: "100vh", background: "var(--bg-grad)" }}>
      <div style={{ maxWidth: 1080, margin: "0 auto", display: "grid", gap: 16 }}>
        <header style={{ display: "grid", gap: 8 }}>
          <div style={{ fontSize: 12, color: "var(--muted)" }}>Platform admin only</div>
          <h1 style={{ margin: 0, color: "var(--text)" }}>購入申請一覧</h1>
          {error ? <p style={{ margin: 0, color: "var(--error-text)" }}>{error}</p> : null}
        </header>

        <PlatformAdminNav />

        {loading ? <div style={{ color: "var(--muted)" }}>読み込み中...</div> : null}
        {!loading && rows.length === 0 ? <div style={{ color: "var(--muted)" }}>購入申請はありません。</div> : null}

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
            <div>宛名: {row.company_name || row.full_name}</div>
            <div>状態: {row.status}</div>
            <div>金額: {row.license_price_jpy.toLocaleString("ja-JP")}円</div>
            <div>領収書PDF: {row.receipt_document_status ?? "-"}</div>
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
              {row.receipt_signed_url ? <a href={row.receipt_signed_url} target="_blank" rel="noreferrer">領収書PDF</a> : null}
            </div>
          </section>
        ))}
      </div>
    </div>
  )
}
