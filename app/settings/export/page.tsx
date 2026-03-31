"use client"

import { useCallback, useEffect, useMemo, useState, type CSSProperties } from "react"
import Link from "next/link"
import { supabase } from "@/lib/supabase"
import { useAuthOrg } from "@/hooks/useAuthOrg"

type ExportJob = {
  id: string
  status: "pending" | "processing" | "done" | "failed"
  job_type: string | null
  trigger_source: string | null
  file_path: string | null
  error_message: string | null
  created_at: string
  started_at: string | null
  finished_at: string | null
}

const cardStyle: CSSProperties = {
  background: "var(--surface)",
  borderRadius: 16,
  border: "1px solid var(--border)",
  padding: 20,
}

function statusLabel(status: ExportJob["status"]) {
  if (status === "pending") return "待機中"
  if (status === "processing") return "処理中"
  if (status === "done") return "完了"
  return "失敗"
}

function statusTone(status: ExportJob["status"]) {
  if (status === "done") return { bg: "#ecfdf5", text: "#166534" }
  if (status === "failed") return { bg: "#fff1f2", text: "#be123c" }
  if (status === "processing") return { bg: "#eff6ff", text: "#1d4ed8" }
  return { bg: "#f8fafc", text: "#475569" }
}

async function getAccessToken() {
  const session = await supabase.auth.getSession()
  return session.data.session?.access_token ?? null
}

export default function ExportSettingsPage() {
  const { activeOrgId, role, loading, needsOnboarding } = useAuthOrg({ redirectToOnboarding: true })
  const canUse = role === "owner" || role === "executive_assistant"
  const [jobs, setJobs] = useState<ExportJob[]>([])
  const [busy, setBusy] = useState<"queue" | "process" | "download" | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [autoRefresh, setAutoRefresh] = useState(true)

  const fetchJobs = useCallback(async () => {
    if (!activeOrgId) return
    const { data, error: jobError } = await supabase
      .from("export_jobs")
      .select("id, status, job_type, trigger_source, file_path, error_message, created_at, started_at, finished_at")
      .eq("org_id", activeOrgId)
      .order("created_at", { ascending: false })
      .limit(30)

    if (jobError) {
      setError(jobError.message)
      setJobs([])
      return
    }
    setJobs((data ?? []) as ExportJob[])
  }, [activeOrgId])

  useEffect(() => {
    void fetchJobs()
  }, [fetchJobs])

  useEffect(() => {
    if (!autoRefresh) return
    const timer = window.setInterval(() => {
      void fetchJobs()
    }, 8000)
    return () => window.clearInterval(timer)
  }, [autoRefresh, fetchJobs])

  const pendingJobs = useMemo(
    () => jobs.filter((job) => job.status === "pending" || job.status === "processing"),
    [jobs]
  )

  const queueExport = async () => {
    if (!activeOrgId || !canUse) return
    const token = await getAccessToken()
    if (!token) {
      setError("ログイン状態を確認できませんでした。")
      return
    }

    setBusy("queue")
    setError(null)
    setSuccess(null)
    try {
      const res = await fetch("/api/exports/create", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ orgId: activeOrgId }),
      })
      const json = await res.json().catch(() => null)
      if (!res.ok || !json?.ok) {
        setError(json?.message ?? "バックアップのキュー登録に失敗しました。")
        return
      }
      setSuccess("バックアップをキューに追加しました。")
      await fetchJobs()
    } finally {
      setBusy(null)
    }
  }

  const processExports = async () => {
    if (!canUse) return
    const token = await getAccessToken()
    if (!token) {
      setError("ログイン状態を確認できませんでした。")
      return
    }

    setBusy("process")
    setError(null)
    setSuccess(null)
    try {
      const res = await fetch("/api/exports/process", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ limit: 5 }),
      })
      const json = await res.json().catch(() => null)
      if (!res.ok || !json?.ok) {
        setError(json?.message ?? "バックアップ処理の実行に失敗しました。")
        return
      }
      setSuccess("待機中のバックアップを処理しました。")
      await fetchJobs()
    } finally {
      setBusy(null)
    }
  }

  const downloadExport = async (jobId: string) => {
    const token = await getAccessToken()
    if (!token) {
      setError("ログイン状態を確認できませんでした。")
      return
    }

    setBusy("download")
    setError(null)
    try {
      const res = await fetch(`/api/exports/download?jobId=${encodeURIComponent(jobId)}`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      const json = await res.json().catch(() => null)
      if (!res.ok || !json?.ok || !json?.url) {
        setError(json?.message ?? "ダウンロードURLの取得に失敗しました。")
        return
      }
      window.open(json.url, "_blank", "noopener,noreferrer")
    } finally {
      setBusy(null)
    }
  }

  if (loading) return <div style={{ padding: 32, color: "var(--muted)" }}>読み込み中...</div>
  if (!activeOrgId || needsOnboarding) return <div style={{ padding: 32, color: "var(--muted)" }}>ワークスペースを選択してください。</div>
  if (!canUse) return <div style={{ padding: 32, color: "var(--muted)" }}>owner / executive_assistant のみ利用できます。</div>

  return (
    <div style={{ padding: "32px 40px", minHeight: "100vh", background: "var(--bg-grad)" }}>
      <div style={{ maxWidth: 980, margin: "0 auto", display: "grid", gap: 16 }}>
        <header>
          <h1 style={{ fontSize: 28, color: "var(--text)", margin: 0 }}>バックアップ</h1>
          <p style={{ fontSize: 13, color: "var(--muted)", marginTop: 8 }}>
            エクスポートは非同期ジョブで作成します。大きい組織でも画面を止めずに取得できます。
          </p>
        </header>

        {error ? <section style={{ ...cardStyle, background: "var(--error-bg)", borderColor: "var(--error-border)", color: "var(--error-text)" }}>{error}</section> : null}
        {success ? <section style={{ ...cardStyle, background: "var(--success-bg)", borderColor: "var(--success-border)", color: "var(--success-text)" }}>{success}</section> : null}

        <section style={cardStyle}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 16, flexWrap: "wrap", alignItems: "center" }}>
            <div>
              <div style={{ fontWeight: 800, color: "var(--text)" }}>今すぐバックアップ</div>
              <div style={{ marginTop: 6, fontSize: 13, color: "var(--muted)" }}>
                `clients / projects / contents / pages / billing / vendors / review / notifications` を含む JSON を生成します。
              </div>
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button type="button" onClick={() => void queueExport()} disabled={busy !== null} style={secondaryButtonStyle}>
                {busy === "queue" ? "登録中..." : "バックアップを登録"}
              </button>
              <button type="button" onClick={() => void processExports()} disabled={busy !== null || pendingJobs.length === 0} style={primaryButtonStyle}>
                {busy === "process" ? "処理中..." : `待機中を実行${pendingJobs.length > 0 ? ` (${pendingJobs.length})` : ""}`}
              </button>
            </div>
          </div>
        </section>

        <section style={cardStyle}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 16, flexWrap: "wrap", alignItems: "center", marginBottom: 12 }}>
            <div>
              <div style={{ fontWeight: 800, color: "var(--text)" }}>ジョブ一覧</div>
              <div style={{ marginTop: 4, fontSize: 13, color: "var(--muted)" }}>
                自動更新を入れておくと、バックアップ完了後にそのまま取得できます。
              </div>
            </div>
            <label style={{ display: "inline-flex", gap: 8, alignItems: "center", fontSize: 13, color: "var(--muted)" }}>
              <input type="checkbox" checked={autoRefresh} onChange={(event) => setAutoRefresh(event.target.checked)} />
              自動更新
            </label>
          </div>

          {jobs.length === 0 ? (
            <div style={{ color: "var(--muted)" }}>まだバックアップはありません。</div>
          ) : (
            <div style={{ display: "grid", gap: 10 }}>
              {jobs.map((job) => {
                const tone = statusTone(job.status)
                return (
                  <div key={job.id} style={{ border: "1px solid var(--border)", borderRadius: 14, padding: 14 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "start" }}>
                      <div style={{ display: "grid", gap: 6 }}>
                        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                          <span style={{ padding: "4px 10px", borderRadius: 999, background: tone.bg, color: tone.text, fontWeight: 800, fontSize: 12 }}>
                            {statusLabel(job.status)}
                          </span>
                          <span style={{ fontSize: 12, color: "var(--muted)" }}>
                            {job.job_type ?? "full_backup"} / {job.trigger_source ?? "manual"}
                          </span>
                        </div>
                        <div style={{ fontWeight: 700, color: "var(--text)" }}>
                          {new Date(job.created_at).toLocaleString("ja-JP")}
                        </div>
                        <div style={{ fontSize: 13, color: "var(--muted)" }}>
                          開始: {job.started_at ? new Date(job.started_at).toLocaleString("ja-JP") : "-"} / 完了: {job.finished_at ? new Date(job.finished_at).toLocaleString("ja-JP") : "-"}
                        </div>
                        <div style={{ fontSize: 13, color: job.status === "failed" ? "var(--error-text)" : "var(--muted)" }}>
                          {job.error_message || job.file_path || "出力ファイルはまだありません。"}
                        </div>
                      </div>
                      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                        {job.status === "pending" ? (
                          <button type="button" onClick={() => void processExports()} disabled={busy !== null} style={secondaryButtonStyle}>
                            この待機列を処理
                          </button>
                        ) : null}
                        {job.status === "done" && job.file_path ? (
                          <button type="button" onClick={() => void downloadExport(job.id)} disabled={busy === "download"} style={primaryButtonStyle}>
                            ダウンロード
                          </button>
                        ) : null}
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </section>

        <section style={cardStyle}>
          <div style={{ fontWeight: 800, color: "var(--text)" }}>復元の流れ</div>
          <ol style={{ margin: "10px 0 0", paddingLeft: 20, color: "var(--muted)", lineHeight: 1.8 }}>
            <li>ここで最新バックアップを取得</li>
            <li>[復元](/C:/Users/ram_n/Desktop/EmotionaL/NovaLoop/my-app/app/settings/import/page.tsx) で preview</li>
            <li>差分を確認して apply</li>
          </ol>
          <div style={{ marginTop: 12 }}>
            <Link href="/settings/import" style={{ color: "var(--primary)", fontWeight: 700, textDecoration: "none" }}>
              復元画面へ
            </Link>
          </div>
        </section>

        <Link href="/settings" style={{ color: "var(--primary)", fontWeight: 600, textDecoration: "none" }}>
          設定へ戻る
        </Link>
      </div>
    </div>
  )
}

const secondaryButtonStyle: CSSProperties = {
  padding: "10px 14px",
  borderRadius: 10,
  border: "1px solid var(--border)",
  background: "var(--surface-2)",
  color: "var(--text)",
  fontWeight: 700,
  cursor: "pointer",
}

const primaryButtonStyle: CSSProperties = {
  ...secondaryButtonStyle,
  borderColor: "var(--button-primary-bg)",
  background: "var(--button-primary-bg)",
  color: "var(--primary-contrast)",
}
