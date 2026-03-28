"use client"

import { useCallback, useEffect, useState } from "react"
import Link from "next/link"
import { supabase } from "@/lib/supabase"
import { useAuthOrg } from "@/hooks/useAuthOrg"

type AuditLog = {
  id: string
  user_id: string
  action: string
  resource_type: string
  resource_id: string | null
  meta: Record<string, unknown> | null
  created_at: string
}

const cardStyle: React.CSSProperties = {
  background: "var(--surface)",
  borderRadius: 16,
  border: "1px solid var(--border)",
  padding: 20,
}

export default function AuditSettingsPage() {
  const { activeOrgId, role, loading } = useAuthOrg({ redirectToOnboarding: true })
  const [logs, setLogs] = useState<AuditLog[]>([])
  const [error, setError] = useState<string | null>(null)
  const canUse = role === "owner" || role === "executive_assistant"

  const load = useCallback(async () => {
    if (!activeOrgId || !canUse) return
    const token = (await supabase.auth.getSession()).data.session?.access_token
    if (!token) return
    const res = await fetch("/api/settings/audit?limit=80", {
      headers: { Authorization: `Bearer ${token}` },
    })
    const json = await res.json().catch(() => null)
    if (!res.ok || !json?.ok) {
      setError(json?.error ?? "監査ログの取得に失敗しました。")
      return
    }
    setLogs((json.logs ?? []) as AuditLog[])
  }, [activeOrgId, canUse])

  useEffect(() => {
    queueMicrotask(() => {
      void load()
    })
  }, [load])

  if (loading) return <div style={{ padding: 32, color: "var(--muted)" }}>読み込み中...</div>
  if (!activeOrgId) return <div style={{ padding: 32, color: "var(--muted)" }}>ワークスペースを選択してください。</div>
  if (!canUse) return <div style={{ padding: 32, color: "var(--muted)" }}>owner / executive_assistant のみ利用できます。</div>

  return (
    <div style={{ padding: "32px 40px", minHeight: "100vh", background: "var(--bg-grad)" }}>
      <div style={{ maxWidth: 1080, margin: "0 auto", display: "grid", gap: 16 }}>
        <header style={{ display: "flex", justifyContent: "space-between", gap: 16, flexWrap: "wrap", alignItems: "center" }}>
          <div>
            <h1 style={{ fontSize: 28, color: "var(--text)", margin: 0 }}>Audit</h1>
            <p style={{ fontSize: 13, color: "var(--muted)", marginTop: 8 }}>
              Pages、請求、外注、export / import、権限変更の監査ログを確認します。
            </p>
          </div>
          <button type="button" onClick={() => void load()} style={{ padding: "10px 16px", borderRadius: 10, border: "1px solid var(--border)", background: "var(--surface-2)", fontWeight: 600 }}>
            再読込
          </button>
        </header>

        {error ? <section style={{ ...cardStyle, background: "var(--error-bg)", borderColor: "var(--error-border)", color: "var(--error-text)" }}>{error}</section> : null}

        <section style={cardStyle}>
          {logs.length === 0 ? (
            <p style={{ color: "var(--muted)" }}>まだ監査ログはありません。</p>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <thead>
                  <tr style={{ borderBottom: "1px solid var(--border)", textAlign: "left" }}>
                    <th style={{ padding: "10px 0" }}>日時</th>
                    <th style={{ padding: "10px 12px" }}>action</th>
                    <th style={{ padding: "10px 12px" }}>resource</th>
                    <th style={{ padding: "10px 12px" }}>user</th>
                    <th style={{ padding: "10px 0" }}>meta</th>
                  </tr>
                </thead>
                <tbody>
                  {logs.map((log) => (
                    <tr key={log.id} style={{ borderBottom: "1px solid var(--border)", verticalAlign: "top" }}>
                      <td style={{ padding: "12px 0", whiteSpace: "nowrap" }}>{new Date(log.created_at).toLocaleString("ja-JP")}</td>
                      <td style={{ padding: "12px 12px", fontWeight: 700 }}>{log.action}</td>
                      <td style={{ padding: "12px 12px" }}>{log.resource_type}{log.resource_id ? ` / ${log.resource_id}` : ""}</td>
                      <td style={{ padding: "12px 12px", color: "var(--muted)" }}>{log.user_id}</td>
                      <td style={{ padding: "12px 0", color: "var(--muted)", whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
                        {log.meta ? JSON.stringify(log.meta, null, 2) : "-"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <Link href="/settings" style={{ color: "var(--primary)", fontWeight: 600, textDecoration: "none" }}>設定へ戻る</Link>
      </div>
    </div>
  )
}
