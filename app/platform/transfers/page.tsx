"use client"

import { useCallback, useEffect, useState } from "react"
import { supabase } from "@/lib/supabase"
import PlatformAdminNav from "@/components/platform/PlatformAdminNav"

type TransferRow = {
  id: string
  current_google_email?: string | null
  previous_google_email?: string | null
  full_name: string
  status: string
  reason: string
}

export default function PlatformTransfersPage() {
  const [rows, setRows] = useState<TransferRow[]>([])
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
    const res = await fetch("/api/platform/transfers", { headers: { Authorization: `Bearer ${token}` } })
    const json = await res.json().catch(() => null)
    if (!res.ok || !json?.ok) {
      setError(json?.error ?? "再付与申請一覧を取得できませんでした。")
      setRows([])
      setLoading(false)
      return
    }
    setRows(Array.isArray(json.transfers) ? json.transfers : [])
    setLoading(false)
  }, [])

  /* eslint-disable */
  useEffect(() => {
    void load()
  }, [load])
  /* eslint-enable */

  const approve = useCallback(async (id: string) => {
    const token = (await supabase.auth.getSession()).data.session?.access_token
    if (!token) return
    setBusyId(id)
    setError(null)
    const res = await fetch(`/api/platform/transfers/${id}/approve`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    })
    const json = await res.json().catch(() => null)
    setBusyId(null)
    if (!res.ok || !json?.ok) {
      setError(json?.error ?? "再付与承認に失敗しました。")
      return
    }
    await load()
  }, [load])

  return (
    <div style={{ padding: "32px 24px 80px", minHeight: "100vh", background: "var(--bg-grad)" }}>
      <div style={{ maxWidth: 1080, margin: "0 auto", display: "grid", gap: 16 }}>
        <header style={{ display: "grid", gap: 8 }}>
          <div style={{ fontSize: 12, color: "var(--muted)" }}>Platform admin only</div>
          <h1 style={{ margin: 0, color: "var(--text)" }}>ライセンス再付与申請</h1>
          {error ? <p style={{ margin: 0, color: "var(--error-text)" }}>{error}</p> : null}
        </header>

        <PlatformAdminNav />

        {loading ? <div style={{ color: "var(--muted)" }}>読み込み中...</div> : null}
        {!loading && rows.length === 0 ? <div style={{ color: "var(--muted)" }}>再付与申請はありません。</div> : null}

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
            <div>{row.full_name}</div>
            <div>現在のGoogleメール: {row.current_google_email || "-"}</div>
            <div>以前のGoogleメール: {row.previous_google_email || "-"}</div>
            <div>状態: {row.status}</div>
            <div>理由: {row.reason}</div>
            <button
              type="button"
              disabled={row.status !== "pending" || busyId === row.id}
              onClick={() => void approve(row.id)}
              style={{
                width: "fit-content",
                padding: "10px 14px",
                borderRadius: 10,
                border: "1px solid var(--primary)",
                background: "var(--primary)",
                color: "#fff",
              }}
            >
              承認して移管する
            </button>
          </section>
        ))}
      </div>
    </div>
  )
}
