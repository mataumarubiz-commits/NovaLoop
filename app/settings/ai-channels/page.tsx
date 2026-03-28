"use client"

import { useCallback, useEffect, useState } from "react"
import Link from "next/link"
import { supabase } from "@/lib/supabase"
import { EXTERNAL_CHAT_COPY } from "@/lib/ai/externalCopy"
import { useAuthOrg } from "@/hooks/useAuthOrg"

type ChannelSettings = {
  discord_enabled: boolean
  line_enabled: boolean
  discord_bot_label: string | null
  line_bot_label: string | null
  open_app_url: string | null
}

type LinkRow = {
  channel_type: "discord" | "line"
  external_user_id: string | null
  external_display_name: string | null
  role: string
  status: string
  link_code: string | null
  code_expires_at: string | null
  verified_at: string | null
  last_used_at: string | null
}

const cardStyle: React.CSSProperties = {
  border: "1px solid var(--border)",
  borderRadius: 16,
  background: "var(--surface)",
  padding: 20,
}

const buttonStyle: React.CSSProperties = {
  border: "1px solid var(--border)",
  borderRadius: 999,
  padding: "10px 14px",
  background: "var(--surface)",
  color: "var(--text)",
  cursor: "pointer",
  fontWeight: 600,
}

async function getToken() {
  const session = await supabase.auth.getSession()
  return session.data.session?.access_token ?? null
}

function mask(value: string | null) {
  if (!value) return "-"
  if (value.length <= 6) return value
  return `${value.slice(0, 3)}...${value.slice(-3)}`
}

function formatChannelLabel(channelType: "discord" | "line") {
  return channelType === "discord" ? "Discord" : "LINE"
}

export default function AiChannelsSettingsPage() {
  const { activeOrgId, role, loading } = useAuthOrg({ redirectToOnboarding: true })
  const [settings, setSettings] = useState<ChannelSettings>({
    discord_enabled: false,
    line_enabled: false,
    discord_bot_label: "NovaLoop AI",
    line_bot_label: "NovaLoop AI",
    open_app_url: "",
  })
  const [links, setLinks] = useState<LinkRow[]>([])
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  const canManage = role === "owner" || role === "executive_assistant"

  const load = useCallback(async () => {
    const token = await getToken()
    if (!token) return

    const res = await fetch("/api/settings/ai-channels", {
      headers: { Authorization: `Bearer ${token}` },
    })
    const json = await res.json().catch(() => null)
    if (!res.ok || !json?.ok) {
      setError(json?.error ?? "外部チャットAI設定の読み込みに失敗しました。")
      return
    }

    setSettings(json.settings)
    setLinks(json.links ?? [])
  }, [])

  useEffect(() => {
    if (!activeOrgId) return
    const timer = setTimeout(() => {
      void load()
    }, 0)
    return () => clearTimeout(timer)
  }, [activeOrgId, load])

  const startLink = async (channelType: "discord" | "line") => {
    setBusy(`start:${channelType}`)
    setError(null)
    setMessage(null)

    const token = await getToken()
    if (!token) return

    const res = await fetch("/api/ai/external/link/start", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ channelType }),
    })
    const json = await res.json().catch(() => null)
    if (!res.ok || !json?.ok) {
      setError(json?.error ?? "連携コードの発行に失敗しました。")
      setBusy(null)
      return
    }

    setMessage(`${formatChannelLabel(channelType)} の連携コードを発行しました。 ${json.code}`)
    await load()
    setBusy(null)
  }

  const revokeLink = async (channelType: "discord" | "line") => {
    setBusy(`revoke:${channelType}`)
    setError(null)

    const token = await getToken()
    if (!token) return

    const res = await fetch("/api/ai/external/links", {
      method: "DELETE",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ channelType }),
    })
    const json = await res.json().catch(() => null)
    if (!res.ok || !json?.ok) {
      setError(json?.error ?? "連携解除に失敗しました。")
      setBusy(null)
      return
    }

    setMessage(`${formatChannelLabel(channelType)} の連携を解除しました。`)
    await load()
    setBusy(null)
  }

  const saveSettings = async () => {
    setBusy("save")
    setError(null)

    const token = await getToken()
    if (!token) return

    const res = await fetch("/api/settings/ai-channels", {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify(settings),
    })
    const json = await res.json().catch(() => null)
    if (!res.ok || !json?.ok) {
      setError(json?.error ?? "設定の保存に失敗しました。")
      setBusy(null)
      return
    }

    setMessage("外部チャットAI設定を保存しました。")
    setBusy(null)
  }

  if (loading) {
    return <div style={{ padding: 40, color: "var(--muted)" }}>読み込み中...</div>
  }

  const discordLink = links.find((link) => link.channel_type === "discord")
  const lineLink = links.find((link) => link.channel_type === "line")

  return (
    <div style={{ minHeight: "100vh", background: "var(--bg-grad)", padding: "32px 24px 56px" }}>
      <div style={{ maxWidth: 980, margin: "0 auto", display: "grid", gap: 16 }}>
        <header style={cardStyle}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
            <div>
              <h1 style={{ margin: 0, fontSize: 28, color: "var(--text)" }}>外部チャット連携</h1>
              <p style={{ margin: "8px 0 0", color: "var(--muted)", lineHeight: 1.7 }}>{EXTERNAL_CHAT_COPY.settings.overview}</p>
              <p style={{ margin: "8px 0 0", color: "var(--muted)", lineHeight: 1.7 }}>{EXTERNAL_CHAT_COPY.settings.scope}</p>
              <p style={{ margin: "8px 0 0", color: "var(--muted)", lineHeight: 1.7 }}>{EXTERNAL_CHAT_COPY.settings.audit}</p>
            </div>
            <Link href="/settings" style={{ color: "var(--primary)", fontWeight: 700, textDecoration: "none" }}>
              設定に戻る
            </Link>
          </div>
        </header>

        {message ? <div style={{ ...cardStyle, borderColor: "var(--success-border)", background: "var(--success-bg)", color: "var(--success-text)" }}>{message}</div> : null}
        {error ? <div style={{ ...cardStyle, borderColor: "var(--error-border)", background: "var(--error-bg)", color: "var(--error-text)" }}>{error}</div> : null}

        {[{ key: "discord", label: "Discord", row: discordLink }, { key: "line", label: "LINE", row: lineLink }].map((item) => (
          <section key={item.key} style={cardStyle}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
              <div>
                <h2 style={{ margin: 0, fontSize: 18 }}>{item.label}</h2>
                <p style={{ margin: "8px 0 0", color: "var(--muted)", fontSize: 14, lineHeight: 1.6 }}>
                  連携コードを発行し、{item.key === "discord" ? "/nova question:link <code>" : "LINE に link <code>"} を送ると接続できます。
                </p>
              </div>
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                <button type="button" onClick={() => void startLink(item.key as "discord" | "line")} style={buttonStyle} disabled={busy === `start:${item.key}`}>
                  {busy === `start:${item.key}` ? "発行中..." : "連携コードを発行"}
                </button>
                {item.row ? (
                  <button type="button" onClick={() => void revokeLink(item.key as "discord" | "line")} style={buttonStyle} disabled={busy === `revoke:${item.key}`}>
                    連携解除
                  </button>
                ) : null}
              </div>
            </div>

            <div style={{ marginTop: 16, display: "grid", gap: 8, gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))" }}>
              <div>状態: {item.row?.status ?? "未連携"}</div>
              <div>外部アカウントID: {mask(item.row?.external_user_id ?? null)}</div>
              <div>表示名: {item.row?.external_display_name ?? "-"}</div>
              <div>連携コード: {item.row?.link_code ?? "-"}</div>
              <div>コード期限: {item.row?.code_expires_at ?? "-"}</div>
              <div>最終利用: {item.row?.last_used_at ?? "-"}</div>
            </div>
          </section>
        ))}

        <section style={cardStyle}>
          <h2 style={{ marginTop: 0, fontSize: 18 }}>組織設定</h2>
          <div style={{ display: "grid", gap: 14, gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))" }}>
            <label style={{ display: "grid", gap: 6 }}>
              <span>Discord 連携を有効化</span>
              <input
                type="checkbox"
                checked={settings.discord_enabled}
                disabled={!canManage}
                onChange={(e) => setSettings((prev) => ({ ...prev, discord_enabled: e.target.checked }))}
              />
            </label>
            <label style={{ display: "grid", gap: 6 }}>
              <span>LINE 連携を有効化</span>
              <input
                type="checkbox"
                checked={settings.line_enabled}
                disabled={!canManage}
                onChange={(e) => setSettings((prev) => ({ ...prev, line_enabled: e.target.checked }))}
              />
            </label>
            <label style={{ display: "grid", gap: 6 }}>
              <span>Discord 表示名</span>
              <input
                value={settings.discord_bot_label ?? ""}
                disabled={!canManage}
                onChange={(e) => setSettings((prev) => ({ ...prev, discord_bot_label: e.target.value }))}
                style={{ padding: "10px 12px", borderRadius: 8, border: "1px solid var(--border)" }}
              />
            </label>
            <label style={{ display: "grid", gap: 6 }}>
              <span>LINE 表示名</span>
              <input
                value={settings.line_bot_label ?? ""}
                disabled={!canManage}
                onChange={(e) => setSettings((prev) => ({ ...prev, line_bot_label: e.target.value }))}
                style={{ padding: "10px 12px", borderRadius: 8, border: "1px solid var(--border)" }}
              />
            </label>
            <label style={{ display: "grid", gap: 6, gridColumn: "1 / -1" }}>
              <span>NovaLoop URL</span>
              <input
                value={settings.open_app_url ?? ""}
                disabled={!canManage}
                onChange={(e) => setSettings((prev) => ({ ...prev, open_app_url: e.target.value }))}
                style={{ padding: "10px 12px", borderRadius: 8, border: "1px solid var(--border)" }}
              />
            </label>
          </div>

          <div style={{ marginTop: 16, display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
            <div style={{ color: "var(--muted)", fontSize: 13 }}>{EXTERNAL_CHAT_COPY.settings.audit}</div>
            <button type="button" onClick={() => void saveSettings()} disabled={!canManage || busy === "save"} style={buttonStyle}>
              {busy === "save" ? "保存中..." : "設定を保存"}
            </button>
          </div>
        </section>
      </div>
    </div>
  )
}
