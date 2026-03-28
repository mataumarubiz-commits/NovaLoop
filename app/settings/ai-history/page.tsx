"use client"

import { useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { useSearchParams } from "next/navigation"
import { supabase } from "@/lib/supabase"
import { useAuthOrg } from "@/hooks/useAuthOrg"
import type { AiHistoryItem, AiHistoryResponsePayload, AiMode, AiSource } from "@/lib/aiClientEvents"

const SOURCE_OPTIONS: Array<{ value: AiSource; label: string }> = [
  { value: "contents", label: "Contents" },
  { value: "billing", label: "Billing" },
  { value: "vendor", label: "Vendor" },
  { value: "pages", label: "Pages" },
  { value: "sql", label: "SQL" },
  { value: "other", label: "Other" },
]

const MODE_OPTIONS: Array<{ value: AiMode; label: string }> = [
  { value: "summarize", label: "要約" },
  { value: "rewrite", label: "書き換え" },
  { value: "format", label: "整形" },
  { value: "headings", label: "見出し案" },
  { value: "checklist", label: "チェックリスト" },
  { value: "procedure", label: "手順" },
  { value: "sql_draft", label: "SQL 下書き" },
  { value: "title_ideas", label: "タイトル案" },
  { value: "status_summary", label: "状況要約" },
  { value: "delay_summary", label: "遅延要約" },
  { value: "task_rewrite", label: "タスク文変換" },
  { value: "request_title", label: "請求依頼件名" },
  { value: "request_message", label: "請求依頼本文" },
  { value: "send_message", label: "送付添え文" },
  { value: "reject_reason", label: "差し戻し理由" },
]

function formatHistoryTime(value: string) {
  if (!value) return "-"
  try {
    return new Date(value).toLocaleString("ja-JP", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    })
  } catch {
    return value
  }
}

function metaText(value: unknown) {
  return typeof value === "string" && value.trim() ? value : ""
}

export default function AiHistoryPage() {
  const searchParams = useSearchParams()
  const { user, loading: authLoading } = useAuthOrg()
  const [source, setSource] = useState(searchParams.get("source") ?? "")
  const [mode, setMode] = useState(searchParams.get("mode") ?? "")
  const [applyTarget, setApplyTarget] = useState(searchParams.get("applyTarget") ?? "")
  const [recordId, setRecordId] = useState(searchParams.get("recordId") ?? "")
  const [sourceObject, setSourceObject] = useState(searchParams.get("sourceObject") ?? "")
  const [items, setItems] = useState<AiHistoryItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const queryString = useMemo(() => {
    const params = new URLSearchParams({ limit: "30" })
    if (source) params.set("source", source)
    if (mode) params.set("mode", mode)
    if (applyTarget) params.set("applyTarget", applyTarget)
    if (recordId) params.set("recordId", recordId)
    if (sourceObject) params.set("sourceObject", sourceObject)
    return params.toString()
  }, [applyTarget, mode, recordId, source, sourceObject])

  useEffect(() => {
    if (!user) {
      setLoading(false)
      return
    }

    let active = true

    const load = async () => {
      setLoading(true)
      setError(null)

      try {
        const token = (await supabase.auth.getSession()).data.session?.access_token
        const res = await fetch(`/api/ai/history?${queryString}`, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        })
        const json = (await res.json().catch(() => null)) as AiHistoryResponsePayload | { error?: string } | null
        if (!active) return

        if (!res.ok) {
          setError((json as { error?: string } | null)?.error ?? "AI 履歴の取得に失敗しました。")
          setItems([])
          return
        }

        setItems(Array.isArray((json as AiHistoryResponsePayload | null)?.items) ? (json as AiHistoryResponsePayload).items : [])
      } catch (nextError) {
        if (!active) return
        setError(nextError instanceof Error ? nextError.message : "AI 履歴の取得に失敗しました。")
        setItems([])
      } finally {
        if (active) setLoading(false)
      }
    }

    void load()
    return () => {
      active = false
    }
  }, [queryString, user])

  if (authLoading || loading) {
    return <div style={{ padding: 32, color: "var(--muted)" }}>読み込み中...</div>
  }

  if (!user) {
    return <div style={{ padding: 32, color: "var(--muted)" }}>ログインしてください。</div>
  }

  return (
    <div style={{ minHeight: "100vh", background: "var(--bg-grad)", padding: "32px 24px 48px" }}>
      <div style={{ maxWidth: 980, margin: "0 auto", display: "grid", gap: 16 }}>
        <header style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "start", flexWrap: "wrap" }}>
          <div>
            <Link href="/settings" style={{ color: "var(--primary)", textDecoration: "none", fontWeight: 700 }}>
              設定に戻る
            </Link>
            <h1 style={{ margin: "12px 0 8px", fontSize: 28, color: "var(--text)" }}>AI 履歴</h1>
            <p style={{ margin: 0, color: "var(--muted)", lineHeight: 1.7 }}>
              自分が生成した AI 候補を source / mode / applyTarget / record 単位で確認できます。
            </p>
          </div>
        </header>

        <section style={{ border: "1px solid var(--border)", borderRadius: 14, padding: 16, background: "var(--surface)", display: "grid", gap: 12 }}>
          <div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))" }}>
            <label style={{ display: "grid", gap: 6 }}>
              <span style={{ fontSize: 12, color: "var(--muted)" }}>source</span>
              <select value={source} onChange={(event) => setSource(event.target.value)} style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--border)", background: "var(--input-bg)" }}>
                <option value="">すべて</option>
                {SOURCE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>

            <label style={{ display: "grid", gap: 6 }}>
              <span style={{ fontSize: 12, color: "var(--muted)" }}>mode</span>
              <select value={mode} onChange={(event) => setMode(event.target.value)} style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--border)", background: "var(--input-bg)" }}>
                <option value="">すべて</option>
                {MODE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>

            <label style={{ display: "grid", gap: 6 }}>
              <span style={{ fontSize: 12, color: "var(--muted)" }}>applyTarget</span>
              <input value={applyTarget} onChange={(event) => setApplyTarget(event.target.value)} style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--border)", background: "var(--input-bg)" }} />
            </label>

            <label style={{ display: "grid", gap: 6 }}>
              <span style={{ fontSize: 12, color: "var(--muted)" }}>sourceObject</span>
              <input value={sourceObject} onChange={(event) => setSourceObject(event.target.value)} style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--border)", background: "var(--input-bg)" }} />
            </label>

            <label style={{ display: "grid", gap: 6 }}>
              <span style={{ fontSize: 12, color: "var(--muted)" }}>recordId</span>
              <input value={recordId} onChange={(event) => setRecordId(event.target.value)} style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--border)", background: "var(--input-bg)" }} />
            </label>
          </div>

          <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <div style={{ fontSize: 12, color: "var(--muted)" }}>現在のクエリ: {queryString}</div>
            <button
              type="button"
              onClick={() => {
                setSource("")
                setMode("")
                setApplyTarget("")
                setRecordId("")
                setSourceObject("")
              }}
              style={{ padding: "8px 12px", borderRadius: 10, border: "1px solid var(--border)", background: "var(--surface-2)", cursor: "pointer", fontWeight: 700 }}
            >
              フィルタをクリア
            </button>
          </div>
        </section>

        <section style={{ border: "1px solid var(--border)", borderRadius: 14, padding: 16, background: "var(--surface)", display: "grid", gap: 12 }}>
          {error ? <div style={{ color: "var(--error-text)" }}>{error}</div> : null}

          {items.length === 0 ? (
            <div style={{ color: "var(--muted)" }}>該当する履歴はありません。</div>
          ) : (
            items.map((item) => {
              const metaSummary = [metaText(item.meta?.recordLabel), metaText(item.meta?.sourceObject), metaText(item.meta?.recordId)]
                .filter(Boolean)
                .join(" / ")

              return (
                <article key={item.id} style={{ border: "1px solid var(--border)", borderRadius: 12, padding: 14, display: "grid", gap: 8 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
                    <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                      <strong style={{ color: "var(--text)" }}>{item.source}</strong>
                      <span style={{ fontSize: 12, color: "var(--muted)" }}>{item.mode}</span>
                      <span style={{ fontSize: 11, padding: "2px 8px", borderRadius: 999, border: "1px solid var(--border)", color: "var(--muted)" }}>{item.kind}</span>
                      {item.applyTarget ? <span style={{ fontSize: 11, color: "var(--muted)" }}>{item.applyTarget}</span> : null}
                    </div>
                    <span style={{ fontSize: 12, color: "var(--muted)" }}>{formatHistoryTime(item.createdAt)}</span>
                  </div>

                  {metaSummary ? <div style={{ fontSize: 12, color: "var(--muted)" }}>{metaSummary}</div> : null}

                  <div style={{ whiteSpace: "pre-wrap", lineHeight: 1.7, color: "var(--text)" }}>{item.text}</div>
                </article>
              )
            })
          )}
        </section>
      </div>
    </div>
  )
}
