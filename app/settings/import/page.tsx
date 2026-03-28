"use client"

import { useState } from "react"
import Link from "next/link"
import { supabase } from "@/lib/supabase"
import { useAuthOrg } from "@/hooks/useAuthOrg"

type PreviewSummary = Record<string, { addCount?: number; reuseCount?: number; skipCount?: number; dupSkipCount?: number; invalidSkipCount?: number }>

const cardStyle: React.CSSProperties = {
  background: "var(--surface)",
  borderRadius: 16,
  border: "1px solid var(--border)",
  padding: 20,
}

export default function ImportSettingsPage() {
  const { activeOrgId, role, loading, needsOnboarding } = useAuthOrg({ redirectToOnboarding: true })
  const [file, setFile] = useState<File | null>(null)
  const [exportData, setExportData] = useState<Record<string, unknown> | null>(null)
  const [summary, setSummary] = useState<PreviewSummary | null>(null)
  const [busy, setBusy] = useState<"preview" | "apply" | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const canUse = role === "owner" || role === "executive_assistant"

  const handleFile = (nextFile: File | null) => {
    setFile(nextFile)
    setSummary(null)
    setError(null)
    setSuccess(null)
    setExportData(null)
    if (!nextFile) return

    const reader = new FileReader()
    reader.onload = () => {
      try {
        setExportData(JSON.parse(String(reader.result)) as Record<string, unknown>)
      } catch {
        setError("JSON の読み込みに失敗しました。")
      }
    }
    reader.readAsText(nextFile, "utf-8")
  }

  const callApi = async (path: "/api/imports/preview" | "/api/imports/apply") => {
    if (!activeOrgId || !exportData) return null
    const token = (await supabase.auth.getSession()).data.session?.access_token
    if (!token) {
      setError("ログインし直してから再実行してください。")
      return null
    }
    const res = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ orgId: activeOrgId, exportData }),
    })
    return res.json().catch(() => null)
  }

  const runPreview = async () => {
    setBusy("preview")
    setError(null)
    const json = await callApi("/api/imports/preview")
    if (!json?.ok || !json?.summary) {
      setError(json?.message ?? "プレビューの取得に失敗しました。")
    } else {
      setSummary(json.summary as PreviewSummary)
    }
    setBusy(null)
  }

  const runApply = async () => {
    if (typeof window !== "undefined" && !window.confirm("このデータを現在のワークスペースへ取り込みます。続行しますか？")) {
      return
    }
    setBusy("apply")
    setError(null)
    const json = await callApi("/api/imports/apply")
    if (!json?.ok) {
      setError(json?.message ?? "取り込みに失敗しました。")
    } else {
      setSuccess("取り込みを実行しました。")
      setSummary(null)
      setFile(null)
      setExportData(null)
    }
    setBusy(null)
  }

  if (loading) return <div style={{ padding: 32, color: "var(--muted)" }}>読み込み中...</div>
  if (!activeOrgId || needsOnboarding) return <div style={{ padding: 32, color: "var(--muted)" }}>ワークスペースを選択してください。</div>
  if (!canUse) return <div style={{ padding: 32, color: "var(--muted)" }}>owner / executive_assistant のみ利用できます。</div>

  return (
    <div style={{ padding: "32px 40px", minHeight: "100vh", background: "var(--bg-grad)" }}>
      <div style={{ maxWidth: 920, margin: "0 auto", display: "grid", gap: 16 }}>
        <header>
          <h1 style={{ fontSize: 28, color: "var(--text)", margin: 0 }}>インポート</h1>
          <p style={{ fontSize: 13, color: "var(--muted)", marginTop: 8 }}>
            `/settings/export` で出した JSON を読み込みます。apply は実データ変更なので必ず preview を先に確認してください。
          </p>
        </header>

        <section style={{ ...cardStyle, background: "var(--warning-bg)", borderColor: "var(--warning-border)", color: "var(--warning-text)" }}>
          PDF や Storage 実ファイルは取り込みません。まずはマスタ・制作・請求・外注の再現を優先しています。
        </section>

        {error && <section style={{ ...cardStyle, background: "var(--error-bg)", borderColor: "var(--error-border)", color: "var(--error-text)" }}>{error}</section>}
        {success && <section style={{ ...cardStyle, background: "var(--success-bg)", borderColor: "var(--success-border)", color: "var(--success-text)" }}>{success}</section>}

        <section style={cardStyle}>
          <div style={{ fontWeight: 700, color: "var(--text)", marginBottom: 12 }}>1. ファイルを選ぶ</div>
          <input type="file" accept=".json,application/json" onChange={(event) => handleFile(event.target.files?.[0] ?? null)} />
          {file ? <p style={{ marginTop: 8, color: "var(--muted)" }}>{file.name}</p> : null}
        </section>

        <section style={cardStyle}>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button type="button" disabled={!exportData || busy !== null} onClick={() => void runPreview()} style={{ padding: "10px 16px", borderRadius: 10, border: "1px solid var(--border)", background: "var(--surface-2)" }}>
              {busy === "preview" ? "プレビュー中..." : "2. preview を実行"}
            </button>
            <button type="button" disabled={!summary || busy !== null} onClick={() => void runApply()} style={{ padding: "10px 16px", borderRadius: 10, border: "1px solid var(--border)", background: "var(--surface-2)" }}>
              {busy === "apply" ? "取り込み中..." : "3. apply を実行"}
            </button>
          </div>
        </section>

        {summary ? (
          <section style={cardStyle}>
            <div style={{ fontWeight: 700, color: "var(--text)", marginBottom: 12 }}>プレビュー結果</div>
            <div style={{ display: "grid", gap: 8 }}>
              {Object.entries(summary).map(([key, value]) => (
                <div key={key} style={{ display: "flex", justifyContent: "space-between", gap: 16, paddingBottom: 8, borderBottom: "1px solid var(--border)" }}>
                  <strong style={{ color: "var(--text)" }}>{key}</strong>
                  <span style={{ color: "var(--muted)", textAlign: "right" }}>
                    追加 {value.addCount ?? 0}
                    {" / "}再利用 {value.reuseCount ?? 0}
                    {" / "}重複スキップ {value.dupSkipCount ?? 0}
                    {" / "}無効スキップ {value.invalidSkipCount ?? 0}
                    {" / "}通常スキップ {value.skipCount ?? 0}
                  </span>
                </div>
              ))}
            </div>
          </section>
        ) : null}

        <Link href="/settings" style={{ color: "var(--primary)", fontWeight: 600, textDecoration: "none" }}>設定へ戻る</Link>
      </div>
    </div>
  )
}
