"use client"

import { useCallback, useEffect, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { supabase } from "@/lib/supabase"
import Section from "@/components/settings/Section"
import Row from "@/components/settings/Row"
import Switch from "@/components/ui/Switch"
import Modal from "@/components/ui/Modal"

const STORAGE_KEYS = {
  theme: "settings_theme",
  notifyEmail: "settings_notify_email",
  notifySlack: "settings_notify_slack",
  notifyLine: "settings_notify_line",
} as const

type Theme = "light" | "dark" | "system"

export type SettingsInitialData = {
  profileDisplayName: string
  orgDisplayName: string | null
  activeOrgId: string | null
  activeOrgName: string
  role: string | null
}

function getStoredTheme(): Theme {
  if (typeof window === "undefined") return "system"
  const value = localStorage.getItem(STORAGE_KEYS.theme)
  return value === "light" || value === "dark" || value === "system" ? value : "system"
}

function getStoredBoolean(key: string, fallback: boolean) {
  if (typeof window === "undefined") return fallback
  const value = localStorage.getItem(key)
  if (value === null) return fallback
  return value === "1"
}

function applyTheme(theme: Theme) {
  const root = document.documentElement
  if (theme === "system") root.removeAttribute("data-theme")
  else root.setAttribute("data-theme", theme)
}

export default function SettingsClient({ initialData }: { initialData: SettingsInitialData }) {
  const router = useRouter()
  const [theme, setThemeState] = useState<Theme>(() => getStoredTheme())
  const [notifyEmail, setNotifyEmail] = useState(() => getStoredBoolean(STORAGE_KEYS.notifyEmail, true))
  const [notifySlack, setNotifySlack] = useState(() => getStoredBoolean(STORAGE_KEYS.notifySlack, false))
  const [notifyLine, setNotifyLine] = useState(() => getStoredBoolean(STORAGE_KEYS.notifyLine, false))
  const [integrationOpen, setIntegrationOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [deleteMessage, setDeleteMessage] = useState("")

  useEffect(() => {
    applyTheme(theme)
  }, [theme])

  const setTheme = useCallback((nextTheme: Theme) => {
    setThemeState(nextTheme)
    localStorage.setItem(STORAGE_KEYS.theme, nextTheme)
  }, [])

  const setStoredBoolean = useCallback((key: string, value: boolean, setter: (value: boolean) => void) => {
    setter(value)
    localStorage.setItem(key, value ? "1" : "0")
  }, [])

  const handleLogout = async () => {
    await supabase.auth.signOut()
    router.push("/")
  }

  const handleDelete = async () => {
    setDeleteMessage("アカウント削除はまだ管理者対応です。ログアウトしてサポートへ連絡してください。")
    await supabase.auth.signOut()
    setTimeout(() => {
      setDeleteOpen(false)
      setDeleteMessage("")
      router.push("/")
    }, 1200)
  }

  const buttonStyle: React.CSSProperties = {
    minHeight: 42,
    padding: "10px 16px",
    borderRadius: 12,
    border: "1px solid var(--border)",
    background: "var(--surface)",
    color: "var(--text)",
    fontSize: 14,
    cursor: "pointer",
  }

  return (
    <div style={{ minHeight: "100vh", background: "var(--bg-grad)", padding: "0 24px 48px", boxSizing: "border-box" }}>
      <div style={{ maxWidth: 720, margin: "0 auto", padding: "0 16px" }}>
        <Section title="テーマ">
          <Row
            title="表示テーマ"
            description="ライト、ダーク、システムから選べます。"
            right={
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {(["light", "dark", "system"] as const).map((item) => (
                  <button
                    key={item}
                    type="button"
                    onClick={() => setTheme(item)}
                    style={{
                      ...buttonStyle,
                      background: theme === item ? "var(--primary)" : "var(--surface)",
                      color: theme === item ? "var(--primary-contrast)" : "var(--text)",
                      borderColor: theme === item ? "var(--primary)" : "var(--border)",
                    }}
                  >
                    {item === "light" ? "ライト" : item === "dark" ? "ダーク" : "システム"}
                  </button>
                ))}
              </div>
            }
          />
        </Section>

        <Section title="通知">
          <Row
            title="メール通知"
            description="重要な更新をメールで受け取ります。"
            right={<Switch checked={notifyEmail} onChange={(value) => setStoredBoolean(STORAGE_KEYS.notifyEmail, value, setNotifyEmail)} aria-label="メール通知" />}
          />
          <Row
            title="Slack 通知"
            description="投稿用の外部連携は準備中です。"
            right={<Switch checked={notifySlack} onChange={(value) => setStoredBoolean(STORAGE_KEYS.notifySlack, value, setNotifySlack)} aria-label="Slack 通知" />}
          />
          <Row
            title="LINE 通知"
            description="外部チャット連携とは別で、通知配信側の整備は準備中です。"
            right={<Switch checked={notifyLine} onChange={(value) => setStoredBoolean(STORAGE_KEYS.notifyLine, value, setNotifyLine)} aria-label="LINE 通知" />}
          />
        </Section>

        <Section title="連携">
          <Row
            title="外部連携"
            description="SNS 投稿や外部通知の追加連携は順次拡張します。"
            right={
              <button type="button" onClick={() => setIntegrationOpen(true)} style={buttonStyle}>
                確認する
              </button>
            }
          />
          <Row
            title="外部チャットAI"
            description="Discord / LINE の連携状態と利用範囲は専用画面で確認できます。"
            right={
              <Link href="/settings/ai-channels" style={{ ...buttonStyle, textDecoration: "none", display: "inline-flex", alignItems: "center" }}>
                連携設定へ
              </Link>
            }
          />
        </Section>

        <Section title="アカウント">
          <Row
            title="現在の表示名"
            description={initialData.profileDisplayName || "未設定"}
            right={
              <Link href="/settings/profile" style={{ ...buttonStyle, textDecoration: "none", display: "inline-flex", alignItems: "center" }}>
                プロフィールを開く
              </Link>
            }
          />
          <Row
            title="現在のワークスペース"
            description={initialData.activeOrgName || "未所属"}
            right={
              <Link href="/settings/workspace" style={{ ...buttonStyle, textDecoration: "none", display: "inline-flex", alignItems: "center" }}>
                ワークスペース設定
              </Link>
            }
          />
          <Row
            title="ログアウト"
            description="現在のセッションを終了します。"
            right={
              <button type="button" onClick={() => void handleLogout()} style={buttonStyle}>
                ログアウト
              </button>
            }
          />
          <div style={{ marginTop: 8 }}>
            <button
              type="button"
              onClick={() => setDeleteOpen(true)}
              style={{ ...buttonStyle, width: "100%", background: "#b91c1c", borderColor: "#b91c1c", color: "#fff" }}
            >
              アカウント削除について確認する
            </button>
          </div>
        </Section>

        <p style={{ marginTop: 24 }}>
          <Link href="/home" style={{ color: "var(--primary)", fontWeight: 600, textDecoration: "none" }}>
            Home へ戻る
          </Link>
        </p>
      </div>

      <Modal open={integrationOpen} onClose={() => setIntegrationOpen(false)} title="連携について">
        <p style={{ color: "var(--muted)", marginBottom: 16, lineHeight: 1.7 }}>
          外部連携は機能ごとに段階導入しています。現在は外部チャットAI連携が利用可能で、投稿用の外部連携は準備中です。
        </p>
        <button type="button" onClick={() => setIntegrationOpen(false)} style={buttonStyle}>
          閉じる
        </button>
      </Modal>

      <Modal open={deleteOpen} onClose={() => setDeleteOpen(false)} title="アカウント削除">
        <p style={{ color: "var(--muted)", marginBottom: 16, lineHeight: 1.7 }}>
          現時点では、アカウント削除は自己操作に対応していません。ログアウト後にサポートへ連絡してください。
        </p>
        {deleteMessage ? <p style={{ color: "var(--text)", marginBottom: 16 }}>{deleteMessage}</p> : null}
        <div style={{ display: "flex", gap: 12 }}>
          <button type="button" onClick={() => setDeleteOpen(false)} style={buttonStyle}>
            キャンセル
          </button>
          <button type="button" onClick={() => void handleDelete()} style={{ ...buttonStyle, background: "#b91c1c", borderColor: "#b91c1c", color: "#fff" }}>
            ログアウトする
          </button>
        </div>
      </Modal>
    </div>
  )
}
