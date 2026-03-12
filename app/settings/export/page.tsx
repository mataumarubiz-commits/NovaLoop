"use client"

import { useCallback, useEffect, useState } from "react"
import Link from "next/link"
import { supabase } from "@/lib/supabase"
import { useAuthOrg } from "@/hooks/useAuthOrg"

type ExportJob = {
  id: string
  status: string
  file_path: string | null
  error_message: string | null
  created_at: string
}

const cardStyle: React.CSSProperties = {
  background: "var(--surface)",
  borderRadius: 16,
  border: "1px solid var(--border)",
  padding: 20,
}

export default function ExportSettingsPage() {
  const { activeOrgId, role, loading, needsOnboarding } = useAuthOrg({ redirectToOnboarding: true })
  const [jobs, setJobs] = useState<ExportJob[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const canUse = role === "owner" || role === "executive_assistant"

  const fetchJobs = useCallback(async () => {
    if (!activeOrgId) return
    const { data, error: jobError } = await supabase
      .from("export_jobs")
      .select("id, status, file_path, error_message, created_at")
      .eq("org_id", activeOrgId)
      .order("created_at", { ascending: false })
    if (jobError) {
      setError("エクスポート履歴の取得に失敗しました。")
      setJobs([])
      return
    }
    setJobs((data ?? []) as ExportJob[])
  }, [activeOrgId])

  useEffect(() => {
    queueMicrotask(() => {
      void fetchJobs()
    })
  }, [fetchJobs])

  const createExport = async () => {
    if (!activeOrgId || !canUse) return
    setBusy(true)
    setError(null)
    setSuccess(null)

    const token = (await supabase.auth.getSession()).data.session?.access_token
    if (!token) {
      setError("ログインし直してから再実行してください。")
      setBusy(false)
      return
    }

    const res = await fetch("/api/exports/create", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ orgId: activeOrgId }),
    })
    const json = await res.json().catch(() => null)
    if (!res.ok || !json?.ok) {
      setError(json?.message ?? "エクスポートに失敗しました。")
    } else {
      setSuccess("エクスポートを作成しました。履歴に反映されるまで少し待ってください。")
      await fetchJobs()
    }
    setBusy(false)
  }

  const downloadExport = async (jobId: string) => {
    const token = (await supabase.auth.getSession()).data.session?.access_token
    if (!token) {
      setError("ログインし直してから再実行してください。")
      return
    }
    const res = await fetch(`/api/exports/download?jobId=${encodeURIComponent(jobId)}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    const json = await res.json().catch(() => null)
    if (!res.ok || !json?.ok || !json?.url) {
      setError(json?.message ?? "ダウンロード URL の取得に失敗しました。")
      return
    }
    window.open(json.url, "_blank", "noopener,noreferrer")
  }

  if (loading) return <div style={{ padding: 32, color: "var(--muted)" }}>読み込み中...</div>
  if (!activeOrgId || needsOnboarding) return <div style={{ padding: 32, color: "var(--muted)" }}>ワークスペースを選択してください。</div>
  if (!canUse) return <div style={{ padding: 32, color: "var(--muted)" }}>owner / executive_assistant のみ利用できます。</div>

  return (
    <div style={{ padding: "32px 40px", minHeight: "100vh", background: "var(--bg-grad)" }}>
      <div style={{ maxWidth: 920, margin: "0 auto", display: "grid", gap: 16 }}>
        <header>
          <h1 style={{ fontSize: 28, color: "var(--text)", margin: 0 }}>エクスポート</h1>
          <p style={{ fontSize: 13, color: "var(--muted)", marginTop: 8 }}>
            現在のワークスペースを JSON で退避します。危険操作ではありませんが、取得ファイルの扱いには注意してください。
          </p>
        </header>

        {error && <section style={{ ...cardStyle, background: "#fff1f2", borderColor: "#fecaca", color: "#b91c1c" }}>{error}</section>}
        {success && <section style={{ ...cardStyle, background: "#f0fdf4", borderColor: "#bbf7d0", color: "#166534" }}>{success}</section>}

        <section style={cardStyle}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 16, flexWrap: "wrap", alignItems: "center" }}>
            <div>
              <div style={{ fontWeight: 700, color: "var(--text)" }}>今すぐエクスポート</div>
              <div style={{ fontSize: 13, color: "var(--muted)", marginTop: 4 }}>clients / contents / pages / invoices / vendors / payouts などを含みます。</div>
            </div>
            <button
              type="button"
              onClick={() => void createExport()}
              disabled={busy}
              style={{
                padding: "10px 16px",
                borderRadius: 10,
                border: "1px solid var(--border)",
                background: "var(--surface-2)",
                fontWeight: 600,
                cursor: busy ? "wait" : "pointer",
              }}
            >
              {busy ? "作成中..." : "エクスポートを作成"}
            </button>
          </div>
        </section>

        <section style={cardStyle}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 16, flexWrap: "wrap", alignItems: "center", marginBottom: 12 }}>
            <div style={{ fontWeight: 700, color: "var(--text)" }}>履歴</div>
            <div style={{ fontSize: 12, color: "var(--muted)" }}>{jobs.length} 件</div>
          </div>

          {jobs.length === 0 ? (
            <p style={{ color: "var(--muted)" }}>まだエクスポート履歴はありません。</p>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
                <thead>
                  <tr style={{ borderBottom: "1px solid var(--border)", textAlign: "left" }}>
                    <th style={{ padding: "10px 0" }}>作成日時</th>
                    <th style={{ padding: "10px 12px" }}>状態</th>
                    <th style={{ padding: "10px 12px" }}>ファイル</th>
                    <th style={{ padding: "10px 0" }}>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {jobs.map((job) => (
                    <tr key={job.id} style={{ borderBottom: "1px solid var(--border)" }}>
                      <td style={{ padding: "12px 0" }}>{new Date(job.created_at).toLocaleString("ja-JP")}</td>
                      <td style={{ padding: "12px 12px" }}>{job.status}</td>
                      <td style={{ padding: "12px 12px", color: "var(--muted)" }}>{job.file_path ?? job.error_message ?? "-"}</td>
                      <td style={{ padding: "12px 0" }}>
                        {job.status === "done" && job.file_path ? (
                          <button
                            type="button"
                            onClick={() => void downloadExport(job.id)}
                            style={{ padding: "8px 12px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--surface)" }}
                          >
                            ダウンロード
                          </button>
                        ) : null}
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
