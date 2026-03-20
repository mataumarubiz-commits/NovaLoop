"use client"

import { useEffect, useState, type CSSProperties } from "react"
import Link from "next/link"
import { supabase } from "@/lib/supabase"
import { useAuthOrg } from "@/hooks/useAuthOrg"
import SettingsClient, { type SettingsInitialData } from "./SettingsClient"

const cardStyle: CSSProperties = {
  border: "1px solid var(--border)",
  borderRadius: 14,
  padding: 16,
  background: "var(--surface)",
}

const adminOnlyCards = [
  { href: "/settings/dashboard", title: "ダッシュボード", description: "運用状況、進捗、AI 利用の確認を行います。" },
  { href: "/settings/health", title: "Health", description: "主要データと設定の健全性を確認します。" },
  { href: "/settings/e2e", title: "E2Eチェック", description: "主要導線の確認用チェックリストです。" },
  { href: "/settings/export", title: "エクスポート", description: "JSON 形式でデータを書き出します。" },
  { href: "/settings/import", title: "インポート", description: "preview / apply の段階で安全に取り込みます。" },
  { href: "/settings/assets", title: "Assets", description: "Storage と URL の利用状況を確認します。" },
  { href: "/settings/audit", title: "Audit", description: "運用ログと変更履歴を確認します。" },
  { href: "/settings/roles", title: "ロール", description: "権限ごとの表示範囲と運用方針を確認します。" },
]

const commonCards = [
  { href: "/settings/profile", title: "プロフィール", description: "表示名、メール、パスワードを管理します。" },
  { href: "/settings/workspace", title: "ワークスペース", description: "会社情報、請求元情報、組織コードを設定します。" },
  { href: "/settings/members", title: "メンバー", description: "招待、権限、在籍メンバーを確認します。" },
  { href: "/settings/ai-history", title: "AI 履歴", description: "source / mode / applyTarget / record 単位で AI 候補を見返せます。" },
  { href: "/settings/ai-channels", title: "外部AI連携", description: "Discord / LINE の read-only AI 設定を管理します。" },
  { href: "/notifications", title: "通知", description: "未読通知と対応状況を確認します。" },
  { href: "/help/setup", title: "使い方", description: "初期設定と主要操作のガイドです。" },
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
                アカウント、ワークスペース、通知、外部AI連携などの運用設定をここから確認します。
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
