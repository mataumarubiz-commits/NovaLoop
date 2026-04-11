"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { useSearchParams } from "next/navigation"
import { supabase } from "@/lib/supabase"
import { useAuthOrg } from "@/hooks/useAuthOrg"

type Connection = {
  guild_id: string
  guild_name: string | null
  channel_id: string
  channel_name: string | null
  status: string
  commands_enabled: boolean
  immediate_notifications_enabled: boolean
  morning_summary_enabled: boolean
  evening_summary_enabled: boolean
  incident_notifications_enabled: boolean
  last_healthcheck_at: string | null
  last_error: string | null
}

type Rule = {
  event_type: string
  enabled: boolean
  delivery_mode: string
}

type LogRow = {
  id: string
  event_type?: string
  command_name?: string
  status: string
  error?: string | null
  created_at: string
}

const EVENT_TYPES = [
  "contents.editor_due_overdue",
  "contents.client_due_overdue",
  "system.incident",
  "summary.morning",
  "summary.evening",
]

const pageStyle: React.CSSProperties = {
  minHeight: "100vh",
  background: "var(--bg-grad)",
  padding: "40px 24px 80px",
}

const sectionStyle: React.CSSProperties = {
  border: "1px solid var(--border)",
  borderRadius: 8,
  background: "var(--surface)",
  padding: 20,
}

const inputStyle: React.CSSProperties = {
  width: "100%",
  border: "1px solid var(--border)",
  borderRadius: 8,
  padding: "10px 12px",
  background: "var(--input-bg)",
  color: "var(--text)",
}

const buttonStyle: React.CSSProperties = {
  border: "1px solid var(--border)",
  borderRadius: 8,
  padding: "10px 14px",
  background: "var(--surface-2)",
  color: "var(--text)",
  cursor: "pointer",
  fontWeight: 700,
}

async function getToken() {
  return (await supabase.auth.getSession()).data.session?.access_token ?? null
}

function emptyConnection(): Connection {
  return {
    guild_id: "",
    guild_name: "",
    channel_id: "",
    channel_name: "",
    status: "not_connected",
    commands_enabled: true,
    immediate_notifications_enabled: true,
    morning_summary_enabled: true,
    evening_summary_enabled: true,
    incident_notifications_enabled: true,
    last_healthcheck_at: null,
    last_error: null,
  }
}

export default function DiscordIntegrationSettingsPage() {
  const { loading, role } = useAuthOrg({ redirectToOnboarding: true })
  const searchParams = useSearchParams()
  const canManage = role === "owner" || role === "executive_assistant"
  const [connection, setConnection] = useState<Connection>(emptyConnection)
  const [rules, setRules] = useState<Rule[]>(EVENT_TYPES.map((eventType) => ({ event_type: eventType, enabled: true, delivery_mode: "both" })))
  const [deliveries, setDeliveries] = useState<LogRow[]>([])
  const [commands, setCommands] = useState<LogRow[]>([])
  const [installUrl, setInstallUrl] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  const statusMessage = useMemo(() => {
    const status = searchParams.get("status")
    if (status === "installed") return "Discordのインストールを受け取りました。管理チャンネルを保存してください。"
    if (status === "state_invalid") return "Discord連携のstateが期限切れです。もう一度接続してください。"
    if (status === "code_missing") return "Discordから認可コードが返りませんでした。"
    return null
  }, [searchParams])

  const load = useCallback(async () => {
    const token = await getToken()
    if (!token) return
    const res = await fetch("/api/integrations/discord/connection", { headers: { Authorization: `Bearer ${token}` } })
    const json = await res.json().catch(() => null)
    if (!res.ok || !json?.ok) {
      setError(json?.message ?? "Discord設定の読み込みに失敗しました。")
      return
    }
    setConnection(json.connection ?? emptyConnection())
    const loadedRules = Array.isArray(json.rules) ? json.rules : []
    setRules(
      EVENT_TYPES.map((eventType) => {
        const existing = loadedRules.find((rule: Rule) => rule.event_type === eventType)
        return existing ?? { event_type: eventType, enabled: true, delivery_mode: "both" }
      })
    )
    setDeliveries(json.deliveries ?? [])
    setCommands(json.commands ?? [])
    setInstallUrl(json.installUrl ?? null)
  }, [])

  useEffect(() => {
    if (loading) return
    const timer = setTimeout(() => {
      void load()
    }, 0)
    return () => clearTimeout(timer)
  }, [load, loading])

  const save = async () => {
    setBusy("save")
    setError(null)
    setMessage(null)
    const token = await getToken()
    if (!token) return
    const res = await fetch("/api/integrations/discord/connection", {
      method: "PATCH",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ ...connection, rules }),
    })
    const json = await res.json().catch(() => null)
    setBusy(null)
    if (!res.ok || !json?.ok) {
      setError(json?.message ?? "保存に失敗しました。")
      return
    }
    setMessage("Discord管理チャンネルを保存しました。")
    await load()
  }

  const runHealth = async () => {
    setBusy("health")
    setError(null)
    setMessage(null)
    const token = await getToken()
    if (!token) return
    const res = await fetch("/api/integrations/discord/health", { headers: { Authorization: `Bearer ${token}` } })
    const json = await res.json().catch(() => null)
    setBusy(null)
    if (!res.ok || !json?.ok) {
      setError(json?.message ?? "接続確認に失敗しました。")
      return
    }
    setMessage(`接続確認: ${json.status}`)
    await load()
  }

  const registerCommands = async () => {
    setBusy("commands")
    setError(null)
    setMessage(null)
    const token = await getToken()
    if (!token) return
    const res = await fetch("/api/integrations/discord/commands/register", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    })
    const json = await res.json().catch(() => null)
    setBusy(null)
    if (!res.ok || !json?.ok) {
      setError(json?.message ?? json?.error ?? "Discordコマンド登録に失敗しました。")
      return
    }
    setMessage(`Discordコマンドを登録しました: ${json.registeredCount ?? 0}件`)
    await load()
  }

  const revoke = async () => {
    setBusy("revoke")
    setError(null)
    const token = await getToken()
    if (!token) return
    const res = await fetch("/api/integrations/discord/connection", { method: "DELETE", headers: { Authorization: `Bearer ${token}` } })
    const json = await res.json().catch(() => null)
    setBusy(null)
    if (!res.ok || !json?.ok) {
      setError(json?.message ?? "解除に失敗しました。")
      return
    }
    setMessage("Discord連携を停止しました。")
    await load()
  }

  if (loading) return <div style={{ padding: 32, color: "var(--muted)" }}>読み込み中...</div>
  if (!canManage) return <div style={{ padding: 32, color: "var(--muted)" }}>Discord連携は owner / executive_assistant のみ設定できます。</div>

  return (
    <div style={pageStyle}>
      <div style={{ maxWidth: 980, margin: "0 auto", display: "grid", gap: 16 }}>
        <header style={{ display: "grid", gap: 8 }}>
          <div style={{ display: "flex", gap: 8, fontSize: 12, color: "var(--muted)" }}>
            <Link href="/settings" style={{ color: "var(--primary)", textDecoration: "none", fontWeight: 700 }}>設定</Link>
            <span>/</span>
            <span>Discord運用連携</span>
          </div>
          <h1 style={{ margin: 0, fontSize: 30, lineHeight: 1.2, color: "var(--text)" }}>Discord運用連携</h1>
          <p style={{ margin: 0, color: "var(--muted)", lineHeight: 1.8 }}>
            管理者用の固定チャンネルから案件検索、案件追加、監査ログ確認を行います。金額や請求情報はDiscordに出しません。
          </p>
        </header>

        {statusMessage ? <div style={sectionStyle}>{statusMessage}</div> : null}
        {message ? <div style={{ ...sectionStyle, borderColor: "var(--success-border)", color: "var(--success-text)", background: "var(--success-bg)" }}>{message}</div> : null}
        {error ? <div style={{ ...sectionStyle, borderColor: "var(--error-border)", color: "var(--error-text)", background: "var(--error-bg)" }}>{error}</div> : null}

        <section style={sectionStyle}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
            <div>
              <h2 style={{ margin: 0, fontSize: 18 }}>接続</h2>
              <p style={{ margin: "8px 0 0", color: "var(--muted)", fontSize: 14 }}>1組織につき1サーバー、1管理チャンネルだけを有効にします。</p>
            </div>
            {installUrl ? <a href={installUrl} style={{ ...buttonStyle, textDecoration: "none" }}>Discordに接続</a> : null}
          </div>
          <div style={{ marginTop: 16, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12 }}>
            <label>サーバーID<input style={inputStyle} value={connection.guild_id} onChange={(event) => setConnection((prev) => ({ ...prev, guild_id: event.target.value }))} /></label>
            <label>サーバー名<input style={inputStyle} value={connection.guild_name ?? ""} onChange={(event) => setConnection((prev) => ({ ...prev, guild_name: event.target.value }))} /></label>
            <label>チャンネルID<input style={inputStyle} value={connection.channel_id} onChange={(event) => setConnection((prev) => ({ ...prev, channel_id: event.target.value }))} /></label>
            <label>チャンネル名<input style={inputStyle} value={connection.channel_name ?? ""} onChange={(event) => setConnection((prev) => ({ ...prev, channel_name: event.target.value }))} /></label>
          </div>
          <div style={{ marginTop: 12, display: "grid", gap: 8, gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))" }}>
            {[
              ["commands_enabled", "コマンドを有効化"],
              ["immediate_notifications_enabled", "即時通知"],
              ["morning_summary_enabled", "朝サマリ"],
              ["evening_summary_enabled", "夕サマリ"],
              ["incident_notifications_enabled", "障害通知"],
            ].map(([key, label]) => (
              <label key={key} style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <input
                  type="checkbox"
                  checked={Boolean(connection[key as keyof Connection])}
                  onChange={(event) => setConnection((prev) => ({ ...prev, [key]: event.target.checked }))}
                />
                {label}
              </label>
            ))}
          </div>
          <div style={{ marginTop: 16, display: "flex", gap: 10, flexWrap: "wrap" }}>
            <button type="button" style={buttonStyle} onClick={() => void save()} disabled={busy === "save"}>{busy === "save" ? "保存中..." : "保存"}</button>
            <button type="button" style={buttonStyle} onClick={() => void runHealth()} disabled={busy === "health"}>{busy === "health" ? "確認中..." : "接続確認"}</button>
            <button type="button" style={buttonStyle} onClick={() => void registerCommands()} disabled={busy === "commands"}>{busy === "commands" ? "登録中..." : "コマンド登録"}</button>
            <button type="button" style={buttonStyle} onClick={() => void revoke()} disabled={busy === "revoke"}>連携を停止</button>
          </div>
          <p style={{ margin: "12px 0 0", color: "var(--muted)", fontSize: 13 }}>
            状態: {connection.status} / 最終確認: {connection.last_healthcheck_at ?? "-"} / 最終エラー: {connection.last_error ?? "-"}
          </p>
        </section>

        <section style={sectionStyle}>
          <h2 style={{ marginTop: 0, fontSize: 18 }}>通知ルール</h2>
          <div style={{ display: "grid", gap: 8 }}>
            {rules.map((rule, index) => (
              <label key={rule.event_type} style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", borderTop: index === 0 ? "none" : "1px solid var(--border)", paddingTop: index === 0 ? 0 : 8 }}>
                <span>{rule.event_type}</span>
                <input type="checkbox" checked={rule.enabled} onChange={(event) => setRules((prev) => prev.map((item) => item.event_type === rule.event_type ? { ...item, enabled: event.target.checked } : item))} />
              </label>
            ))}
          </div>
        </section>

        <section style={sectionStyle}>
          <h2 style={{ marginTop: 0, fontSize: 18 }}>最近の送信 / コマンド</h2>
          <div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))" }}>
            <LogList title="送信ログ" rows={deliveries} />
            <LogList title="コマンドログ" rows={commands} />
          </div>
        </section>
      </div>
    </div>
  )
}

function LogList({ title, rows }: { title: string; rows: LogRow[] }) {
  return (
    <div style={{ display: "grid", gap: 6 }}>
      <h3 style={{ margin: 0, fontSize: 15 }}>{title}</h3>
      {rows.length === 0 ? <p style={{ margin: 0, color: "var(--muted)", fontSize: 13 }}>まだログはありません。</p> : null}
      {rows.map((row) => (
        <div key={row.id} style={{ border: "1px solid var(--border)", borderRadius: 8, padding: 10, fontSize: 12 }}>
          <div>{row.event_type ?? row.command_name ?? "-"}</div>
          <div style={{ color: "var(--muted)" }}>{row.status} / {row.created_at}</div>
          {row.error ? <div style={{ color: "var(--error-text)" }}>{row.error}</div> : null}
        </div>
      ))}
    </div>
  )
}
