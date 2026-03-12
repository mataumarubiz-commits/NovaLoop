"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { supabase } from "@/lib/supabase"
import { useAuthOrg } from "@/hooks/useAuthOrg"
import SettingsClient, { type SettingsInitialData } from "./SettingsClient"

const cardStyle: React.CSSProperties = {
  border: "1px solid var(--border)",
  borderRadius: 14,
  padding: 16,
  background: "var(--surface)",
}

const adminOnlyCards = [
  { href: "/settings/dashboard", title: "ダッシュボード", description: "利用状況、定着度、AI 活用の概況を確認します。" },
  { href: "/settings/health", title: "Health", description: "主要データと設定の診断結果を確認します。" },
  { href: "/settings/e2e", title: "E2Eチェック", description: "本番前の手動確認チェックリストです。" },
  { href: "/settings/export", title: "エクスポート", description: "JSON 形式でデータを書き出します。" },
  { href: "/settings/import", title: "インポート", description: "preview / apply の順で安全に取り込みます。" },
  { href: "/settings/assets", title: "Assets", description: "Storage と URL 資産の確認を行います。" },
  { href: "/settings/audit", title: "Audit", description: "監査ログの検索と確認を行います。" },
  { href: "/settings/roles", title: "ロール", description: "役割ごとの表示差分と運用方針を確認します。" },
]

const commonCards = [
  { href: "/settings/profile", title: "プロフィール", description: "表示名、メール、パスワードを管理します。" },
  { href: "/settings/workspace", title: "ワークスペース", description: "会社情報、請求者情報、口座、委託者コードを設定します。" },
  { href: "/settings/members", title: "メンバー", description: "招待、権限、会計向けの見え方を確認します。" },
  { href: "/settings/ai-channels", title: "外部チャット連携", description: "Discord / LINE 連携と read-only AI の設定を管理します。" },
  { href: "/notifications", title: "通知", description: "未読通知と対応状況を確認します。" },
  { href: "/help/setup", title: "使い方", description: "導入時に見るべき記事と手順を確認します。" },
]

export default function SettingsPage() {
  const { user, loading, profile, activeOrgId, role, memberships } = useAuthOrg()
  const [initialData, setInitialData] = useState<SettingsInitialData | null>(null)
  const isAdmin = role === "owner" || role === "executive_assistant"

  useEffect(() => {
    if (!user) return
    let active = true

    const fallback = () => {
      if (!active) return
      setInitialData({
        profileDisplayName: profile?.display_name ?? "",
        orgDisplayName: null,
        activeOrgId: activeOrgId ?? null,
        activeOrgName: activeOrgId ? memberships.find((item) => item.org_id === activeOrgId)?.org_name ?? "" : "",
        role: role ?? null,
      })
    }

    const load = async () => {
      const token = (await supabase.auth.getSession()).data.session?.access_token
      if (!token) {
        fallback()
        return
      }

      const res = await fetch("/api/me", { headers: { Authorization: `Bearer ${token}` } }).catch(() => null)
      const json = await res?.json().catch(() => null)
      if (!active || !res?.ok || !json) {
        fallback()
        return
      }
      setInitialData(json as SettingsInitialData)
    }

    void load()
    return () => {
      active = false
    }
  }, [activeOrgId, memberships, profile?.display_name, role, user])

  if (loading) return <div style={{ padding: 32, color: "var(--muted)" }}>読み込み中...</div>
  if (!user) return <div style={{ padding: 32, color: "var(--muted)" }}>ログインしてください。</div>
  if (!initialData) return <div style={{ padding: 32, color: "var(--muted)" }}>読み込み中...</div>

  return (
    <div style={{ minHeight: "100vh", background: "var(--bg-grad)" }}>
      <div style={{ maxWidth: 1040, margin: "0 auto", padding: "32px 24px 0" }}>
        <section style={{ ...cardStyle, marginBottom: 20 }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 16, flexWrap: "wrap", alignItems: "center" }}>
            <div>
              <h1 style={{ margin: 0, fontSize: 28, color: "var(--text)" }}>設定</h1>
              <p style={{ margin: "8px 0 0", fontSize: 13, color: "var(--muted)", lineHeight: 1.7 }}>
                アカウント、ワークスペース、権限、通知、外部チャットAI、運用管理の設定をここで確認できます。
              </p>
            </div>
            <Link href="/home" style={{ color: "var(--primary)", fontWeight: 600, textDecoration: "none" }}>
              Home に戻る
            </Link>
          </div>

          <div style={{ marginTop: 16, display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))" }}>
            {commonCards.map((item) => (
              <Link key={item.href} href={item.href} style={{ ...cardStyle, textDecoration: "none", color: "inherit" }}>
                <div style={{ fontWeight: 700, color: "var(--text)" }}>{item.title}</div>
                <div style={{ marginTop: 6, fontSize: 13, color: "var(--muted)", lineHeight: 1.6 }}>{item.description}</div>
              </Link>
            ))}
            {isAdmin
              ? adminOnlyCards.map((item) => (
                  <Link key={item.href} href={item.href} style={{ ...cardStyle, textDecoration: "none", color: "inherit" }}>
                    <div style={{ fontWeight: 700, color: "var(--text)" }}>{item.title}</div>
                    <div style={{ marginTop: 6, fontSize: 13, color: "var(--muted)", lineHeight: 1.6 }}>{item.description}</div>
                  </Link>
                ))
              : null}
          </div>
        </section>
      </div>

      <SettingsClient initialData={initialData} />
    </div>
  )
}
