"use client"

import { diffWords } from "diff"
import { useCallback, useEffect, useMemo, useState } from "react"
import { supabase } from "@/lib/supabase"
import type {
  AiApiSuccessPayload,
  AiApplyTransform,
  AiHistoryItem,
  AiHistoryResponsePayload,
  AiMeta,
  AiMode,
  AiSource,
  AiTextResult,
  ApplyAiResultDetail,
  OpenAiPaletteDetail,
} from "@/lib/aiClientEvents"

const MODE_LABELS: Record<AiMode, string> = {
  summarize: "要約",
  rewrite: "書き換え",
  format: "整形",
  headings: "見出し案",
  checklist: "チェックリスト",
  sql_draft: "SQL 下書き",
  procedure: "手順化",
  title_ideas: "タイトル案",
  status_summary: "状況要約",
  delay_summary: "遅延要約",
  task_rewrite: "タスク文変換",
  request_title: "請求依頼タイトル",
  request_message: "請求依頼本文",
  reject_reason: "差し戻し理由整形",
  send_message: "送付メッセージ",
}

const MODE_DESCRIPTIONS: Record<AiMode, string> = {
  summarize: "内容を短く整理します。",
  rewrite: "意味を変えずに読みやすく書き換えます。",
  format: "箇条書きや改行で見やすく整えます。",
  headings: "見出しや構成案を出します。",
  checklist: "実務向けのチェックリストに変換します。",
  sql_draft: "Supabase / PostgreSQL 向けの SQL 下書きを作ります。",
  procedure: "手順書形式に変換します。",
  title_ideas: "短い候補を複数出します。",
  status_summary: "社内共有しやすい短い状況要約にします。",
  delay_summary: "遅延理由、影響、次アクションを短く整理します。",
  task_rewrite: "依頼しやすいタスク文に書き換えます。",
  request_title: "請求依頼の件名候補を複数出します。",
  request_message: "請求依頼本文のたたき台を作ります。",
  reject_reason: "差し戻し理由を丁寧で実務的な文面に整えます。",
  send_message: "請求書や PDF 送付時の添え文を作ります。",
}

const HISTORY_LIMIT = 6

function defaultModesForSource(source: AiSource): AiMode[] {
  switch (source) {
    case "pages":
      return ["summarize", "rewrite", "format", "headings", "procedure", "checklist"]
    case "sql":
      return ["sql_draft"]
    case "contents":
      return ["title_ideas", "status_summary", "delay_summary", "task_rewrite"]
    case "billing":
      return ["request_title", "request_message", "send_message"]
    case "vendor":
      return ["reject_reason"]
    default:
      return ["summarize", "rewrite", "format", "headings", "procedure"]
  }
}

function defaultApplyLabel(source: AiSource) {
  switch (source) {
    case "pages":
      return "Pages に反映"
    case "contents":
      return "下書きに反映"
    case "billing":
      return "フォームに反映"
    case "vendor":
      return "文面に反映"
    default:
      return null
  }
}

function applyTransform(result: string, transform: AiApplyTransform) {
  if (transform === "first_line") {
    return (
      result
        .split(/\r?\n/)
        .map((line) => line.trim())
        .find(Boolean) ?? ""
    )
  }
  return result
}

function formatHistoryTime(value: string) {
  if (!value) return ""
  try {
    return new Date(value).toLocaleString("ja-JP", {
      month: "numeric",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    })
  } catch {
    return ""
  }
}

function stringMetaValue(meta: AiMeta | undefined, key: string) {
  const value = meta?.[key]
  return typeof value === "string" && value.trim() ? value.trim() : null
}

function buildHistoryHref({
  source,
  mode,
  applyTarget,
  recordId,
  sourceObject,
}: {
  source: AiSource
  mode: AiMode
  applyTarget?: string
  recordId?: string | null
  sourceObject?: string | null
}) {
  const params = new URLSearchParams({ source, mode })
  if (applyTarget) params.set("applyTarget", applyTarget)
  if (recordId) params.set("recordId", recordId)
  if (sourceObject) params.set("sourceObject", sourceObject)
  return `/settings/ai-history?${params.toString()}`
}

function sourceNoteText(source: AiSource, mode: AiMode) {
  if (source === "pages") {
    return "Pages は生成後に差分を確認してから反映してください。"
  }
  if (source === "contents" || source === "billing" || source === "vendor") {
    return "AI はローカル下書きだけを更新します。保存や送信は既存の操作で確定してください。"
  }
  if (mode === "sql_draft") {
    return "SQL は下書きのみです。実行前に必ず内容を確認してください。"
  }
  return null
}

export default function AIPalette() {
  const [open, setOpen] = useState(false)
  const [mode, setMode] = useState<AiMode>("summarize")
  const [availableModes, setAvailableModes] = useState<AiMode[]>(defaultModesForSource("other"))
  const [instruction, setInstruction] = useState("")
  const [text, setText] = useState("")
  const [context, setContext] = useState("")
  const [result, setResult] = useState<AiTextResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [source, setSource] = useState<AiSource>("other")
  const [title, setTitle] = useState<string | null>(null)
  const [compareText, setCompareText] = useState("")
  const [applyLabel, setApplyLabel] = useState<string | null>(null)
  const [applyTarget, setApplyTarget] = useState<string | undefined>(undefined)
  const [applyMode, setApplyMode] = useState<AiApplyTransform>("raw")
  const [meta, setMeta] = useState<AiMeta | undefined>(undefined)
  const [history, setHistory] = useState<AiHistoryItem[]>([])
  const [historyLoading, setHistoryLoading] = useState(false)

  const diffParts = useMemo(() => {
    if (!compareText.trim() || !result?.text.trim()) return []
    return diffWords(compareText, result.text)
  }, [compareText, result])

  const recordId = useMemo(() => stringMetaValue(meta, "recordId"), [meta])
  const sourceObject = useMemo(() => stringMetaValue(meta, "sourceObject"), [meta])
  const recordLabel = useMemo(() => stringMetaValue(meta, "recordLabel"), [meta])
  const historyHref = useMemo(
    () =>
      buildHistoryHref({
        source,
        mode,
        applyTarget,
        recordId,
        sourceObject,
      }),
    [applyTarget, mode, recordId, source, sourceObject]
  )

  const close = useCallback(() => {
    setOpen(false)
    setError(null)
    setLoading(false)
  }, [])

  const resetForOpen = useCallback((detail?: OpenAiPaletteDetail) => {
    const nextSource = detail?.source ?? "other"
    const nextModes = detail?.modes?.length ? detail.modes : defaultModesForSource(nextSource)
    const nextMode = detail?.mode && nextModes.includes(detail.mode) ? detail.mode : nextModes[0]

    setSource(nextSource)
    setAvailableModes(nextModes)
    setMode(nextMode)
    setInstruction("")
    setText(detail?.text ?? window.getSelection()?.toString() ?? "")
    setContext(detail?.context ?? "")
    setTitle(detail?.title ?? null)
    setCompareText(detail?.compareText ?? detail?.text ?? "")
    setApplyLabel(detail?.applyLabel ?? defaultApplyLabel(nextSource))
    setApplyTarget(detail?.applyTarget)
    setApplyMode(detail?.applyTransform ?? "raw")
    setMeta(detail?.meta)
    setResult(null)
    setHistory([])
    setError(null)
    setOpen(true)
  }, [])

  const handleGlobalKey = useCallback(
    (event: KeyboardEvent) => {
      const isMac = navigator.platform.toLowerCase().includes("mac")
      const metaKey = isMac ? event.metaKey : event.ctrlKey
      if (!metaKey || event.key.toLowerCase() !== "k") return
      event.preventDefault()
      resetForOpen({
        source: "other",
        text: window.getSelection()?.toString() ?? "",
      })
    },
    [resetForOpen]
  )

  useEffect(() => {
    window.addEventListener("keydown", handleGlobalKey)

    const openHandler = (event: Event) => {
      resetForOpen((event as CustomEvent<OpenAiPaletteDetail>).detail)
    }

    const closeHandler = (event: KeyboardEvent) => {
      if (event.key === "Escape") close()
    }

    window.addEventListener("open-ai-palette", openHandler as EventListener)
    window.addEventListener("keydown", closeHandler)
    return () => {
      window.removeEventListener("keydown", handleGlobalKey)
      window.removeEventListener("open-ai-palette", openHandler as EventListener)
      window.removeEventListener("keydown", closeHandler)
    }
  }, [close, handleGlobalKey, resetForOpen])

  const loadHistory = useCallback(async () => {
    if (!open) return

    setHistoryLoading(true)
    try {
      const { data } = await supabase.auth.getSession()
      const token = data.session?.access_token
      const params = new URLSearchParams({
        source,
        mode,
        limit: String(HISTORY_LIMIT),
      })
      if (applyTarget) params.set("applyTarget", applyTarget)
      if (recordId) params.set("recordId", recordId)
      if (sourceObject) params.set("sourceObject", sourceObject)
      const res = await fetch(`/api/ai/history?${params.toString()}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      })
      if (!res.ok) {
        setHistory([])
        return
      }
      const json = (await res.json().catch(() => null)) as AiHistoryResponsePayload | null
      setHistory(Array.isArray(json?.items) ? json.items : [])
    } catch {
      setHistory([])
    } finally {
      setHistoryLoading(false)
    }
  }, [applyTarget, mode, open, recordId, source, sourceObject])

  useEffect(() => {
    void loadHistory()
  }, [loadHistory])

  const handleSend = useCallback(async (): Promise<string | null> => {
    if (!text.trim() && !context.trim()) {
      setError("テキストまたはコンテキストを入力してください。")
      return null
    }

    setLoading(true)
    setError(null)
    setResult(null)

    try {
      const { data } = await supabase.auth.getSession()
      const token = data.session?.access_token
      const res = await fetch("/api/ai", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ mode, instruction, text, context, source, applyTarget, meta }),
      })

      const json = await res.json().catch(() => null)
      if (!res.ok) {
        setError(json?.error ?? "AI の生成に失敗しました。")
        return null
      }

      const nextResult = (json as AiApiSuccessPayload | null)?.result ?? null
      if (!nextResult?.text) {
        setError("AI の出力を受け取れませんでした。")
        return null
      }

      setResult(nextResult)
      setHistory((prev) => {
        const nextItem: AiHistoryItem = {
          id: `local-${Date.now()}`,
          source,
          mode: nextResult.mode,
          kind: nextResult.kind,
          text: nextResult.text,
          createdAt: new Date().toISOString(),
          applyTarget: applyTarget ?? null,
          meta: meta ?? null,
        }
        const deduped = prev.filter((item) => !(item.mode === nextItem.mode && item.text === nextItem.text))
        return [nextItem, ...deduped].slice(0, HISTORY_LIMIT)
      })
      return nextResult.text
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "AI の生成に失敗しました。")
      return null
    } finally {
      setLoading(false)
    }
  }, [applyTarget, context, instruction, meta, mode, source, text])

  const handleCopy = useCallback(async () => {
    if (!result?.text) return
    try {
      await navigator.clipboard.writeText(result.text)
    } catch {
      setError("コピーに失敗しました。")
    }
  }, [result])

  const handleApply = useCallback(() => {
    if (!result || !applyLabel) return
    const finalText = applyTransform(result.text, applyMode)
    const detail: ApplyAiResultDetail = {
      source,
      mode,
      result: { ...result, text: finalText },
      applyTarget,
      meta,
    }
    window.dispatchEvent(new CustomEvent("apply-ai-result", { detail }))
    close()
  }, [applyLabel, applyMode, applyTarget, close, meta, mode, result, source])

  const restoreHistoryItem = useCallback((item: AiHistoryItem) => {
    setMode(item.mode)
    setApplyTarget(item.applyTarget ?? undefined)
    setMeta(item.meta ?? undefined)
    setResult({
      kind: item.kind,
      mode: item.mode,
      text: item.text,
    })
    setError(null)
  }, [])

  const sourceNote = sourceNoteText(source, mode)

  if (!open) return null

  return (
    <div
      onClick={close}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 60,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "rgba(15,23,42,0.45)",
        padding: 16,
      }}
    >
      <div
        onClick={(event) => event.stopPropagation()}
        style={{
          width: "min(920px, 100%)",
          maxHeight: "86vh",
          borderRadius: 16,
          border: "1px solid var(--border)",
          background: "var(--surface)",
          boxShadow: "var(--shadow-lg)",
          padding: 16,
          display: "flex",
          flexDirection: "column",
          gap: 12,
          overflow: "auto",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
          <div style={{ fontSize: 13, color: "var(--muted)" }}>{title ?? "AI Palette"} / Cmd(Ctrl)+K</div>
          <button
            type="button"
            onClick={close}
            aria-label="閉じる"
            style={{
              border: "none",
              background: "transparent",
              color: "var(--muted)",
              cursor: "pointer",
              fontSize: 16,
              lineHeight: 1,
            }}
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
          1. モードを選ぶ 2. テキストと文脈を確認する 3. AI 生成で結果を見る 4. 必要なら反映する
        </div>

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {availableModes.map((item) => (
            <button
              key={item}
              type="button"
              onClick={() => setMode(item)}
              aria-pressed={mode === item}
              style={{
                padding: "6px 10px",
                borderRadius: 999,
                border: mode === item ? "1px solid rgba(37,99,235,0.9)" : "1px solid var(--border)",
                background: mode === item ? "rgba(37,99,235,0.12)" : "var(--surface)",
                color: mode === item ? "var(--text)" : "var(--muted)",
                fontSize: 12,
                fontWeight: mode === item ? 800 : 500,
                cursor: "pointer",
              }}
            >
              {MODE_LABELS[item]}
            </button>
          ))}
        </div>

        <div style={{ marginTop: -2, fontSize: 12, color: "var(--muted)" }}>
          <strong style={{ color: "var(--text)" }}>現在のモード:</strong> {MODE_LABELS[mode]} - {MODE_DESCRIPTIONS[mode]}
          {applyMode === "first_line" ? " / 反映時は1行目のみ使います" : ""}
        </div>

        <textarea
          value={instruction}
          onChange={(event) => setInstruction(event.target.value)}
          placeholder="追加の指示があれば入力してください"
          style={{
            width: "100%",
            minHeight: 42,
            borderRadius: 8,
            border: "1px solid var(--input-border)",
            background: "var(--input-bg)",
            color: "var(--input-text)",
            fontSize: 13,
            padding: "8px 10px",
            boxSizing: "border-box",
          }}
        />

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, minHeight: 180 }}>
          <textarea
            value={text}
            onChange={(event) => setText(event.target.value)}
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
              boxSizing: "border-box",
            }}
          />
          <textarea
            value={context}
            onChange={(event) => setContext(event.target.value)}
            placeholder="補足コンテキスト"
            style={{
              width: "100%",
              borderRadius: 8,
              border: "1px solid var(--input-border)",
              background: "var(--input-bg)",
              color: "var(--input-text)",
              fontSize: 13,
              padding: "8px 10px",
              resize: "vertical",
              boxSizing: "border-box",
            }}
          />
        </div>

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <div style={{ fontSize: 11, color: "var(--muted)", maxWidth: 620 }}>{sourceNote}</div>
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
              {loading ? "生成中..." : "AI 生成"}
            </button>

            {applyLabel ? (
              <button
                type="button"
                onClick={handleApply}
                disabled={!result?.text}
                style={{
                  padding: "8px 14px",
                  borderRadius: 8,
                  border: "1px solid var(--border)",
                  background: result?.text ? "var(--surface-2)" : "var(--surface)",
                  color: result?.text ? "var(--text)" : "var(--muted)",
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: result?.text ? "pointer" : "not-allowed",
                }}
              >
                {applyLabel}
              </button>
            ) : null}
          </div>
        </div>

        {error ? (
          <div
            style={{
              padding: "6px 8px",
              borderRadius: 8,
              border: "1px solid var(--error-border)",
              background: "var(--error-bg)",
              color: "var(--error-text)",
              fontSize: 12,
            }}
          >
            {error}
          </div>
        ) : null}

        <div
          style={{
            padding: "10px 12px",
            borderRadius: 10,
            border: "1px solid var(--border)",
            background: "var(--surface-2)",
            minHeight: 96,
            display: "flex",
            flexDirection: "column",
            gap: 10,
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <span style={{ fontSize: 12, color: "var(--muted)" }}>AI 出力</span>
              {result?.kind ? (
                <span
                  style={{
                    fontSize: 11,
                    padding: "2px 8px",
                    borderRadius: 999,
                    border: "1px solid var(--border)",
                    background: "var(--surface)",
                    color: "var(--muted)",
                  }}
                >
                  {result.kind}
                </span>
              ) : null}
            </div>
            <button
              type="button"
              onClick={() => void handleCopy()}
              disabled={!result?.text}
              style={{
                padding: "4px 8px",
                borderRadius: 6,
                border: "1px solid var(--button-secondary-border)",
                background: "var(--button-secondary-bg)",
                color: "var(--button-secondary-text)",
                fontSize: 12,
                cursor: result?.text ? "pointer" : "not-allowed",
              }}
            >
              コピー
            </button>
          </div>

          {compareText.trim() && result?.text.trim() ? (
            <div style={{ display: "grid", gap: 10 }}>
              <div style={{ fontSize: 12, color: "var(--muted)" }}>反映前後を比較</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                <div style={{ border: "1px solid var(--border)", borderRadius: 8, padding: 10, background: "var(--surface)" }}>
                  <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 6 }}>元テキスト</div>
                  <div style={{ whiteSpace: "pre-wrap", fontSize: 13, color: "var(--text)", maxHeight: 180, overflowY: "auto" }}>{compareText}</div>
                </div>
                <div style={{ border: "1px solid var(--border)", borderRadius: 8, padding: 10, background: "var(--surface)" }}>
                  <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 6 }}>生成結果</div>
                  <div style={{ whiteSpace: "pre-wrap", fontSize: 13, color: "var(--text)", maxHeight: 180, overflowY: "auto" }}>
                    {loading && !result ? "生成中..." : result?.text || "ここに AI の出力が表示されます。"}
                  </div>
                </div>
              </div>
              <div style={{ border: "1px solid var(--border)", borderRadius: 8, padding: 10, background: "var(--surface)" }}>
                <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 6 }}>差分プレビュー</div>
                <div style={{ whiteSpace: "pre-wrap", fontSize: 13, color: "var(--text)", maxHeight: 180, overflowY: "auto", lineHeight: 1.7 }}>
                  {diffParts.length === 0
                    ? "差分はありません。"
                    : diffParts.map((part, index) => (
                        <span
                          key={`${part.value}-${index}`}
                          style={{
                            background: part.added ? "var(--success-bg)" : part.removed ? "var(--error-bg)" : "transparent",
                            color: part.removed ? "var(--error-text)" : "inherit",
                            textDecoration: part.removed ? "line-through" : "none",
                          }}
                        >
                          {part.value}
                        </span>
                      ))}
                </div>
              </div>
            </div>
          ) : (
            <div style={{ fontSize: 13, color: "var(--text)", whiteSpace: "pre-wrap", overflowY: "auto", maxHeight: 220 }}>
              {loading && !result ? "生成中..." : result?.text || "ここに AI の出力が表示されます。"}
            </div>
          )}
        </div>

        <div
          style={{
            padding: "10px 12px",
            borderRadius: 10,
            border: "1px solid var(--border)",
            background: "var(--surface)",
            display: "grid",
            gap: 8,
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text)" }}>最近の候補</div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <div style={{ fontSize: 11, color: "var(--muted)" }}>
                {recordLabel || recordId ? `${recordLabel ?? recordId} の履歴` : "同じ source / mode の履歴"}
              </div>
              <a
                href={historyHref}
                target="_blank"
                rel="noreferrer"
                style={{ fontSize: 11, color: "var(--primary)", fontWeight: 700, textDecoration: "none" }}
              >
                履歴ページ
              </a>
            </div>
          </div>

          {historyLoading ? (
            <div style={{ fontSize: 12, color: "var(--muted)" }}>履歴を読み込み中...</div>
          ) : history.length === 0 ? (
            <div style={{ fontSize: 12, color: "var(--muted)" }}>まだ候補履歴はありません。</div>
          ) : (
            <div style={{ display: "grid", gap: 8 }}>
              {history.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => restoreHistoryItem(item)}
                  style={{
                    textAlign: "left",
                    border: "1px solid var(--border)",
                    borderRadius: 10,
                    background: "var(--surface-2)",
                    padding: "10px 12px",
                    cursor: "pointer",
                    display: "grid",
                    gap: 6,
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
                    <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                      <span style={{ fontSize: 12, fontWeight: 700, color: "var(--text)" }}>{MODE_LABELS[item.mode]}</span>
                      <span
                        style={{
                          fontSize: 10,
                          padding: "2px 6px",
                          borderRadius: 999,
                          border: "1px solid var(--border)",
                          color: "var(--muted)",
                          background: "var(--surface)",
                        }}
                      >
                        {item.kind}
                      </span>
                      {item.applyTarget ? (
                        <span style={{ fontSize: 10, color: "var(--muted)" }}>{item.applyTarget}</span>
                      ) : null}
                    </div>
                    <span style={{ fontSize: 11, color: "var(--muted)" }}>{formatHistoryTime(item.createdAt)}</span>
                  </div>
                  <div
                    style={{
                      fontSize: 12,
                      color: "var(--text)",
                      lineHeight: 1.6,
                      whiteSpace: "pre-wrap",
                      display: "-webkit-box",
                      WebkitLineClamp: 3,
                      WebkitBoxOrient: "vertical",
                      overflow: "hidden",
                    }}
                  >
                    {item.text}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
