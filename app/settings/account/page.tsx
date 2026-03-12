"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { supabase } from "@/lib/supabase"
import { useAuthOrg } from "@/hooks/useAuthOrg"

export default function AccountSettingsPage() {
  const { user, profile, loading: authLoading, refresh } = useAuthOrg()
  const [displayName, setDisplayName] = useState("")
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<{ type: "error" | "success"; text: string } | null>(null)

  useEffect(() => {
    if (profile?.display_name != null) {
      setDisplayName(profile.display_name)
    }
  }, [profile?.display_name])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!user?.id) {
      setMessage({ type: "error", text: "ログイン情報を取得できませんでした。" })
      return
    }
    setSaving(true)
    setMessage(null)
    try {
      const { data } = await supabase.auth.getSession()
      const token = data.session?.access_token
      if (!token) {
        setMessage({ type: "error", text: "セッション情報を取得できませんでした。ログインし直してください。" })
        return
      }

      const res = await fetch("/api/account/display-name", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ displayName: displayName.trim() }),
      })
      const json = (await res.json().catch(() => null)) as { ok?: boolean; message?: string } | null
      if (!res.ok || !json?.ok) {
        setMessage({
          type: "error",
          text: json?.message ?? "保存に失敗しました。しばらくしてから再試行してください。",
        })
        return
      }
      await refresh()
      setMessage({ type: "success", text: "保存しました。" })
      setTimeout(() => setMessage(null), 3000)
    } catch {
      setMessage({
        type: "error",
        text: "保存に失敗しました。しばらくしてから再試行してください。",
      })
    } finally {
      setSaving(false)
    }
  }

  if (authLoading) {
    return (
      <div style={{ padding: "48px 24px", textAlign: "center", color: "var(--muted)" }}>
        読み込み中…
      </div>
    )
  }

  if (!user) {
    return (
      <div style={{ padding: "48px 24px", textAlign: "center" }}>
        <p style={{ color: "var(--muted)", marginBottom: 16 }}>ログインしてください。</p>
        <Link href="/" style={{ color: "var(--primary)", fontSize: 14 }}>
          ログインへ
        </Link>
      </div>
    )
  }

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "var(--bg-grad)",
        padding: "48px 24px",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
      }}
    >
      <div style={{ maxWidth: 420, width: "100%" }}>
        <h1
          style={{
            fontSize: 24,
            fontWeight: 600,
            color: "var(--text)",
            marginBottom: 8,
            textAlign: "center",
          }}
        >
          アカウント設定
        </h1>
        <p
          style={{
            fontSize: 14,
            color: "var(--muted)",
            marginBottom: 32,
            textAlign: "center",
          }}
        >
          表示名は組織をまたいで共通で使用されます。
        </p>

        <div
          style={{
            background: "var(--surface)",
            borderRadius: 16,
            border: "1px solid var(--border)",
            padding: "28px 24px",
            boxShadow: "0 4px 20px rgba(0,0,0,0.06)",
          }}
        >
          <form onSubmit={handleSubmit}>
            <label
              style={{
                display: "block",
                fontSize: 13,
                fontWeight: 600,
                color: "var(--text)",
                marginBottom: 8,
              }}
            >
              表示名
            </label>
            <input
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="表示名を入力"
              maxLength={100}
              style={{
                width: "100%",
                padding: "12px 14px",
                borderRadius: 10,
                border: "1px solid var(--input-border)",
                background: "var(--input-bg)",
                color: "var(--input-text)",
                fontSize: 14,
                boxSizing: "border-box",
              }}
            />
            {message && (
              <div
                style={{
                  marginTop: 12,
                  padding: "10px 12px",
                  borderRadius: 10,
                  fontSize: 13,
                  background:
                    message.type === "success" ? "#f0fdf4" : "#fff1f2",
                  color: message.type === "success" ? "#166534" : "#b91c1c",
                  border: `1px solid ${message.type === "success" ? "#bbf7d0" : "#fecaca"}`,
                }}
              >
                {message.text}
              </div>
            )}
            <div style={{ marginTop: 24, display: "flex", gap: 12, justifyContent: "flex-end" }}>
              <Link
                href="/settings"
                style={{
                  padding: "10px 16px",
                  fontSize: 14,
                  color: "var(--muted)",
                  textDecoration: "none",
                }}
              >
                キャンセル
              </Link>
              <button
                type="submit"
                disabled={saving}
                style={{
                  padding: "10px 20px",
                  borderRadius: 10,
                  border: "none",
                  background: "var(--button-primary-bg)",
                  color: "var(--primary-contrast)",
                  fontSize: 14,
                  fontWeight: 500,
                  cursor: saving ? "not-allowed" : "pointer",
                }}
              >
                {saving ? "保存中…" : "保存"}
              </button>
            </div>
          </form>
        </div>

        <p style={{ marginTop: 24, textAlign: "center" }}>
          <Link
            href="/settings"
            style={{ fontSize: 14, color: "var(--primary)", fontWeight: 500 }}
          >
            ← 設定に戻る
          </Link>
        </p>
      </div>
    </div>
  )
}
