"use client"

import type { CSSProperties } from "react"
import Link from "next/link"
import { useAuthOrg } from "@/hooks/useAuthOrg"

const cardStyle: CSSProperties = {
  background: "var(--surface)",
  borderRadius: 16,
  border: "1px solid var(--border)",
  padding: "24px 22px",
  boxShadow: "0 4px 20px rgba(0,0,0,0.06)",
}

export default function OrgSettingsPage() {
  const { activeOrgId, role, memberships, loading } = useAuthOrg({ redirectToOnboarding: true })
  const currentName = activeOrgId ? memberships.find((m) => m.org_id === activeOrgId)?.org_name ?? "" : ""
  const canEdit = role === "owner" || role === "executive_assistant"

  if (loading) {
    return <div style={{ padding: "48px 24px", minHeight: "100vh", background: "var(--bg-grad)", textAlign: "center" }}>読み込み中...</div>
  }

  if (!activeOrgId) {
    return (
      <div style={{ padding: "48px 24px", minHeight: "100vh", background: "var(--bg-grad)", textAlign: "center" }}>
        <p style={{ color: "var(--muted)", marginBottom: 16 }}>ワークスペースを選択してください。</p>
        <Link href="/settings" style={{ color: "var(--primary)", fontWeight: 600 }}>
          設定へ戻る
        </Link>
      </div>
    )
  }

  return (
    <div style={{ minHeight: "100vh", background: "var(--bg-grad)", padding: "48px 24px", display: "flex", justifyContent: "center" }}>
      <div style={{ maxWidth: 520, width: "100%", display: "grid", gap: 16 }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 600, color: "var(--text)", marginBottom: 8, textAlign: "center" }}>組織情報</h1>
          <p style={{ fontSize: 14, color: "var(--muted)", marginBottom: 0, textAlign: "center" }}>
            組織情報の編集導線はワークスペースに統合しました。重複画面を残さず、運用上の迷いを減らします。
          </p>
        </div>

        <section style={cardStyle}>
          <div style={{ display: "grid", gap: 12 }}>
            <div>
              <div style={{ fontSize: 13, color: "var(--muted)", marginBottom: 6 }}>現在のワークスペース名</div>
              <div style={{ fontSize: 18, fontWeight: 600, color: "var(--text)" }}>{currentName || "未設定"}</div>
            </div>
            <div style={{ color: "var(--muted)", fontSize: 14 }}>
              {canEdit
                ? "ワークスペース名、自社情報、口座、紹介コードはワークスペース設定からまとめて更新できます。"
                : "組織情報の編集は owner / executive_assistant のみ可能です。"}
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
              <Link href="/settings" style={{ color: "var(--primary)", fontWeight: 600, textDecoration: "none", alignSelf: "center" }}>
                設定へ戻る
              </Link>
              <Link href="/settings/workspace" style={{ padding: "10px 18px", borderRadius: 10, background: "var(--button-primary-bg)", color: "var(--primary-contrast)", fontWeight: 600, textDecoration: "none" }}>
                ワークスペースを開く
              </Link>
            </div>
          </div>
        </section>
      </div>
    </div>
  )
}
