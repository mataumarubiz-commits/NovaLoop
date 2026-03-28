"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { supabase } from "@/lib/supabase"
import { useAuthOrg } from "@/hooks/useAuthOrg"

type MeResponse = {
  profileDisplayName: string
  orgDisplayName: string | null
}

const cardStyle: React.CSSProperties = {
  background: "var(--surface)",
  borderRadius: 16,
  border: "1px solid var(--border)",
  padding: "24px 22px",
  boxShadow: "var(--shadow-md)",
}

async function getAccessToken() {
  const session = await supabase.auth.getSession()
  if (session.data.session?.access_token) {
    return session.data.session.access_token
  }
  const refreshed = await supabase.auth.refreshSession()
  return refreshed.data.session?.access_token ?? null
}

export default function ProfileSettingsPage() {
  const { user, activeOrgId, loading: authLoading } = useAuthOrg({ redirectToOnboarding: true })
  const [profileName, setProfileName] = useState("")
  const [orgName, setOrgName] = useState("")
  const [email, setEmail] = useState("")
  const [newEmail, setNewEmail] = useState("")
  const [newPassword, setNewPassword] = useState("")
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<{ type: "error" | "success"; text: string } | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let active = true

    const load = async () => {
      if (!user) {
        setLoading(false)
        return
      }

      const token = await getAccessToken()
      setEmail(user.email ?? "")
      if (!token) {
        if (active) {
          setMessage({ type: "error", text: "認証を確認できませんでした。ログインし直してください。" })
          setLoading(false)
        }
        return
      }

      const res = await fetch("/api/me", {
        headers: { Authorization: `Bearer ${token}` },
      })

      if (!active) return

      if (res.ok) {
        const json = (await res.json().catch(() => null)) as MeResponse | null
        setProfileName(json?.profileDisplayName ?? "")
        setOrgName(json?.orgDisplayName ?? "")
      }
      setLoading(false)
    }

    void load()
    return () => {
      active = false
    }
  }, [user])

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!user) return

    setSaving(true)
    setMessage(null)
    try {
      const token = await getAccessToken()
      if (!token) {
        setMessage({ type: "error", text: "認証を確認できませんでした。ログインし直してください。" })
        return
      }

      const meRes = await fetch("/api/me", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          display_name: profileName.trim(),
          org_id: activeOrgId || undefined,
          org_display_name: orgName.trim() || undefined,
        }),
      })
      const meJson = await meRes.json().catch(() => null)
      if (!meRes.ok || !meJson?.ok) {
        setMessage({ type: "error", text: meJson?.message ?? "プロフィールの更新に失敗しました。" })
        return
      }

      if (newEmail.trim() || newPassword.trim()) {
        const { error } = await supabase.auth.updateUser({
          email: newEmail.trim() || undefined,
          password: newPassword.trim() || undefined,
        })
        if (error) {
          setMessage({ type: "error", text: error.message })
          return
        }
      }

      setNewPassword("")
      if (newEmail.trim()) setNewEmail("")
      setMessage({ type: "success", text: "プロフィールを更新しました。" })
    } finally {
      setSaving(false)
    }
  }

  if (authLoading || loading) {
    return <div style={{ padding: "48px 24px", minHeight: "100vh", background: "var(--bg-grad)", textAlign: "center" }}>読み込み中...</div>
  }

  if (!user) {
    return (
      <div style={{ padding: "48px 24px", minHeight: "100vh", background: "var(--bg-grad)", textAlign: "center" }}>
        <p style={{ color: "var(--muted)", marginBottom: 16 }}>ログインしてください。</p>
        <Link href="/" style={{ color: "var(--primary)", fontWeight: 600 }}>
          ログインへ
        </Link>
      </div>
    )
  }

  return (
    <div style={{ minHeight: "100vh", background: "var(--bg-grad)", padding: "48px 24px", display: "flex", justifyContent: "center" }}>
      <div style={{ maxWidth: 520, width: "100%", display: "grid", gap: 16 }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 600, color: "var(--text)", marginBottom: 8, textAlign: "center" }}>プロフィール設定</h1>
          <p style={{ fontSize: 14, color: "var(--muted)", marginBottom: 0, textAlign: "center" }}>
            表示名、組織内表示名、メールアドレス、パスワードを管理します。
          </p>
        </div>

        <form onSubmit={handleSave} style={cardStyle}>
          <div style={{ display: "grid", gap: 14 }}>
            <label style={{ display: "grid", gap: 6 }}>
              <span>現在のメールアドレス</span>
              <input value={email} readOnly style={{ width: "100%", padding: "10px 12px", borderRadius: 10, border: "1px solid var(--input-border)", background: "var(--surface-2)" }} />
            </label>
            <label style={{ display: "grid", gap: 6 }}>
              <span>表示名</span>
              <input value={profileName} onChange={(e) => setProfileName(e.target.value)} style={{ width: "100%", padding: "10px 12px", borderRadius: 10, border: "1px solid var(--input-border)", background: "var(--input-bg)" }} />
            </label>
            <label style={{ display: "grid", gap: 6 }}>
              <span>ワークスペース内表示名</span>
              <input value={orgName} onChange={(e) => setOrgName(e.target.value)} style={{ width: "100%", padding: "10px 12px", borderRadius: 10, border: "1px solid var(--input-border)", background: "var(--input-bg)" }} />
            </label>
            <label style={{ display: "grid", gap: 6 }}>
              <span>新しいメールアドレス</span>
              <input value={newEmail} onChange={(e) => setNewEmail(e.target.value)} placeholder="変更する場合のみ入力" style={{ width: "100%", padding: "10px 12px", borderRadius: 10, border: "1px solid var(--input-border)", background: "var(--input-bg)" }} />
            </label>
            <label style={{ display: "grid", gap: 6 }}>
              <span>新しいパスワード</span>
              <input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} placeholder="変更する場合のみ入力" style={{ width: "100%", padding: "10px 12px", borderRadius: 10, border: "1px solid var(--input-border)", background: "var(--input-bg)" }} />
            </label>
          </div>

          {message && (
            <div style={{ marginTop: 14, padding: "8px 10px", borderRadius: 10, fontSize: 13, background: message.type === "success" ? "var(--success-bg)" : "var(--error-bg)", color: message.type === "success" ? "var(--success-text)" : "var(--error-text)", border: `1px solid ${message.type === "success" ? "var(--success-border)" : "var(--error-border)"}` }}>
              {message.text}
            </div>
          )}

          <div style={{ marginTop: 22, display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
            <Link href="/settings" style={{ color: "var(--primary)", fontWeight: 600, textDecoration: "none", alignSelf: "center" }}>
              設定へ戻る
            </Link>
            <button type="submit" disabled={saving} style={{ padding: "10px 20px", borderRadius: 10, border: "none", background: "var(--button-primary-bg)", color: "var(--primary-contrast)", fontWeight: 600, cursor: saving ? "not-allowed" : "pointer" }}>
              {saving ? "保存中..." : "保存"}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
