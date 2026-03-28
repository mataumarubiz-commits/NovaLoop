"use client"

import { useCallback, useEffect, useState } from "react"
import Link from "next/link"
import { supabase } from "@/lib/supabase"
import { useAuthOrg } from "@/hooks/useAuthOrg"

type AssetPage = {
  id: string
  title: string
  cover_path: string | null
}

const cardStyle: React.CSSProperties = {
  background: "var(--surface)",
  borderRadius: 16,
  border: "1px solid var(--border)",
  padding: 20,
}

export default function AssetsSettingsPage() {
  const { activeOrgId, role, loading } = useAuthOrg({ redirectToOnboarding: true })
  const [pages, setPages] = useState<AssetPage[]>([])
  const [pageCount, setPageCount] = useState(0)
  const [assetFolderCount, setAssetFolderCount] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  const canUse = role === "owner" || role === "executive_assistant"

  const load = useCallback(async () => {
    if (!activeOrgId || !canUse) return
    const token = (await supabase.auth.getSession()).data.session?.access_token
    if (!token) return
    const res = await fetch("/api/settings/assets", {
      headers: { Authorization: `Bearer ${token}` },
    })
    const json = await res.json().catch(() => null)
    if (!res.ok || !json?.ok) {
      setError(json?.error ?? "Assets の読み込みに失敗しました。")
      return
    }
    setPages((json.pages ?? []) as AssetPage[])
    setPageCount(Number(json.pageCount ?? 0))
    setAssetFolderCount(Number(json.assetFolderCount ?? 0))
  }, [activeOrgId, canUse])

  useEffect(() => {
    queueMicrotask(() => {
      void load()
    })
  }, [load])

  const verify = async () => {
    setError(null)
    const token = (await supabase.auth.getSession()).data.session?.access_token
    if (!token) return
    const res = await fetch("/api/settings/assets", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ mode: "verify" }),
    })
    const json = await res.json().catch(() => null)
    if (!res.ok || !json?.ok) {
      setError(json?.error ?? "verify に失敗しました。")
      return
    }
    setSuccess(`verify 完了: ${json.folderCount ?? 0} 件のフォルダを確認しました。`)
    await load()
  }

  const copyUrl = async (path: string) => {
    setError(null)
    const token = (await supabase.auth.getSession()).data.session?.access_token
    if (!token) return
    const res = await fetch("/api/settings/assets", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ mode: "copy", path }),
    })
    const json = await res.json().catch(() => null)
    if (!res.ok || !json?.ok || !json?.url) {
      setError(json?.error ?? "URL の取得に失敗しました。")
      return
    }
    await navigator.clipboard.writeText(json.url)
    setSuccess("署名 URL をコピーしました。")
  }

  if (loading) return <div style={{ padding: 32, color: "var(--muted)" }}>読み込み中...</div>
  if (!activeOrgId) return <div style={{ padding: 32, color: "var(--muted)" }}>ワークスペースを選択してください。</div>
  if (!canUse) return <div style={{ padding: 32, color: "var(--muted)" }}>owner / executive_assistant のみ利用できます。</div>

  return (
    <div style={{ padding: "32px 40px", minHeight: "100vh", background: "var(--bg-grad)" }}>
      <div style={{ maxWidth: 920, margin: "0 auto", display: "grid", gap: 16 }}>
        <header>
          <h1 style={{ fontSize: 28, color: "var(--text)", margin: 0 }}>Assets</h1>
          <p style={{ fontSize: 13, color: "var(--muted)", marginTop: 8 }}>
            Pages 用の asset フォルダと cover path の状態を確認します。
          </p>
        </header>

        {error && <section style={{ ...cardStyle, background: "var(--error-bg)", borderColor: "var(--error-border)", color: "var(--error-text)" }}>{error}</section>}
        {success && <section style={{ ...cardStyle, background: "var(--success-bg)", borderColor: "var(--success-border)", color: "var(--success-text)" }}>{success}</section>}

        <section style={{ ...cardStyle, display: "flex", justifyContent: "space-between", gap: 16, flexWrap: "wrap", alignItems: "center" }}>
          <div style={{ display: "flex", gap: 24, flexWrap: "wrap" }}>
            <div><div style={{ fontSize: 12, color: "var(--muted)" }}>Pages</div><div style={{ fontSize: 24, fontWeight: 700 }}>{pageCount}</div></div>
            <div><div style={{ fontSize: 12, color: "var(--muted)" }}>Asset folders</div><div style={{ fontSize: 24, fontWeight: 700 }}>{assetFolderCount}</div></div>
          </div>
          <button type="button" onClick={() => void verify()} style={{ padding: "10px 16px", borderRadius: 10, border: "1px solid var(--border)", background: "var(--surface-2)", fontWeight: 600 }}>
            scan / verify
          </button>
        </section>

        <section style={cardStyle}>
          <div style={{ fontWeight: 700, marginBottom: 12 }}>cover path 一覧</div>
          {pages.length === 0 ? (
            <p style={{ color: "var(--muted)" }}>Pages データがありません。</p>
          ) : (
            <div style={{ display: "grid", gap: 10 }}>
              {pages.map((page) => (
                <div key={page.id} style={{ display: "flex", justifyContent: "space-between", gap: 16, flexWrap: "wrap", paddingBottom: 10, borderBottom: "1px solid var(--border)" }}>
                  <div>
                    <div style={{ fontWeight: 600 }}>{page.title}</div>
                    <div style={{ fontSize: 13, color: "var(--muted)" }}>{page.cover_path ?? "cover path なし"}</div>
                  </div>
                  {page.cover_path ? (
                    <button type="button" onClick={() => void copyUrl(page.cover_path as string)} style={{ padding: "8px 12px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--surface)" }}>
                      URL をコピー
                    </button>
                  ) : null}
                </div>
              ))}
            </div>
          )}
        </section>

        <Link href="/settings" style={{ color: "var(--primary)", fontWeight: 600, textDecoration: "none" }}>設定へ戻る</Link>
      </div>
    </div>
  )
}
