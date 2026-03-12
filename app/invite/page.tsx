"use client"

import { Suspense, useEffect, useState } from "react"
import Link from "next/link"
import { useSearchParams } from "next/navigation"
import { supabase } from "@/lib/supabase"

function InviteContent() {
  const searchParams = useSearchParams()
  const token = searchParams.get("token")?.trim() ?? ""
  const [status, setStatus] = useState<"loading" | "logged_out" | "ready" | "success" | "error">("loading")
  const [displayName, setDisplayName] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  useEffect(() => {
    if (!token) {
      return
    }
    let active = true
    const check = async () => {
      const { data } = await supabase.auth.getUser()
      if (!active) return
      if (!data?.user) {
        setStatus("logged_out")
        return
      }
      setStatus("ready")
    }
    void check()
    return () => {
      active = false
    }
  }, [token])

  if (!token) {
    return (
      <CenteredCard title="招待を開けませんでした" description="招待リンクが不正です。">
        <Link href="/" style={linkStyle}>
          トップへ戻る
        </Link>
      </CenteredCard>
    )
  }

  const handleAccept = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!token || status !== "ready") return
    setSubmitting(true)
    setErrorMessage(null)

    const { data } = await supabase.auth.getSession()
    const authToken = data.session?.access_token
    if (!authToken) {
      setErrorMessage("ログイン状態を確認してください。")
      setSubmitting(false)
      return
    }

    const res = await fetch("/api/org/invites/accept", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${authToken}` },
      body: JSON.stringify({ token, displayName: displayName.trim() || undefined }),
    })
    const json = await res.json().catch(() => null)
    if (res.ok && json?.ok) {
      setStatus("success")
      window.location.href = "/home"
      return
    }
    setErrorMessage(json?.error ?? "招待の受け入れに失敗しました。")
    setSubmitting(false)
  }

  if (status === "loading") {
    return <CenteredCard title="招待を確認中" description="ログイン状態と招待トークンを確認しています。" />
  }

  if (status === "error") {
    return (
      <CenteredCard title="招待を開けませんでした" description={errorMessage ?? "招待リンクを確認してください。"}>
        <Link href="/" style={linkStyle}>
          トップへ戻る
        </Link>
      </CenteredCard>
    )
  }

  if (status === "logged_out") {
    const loginUrl = `/?redirectTo=${encodeURIComponent(`/invite?token=${token}`)}`
    return (
      <CenteredCard title="ログインして参加" description="招待先のワークスペースに参加するには、先にログインが必要です。">
        <Link href={loginUrl} style={primaryLinkStyle}>
          ログインして続ける
        </Link>
      </CenteredCard>
    )
  }

  if (status === "success") {
    return <CenteredCard title="参加が完了しました" description="Home に移動しています。しばらくお待ちください。" />
  }

  return (
    <div style={pageStyle}>
      <div style={panelStyle}>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: "var(--text)", marginBottom: 8, textAlign: "center" }}>
          ワークスペースに参加
        </h1>
        <p style={{ fontSize: 14, color: "var(--muted)", marginBottom: 24, textAlign: "center", lineHeight: 1.7 }}>
          表示名を入力して参加を確定します。請求や設定などの権限は招待時のロール設定に従います。
        </p>
        <form onSubmit={handleAccept}>
          <label style={{ display: "block", fontSize: 13, fontWeight: 600, color: "var(--text)", marginBottom: 6 }}>
            表示名
          </label>
          <input
            type="text"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="表示名"
            maxLength={100}
            style={inputStyle}
          />
          {errorMessage ? <p style={{ color: "#b91c1c", fontSize: 13, margin: "12px 0 0" }}>{errorMessage}</p> : null}
          <button type="submit" disabled={submitting} style={submitStyle}>
            {submitting ? "参加処理中..." : "参加する"}
          </button>
        </form>
      </div>
    </div>
  )
}

export default function InvitePage() {
  return (
    <Suspense fallback={<CenteredCard title="招待を確認中" description="読み込み中..." />}>
      <InviteContent />
    </Suspense>
  )
}

function CenteredCard({
  title,
  description,
  children,
}: {
  title: string
  description: string
  children?: React.ReactNode
}) {
  return (
    <div style={pageStyle}>
      <div style={{ ...panelStyle, textAlign: "center" }}>
        <h1 style={{ fontSize: 20, fontWeight: 700, color: "var(--text)", marginBottom: 8 }}>{title}</h1>
        <p style={{ color: "var(--muted)", marginBottom: children ? 24 : 0, lineHeight: 1.7 }}>{description}</p>
        {children}
      </div>
    </div>
  )
}

const pageStyle = {
  minHeight: "100vh",
  background: "var(--bg-grad)",
  display: "flex",
  flexDirection: "column" as const,
  alignItems: "center",
  justifyContent: "center",
  padding: 24,
}

const panelStyle = {
  maxWidth: 420,
  width: "100%",
  padding: 32,
  background: "var(--surface)",
  borderRadius: 16,
  border: "1px solid var(--border)",
  boxShadow: "0 4px 20px rgba(0,0,0,0.06)",
}

const inputStyle = {
  width: "100%",
  padding: "12px 14px",
  borderRadius: 10,
  border: "1px solid var(--input-border)",
  background: "var(--input-bg)",
  color: "var(--input-text)",
  fontSize: 14,
  boxSizing: "border-box" as const,
}

const submitStyle = {
  width: "100%",
  padding: "14px",
  borderRadius: 12,
  border: "none",
  background: "var(--primary)",
  color: "var(--primary-contrast)",
  fontSize: 15,
  fontWeight: 600,
  cursor: "pointer",
  marginTop: 16,
}

const linkStyle = {
  color: "var(--primary)",
  fontSize: 14,
  fontWeight: 600,
  textDecoration: "none",
}

const primaryLinkStyle = {
  display: "inline-block",
  padding: "12px 24px",
  borderRadius: 12,
  background: "var(--primary)",
  color: "var(--primary-contrast)",
  fontWeight: 600,
  textDecoration: "none",
}
