"use client"

import { useCallback, useEffect, useState } from "react"
import { supabase } from "@/lib/supabase"

type Mode = "summarize" | "rewrite" | "format" | "headings" | "sql_draft" | "procedure"

type OpenDetail = {
  source?: "pages" | "sql" | "other"
  text?: string
  context?: string
  mode?: Mode
}

const MODE_LABELS: Record<Mode, string> = {
  summarize: "要約",
  rewrite: "言い換え",
  format: "整形",
  headings: "見出し整理",
  sql_draft: "SQL案",
  procedure: "手順化",
}

const MODE_DESCRIPTIONS: Record<Mode, string> = {
  summarize: "長文を短く要点化します。",
  rewrite: "読みやすく自然な表現に書き換えます。",
  format: "箇条書きや段落を整理して整えます。",
  headings: "見出し構造をつけて読みやすくします。",
  sql_draft: "要件からSQLのたたき台を提案します。",
  procedure: "作業を番号付き手順に変換します。",
}

export default function AIPalette() {
  const [open, setOpen] = useState(false)
  const [mode, setMode] = useState<Mode>("summarize")
  const [instruction, setInstruction] = useState("")
  const [text, setText] = useState("")
  const [context, setContext] = useState("")
  const [result, setResult] = useState("")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [source, setSource] = useState<OpenDetail["source"]>("other")

  const close = () => {
    setOpen(false)
    setError(null)
  }

  const handleGlobalKey = useCallback((e: KeyboardEvent) => {
    const isMac = navigator.platform.toLowerCase().includes("mac")
    const meta = isMac ? e.metaKey : e.ctrlKey
    if (meta && e.key.toLowerCase() === "k") {
      e.preventDefault()
      const selection = window.getSelection()?.toString() ?? ""
      setText(selection)
      setContext("")
      setMode("summarize")
      setSource("other")
      setResult("")
      setError(null)
      setOpen((prev) => !prev)
    }
  }, [])

  useEffect(() => {
    window.addEventListener("keydown", handleGlobalKey)

    const openHandler = (event: Event) => {
      const detail = (event as CustomEvent<OpenDetail>).detail
      setSource(detail?.source ?? "other")
      setText(detail?.text ?? window.getSelection()?.toString() ?? "")
      setContext(detail?.context ?? "")
      if (detail?.mode) setMode(detail.mode)
      else if (detail?.source === "sql") setMode("sql_draft")
      else setMode("summarize")
      setResult("")
      setError(null)
      setOpen(true)
    }

    window.addEventListener("open-ai-palette", openHandler as EventListener)
    return () => {
      window.removeEventListener("keydown", handleGlobalKey)
      window.removeEventListener("open-ai-palette", openHandler as EventListener)
    }
  }, [handleGlobalKey])

  const handleSend = useCallback(async (): Promise<string | null> => {
    if (!text.trim() && !context.trim()) {
      setError("テキストまたはコンテキストを入力してください。")
      return null
    }

    setLoading(true)
    setError(null)
    setResult("")

    try {
      const { data } = await supabase.auth.getSession()
      const token = data.session?.access_token
      const res = await fetch("/api/ai", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ mode, instruction, text, context }),
      })

      const json = await res.json()
      if (!res.ok) {
        setError(json?.error ?? "AI呼び出しに失敗しました。")
        return null
      }

      const out = json.result ?? ""
      setResult(out)
      return out
    } catch (e) {
      setError(e instanceof Error ? e.message : "AI呼び出しに失敗しました。")
      return null
    } finally {
      setLoading(false)
    }
  }, [mode, instruction, text, context])

  const handleCopy = () => {
    if (!result) return
    void navigator.clipboard.writeText(result)
  }

  const handleApplyToPages = useCallback(() => {
    if (!result || source !== "pages") return
    window.dispatchEvent(new CustomEvent("apply-ai-to-pages", { detail: { mode, result } }))
  }, [result, source, mode])

  const handleRunAndApplyToPages = useCallback(async () => {
    if (source !== "pages") return

    if (result) {
      handleApplyToPages()
      close()
      return
    }

    const generated = await handleSend()
    if (generated != null) {
      window.dispatchEvent(new CustomEvent("apply-ai-to-pages", { detail: { mode, result: generated } }))
      close()
    }
  }, [source, result, mode, handleSend, handleApplyToPages])

  const getModeButtonStyle = (selected: boolean) => ({
    padding: "6px 10px",
    borderRadius: 999,
    border: selected ? "1px solid rgba(67,56,202,0.95)" : "1px solid var(--border)",
    background: selected ? "rgba(67,56,202,0.34)" : "var(--surface)",
    color: selected ? "#111827" : "var(--muted)",
    fontSize: 12,
    fontWeight: selected ? 800 : 500,
    boxShadow: selected ? "inset 0 0 0 1px rgba(255,255,255,0.28), 0 2px 8px rgba(67,56,202,0.35)" : "none",
    cursor: "pointer",
    transition: "background-color 120ms ease, border-color 120ms ease, box-shadow 120ms ease, color 120ms ease",
  })

  if (!open) return null

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 60,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "rgba(15,23,42,0.45)",
      }}
    >
      <div
        style={{
          width: "min(720px, 100% - 32px)",
          maxHeight: "80vh",
          borderRadius: 16,
          border: "1px solid var(--border)",
          background: "var(--surface)",
          boxShadow: "0 24px 80px rgba(15,23,42,0.4)",
          padding: 16,
          display: "flex",
          flexDirection: "column",
          gap: 10,
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
          <div style={{ fontSize: 13, color: "var(--muted)" }}>AIパレット（Cmd/Ctrl + K）</div>
          <button
            type="button"
            onClick={close}
            style={{
              border: "none",
              background: "transparent",
              color: "var(--muted)",
              cursor: "pointer",
              fontSize: 16,
              lineHeight: 1,
            }}
            aria-label="閉じる"
          >
            ×
          </button>
        </div>

        <div
          style={{
            border: "1px solid var(--border)",
            borderRadius: 10,
            background: "var(--surface-2)",
            padding: "8px 10px",
            fontSize: 12,
            color: "var(--muted)",
            lineHeight: 1.6,
          }}
        >
          <strong style={{ color: "var(--text)", marginRight: 6 }}>使い方:</strong>
          1. モードを選ぶ 2. 対象テキストを入れる 3. 「AIに送信」で結果を確認
        </div>

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {(Object.keys(MODE_LABELS) as Mode[]).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMode(m)}
              aria-pressed={mode === m}
              style={getModeButtonStyle(mode === m)}
            >
              {MODE_LABELS[m]}
            </button>
          ))}
        </div>
        <div
          style={{
            marginTop: -2,
            fontSize: 12,
            color: "var(--muted)",
          }}
        >
          <strong style={{ color: "var(--text)" }}>選択中:</strong> {MODE_LABELS[mode]} - {MODE_DESCRIPTIONS[mode]}
        </div>

        <textarea
          value={instruction}
          onChange={(e) => setInstruction(e.target.value)}
          placeholder="追加指示（任意）"
          style={{
            width: "100%",
            minHeight: 40,
            borderRadius: 8,
            border: "1px solid var(--input-border)",
            background: "var(--input-bg)",
            color: "var(--input-text)",
            fontSize: 13,
            padding: "6px 8px",
          }}
        />

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, minHeight: 180 }}>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="対象テキスト"
            style={{
              width: "100%",
              borderRadius: 8,
              border: "1px solid var(--input-border)",
              background: "var(--input-bg)",
              color: "var(--input-text)",
              fontSize: 13,
              padding: "8px 10px",
              resize: "vertical",
            }}
          />
          <textarea
            value={context}
            onChange={(e) => setContext(e.target.value)}
            placeholder="補足コンテキスト（任意）"
            style={{
              width: "100%",
              borderRadius: 8,
              border: "1px solid var(--input-border)",
              background: "var(--input-bg)",
              color: "var(--input-text)",
              fontSize: 13,
              padding: "8px 10px",
              resize: "vertical",
            }}
          />
        </div>

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
          <div style={{ fontSize: 11, color: "var(--muted)" }}>
            {mode === "sql_draft" && "このSQLは自動実行されません。提案のみです。"}
            {mode === "procedure" && "選択テキストを番号付き手順に変換します。"}
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button
              type="button"
              onClick={() => void handleSend()}
              disabled={loading}
              style={{
                padding: "8px 14px",
                borderRadius: 8,
                border: "1px solid var(--button-primary-bg)",
                background: "var(--button-primary-bg)",
                color: "var(--primary-contrast)",
                fontSize: 13,
                cursor: loading ? "wait" : "pointer",
              }}
            >
              {loading ? "実行中..." : "AIに送信"}
            </button>

            {source === "pages" && (
              <button
                type="button"
                onClick={() => void handleRunAndApplyToPages()}
                disabled={loading || (!text.trim() && !context.trim())}
                style={{
                  padding: "8px 14px",
                  borderRadius: 8,
                  border: "1px solid var(--border)",
                  background: "var(--surface-2)",
                  color: "var(--text)",
                  fontSize: 13,
                  fontWeight: 500,
                  cursor: loading || (!text.trim() && !context.trim()) ? "not-allowed" : "pointer",
                }}
              >
                {loading ? "処理中..." : result ? "Pagesに適用して閉じる" : "実行してPagesに適用"}
              </button>
            )}
          </div>
        </div>

        {error && (
          <div
            style={{
              marginTop: 4,
              padding: "6px 8px",
              borderRadius: 8,
              border: "1px solid #fecaca",
              background: "#fff1f2",
              color: "#b91c1c",
              fontSize: 12,
            }}
          >
            {error}
          </div>
        )}

        <div
          style={{
            marginTop: 6,
            padding: "8px 10px",
            borderRadius: 10,
            border: "1px solid var(--border)",
            background: "var(--surface-2)",
            minHeight: 80,
            display: "flex",
            flexDirection: "column",
            gap: 6,
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 12, color: "var(--muted)" }}>AI出力</span>
            <div style={{ display: "flex", gap: 6 }}>
              <button
                type="button"
                onClick={handleCopy}
                disabled={!result}
                style={{
                  padding: "4px 8px",
                  borderRadius: 6,
                  border: "1px solid var(--button-secondary-border)",
                  background: "var(--button-secondary-bg)",
                  color: "var(--button-secondary-text)",
                  fontSize: 12,
                  cursor: result ? "pointer" : "not-allowed",
                }}
              >
                コピー
              </button>
              <button
                type="button"
                onClick={handleApplyToPages}
                disabled={!result || source !== "pages"}
                style={{
                  padding: "4px 8px",
                  borderRadius: 6,
                  border: "1px solid var(--button-secondary-border)",
                  background: source === "pages" && result ? "var(--button-secondary-bg)" : "var(--surface)",
                  color: source === "pages" && result ? "var(--button-secondary-text)" : "var(--muted)",
                  fontSize: 12,
                  cursor: !result || source !== "pages" ? "not-allowed" : "pointer",
                }}
              >
                Pagesに適用
              </button>
            </div>
          </div>
          <div
            style={{
              fontSize: 13,
              color: "var(--text)",
              whiteSpace: "pre-wrap",
              overflowY: "auto",
              maxHeight: 200,
            }}
          >
            {loading && !result ? "実行中..." : result || "ここにAIの出力が表示されます。"}
          </div>
        </div>
      </div>
    </div>
  )
}
