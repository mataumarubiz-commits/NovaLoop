"use client"

import { useCallback, useEffect, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { supabase } from "@/lib/supabase"
import PlatformAdminNav from "@/components/platform/PlatformAdminNav"

type ReceiptRow = {
  id: string
  receipt_number: string
  purchaser_company_name?: string | null
  purchaser_name: string
  purchaser_email?: string | null
  total_amount: number
  issued_at: string
  paid_at: string
  status: string
  pdf_path?: string | null
  signed_url?: string | null
  payment?: {
    request_number?: string | null
    invoice_number?: string | null
  } | null
}

function formatDateTime(value: string) {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString("ja-JP")
}

export default function PlatformReceiptsPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const q = searchParams.get("q") ?? ""

  const [queryInput, setQueryInput] = useState(q)
  const [rows, setRows] = useState<ReceiptRow[]>([])
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

    const params = new URLSearchParams()
    if (q) params.set("q", q)
    const res = await fetch(`/api/platform/receipts?${params.toString()}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    const json = await res.json().catch(() => null)
    if (!res.ok || !json?.ok) {
      setError(json?.error ?? "領収書一覧を取得できませんでした。")
      setRows([])
      setLoading(false)
      return
    }

    setRows(Array.isArray(json.receipts) ? json.receipts : [])
    setLoading(false)
  }, [q])

  useEffect(() => {
    queueMicrotask(() => {
      void load()
    })
  }, [load])

  return (
    <div style={{ padding: "32px 24px 80px", minHeight: "100vh", background: "var(--bg-grad)" }}>
      <div style={{ maxWidth: 1080, margin: "0 auto", display: "grid", gap: 16 }}>
        <header style={{ display: "grid", gap: 8 }}>
          <div style={{ fontSize: 12, color: "var(--muted)" }}>Platform admin only</div>
          <h1 style={{ margin: 0, color: "var(--text)" }}>領収書一覧</h1>
          {error ? <p style={{ margin: 0, color: "var(--error-text)" }}>{error}</p> : null}
        </header>

        <PlatformAdminNav />

        <form
          onSubmit={(event) => {
            event.preventDefault()
            const url = new URL(window.location.href)
            if (queryInput.trim()) {
              url.searchParams.set("q", queryInput.trim())
            } else {
              url.searchParams.delete("q")
            }
            router.push(url.pathname + url.search)
          }}
          style={{ display: "flex", gap: 8 }}
        >
          <input
            type="search"
            value={queryInput}
            onChange={(event) => setQueryInput(event.target.value)}
            placeholder="領収書番号 / 宛名 / メールアドレス"
            style={{
              flex: 1,
              padding: "10px 14px",
              borderRadius: 10,
              border: "1px solid var(--border)",
              background: "var(--surface)",
              color: "var(--text)",
            }}
          />
          <button
            type="submit"
            style={{
              padding: "10px 18px",
              borderRadius: 10,
              border: "1px solid var(--border)",
              background: "var(--surface)",
              color: "var(--text)",
              cursor: "pointer",
            }}
          >
            検索
          </button>
        </form>

        {loading ? <div style={{ color: "var(--muted)" }}>読み込み中...</div> : null}
        {!loading && rows.length === 0 ? <div style={{ color: "var(--muted)" }}>領収書はまだありません。</div> : null}

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
            <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
              <strong>{row.receipt_number}</strong>
              <span style={{ color: "var(--muted)" }}>{row.status}</span>
            </div>
            <div>
              宛名: {row.purchaser_company_name ? `${row.purchaser_company_name} / ` : ""}
              {row.purchaser_name}
            </div>
            <div>メール: {row.purchaser_email ?? "-"}</div>
            <div>金額: {Number(row.total_amount ?? 0).toLocaleString("ja-JP")}円</div>
            <div>発行日: {formatDateTime(row.issued_at)}</div>
            <div>入金日: {formatDateTime(row.paid_at)}</div>
            <div>申請番号: {row.payment?.request_number ?? "-"}</div>
            <div>請求番号: {row.payment?.invoice_number ?? "-"}</div>
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
              {row.signed_url ? (
                <a href={row.signed_url} target="_blank" rel="noreferrer">
                  PDFを開く
                </a>
              ) : null}
            </div>
          </section>
        ))}
      </div>
    </div>
  )
}
