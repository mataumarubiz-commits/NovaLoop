"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { supabase } from "@/lib/supabase"
import { useAuthOrg } from "@/hooks/useAuthOrg"
import Section from "@/components/settings/Section"
import MenuRow from "@/components/settings/MenuRow"
import SettingsClient, { type SettingsInitialData } from "./SettingsClient"

type MenuItem = {
  href: string
  title: string
  description: string
}

function MenuSection({ title, description, items }: { title: string; description: string; items: MenuItem[] }) {
  return (
    <Section title={title} description={description}>
      {items.map((item, index) => (
        <MenuRow key={item.href} href={item.href} title={item.title} description={item.description} first={index === 0} />
      ))}
    </Section>
  )
}

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

  const accountItems: MenuItem[] = [
    { href: "/settings/profile", title: "プロフィール", description: "表示名やメールなどの個人設定を管理します。" },
    { href: "/settings/license", title: "ライセンス", description: "Creator ライセンスと請求書の状態を確認します。" },
  ]
  const orgItems: MenuItem[] = [
    { href: "/settings/workspace", title: "ワークスペース", description: "会社情報、請求元情報、組織コードを設定します。" },
    { href: "/settings/members", title: "メンバー", description: "招待、権限、承認待ちメンバーを管理します。" },
    { href: "/settings/templates", title: "テンプレート", description: "コンテンツテンプレートの一覧・追加・編集・並び順を管理します。" },
    { href: "/settings/ai-history", title: "AI 履歴", description: "AI の利用履歴を確認します。" },
    { href: "/settings/ai-channels", title: "外部AI連携", description: "Discord / LINE の AI 連携設定を確認します。" },
  ]
  const dataItems: MenuItem[] = isAdmin
    ? [
        { href: "/settings/export", title: "エクスポート", description: "JSON 形式でデータを書き出します。" },
        { href: "/settings/import", title: "インポート", description: "preview / apply で安全に取り込みます。" },
        { href: "/settings/assets", title: "Assets", description: "Storage と URL の参照状態を確認します。" },
      ]
    : []
  const securityItems: MenuItem[] = isAdmin
    ? [
        { href: "/settings/roles", title: "ロール", description: "表示できる画面と権限方針を確認します。" },
        { href: "/settings/audit", title: "監査", description: "操作ログと監査履歴を確認します。" },
      ]
    : []
  const supportItems: MenuItem[] = [
    { href: "/settings/dashboard", title: "改善要望 / バグ報告", description: "改善提案や不具合報告はここから送信します。" },
  ]

  return (
    <div style={{ minHeight: "100vh", background: "var(--bg-grad)" }}>
      <div style={{ maxWidth: 920, margin: "0 auto", padding: "40px 24px 80px", display: "grid", gap: 28 }}>
        <header style={{ display: "grid", gap: 14 }}>
          <div style={{ display: "flex", gap: 8, fontSize: 12, color: "var(--muted)" }}>
            <Link href="/home" style={{ color: "var(--primary)", textDecoration: "none", fontWeight: 600 }}>
              Home
            </Link>
            <span>/</span>
            <span>設定</span>
          </div>
          <div style={{ display: "grid", gap: 8, maxWidth: 680 }}>
            <h1 style={{ margin: 0, fontSize: 30, lineHeight: 1.2, fontWeight: 700, color: "var(--text)", letterSpacing: "-0.03em" }}>
              設定
            </h1>
            <p style={{ margin: 0, color: "var(--muted)", fontSize: 14, lineHeight: 1.8 }}>
              アカウント、組織、データ管理、セキュリティ設定をまとめて管理できます。
            </p>
          </div>
        </header>

        <MenuSection title="アカウント" description="個人に紐づく設定をまとめています。" items={accountItems} />
        <MenuSection title="組織" description="チーム運用とワークスペース全体の設定です。" items={orgItems} />
        {dataItems.length > 0 ? <MenuSection title="データ管理" description="移行、保全、書き出しの設定です。" items={dataItems} /> : null}
        {securityItems.length > 0 ? <MenuSection title="セキュリティ / 監査" description="権限と履歴の確認をまとめています。" items={securityItems} /> : null}

        <MenuSection title="サポート" description="改善要望やバグ報告の窓口です。" items={supportItems} />

        <SettingsClient initialData={initialData} />
      </div>
    </div>
  )
}

