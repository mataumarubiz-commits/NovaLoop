"use client"

import { useCallback, useEffect, useState } from "react"
import Link from "next/link"
import { supabase } from "@/lib/supabase"
import { useAuthOrg } from "@/hooks/useAuthOrg"

type Status = "ok" | "warning" | "error"
type HealthCheck = {
  id: string
  label: string
  status: Status
  detail: string
}

const cardStyle: React.CSSProperties = {
  background: "var(--surface)",
  borderRadius: 16,
  border: "1px solid var(--border)",
  padding: 20,
}

export default function HealthSettingsPage() {
  const { activeOrgId, role, loading, needsOnboarding } = useAuthOrg({ redirectToOnboarding: true })
  const [running, setRunning] = useState(false)
  const [checks, setChecks] = useState<HealthCheck[]>([])
  const [summary, setSummary] = useState({ ok: 0, warning: 0, error: 0 })
  const [error, setError] = useState<string | null>(null)

  const canUse = role === "owner" || role === "executive_assistant"

  const runChecks = useCallback(async () => {
    if (!activeOrgId || !canUse) return
    setRunning(true)
    setError(null)

    const token = (await supabase.auth.getSession()).data.session?.access_token
    if (!token) {
      setError("ログインし直してから再実行してください。")
      setRunning(false)
      return
    }

    const res = await fetch("/api/settings/health", {
      headers: { Authorization: `Bearer ${token}` },
    })
    const json = await res.json().catch(() => null)
    if (!res.ok || !json?.ok) {
      setError(json?.error ?? "Health の取得に失敗しました。")
      setChecks([])
      setSummary({ ok: 0, warning: 0, error: 0 })
    } else {
      setChecks((json.checks ?? []) as HealthCheck[])
      setSummary((json.summary ?? { ok: 0, warning: 0, error: 0 }) as { ok: number; warning: number; error: number })
    }
    setRunning(false)
  }, [activeOrgId, canUse])

  useEffect(() => {
    queueMicrotask(() => {
      void runChecks()
    })
  }, [runChecks])

  const badgeStyle = (status: Status): React.CSSProperties => ({
    display: "inline-flex",
    alignItems: "center",
    padding: "4px 10px",
    borderRadius: 999,
    fontSize: 12,
    fontWeight: 700,
    background:
      status === "ok" ? "#dcfce7" : status === "warning" ? "#fef3c7" : "#fee2e2",
    color:
      status === "ok" ? "#166534" : status === "warning" ? "#92400e" : "#b91c1c",
  })

  if (loading) {
    return <div style={{ padding: 32, color: "var(--muted)" }}>読み込み中...</div>
  }

  if (!activeOrgId || needsOnboarding) {
    return (
      <div style={{ padding: 32 }}>
        <p style={{ color: "var(--muted)", marginBottom: 12 }}>ワークスペースを選択してから確認してください。</p>
        <Link href="/settings" style={{ color: "var(--primary)" }}>設定へ戻る</Link>
      </div>
    )
  }

  if (!canUse) {
    return (
      <div style={{ padding: 32 }}>
        <h1 style={{ fontSize: 24, marginBottom: 8 }}>Health</h1>
        <p style={{ color: "var(--muted)" }}>owner / executive_assistant のみ確認できます。</p>
      </div>
    )
  }

  return (
    <div style={{ padding: "32px 40px", minHeight: "100vh", background: "var(--bg-grad)" }}>
      <div style={{ maxWidth: 980, margin: "0 auto", display: "grid", gap: 16 }}>
        <header style={{ display: "flex", justifyContent: "space-between", gap: 16, flexWrap: "wrap", alignItems: "center" }}>
          <div>
            <h1 style={{ fontSize: 28, color: "var(--text)", margin: 0 }}>Health</h1>
            <p style={{ fontSize: 13, color: "var(--muted)", marginTop: 8 }}>
              主要データ、Storage、export / import の疎通をまとめて確認します。
            </p>
          </div>
          <button
            type="button"
            onClick={() => void runChecks()}
            disabled={running}
            style={{
              padding: "10px 16px",
              borderRadius: 10,
              border: "1px solid var(--border)",
              background: "var(--surface)",
              fontWeight: 600,
              cursor: running ? "wait" : "pointer",
            }}
          >
            {running ? "再実行中..." : "再実行"}
          </button>
        </header>

        <section style={{ ...cardStyle, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 12 }}>
          <div>
            <div style={{ fontSize: 12, color: "var(--muted)" }}>OK</div>
            <div style={{ fontSize: 28, fontWeight: 700, color: "var(--text)" }}>{summary.ok}</div>
          </div>
          <div>
            <div style={{ fontSize: 12, color: "var(--muted)" }}>Warning</div>
            <div style={{ fontSize: 28, fontWeight: 700, color: "#92400e" }}>{summary.warning}</div>
          </div>
          <div>
            <div style={{ fontSize: 12, color: "var(--muted)" }}>Error</div>
            <div style={{ fontSize: 28, fontWeight: 700, color: "#b91c1c" }}>{summary.error}</div>
          </div>
        </section>

        {error && (
          <section style={{ ...cardStyle, borderColor: "#fecaca", background: "#fff1f2", color: "#b91c1c" }}>
            {error}
          </section>
        )}

        <section style={cardStyle}>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
              <thead>
                <tr style={{ borderBottom: "1px solid var(--border)", textAlign: "left" }}>
                  <th style={{ padding: "10px 0" }}>項目</th>
                  <th style={{ padding: "10px 12px" }}>状態</th>
                  <th style={{ padding: "10px 0" }}>ヒント</th>
                </tr>
              </thead>
              <tbody>
                {checks.map((check) => (
                  <tr key={check.id} style={{ borderBottom: "1px solid var(--border)" }}>
                    <td style={{ padding: "12px 0", fontWeight: 600 }}>{check.label}</td>
                    <td style={{ padding: "12px 12px" }}>
                      <span style={badgeStyle(check.status)}>
                        {check.status === "ok" ? "OK" : check.status === "warning" ? "Warning" : "Error"}
                      </span>
                    </td>
                    <td style={{ padding: "12px 0", color: "var(--muted)" }}>{check.detail}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  )
}
