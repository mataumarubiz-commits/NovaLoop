"use client"

import { useMemo, useState, type CSSProperties } from "react"
import Link from "next/link"
import { supabase } from "@/lib/supabase"
import { useAuthOrg } from "@/hooks/useAuthOrg"

type PreviewSummary = Record<
  string,
  {
    addCount?: number
    reuseCount?: number
    skipCount?: number
    dupSkipCount?: number
    invalidSkipCount?: number
  }
>

const cardStyle: CSSProperties = {
  background: "var(--surface)",
  borderRadius: 16,
  border: "1px solid var(--border)",
  padding: 20,
}

async function getAccessToken() {
  const session = await supabase.auth.getSession()
  return session.data.session?.access_token ?? null
}

export default function ImportSettingsPage() {
  const { activeOrgId, role, loading, needsOnboarding } = useAuthOrg({ redirectToOnboarding: true })
  const canUse = role === "owner" || role === "executive_assistant"
  const [file, setFile] = useState<File | null>(null)
  const [exportData, setExportData] = useState<Record<string, unknown> | null>(null)
  const [summary, setSummary] = useState<PreviewSummary | null>(null)
  const [busy, setBusy] = useState<"preview" | "apply" | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  const summaryRows = useMemo(
    () => (summary ? Object.entries(summary) : []),
    [summary]
  )

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
    const token = await getAccessToken()
    if (!token) {
      setError("ログイン状態を確認できませんでした。")
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
    setSuccess(null)
    const json = await callApi("/api/imports/preview")
    if (!json?.ok || !json?.summary) {
      setError(json?.message ?? "復元プレビューの取得に失敗しました。")
    } else {
      setSummary(json.summary as PreviewSummary)
    }
    setBusy(null)
  }

  const runApply = async () => {
    if (!summary) return
    if (!window.confirm("現在のワークスペースにバックアップ内容を反映します。続けますか。")) return
    setBusy("apply")
    setError(null)
    setSuccess(null)
    const json = await callApi("/api/imports/apply")
    if (!json?.ok) {
      setError(json?.message ?? "復元に失敗しました。")
    } else {
      setSuccess("復元を反映しました。")
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
      <div style={{ maxWidth: 980, margin: "0 auto", display: "grid", gap: 16 }}>
        <header>
          <h1 style={{ fontSize: 28, color: "var(--text)", margin: 0 }}>復元</h1>
          <p style={{ fontSize: 13, color: "var(--muted)", marginTop: 8 }}>
            先に preview で差分を確認してから apply します。画面の操作を増やしすぎないため、手順は3段階に固定しています。
          </p>
        </header>

        <section style={{ ...cardStyle, background: "var(--warning-bg)", borderColor: "var(--warning-border)", color: "var(--warning-text)" }}>
          PDF や Storage 内の原本ファイルは別管理です。ここで戻すのはアプリのデータと添付の参照情報です。
        </section>

        {error ? <section style={{ ...cardStyle, background: "var(--error-bg)", borderColor: "var(--error-border)", color: "var(--error-text)" }}>{error}</section> : null}
        {success ? <section style={{ ...cardStyle, background: "var(--success-bg)", borderColor: "var(--success-border)", color: "var(--success-text)" }}>{success}</section> : null}

        <section style={cardStyle}>
          <div style={{ fontWeight: 800, color: "var(--text)", marginBottom: 12 }}>1. バックアップファイルを選ぶ</div>
          <input type="file" accept=".json,application/json" onChange={(event) => handleFile(event.target.files?.[0] ?? null)} />
          {file ? <p style={{ marginTop: 10, color: "var(--muted)" }}>{file.name}</p> : null}
        </section>

        <section style={cardStyle}>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button type="button" disabled={!exportData || busy !== null} onClick={() => void runPreview()} style={secondaryButtonStyle}>
              {busy === "preview" ? "確認中..." : "2. preview"}
            </button>
            <button type="button" disabled={!summary || busy !== null} onClick={() => void runApply()} style={primaryButtonStyle}>
              {busy === "apply" ? "反映中..." : "3. apply"}
            </button>
          </div>
        </section>

        {summaryRows.length > 0 ? (
          <section style={cardStyle}>
            <div style={{ fontWeight: 800, color: "var(--text)", marginBottom: 12 }}>プレビュー結果</div>
            <div style={{ display: "grid", gap: 10 }}>
              {summaryRows.map(([key, value]) => (
                <div key={key} style={{ display: "flex", justifyContent: "space-between", gap: 16, paddingBottom: 10, borderBottom: "1px solid var(--border)" }}>
                  <strong style={{ color: "var(--text)" }}>{key}</strong>
                  <span style={{ color: "var(--muted)", textAlign: "right" }}>
                    追加 {value.addCount ?? 0}
                    {" / "}再利用 {value.reuseCount ?? 0}
                    {" / "}重複スキップ {value.dupSkipCount ?? 0}
                    {" / "}不正スキップ {value.invalidSkipCount ?? 0}
                    {" / "}その他スキップ {value.skipCount ?? 0}
                  </span>
                </div>
              ))}
            </div>
          </section>
        ) : null}

        <section style={cardStyle}>
          <div style={{ fontWeight: 800, color: "var(--text)" }}>バックアップ取得がまだなら</div>
          <div style={{ marginTop: 8 }}>
            <Link href="/settings/export" style={{ color: "var(--primary)", fontWeight: 700, textDecoration: "none" }}>
              バックアップ画面へ
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
  padding: "10px 16px",
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
