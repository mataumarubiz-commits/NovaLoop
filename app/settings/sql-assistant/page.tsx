"use client"

import { useState } from "react"
import { useAuthOrg } from "@/hooks/useAuthOrg"

export default function SqlAssistantPage() {
  const { activeOrgId, role, loading, needsOnboarding } = useAuthOrg({ redirectToOnboarding: true })
  const [input, setInput] = useState("")
  const [context, setContext] = useState("")
  const [result, setResult] = useState("")
  const [loadingAi, setLoadingAi] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const canUse = !!activeOrgId && (role === "owner" || role === "executive_assistant")

  const handleRun = async () => {
    if (!input.trim()) {
      setError("やりたいことを入力してください。")
      return
    }

    setError(null)
    setResult("")
    setLoadingAi(true)
    try {
      const res = await fetch("/api/ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "sql_draft", text: input, context }),
      })
      const json = await res.json().catch(() => null)
      if (!res.ok) {
        setError(json?.error ?? "AI 呼び出しに失敗しました。")
        return
      }
      setResult(json?.result ?? "")
    } catch (e) {
      setError(e instanceof Error ? e.message : "AI 呼び出しに失敗しました。")
    } finally {
      setLoadingAi(false)
    }
  }

  const handleCopy = () => {
    if (!result) return
    void navigator.clipboard.writeText(result)
  }

  if (loading) {
    return (
      <div style={{ padding: "32px 40px", minHeight: "100vh", background: "var(--bg-grad)" }}>
        <p style={{ color: "var(--muted)" }}>読み込み中...</p>
      </div>
    )
  }

  if (needsOnboarding || !activeOrgId) {
    return (
      <div style={{ padding: "32px 40px", minHeight: "100vh", background: "var(--bg-grad)" }}>
        <p style={{ color: "var(--muted)" }}>ワークスペースを選択するか、オンボーディングを完了してください。</p>
      </div>
    )
  }

  if (!canUse) {
    return (
      <div style={{ padding: "32px 40px", minHeight: "100vh", background: "var(--bg-grad)" }}>
        <p style={{ color: "var(--muted)" }}>SQL アシスタントは owner / executive_assistant のみ利用できます。</p>
      </div>
    )
  }

  return (
    <div style={{ padding: "32px 40px 60px", minHeight: "100vh", background: "var(--bg-grad)" }}>
      <header style={{ marginBottom: 20 }}>
        <p style={{ fontSize: 12, letterSpacing: "0.08em", color: "var(--muted)" }}>設定 / SQL アシスタント</p>
        <h1 style={{ fontSize: 24, margin: "6px 0 8px", color: "var(--text)" }}>SQL アシスタント</h1>
        <p style={{ fontSize: 13, color: "var(--muted)" }}>
          やりたいことを日本語で書くと、Supabase / PostgreSQL 向けの SQL 案を生成します。{" "}
          <strong>生成された SQL は必ず確認してから実行してください。</strong>
        </p>
      </header>

      {error && (
        <div
          style={{
            marginBottom: 12,
            padding: "8px 10px",
            borderRadius: 10,
            border: "1px solid #fecaca",
            background: "#fff1f2",
            color: "#b91c1c",
            fontSize: 13,
          }}
        >
          {error}
        </div>
      )}

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1.1fr 1fr",
          gap: 16,
          alignItems: "flex-start",
        }}
      >
        <div
          style={{
            borderRadius: 14,
            border: "1px solid var(--border)",
            background: "var(--surface)",
            padding: 14,
          }}
        >
          <div style={{ fontSize: 13, color: "var(--muted)", marginBottom: 6 }}>やりたいこと</div>
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="例: contents テーブルに ai_summary カラムを追加したい / vendors を org_id ごとに集計したい"
            style={{
              width: "100%",
              minHeight: 140,
              borderRadius: 12,
              border: "1px solid var(--border)",
              background: "var(--input-bg)",
              color: "var(--input-text)",
              padding: 12,
              resize: "vertical",
              boxSizing: "border-box",
            }}
          />

          <div style={{ fontSize: 13, color: "var(--muted)", margin: "12px 0 6px" }}>補足コンテキスト</div>
          <textarea
            value={context}
            onChange={(e) => setContext(e.target.value)}
            placeholder="必要なら制約や前提条件を書いてください"
            style={{
              width: "100%",
              minHeight: 96,
              borderRadius: 12,
              border: "1px solid var(--border)",
              background: "var(--input-bg)",
              color: "var(--input-text)",
              padding: 12,
              resize: "vertical",
              boxSizing: "border-box",
            }}
          />

          <div style={{ display: "flex", gap: 10, marginTop: 14, flexWrap: "wrap" }}>
            <button
              type="button"
              onClick={handleRun}
              disabled={loadingAi}
              style={{
                borderRadius: 10,
                border: "none",
                padding: "10px 16px",
                background: "var(--button-primary-bg)",
                color: "var(--primary-contrast)",
                fontWeight: 600,
                cursor: loadingAi ? "not-allowed" : "pointer",
              }}
            >
              {loadingAi ? "生成中..." : "SQL を作成"}
            </button>
            <button
              type="button"
              onClick={() => {
                setInput("")
                setContext("")
                setResult("")
                setError(null)
              }}
              style={{
                borderRadius: 10,
                border: "1px solid var(--border)",
                padding: "10px 16px",
                background: "var(--surface-2)",
                color: "var(--text)",
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              クリア
            </button>
          </div>
        </div>

        <div
          style={{
            borderRadius: 14,
            border: "1px solid var(--border)",
            background: "var(--surface)",
            padding: 14,
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, marginBottom: 8 }}>
            <div style={{ fontSize: 13, color: "var(--muted)" }}>生成結果</div>
            <button
              type="button"
              onClick={handleCopy}
              disabled={!result}
              style={{
                borderRadius: 8,
                border: "1px solid var(--border)",
                padding: "6px 10px",
                background: "var(--surface-2)",
                color: "var(--text)",
                cursor: result ? "pointer" : "not-allowed",
              }}
            >
              コピー
            </button>
          </div>
          <pre
            style={{
              margin: 0,
              minHeight: 280,
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
              borderRadius: 12,
              border: "1px solid var(--border)",
              background: "var(--table-bg)",
              color: "var(--text)",
              padding: 12,
              fontSize: 13,
              lineHeight: 1.6,
            }}
          >
            {result || "ここに生成された SQL が表示されます。"}
          </pre>
        </div>
      </div>
    </div>
  )
}
