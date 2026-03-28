"use client"

import Link from "next/link"
import { useSearchParams } from "next/navigation"
import { useEffect, useState } from "react"
import { useAuthOrg } from "@/hooks/useAuthOrg"
import { supabase } from "@/lib/supabase"

type DashboardResponse = {
  ok: boolean
  summary: {
    weekly_active_users: number
    incomplete_onboarding_count: number
    first_value_rate: number
    template_usage_count: number
    ai_usage_count: number
    notification_click_count: number
    help_article_view_count: number
    vendor_invoice_submitted_count: number
  }
  feedback: Array<{
    id: string
    category: string
    created_at: string
    page_path: string | null
  }>
}

const cardStyle: React.CSSProperties = {
  border: "1px solid rgba(167, 139, 250, 0.24)",
  borderRadius: 18,
  padding: 18,
  background: "linear-gradient(180deg, rgba(255,255,255,0.96), rgba(248,244,255,0.96))",
  boxShadow: "var(--shadow-lg)",
}

export default function SettingsDashboardPage() {
  const { role, loading: authLoading } = useAuthOrg({ redirectToOnboarding: true })
  const canAccess = role === "owner" || role === "executive_assistant"
  const searchParams = useSearchParams()
  const [loading, setLoading] = useState(true)
  const [data, setData] = useState<DashboardResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [sending, setSending] = useState(false)
  const [feedbackDone, setFeedbackDone] = useState<string | null>(null)
  const [category, setCategory] = useState(searchParams.get("type") === "bug" ? "bug" : "feedback")
  const [message, setMessage] = useState("")

  useEffect(() => {
    if (!canAccess) {
      setLoading(false)
      return
    }
    let active = true

    const load = async () => {
      setLoading(true)
      setError(null)
      const token = (await supabase.auth.getSession()).data.session?.access_token
      if (!token) {
        if (active) {
          setError("ログイン状態を確認してください")
          setLoading(false)
        }
        return
      }

      const res = await fetch("/api/settings/dashboard", {
        headers: { Authorization: `Bearer ${token}` },
      })
      const json = (await res.json().catch(() => null)) as DashboardResponse | { error?: string } | null
      if (!active) return
      if (!res.ok || !json || !("ok" in json)) {
        setError((json as { error?: string } | null)?.error ?? "運用ダッシュボードの取得に失敗しました")
        setLoading(false)
        return
      }

      setData(json)
      setLoading(false)
    }

    void load()
    return () => {
      active = false
    }
  }, [canAccess])

  const submitFeedback = async () => {
    if (!message.trim()) return
    setSending(true)
    setFeedbackDone(null)
    setError(null)
    try {
      const token = (await supabase.auth.getSession()).data.session?.access_token
      if (!token) {
        setError("ログイン状態を確認してください")
        return
      }
      const res = await fetch("/api/feedback", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          category,
          message: message.trim(),
          page_path: searchParams.get("context") || "/settings/dashboard",
        }),
      })
      const json = (await res.json().catch(() => null)) as { ok?: boolean; error?: string } | null
      if (!res.ok || !json?.ok) {
        setError(json?.error ?? "フィードバックの送信に失敗しました")
        return
      }
      setMessage("")
      setFeedbackDone(category === "bug" ? "バグ報告を受け付けました" : "改善要望を受け付けました")
    } finally {
      setSending(false)
    }
  }

  if (authLoading || loading) {
    return <div style={{ padding: 32, color: "var(--muted)" }}>読み込み中...</div>
  }

  if (!canAccess) {
    return <div style={{ padding: 32, color: "var(--muted)" }}>owner / executive_assistant のみ利用できます。</div>
  }

  return (
    <div style={{ minHeight: "100vh", background: "var(--bg-grad)", padding: "32px 24px 56px" }}>
      <div style={{ maxWidth: 1080, margin: "0 auto", display: "grid", gap: 18 }}>
        <header style={{ display: "flex", justifyContent: "space-between", gap: 16, flexWrap: "wrap", alignItems: "end" }}>
          <div>
            <p style={{ margin: 0, fontSize: 12, letterSpacing: "0.08em", color: "var(--muted)" }}>Operations Dashboard</p>
            <h1 style={{ margin: "6px 0 8px", fontSize: 28, color: "var(--text)" }}>運用ダッシュボード</h1>
            <p style={{ margin: 0, fontSize: 13, color: "var(--muted)" }}>
              導入状況、ヘルプ活用、AI利用、通知反応を最小構成で確認できます。
            </p>
          </div>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <Link href="/help/setup" style={{ color: "var(--primary)", fontWeight: 700, textDecoration: "none" }}>
              使い方を見る
            </Link>
            <Link href="/home" style={{ color: "var(--primary)", fontWeight: 700, textDecoration: "none" }}>
              ホームへ
            </Link>
          </div>
        </header>

        {error ? (
          <section style={{ ...cardStyle, borderColor: "var(--error-border)", background: "var(--error-bg)", color: "var(--error-text)" }}>{error}</section>
        ) : null}

        {data ? (
          <section style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12 }}>
            {[
              ["今週のアクティブユーザー", `${data.summary.weekly_active_users}人`],
              ["未完了オンボーディング", `${data.summary.incomplete_onboarding_count}件`],
              ["初回価値到達率", `${data.summary.first_value_rate}%`],
              ["テンプレ使用数", `${data.summary.template_usage_count}回`],
              ["AI利用数", `${data.summary.ai_usage_count}回`],
              ["通知クリック数", `${data.summary.notification_click_count}回`],
              ["ヘルプ記事閲覧数", `${data.summary.help_article_view_count}回`],
              ["外注請求提出数", `${data.summary.vendor_invoice_submitted_count}件`],
            ].map(([label, value]) => (
              <div key={label} style={cardStyle}>
                <div style={{ fontSize: 12, color: "var(--muted)" }}>{label}</div>
                <div style={{ marginTop: 8, fontSize: 24, fontWeight: 800, color: "var(--text)" }}>{value}</div>
              </div>
            ))}
          </section>
        ) : null}

        <section style={{ display: "grid", gridTemplateColumns: "1.2fr 0.8fr", gap: 18 }}>
          <div style={cardStyle}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center", marginBottom: 12 }}>
              <div>
                <div style={{ fontSize: 12, color: "var(--muted)" }}>最近のフィードバック</div>
                <div style={{ fontSize: 18, fontWeight: 700, color: "var(--text)" }}>改善要望とバグ報告</div>
              </div>
            </div>
            {!data || data.feedback.length === 0 ? (
              <p style={{ margin: 0, color: "var(--muted)", fontSize: 13 }}>まだフィードバックはありません。</p>
            ) : (
              <div style={{ display: "grid", gap: 10 }}>
                {data.feedback.map((item) => (
                  <div key={item.id} style={{ border: "1px solid var(--border)", borderRadius: 12, padding: 12, background: "var(--surface)" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                      <strong style={{ color: "var(--text)" }}>{item.category === "bug" ? "バグ報告" : "改善要望"}</strong>
                      <span style={{ fontSize: 12, color: "var(--muted)" }}>{item.created_at.slice(0, 10)}</span>
                    </div>
                    <div style={{ marginTop: 6, fontSize: 12, color: "var(--muted)" }}>{item.page_path || "画面未指定"}</div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div style={cardStyle}>
            <div style={{ fontSize: 12, color: "var(--muted)" }}>声を集める</div>
            <div style={{ marginTop: 6, fontSize: 18, fontWeight: 700, color: "var(--text)" }}>改善要望 / バグ報告</div>
            <div style={{ marginTop: 12, display: "grid", gap: 10 }}>
              <select
                value={category}
                onChange={(event) => setCategory(event.target.value)}
                style={{ padding: "10px 12px", borderRadius: 12, border: "1px solid var(--border)", background: "var(--input-bg)" }}
              >
                <option value="feedback">改善要望</option>
                <option value="bug">バグ報告</option>
              </select>
              <textarea
                value={message}
                onChange={(event) => setMessage(event.target.value)}
                rows={6}
                placeholder="気づいたこと、困ったこと、追加してほしいことを書いてください。"
                style={{ padding: "12px 14px", borderRadius: 12, border: "1px solid var(--border)", background: "var(--input-bg)", resize: "vertical" }}
              />
              <button
                type="button"
                onClick={() => void submitFeedback()}
                disabled={sending || !message.trim()}
                style={{
                  padding: "10px 14px",
                  borderRadius: 12,
                  border: "none",
                  background: "var(--button-primary-bg)",
                  color: "var(--primary-contrast)",
                  fontWeight: 700,
                  cursor: sending || !message.trim() ? "not-allowed" : "pointer",
                }}
              >
                {sending ? "送信中..." : "送信する"}
              </button>
              {feedbackDone ? <div style={{ fontSize: 13, color: "var(--success-text)" }}>{feedbackDone}</div> : null}
            </div>
          </div>
        </section>
      </div>
    </div>
  )
}
