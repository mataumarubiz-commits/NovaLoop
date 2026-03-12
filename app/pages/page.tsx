"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core"
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable"
import { CSS } from "@dnd-kit/utilities"
import { supabase } from "@/lib/supabase"
import { useAuthOrg } from "@/hooks/useAuthOrg"
import { PAGE_TEMPLATES, PAGE_TEMPLATE_KEYS, type PageTemplateKey } from "@/lib/pageTemplates"

type PageRow = {
  id: string
  title: string
  updated_at: string
  sort_order: number
  body_text?: string | null
}

function SettingsIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1Z" />
    </svg>
  )
}

const PREVIEW_LEN = 90

export default function PagesListPage() {
  const router = useRouter()
  const { activeOrgId, role, loading: authLoading, needsOnboarding } = useAuthOrg({ redirectToOnboarding: true })
  const canEdit = role === "owner" || role === "executive_assistant"

  const [pages, setPages] = useState<PageRow[]>([])
  const [archivedPages, setArchivedPages] = useState<PageRow[]>([])
  const [loading, setLoading] = useState(true)
  const [loadingArchived, setLoadingArchived] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)

  const [creating, setCreating] = useState(false)
  const [templateModalOpen, setTemplateModalOpen] = useState(false)
  const [savingOrder, setSavingOrder] = useState(false)
  const [duplicateLoadingId, setDuplicateLoadingId] = useState<string | null>(null)
  const [archiveTarget, setArchiveTarget] = useState<{ id: string; title: string } | null>(null)
  const [archiveLoading, setArchiveLoading] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; title: string } | null>(null)
  const [deleteLoading, setDeleteLoading] = useState(false)

  const [searchQuery, setSearchQuery] = useState("")
  const [listSort, setListSort] = useState<"order" | "updated" | "title">("order")
  const [showArchived, setShowArchived] = useState(false)
  const searchInputRef = useRef<HTMLInputElement>(null)

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  )

  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 2500)
    return () => clearTimeout(t)
  }, [toast])

  const loadPages = useCallback(async () => {
    if (!activeOrgId || needsOnboarding) return
    setError(null)
    const { data: auth } = await supabase.auth.getSession()
    const token = auth.session?.access_token
    if (!token) {
      setError("ログイン状態を確認してください")
      setPages([])
      return
    }

    const res = await fetch("/api/pages/list", {
      headers: { Authorization: `Bearer ${token}` },
    })
    const json = (await res.json().catch(() => null)) as
      | { ok?: boolean; pages?: PageRow[]; message?: string }
      | null
    if (!res.ok || !json?.ok) {
      setError(json?.message ?? "ページ一覧の取得に失敗しました")
      setPages([])
      return
    }

    setPages(
      (json.pages ?? []).map((r) => ({
        id: r.id,
        title: r.title || "無題",
        updated_at: r.updated_at,
        sort_order: typeof r.sort_order === "number" ? r.sort_order : 0,
        body_text: r.body_text ?? null,
      }))
    )
  }, [activeOrgId, needsOnboarding])

  const loadArchived = useCallback(async () => {
    if (!activeOrgId || !canEdit) return
    setLoadingArchived(true)
    try {
      const { data: auth } = await supabase.auth.getSession()
      const token = auth.session?.access_token
      if (!token) return

      const res = await fetch("/api/pages/list?archived=1", {
        headers: { Authorization: `Bearer ${token}` },
      })
      const json = (await res.json().catch(() => null)) as
        | { ok?: boolean; pages?: PageRow[]; message?: string }
        | null
      if (!res.ok || !json?.ok) return
      setArchivedPages(
        (json.pages ?? []).map((r) => ({
          id: r.id,
          title: r.title || "無題",
          updated_at: r.updated_at,
          sort_order: typeof r.sort_order === "number" ? r.sort_order : 0,
          body_text: r.body_text ?? null,
        }))
      )
    } finally {
      setLoadingArchived(false)
    }
  }, [activeOrgId, canEdit])

  useEffect(() => {
    if (!activeOrgId || needsOnboarding) {
      setLoading(false)
      return
    }
    let active = true
    setLoading(true)
    loadPages().then(() => {
      if (active) setLoading(false)
    })
    return () => {
      active = false
    }
  }, [activeOrgId, needsOnboarding, loadPages])

  useEffect(() => {
    if (showArchived) void loadArchived()
  }, [showArchived, loadArchived])

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "/" && document.activeElement?.tagName !== "INPUT" && document.activeElement?.tagName !== "TEXTAREA") {
        e.preventDefault()
        if (pages.length > 0) searchInputRef.current?.focus()
      }
      if ((e.key === "n" || e.key === "N") && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        if (canEdit && !creating) setTemplateModalOpen(true)
      }
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [canEdit, creating, pages.length])

  const createPage = useCallback(
    async (template?: PageTemplateKey) => {
      if (!activeOrgId || !canEdit) return
      setCreating(true)
      setError(null)
      try {
        const { data } = await supabase.auth.getSession()
        const token = data.session?.access_token
        if (!token) {
          setError("ログイン状態を確認してください")
          return
        }
        const res = await fetch("/api/pages/create", {
          method: "POST",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: template ? JSON.stringify({ template }) : undefined,
        })
        const json = (await res.json().catch(() => null)) as { ok?: boolean; id?: string; message?: string } | null
        if (!res.ok || !json?.ok || !json?.id) {
          setError(json?.message ?? "ページの作成に失敗しました")
          return
        }
        router.push(`/pages/${json.id}`)
      } catch {
        setError("ページの作成に失敗しました")
      } finally {
        setCreating(false)
      }
    },
    [activeOrgId, canEdit, router]
  )

  const getAccessToken = useCallback(async () => {
    const { data } = await supabase.auth.getSession()
    return data.session?.access_token ?? null
  }, [])

  const handleDuplicate = useCallback(
    async (pageId: string) => {
      if (!canEdit) return
      setDuplicateLoadingId(pageId)
      setError(null)
      try {
        const token = await getAccessToken()
        if (!token) {
          setError("ログイン状態を確認してください")
          return
        }
        const res = await fetch(`/api/pages/${pageId}/duplicate`, {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
        })
        const json = (await res.json().catch(() => null)) as { ok?: boolean; id?: string; message?: string } | null
        if (!res.ok || !json?.ok || !json?.id) {
          setError(json?.message ?? "複製に失敗しました")
          return
        }
        setToast("ページを複製しました")
        await loadPages()
        router.push(`/pages/${json.id}`)
      } catch {
        setError("複製に失敗しました")
      } finally {
        setDuplicateLoadingId(null)
      }
    },
    [canEdit, getAccessToken, loadPages, router]
  )

  const handleArchiveConfirm = useCallback(async () => {
    if (!archiveTarget || !canEdit) return
    setArchiveLoading(true)
    try {
      const token = await getAccessToken()
      if (!token) return
      const res = await fetch(`/api/pages/${archiveTarget.id}/archive`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      })
      const json = (await res.json().catch(() => null)) as { ok?: boolean; message?: string } | null
      if (!res.ok || !json?.ok) {
        setError(json?.message ?? "アーカイブに失敗しました")
        return
      }
      setArchiveTarget(null)
      setToast("ページをアーカイブしました")
      await loadPages()
    } finally {
      setArchiveLoading(false)
    }
  }, [archiveTarget, canEdit, getAccessToken, loadPages])

  const handleDeleteConfirm = useCallback(async () => {
    if (!deleteTarget || !canEdit) return
    setDeleteLoading(true)
    try {
      const token = await getAccessToken()
      if (!token) {
        setError("ログイン状態を確認してください")
        return
      }
      const res = await fetch(`/api/pages/${deleteTarget.id}/delete`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      })
      const json = (await res.json().catch(() => null)) as { ok?: boolean; message?: string } | null
      if (!res.ok || !json?.ok) {
        setError(json?.message ?? "削除に失敗しました")
        return
      }
      setDeleteTarget(null)
      setToast("ページを削除しました")
      await loadPages()
      if (showArchived) await loadArchived()
    } finally {
      setDeleteLoading(false)
    }
  }, [deleteTarget, canEdit, getAccessToken, loadPages, loadArchived, showArchived])

  const handleUnarchive = useCallback(
    async (pageId: string) => {
      if (!canEdit) return
      const token = await getAccessToken()
      if (!token) return
      const res = await fetch(`/api/pages/${pageId}/unarchive`, { method: "POST", headers: { Authorization: `Bearer ${token}` } })
      const json = (await res.json().catch(() => null)) as { ok?: boolean } | null
      if (json?.ok) {
        setToast("アーカイブを解除しました")
        await loadArchived()
        await loadPages()
      }
    },
    [canEdit, getAccessToken, loadArchived, loadPages]
  )

  const handleReorder = useCallback(
    async (orderedIds: string[]) => {
      if (!canEdit || orderedIds.length === 0 || savingOrder) return
      setSavingOrder(true)
      try {
        const token = await getAccessToken()
        if (!token) return
        const res = await fetch("/api/pages/reorder", {
          method: "POST",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify({ ordered_ids: orderedIds }),
        })
        const json = (await res.json().catch(() => null)) as { ok?: boolean; message?: string } | null
        if (!res.ok || !json?.ok) {
          setError(json?.message ?? "並び順の保存に失敗しました")
          await loadPages()
        }
      } finally {
        setSavingOrder(false)
      }
    },
    [canEdit, getAccessToken, loadPages, savingOrder]
  )

  const filteredPages = searchQuery.trim()
    ? pages.filter((p) => {
        const q = searchQuery.trim().toLowerCase()
        return (p.title || "").toLowerCase().includes(q) || (p.body_text || "").toLowerCase().includes(q)
      })
    : pages

  const sortedPages = useMemo(() => {
    const base = [...filteredPages]
    if (listSort === "title") return base.sort((a, b) => (a.title || "無題").localeCompare(b.title || "無題", "ja"))
    if (listSort === "updated") return base.sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime())
    return base
  }, [filteredPages, listSort])

  const listToShow = listSort === "order" && !searchQuery.trim() ? filteredPages : sortedPages
  const allowDnd = listSort === "order" && !searchQuery.trim() && canEdit

  const onDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event
      if (!over || active.id === over.id || !allowDnd) return
      const oldIndex = pages.findIndex((p) => p.id === active.id)
      const newIndex = pages.findIndex((p) => p.id === over.id)
      if (oldIndex < 0 || newIndex < 0) return
      const next = arrayMove(pages, oldIndex, newIndex)
      setPages(next)
      void handleReorder(next.map((p) => p.id))
    },
    [allowDnd, handleReorder, pages]
  )

  const formatDate = (s: string) => {
    const d = new Date(s)
    const now = new Date()
    const diffMin = Math.floor((now.getTime() - d.getTime()) / 60000)
    if (diffMin < 1) return "たった今"
    if (diffMin < 60) return `${diffMin}分前`
    const diffHour = Math.floor(diffMin / 60)
    if (diffHour < 24) return `${diffHour}時間前`
    const diffDay = Math.floor(diffHour / 24)
    if (diffDay === 1) return "昨日"
    if (diffDay < 7) return `${diffDay}日前`
    return d.toLocaleDateString("ja-JP", { month: "short", day: "numeric" })
  }

  if (authLoading || loading) {
    return <div style={{ padding: "32px 40px", color: "var(--muted)" }}>読み込み中…</div>
  }

  if (needsOnboarding || !activeOrgId) {
    return <div style={{ padding: "32px 40px", color: "var(--muted)" }}>ワークスペースを設定後に Pages が利用できます。</div>
  }

  return (
    <div style={{ padding: "28px 24px 44px", minHeight: "100vh", background: "var(--bg-grad)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap", marginBottom: 16 }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
            <Link href="/home" style={{ color: "var(--primary)", textDecoration: "none", fontSize: 14 }}>Home</Link>
            <span style={{ color: "var(--muted)", fontSize: 13 }}>/</span>
            <span style={{ color: "var(--muted)", fontSize: 13 }}>Pages</span>
          </div>
          <h1 style={{ fontSize: 26, margin: 0, color: "var(--text)" }}>Pages</h1>
          <p style={{ margin: "6px 0 0", fontSize: 13, color: "var(--muted)" }}>社内マニュアルと実務ナレッジを運用する中枢</p>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <Link href="/settings" title="設定" style={{ display: "inline-flex", width: 40, height: 40, alignItems: "center", justifyContent: "center", borderRadius: 10, border: "1px solid var(--border)", background: "var(--surface)", color: "var(--muted)" }}>
            <SettingsIcon />
          </Link>
          {canEdit && (
            <button type="button" onClick={() => setTemplateModalOpen(true)} style={{ padding: "10px 14px", borderRadius: 10, border: "none", background: "var(--button-primary-bg)", color: "var(--primary-contrast)", fontWeight: 700, cursor: "pointer" }}>
              + 新規ページ
            </button>
          )}
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 10, marginBottom: 14 }}>
        <Link href="/contents" style={{ textDecoration: "none", border: "1px solid var(--border)", borderRadius: 10, background: "var(--surface)", padding: 12, color: "var(--text)", fontSize: 13 }}>クライアント運用へ</Link>
        <Link href="/billing" style={{ textDecoration: "none", border: "1px solid var(--border)", borderRadius: 10, background: "var(--surface)", padding: 12, color: "var(--text)", fontSize: 13 }}>請求運用へ</Link>
        <Link href="/payouts" style={{ textDecoration: "none", border: "1px solid var(--border)", borderRadius: 10, background: "var(--surface)", padding: 12, color: "var(--text)", fontSize: 13 }}>外注支払いへ</Link>
        <Link href="/help/pages-manual" style={{ textDecoration: "none", border: "1px solid var(--border)", borderRadius: 10, background: "var(--surface)", padding: 12, color: "var(--text)", fontSize: 13 }}>使い方を見る</Link>
        <Link href="/settings/dashboard?context=/pages&type=feedback" style={{ textDecoration: "none", border: "1px solid var(--border)", borderRadius: 10, background: "var(--surface)", padding: 12, color: "var(--text)", fontSize: 13 }}>改善要望を送る</Link>
      </div>

      <div style={{ border: "1px solid var(--border)", borderRadius: 16, background: "var(--surface)", padding: 16, marginBottom: 14 }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "flex-start", flexWrap: "wrap", marginBottom: 12 }}>
          <div>
            <p style={{ margin: "0 0 6px", fontSize: 11, letterSpacing: "0.08em", color: "var(--primary)", textTransform: "uppercase", fontWeight: 700 }}>Manual templates</p>
            <h2 style={{ margin: 0, fontSize: 18, color: "var(--text)" }}>社内マニュアルをここから始める</h2>
            <p style={{ margin: "6px 0 0", fontSize: 13, color: "var(--muted)" }}>業務手順書、請求手順、外注支払い手順、運用ルールをテンプレからすぐ作成できます。</p>
          </div>
          <Link href="/help/page-templates" style={{ color: "var(--primary)", fontSize: 13, fontWeight: 600, textDecoration: "none" }}>テンプレの使い分けを見る</Link>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))", gap: 10 }}>
          {(["business_manual", "client_ops", "billing_procedure", "payout_procedure"] as const).map((key) => {
            const template = PAGE_TEMPLATES[key]
            return (
              <button
                key={key}
                type="button"
                disabled={!canEdit || creating}
                onClick={() => void createPage(key)}
                style={{
                  textAlign: "left",
                  border: "1px solid var(--border)",
                  borderRadius: 12,
                  background: "linear-gradient(180deg, rgba(255,255,255,0.98) 0%, var(--surface-2) 100%)",
                  padding: 14,
                  color: "var(--text)",
                  cursor: !canEdit || creating ? "not-allowed" : "pointer",
                }}
              >
                <div style={{ fontSize: 11, fontWeight: 700, color: "var(--primary)", marginBottom: 6 }}>{template.badge}</div>
                <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 6 }}>{template.title}</div>
                <div style={{ fontSize: 12, color: "var(--muted)", lineHeight: 1.6 }}>{template.description}</div>
              </button>
            )
          })}
        </div>
      </div>

      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginBottom: 14 }}>
        <input
          ref={searchInputRef}
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          type="search"
          placeholder="タイトル/本文を検索"
          aria-label="ページ検索"
          style={{ width: "100%", maxWidth: 360, padding: "10px 12px", borderRadius: 10, border: "1px solid var(--border)", background: "var(--surface)", color: "var(--text)" }}
        />
        <select value={listSort} onChange={(e) => setListSort(e.target.value as "order" | "updated" | "title")} style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--border)", background: "var(--surface)", color: "var(--text)" }}>
          <option value="order">並び順（手動）</option>
          <option value="updated">更新日時</option>
          <option value="title">タイトル</option>
        </select>
        {canEdit && (
          <button type="button" onClick={() => setShowArchived((v) => !v)} style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--border)", background: "var(--surface-2)", color: "var(--text)", cursor: "pointer" }}>
            {showArchived ? "アーカイブを閉じる" : "アーカイブ一覧"}
          </button>
        )}
      </div>

      {error && <div style={{ marginBottom: 12, padding: "10px 12px", borderRadius: 10, background: "#fff1f2", border: "1px solid #fecaca", color: "#b91c1c", fontSize: 13 }}>{error}</div>}
      {savingOrder && <div style={{ marginBottom: 10, fontSize: 12, color: "var(--muted)" }}>並び順を保存中…</div>}

      {pages.length === 0 ? (
        <div style={{ border: "1px solid var(--border)", borderRadius: 16, padding: "42px 20px", background: "var(--surface)", textAlign: "center" }}>
          <p style={{ fontSize: 16, color: "var(--text)", fontWeight: 600, margin: "0 0 8px" }}>まだページがありません</p>
          <p style={{ fontSize: 13, color: "var(--muted)", margin: "0 0 18px" }}>業務手順、請求手順、運用ルールをページ化して、チームの共通知識にします。</p>
          {canEdit && <button type="button" onClick={() => setTemplateModalOpen(true)} style={{ padding: "10px 14px", borderRadius: 10, border: "none", background: "var(--button-primary-bg)", color: "var(--primary-contrast)", fontWeight: 700, cursor: "pointer" }}>最初のページを作成</button>}
        </div>
      ) : listToShow.length === 0 ? (
        <div style={{ border: "1px solid var(--border)", borderRadius: 12, padding: "24px 16px", background: "var(--surface)", color: "var(--muted)" }}>「{searchQuery.trim()}」に一致するページはありません。</div>
      ) : allowDnd ? (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <SortableContext items={listToShow.map((p) => p.id)} strategy={verticalListSortingStrategy}>
            <div style={{ border: "1px solid var(--border)", borderRadius: 14, overflow: "hidden", background: "var(--surface)" }}>
              {listToShow.map((p) => (
                <SortableRow key={p.id} page={p} formatDate={formatDate} onDuplicate={handleDuplicate} onArchive={setArchiveTarget} onDelete={setDeleteTarget} loadingId={duplicateLoadingId} />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      ) : (
        <div style={{ border: "1px solid var(--border)", borderRadius: 14, overflow: "hidden", background: "var(--surface)" }}>
          {listToShow.map((p) => (
            <StaticRow key={p.id} page={p} formatDate={formatDate} canEdit={canEdit} onDuplicate={handleDuplicate} onArchive={setArchiveTarget} onDelete={setDeleteTarget} loadingId={duplicateLoadingId} />
          ))}
        </div>
      )}

      {showArchived && canEdit && (
        <div style={{ marginTop: 14, border: "1px solid var(--border)", borderRadius: 12, padding: 12, background: "var(--surface)" }}>
          {loadingArchived ? <p style={{ margin: 0, color: "var(--muted)", fontSize: 13 }}>読み込み中…</p> : archivedPages.length === 0 ? <p style={{ margin: 0, color: "var(--muted)", fontSize: 13 }}>アーカイブ済みのページはありません。</p> : (
            <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
              {archivedPages.map((p) => (
                <li key={p.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, padding: "8px 0", borderBottom: "1px solid var(--border)" }}>
                  <Link href={`/pages/${p.id}`} style={{ color: "var(--text)", textDecoration: "none", fontSize: 14 }}>{p.title || "無題"}</Link>
                  <button type="button" onClick={() => void handleUnarchive(p.id)} style={{ padding: "6px 10px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--surface-2)", color: "var(--text)", fontSize: 12, cursor: "pointer" }}>復元</button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {templateModalOpen && canEdit && (
        <div style={{ position: "fixed", inset: 0, zIndex: 80, background: "rgba(0,0,0,0.4)", display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }} onClick={() => !creating && setTemplateModalOpen(false)}>
          <div style={{ width: "min(460px, 100%)", background: "var(--surface)", borderRadius: 14, border: "1px solid var(--border)", padding: 16 }} onClick={(e) => e.stopPropagation()}>
            <h3 style={{ margin: "0 0 10px", fontSize: 17, color: "var(--text)" }}>新規ページを作成</h3>
            <div style={{ display: "grid", gap: 8 }}>
              <button type="button" disabled={creating} onClick={() => void createPage()} style={{ textAlign: "left", border: "1px solid var(--border)", borderRadius: 10, background: "var(--surface-2)", color: "var(--text)", padding: "10px 12px", cursor: creating ? "wait" : "pointer" }}>空白ページ</button>
              {PAGE_TEMPLATE_KEYS.map((k) => (
                <button key={k} type="button" disabled={creating} onClick={() => void createPage(k)} style={{ textAlign: "left", border: "1px solid var(--border)", borderRadius: 10, background: "var(--surface-2)", color: "var(--text)", padding: "10px 12px", cursor: creating ? "wait" : "pointer" }}>
                  <div style={{ fontWeight: 700, marginBottom: 4 }}>{PAGE_TEMPLATES[k].title}</div>
                  <div style={{ fontSize: 12, color: "var(--muted)", lineHeight: 1.5 }}>{PAGE_TEMPLATES[k].description}</div>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {archiveTarget && (
        <div style={{ position: "fixed", inset: 0, zIndex: 81, background: "rgba(0,0,0,0.4)", display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }} onClick={() => !archiveLoading && setArchiveTarget(null)}>
          <div style={{ width: "min(420px, 100%)", background: "var(--surface)", borderRadius: 14, border: "1px solid var(--border)", padding: 18 }} onClick={(e) => e.stopPropagation()}>
            <h3 style={{ margin: "0 0 10px", fontSize: 16, color: "var(--text)" }}>ページをアーカイブしますか？</h3>
            <p style={{ margin: "0 0 14px", fontSize: 13, color: "var(--muted)" }}>「{archiveTarget.title || "無題"}」は一覧から非表示になります。後で復元できます。</p>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
              <button type="button" onClick={() => setArchiveTarget(null)} disabled={archiveLoading} style={{ padding: "8px 12px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--surface-2)", color: "var(--text)", cursor: "pointer" }}>キャンセル</button>
              <button type="button" onClick={() => void handleArchiveConfirm()} disabled={archiveLoading} style={{ padding: "8px 12px", borderRadius: 8, border: "none", background: "var(--primary)", color: "var(--primary-contrast)", cursor: "pointer" }}>{archiveLoading ? "処理中…" : "アーカイブ"}</button>
            </div>
          </div>
        </div>
      )}

      {deleteTarget && (
        <div style={{ position: "fixed", inset: 0, zIndex: 82, background: "rgba(0,0,0,0.45)", display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }} onClick={() => !deleteLoading && setDeleteTarget(null)}>
          <div style={{ width: "min(440px, 100%)", background: "var(--surface)", borderRadius: 14, border: "1px solid var(--border)", padding: 18 }} onClick={(e) => e.stopPropagation()}>
            <h3 style={{ margin: "0 0 10px", fontSize: 16, color: "var(--text)" }}>ページを削除しますか？</h3>
            <p style={{ margin: "0 0 14px", fontSize: 13, color: "var(--muted)" }}>
              「{deleteTarget.title || "無題"}」を完全に削除します。コメント・履歴も削除されます。
            </p>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
              <button type="button" onClick={() => setDeleteTarget(null)} disabled={deleteLoading} style={{ padding: "8px 12px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--surface-2)", color: "var(--text)", cursor: "pointer" }}>キャンセル</button>
              <button type="button" onClick={() => void handleDeleteConfirm()} disabled={deleteLoading} style={{ padding: "8px 12px", borderRadius: 8, border: "1px solid #ef4444", background: "#fef2f2", color: "#b91c1c", cursor: "pointer" }}>
                {deleteLoading ? "削除中…" : "削除する"}
              </button>
            </div>
          </div>
        </div>
      )}

      {toast && <div role="status" style={{ position: "fixed", bottom: 24, left: "50%", transform: "translateX(-50%)", zIndex: 90, background: "var(--text)", color: "var(--surface)", borderRadius: 10, padding: "10px 16px", fontSize: 13 }}>{toast}</div>}
    </div>
  )
}

function StaticRow({
  page,
  formatDate,
  canEdit,
  onDuplicate,
  onArchive,
  onDelete,
  loadingId,
}: {
  page: PageRow
  formatDate: (s: string) => string
  canEdit: boolean
  onDuplicate: (id: string) => void
  onArchive: (payload: { id: string; title: string }) => void
  onDelete: (payload: { id: string; title: string }) => void
  loadingId: string | null
}) {
  const preview = page.body_text?.trim() ? page.body_text.trim().slice(0, PREVIEW_LEN) + (page.body_text.length > PREVIEW_LEN ? "…" : "") : null
  return (
    <div style={{ borderBottom: "1px solid var(--border)", padding: "10px 14px", display: "flex", alignItems: "center", gap: 10 }}>
      <Link href={`/pages/${page.id}`} style={{ flex: 1, minWidth: 0, textDecoration: "none", color: "var(--text)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 15, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{page.title || "無題"}</span>
          <span style={{ fontSize: 12, color: "var(--muted)", flexShrink: 0 }}>{formatDate(page.updated_at)}</span>
        </div>
        {preview && <p style={{ margin: "4px 0 0", fontSize: 12, color: "var(--muted)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{preview}</p>}
      </Link>
      {canEdit && (
        <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
          <button type="button" disabled={loadingId === page.id} onClick={() => onDuplicate(page.id)} style={{ padding: "6px 10px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--surface-2)", color: "var(--text)", fontSize: 12, cursor: "pointer" }}>{loadingId === page.id ? "複製中…" : "複製"}</button>
          <button type="button" onClick={() => onArchive({ id: page.id, title: page.title || "無題" })} style={{ padding: "6px 10px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--surface-2)", color: "var(--muted)", fontSize: 12, cursor: "pointer" }}>アーカイブ</button>
          <button type="button" onClick={() => onDelete({ id: page.id, title: page.title || "無題" })} style={{ padding: "6px 10px", borderRadius: 8, border: "1px solid #fecaca", background: "#fff1f2", color: "#b91c1c", fontSize: 12, cursor: "pointer" }}>削除</button>
        </div>
      )}
    </div>
  )
}

function SortableRow({
  page,
  formatDate,
  onDuplicate,
  onArchive,
  onDelete,
  loadingId,
}: {
  page: PageRow
  formatDate: (s: string) => string
  onDuplicate: (id: string) => void
  onArchive: (payload: { id: string; title: string }) => void
  onDelete: (payload: { id: string; title: string }) => void
  loadingId: string | null
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: page.id })
  const preview = page.body_text?.trim() ? page.body_text.trim().slice(0, PREVIEW_LEN) + (page.body_text.length > PREVIEW_LEN ? "…" : "") : null
  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        borderBottom: "1px solid var(--border)",
        padding: "10px 14px",
        display: "flex",
        alignItems: "center",
        gap: 10,
        background: isDragging ? "var(--surface-2)" : "var(--surface)",
      }}
    >
      <span {...attributes} {...listeners} style={{ width: 22, height: 22, borderRadius: 6, background: "var(--surface-2)", color: "var(--muted)", fontSize: 11, display: "inline-flex", alignItems: "center", justifyContent: "center", cursor: "grab", flexShrink: 0 }}>::</span>
      <Link href={`/pages/${page.id}`} style={{ flex: 1, minWidth: 0, textDecoration: "none", color: "var(--text)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 15, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{page.title || "無題"}</span>
          <span style={{ fontSize: 12, color: "var(--muted)", flexShrink: 0 }}>{formatDate(page.updated_at)}</span>
        </div>
        {preview && <p style={{ margin: "4px 0 0", fontSize: 12, color: "var(--muted)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{preview}</p>}
      </Link>
      <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
        <button type="button" disabled={loadingId === page.id} onClick={() => onDuplicate(page.id)} style={{ padding: "6px 10px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--surface-2)", color: "var(--text)", fontSize: 12, cursor: "pointer" }}>{loadingId === page.id ? "複製中…" : "複製"}</button>
        <button type="button" onClick={() => onArchive({ id: page.id, title: page.title || "無題" })} style={{ padding: "6px 10px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--surface-2)", color: "var(--muted)", fontSize: 12, cursor: "pointer" }}>アーカイブ</button>
        <button type="button" onClick={() => onDelete({ id: page.id, title: page.title || "無題" })} style={{ padding: "6px 10px", borderRadius: 8, border: "1px solid #fecaca", background: "#fff1f2", color: "#b91c1c", fontSize: 12, cursor: "pointer" }}>削除</button>
      </div>
    </div>
  )
}

