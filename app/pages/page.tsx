"use client"

import type { CSSProperties, ReactNode } from "react"
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { DndContext, closestCenter, KeyboardSensor, PointerSensor, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core"
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable"
import { CSS } from "@dnd-kit/utilities"
import TemplateInstallDialog from "@/components/pages/TemplateInstallDialog"
import { useAuthOrg } from "@/hooks/useAuthOrg"
import { supabase } from "@/lib/supabase"

type PageTemplateBinding = {
  installId: string
  templateName: string
  installName: string
  templateBadges: string[]
  pageType: string
  isCustomized: boolean
  rootPageId: string | null
  groupUnderRoot: boolean
  installStatus: string
  updateAvailable: boolean
  templateVersion: string
  latestVersion: string
  templateSourceType: "official" | "shared"
  sharingScope: "official" | "org" | "industry"
  industryTag: string | null
}

type PageRow = {
  id: string
  title: string
  updated_at: string
  sort_order: number
  body_text?: string | null
  template_binding?: PageTemplateBinding | null
}

const previewLength = 90

function installStatusLabel(status: string) {
  switch (status) {
    case "pending":
      return "準備中"
    case "failed":
      return "失敗"
    default:
      return "完了"
  }
}

function templateBadgeTone(label: string): { background: string; color: string; border: string } {
  switch (label) {
    case "公式":
      return { background: "rgba(255,247,237,.92)", color: "#9a3412", border: "1px solid rgba(251,191,36,.22)" }
    case "上級":
      return { background: "rgba(243,232,255,.92)", color: "#7c3aed", border: "1px solid rgba(167,139,250,.22)" }
    case "編集ディレクション":
      return { background: "rgba(219,234,254,.92)", color: "#1d4ed8", border: "1px solid rgba(59,130,246,.2)" }
    case "メンバー運用":
      return { background: "rgba(220,252,231,.92)", color: "#166534", border: "1px solid rgba(34,197,94,.18)" }
    case "修正管理":
      return { background: "rgba(254,226,226,.92)", color: "#b91c1c", border: "1px solid rgba(220,38,38,.16)" }
    case "通知運用":
      return { background: "rgba(204,251,241,.92)", color: "#0f766e", border: "1px solid rgba(45,212,191,.18)" }
    case "1クリック導入":
      return { background: "rgba(254,243,199,.92)", color: "#92400e", border: "1px solid rgba(245,158,11,.18)" }
    default:
      return { background: "rgba(248,250,252,.92)", color: "#475569", border: "1px solid rgba(148,163,184,.18)" }
  }
}

export default function PagesListPage() {
  const router = useRouter()
  const searchRef = useRef<HTMLInputElement>(null)
  const { activeOrgId, role, loading: authLoading, needsOnboarding } = useAuthOrg({ redirectToOnboarding: true })
  const canEdit = role === "owner" || role === "executive_assistant"
  const [pages, setPages] = useState<PageRow[]>([])
  const [archivedPages, setArchivedPages] = useState<PageRow[]>([])
  const [loading, setLoading] = useState(true)
  const [loadingArchived, setLoadingArchived] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState("")
  const [listSort, setListSort] = useState<"order" | "updated" | "title">("order")
  const [showArchived, setShowArchived] = useState(false)
  const [templateDialogOpen, setTemplateDialogOpen] = useState(false)
  const [creatingBlank, setCreatingBlank] = useState(false)
  const [savingOrder, setSavingOrder] = useState(false)
  const [duplicateLoadingId, setDuplicateLoadingId] = useState<string | null>(null)
  const [archiveTarget, setArchiveTarget] = useState<{ id: string; title: string } | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; title: string } | null>(null)

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  )

  useEffect(() => {
    if (!toast) return
    const timer = setTimeout(() => setToast(null), 3200)
    return () => clearTimeout(timer)
  }, [toast])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "/" && document.activeElement?.tagName !== "INPUT" && document.activeElement?.tagName !== "TEXTAREA") {
        event.preventDefault()
        searchRef.current?.focus()
      }
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [])

  const getAccessToken = useCallback(async () => {
    const { data } = await supabase.auth.getSession()
    return data.session?.access_token ?? null
  }, [])

  const mapPage = (row: PageRow): PageRow => ({
    id: row.id,
    title: row.title || "無題",
    updated_at: row.updated_at,
    sort_order: typeof row.sort_order === "number" ? row.sort_order : 0,
    body_text: row.body_text ?? null,
    template_binding: row.template_binding ?? null,
  })

  const loadPages = useCallback(async () => {
    if (!activeOrgId || needsOnboarding) return
    setError(null)
    const token = await getAccessToken()
    if (!token) {
      setError("ログイン状態を確認してください。")
      return
    }
    const res = await fetch("/api/pages/list", { headers: { Authorization: `Bearer ${token}` } })
    const json = (await res.json().catch(() => null)) as { ok?: boolean; pages?: PageRow[]; message?: string } | null
    if (!res.ok || !json?.ok) {
      setError(json?.message ?? "Pages 一覧の取得に失敗しました。")
      setPages([])
      return
    }
    setPages((json.pages ?? []).map(mapPage))
  }, [activeOrgId, getAccessToken, needsOnboarding])

  const loadArchived = useCallback(async () => {
    if (!activeOrgId || !canEdit) return
    setLoadingArchived(true)
    try {
      const token = await getAccessToken()
      if (!token) return
      const res = await fetch("/api/pages/list?archived=1", { headers: { Authorization: `Bearer ${token}` } })
      const json = (await res.json().catch(() => null)) as { ok?: boolean; pages?: PageRow[] } | null
      if (res.ok && json?.ok) {
        setArchivedPages((json.pages ?? []).map(mapPage))
      }
    } finally {
      setLoadingArchived(false)
    }
  }, [activeOrgId, canEdit, getAccessToken])

  useEffect(() => {
    if (!activeOrgId || needsOnboarding) {
      setLoading(false)
      return
    }
    let active = true
    setLoading(true)
    loadPages().finally(() => {
      if (active) setLoading(false)
    })
    return () => {
      active = false
    }
  }, [activeOrgId, loadPages, needsOnboarding])

  useEffect(() => {
    if (showArchived) void loadArchived()
  }, [showArchived, loadArchived])

  const createBlankPage = useCallback(async () => {
    if (!canEdit || creatingBlank) return
    setCreatingBlank(true)
    try {
      const token = await getAccessToken()
      if (!token) return
      const res = await fetch("/api/pages/create", { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" } })
      const json = (await res.json().catch(() => null)) as { ok?: boolean; id?: string; message?: string } | null
      if (!res.ok || !json?.ok || !json.id) {
        setError(json?.message ?? "空ページの作成に失敗しました。")
        return
      }
      setToast("空ページを作成しました。")
      await loadPages()
    } finally {
      setCreatingBlank(false)
    }
  }, [canEdit, creatingBlank, getAccessToken, router])

  const handleDuplicate = useCallback(async (pageId: string) => {
    if (!canEdit) return
    setDuplicateLoadingId(pageId)
    try {
      const token = await getAccessToken()
      if (!token) return
      const res = await fetch(`/api/pages/${pageId}/duplicate`, { method: "POST", headers: { Authorization: `Bearer ${token}` } })
      const json = (await res.json().catch(() => null)) as { ok?: boolean; id?: string; message?: string } | null
      if (!res.ok || !json?.ok || !json.id) {
        setError(json?.message ?? "ページの複製に失敗しました。")
        return
      }
      setToast("ページを複製しました。")
      await loadPages()
      router.push(`/pages/${json.id}`)
    } finally {
      setDuplicateLoadingId(null)
    }
  }, [canEdit, getAccessToken, loadPages, router])

  const handleArchive = useCallback(async () => {
    if (!archiveTarget || !canEdit) return
    const token = await getAccessToken()
    if (!token) return
    const res = await fetch(`/api/pages/${archiveTarget.id}/archive`, { method: "POST", headers: { Authorization: `Bearer ${token}` } })
    const json = (await res.json().catch(() => null)) as { ok?: boolean; message?: string } | null
    if (!res.ok || !json?.ok) {
      setError(json?.message ?? "アーカイブに失敗しました。")
      return
    }
    setArchiveTarget(null)
    setToast("ページをアーカイブしました。")
    await loadPages()
  }, [archiveTarget, canEdit, getAccessToken, loadPages])

  const handleDelete = useCallback(async () => {
    if (!deleteTarget || !canEdit) return
    const token = await getAccessToken()
    if (!token) return
    const res = await fetch(`/api/pages/${deleteTarget.id}/delete`, { method: "DELETE", headers: { Authorization: `Bearer ${token}` } })
    const json = (await res.json().catch(() => null)) as { ok?: boolean; message?: string } | null
    if (!res.ok || !json?.ok) {
      setError(json?.message ?? "ページの削除に失敗しました。")
      return
    }
    setDeleteTarget(null)
    setToast("ページを削除しました。")
    await loadPages()
    if (showArchived) await loadArchived()
  }, [canEdit, deleteTarget, getAccessToken, loadArchived, loadPages, showArchived])

  const handleUnarchive = useCallback(async (pageId: string) => {
    if (!canEdit) return
    const token = await getAccessToken()
    if (!token) return
    const res = await fetch(`/api/pages/${pageId}/unarchive`, { method: "POST", headers: { Authorization: `Bearer ${token}` } })
    const json = (await res.json().catch(() => null)) as { ok?: boolean } | null
    if (json?.ok) {
      setToast("アーカイブを解除しました。")
      await loadPages()
      await loadArchived()
    }
  }, [canEdit, getAccessToken, loadArchived, loadPages])

  const handleReorder = useCallback(async (orderedIds: string[]) => {
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
        setError(json?.message ?? "並び順の保存に失敗しました。")
        await loadPages()
      }
    } finally {
      setSavingOrder(false)
    }
  }, [canEdit, getAccessToken, loadPages, savingOrder])

  const filteredPages = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    if (!q) return pages
    return pages.filter((page) =>
      [page.title, page.body_text ?? "", page.template_binding?.templateName ?? "", page.template_binding?.installName ?? "", page.template_binding?.pageType ?? ""]
        .some((value) => value.toLowerCase().includes(q))
    )
  }, [pages, searchQuery])

  const listToShow = useMemo(() => {
    if (listSort === "order" && !searchQuery.trim()) return filteredPages
    const next = [...filteredPages]
    if (listSort === "title") return next.sort((a, b) => a.title.localeCompare(b.title, "ja"))
    return next.sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime())
  }, [filteredPages, listSort, searchQuery])

  const groupedTemplateSections = useMemo(() => {
    if (listSort !== "order" || searchQuery.trim()) return null

    const plainPages: PageRow[] = []
    const order: string[] = []
    const groups = new Map<string, { installName: string; root: PageRow | null; children: PageRow[]; updateAvailable: boolean; installStatus: string }>()

    for (const page of filteredPages) {
      const binding = page.template_binding
      if (!binding || !binding.groupUnderRoot || !binding.installId) {
        plainPages.push(page)
        continue
      }

      if (!groups.has(binding.installId)) {
        groups.set(binding.installId, {
          installName: binding.installName,
          root: null,
          children: [],
          updateAvailable: binding.updateAvailable,
          installStatus: binding.installStatus,
        })
        order.push(binding.installId)
      }

      const group = groups.get(binding.installId)!
      if (page.id === binding.rootPageId) {
        group.root = page
      } else {
        group.children.push(page)
      }
      group.updateAvailable = group.updateAvailable || binding.updateAvailable
      group.installStatus = group.installStatus === "failed" ? "failed" : binding.installStatus
    }

    return {
      plainPages,
      groups: order.map((installId) => {
        const group = groups.get(installId)!
        return {
          installId,
          installName: group.installName,
          root: group.root,
          pages: group.root ? [group.root, ...group.children] : group.children,
          updateAvailable: group.updateAvailable,
          installStatus: group.installStatus,
        }
      }),
    }
  }, [filteredPages, listSort, searchQuery])

  const allowDnd = canEdit && listSort === "order" && !searchQuery.trim() && (!groupedTemplateSections || groupedTemplateSections.groups.length === 0)
  const templatePages = pages.filter((page) => page.template_binding).length
  const customizedPages = pages.filter((page) => page.template_binding?.isCustomized).length

  const onDragEnd = useCallback((event: DragEndEvent) => {
    if (!allowDnd || !event.over) return
    const activeId = String(event.active.id)
    const overId = String(event.over.id)
    if (activeId === overId) return
    const oldIndex = pages.findIndex((page) => page.id === activeId)
    const newIndex = pages.findIndex((page) => page.id === overId)
    if (oldIndex < 0 || newIndex < 0) return
    const next = arrayMove(pages, oldIndex, newIndex)
    setPages(next)
    void handleReorder(next.map((page) => page.id))
  }, [allowDnd, handleReorder, pages])

  const formatUpdated = (value: string) => {
    const date = new Date(value)
    const diffMinutes = Math.floor((Date.now() - date.getTime()) / 60000)
    if (diffMinutes < 1) return "たった今"
    if (diffMinutes < 60) return `${diffMinutes}分前`
    const diffHours = Math.floor(diffMinutes / 60)
    if (diffHours < 24) return `${diffHours}時間前`
    const diffDays = Math.floor(diffHours / 24)
    if (diffDays === 1) return "昨日"
    if (diffDays < 7) return `${diffDays}日前`
    return date.toLocaleDateString("ja-JP", { month: "short", day: "numeric" })
  }

  if (authLoading || loading) return <div style={{ padding: "32px 40px", color: "var(--muted)" }}>読み込み中…</div>
  if (needsOnboarding || !activeOrgId) return <div style={{ padding: "32px 40px", color: "var(--muted)" }}>ワークスペース設定完了後に Pages を利用できます。</div>

  return (
    <div style={{ padding: "28px 24px 44px", minHeight: "100vh", background: "var(--bg-grad)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 16, flexWrap: "wrap", marginBottom: 16 }}>
        <div>
          <div style={{ display: "flex", gap: 8, marginBottom: 6, fontSize: 13 }}>
            <span style={{ color: "var(--muted)" }}>Pages</span>
          </div>
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: "var(--text)" }}>Pages</h1>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-start" }}>
          <button type="button" onClick={() => setTemplateDialogOpen(true)} style={{ padding: "8px 16px", borderRadius: 8, border: "1px solid #222", background: "#222", color: "#fff", fontWeight: 600, fontSize: 13, cursor: "pointer" }}>+ テンプレを導入</button>
          {canEdit ? <button type="button" onClick={() => void createBlankPage()} style={{ padding: "8px 16px", borderRadius: 8, border: "1px solid var(--border)", background: "#fff", color: "var(--text)", fontWeight: 500, fontSize: 13, cursor: "pointer" }}>{creatingBlank ? "作成中..." : "空ページを作成"}</button> : null}
        </div>
      </div>

      <div style={{ display: "flex", gap: 20, marginBottom: 16, flexWrap: "wrap" }}>
        {[
          ["総ページ数", String(pages.length)],
          ["テンプレ由来", String(templatePages)],
          ["改変あり", String(customizedPages)],
          ["アーカイブ", String(archivedPages.length)],
        ].map(([label, value]) => (
          <div key={label} style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
            <span style={{ fontSize: 20, fontWeight: 700, color: "var(--text)" }}>{value}</span>
            <span style={{ fontSize: 12, color: "var(--muted)" }}>{label}</span>
          </div>
        ))}
      </div>

      <div style={{ marginBottom: 16, fontSize: 12, color: "var(--muted)", lineHeight: 1.7, borderLeft: "2px solid var(--border)", paddingLeft: 12 }}>
        Pages はルールと型を管理する場所です。案件データの実体は /contents に置き、ここでは運用ルール・チェックリスト・テンプレートを整理します。
      </div>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 14 }}>
        <input ref={searchRef} type="search" value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} placeholder="ページを検索…" style={{ width: "100%", maxWidth: 280, padding: "7px 10px", borderRadius: 7, border: "1px solid var(--border)", background: "#fff", color: "var(--text)", fontSize: 13 }} />
        <select value={listSort} onChange={(event) => setListSort(event.target.value as "order" | "updated" | "title")} style={{ padding: "7px 10px", borderRadius: 7, border: "1px solid var(--border)", background: "#fff", color: "var(--text)", fontSize: 13 }}>
          <option value="order">並び順</option>
          <option value="updated">更新日</option>
          <option value="title">タイトル</option>
        </select>
        {canEdit ? <button type="button" onClick={() => setShowArchived((current) => !current)} style={{ padding: "7px 10px", borderRadius: 7, border: "1px solid var(--border)", background: "#fff", color: "var(--text)", cursor: "pointer", fontSize: 13 }}>{showArchived ? "アーカイブを閉じる" : "アーカイブを見る"}</button> : null}
      </div>

      {error ? <div style={{ marginBottom: 12, padding: "10px 12px", borderRadius: 12, background: "var(--error-bg)", border: "1px solid var(--error-border)", color: "var(--error-text)", fontSize: 13 }}>{error}</div> : null}
      {savingOrder ? <div style={{ marginBottom: 10, fontSize: 12, color: "var(--muted)" }}>並び順を保存しています…</div> : null}

      {pages.length === 0 ? (
        <div style={{ borderRadius: 10, border: "1px solid var(--border)", background: "#fff", padding: "48px 24px", textAlign: "center" }}>
          <div style={{ fontSize: 16, fontWeight: 600, color: "var(--text)", marginBottom: 6 }}>ページがありません</div>
          <p style={{ margin: "0 0 20px", fontSize: 13, color: "var(--muted)" }}>テンプレートから導入するか、空ページを作成して始められます。</p>
          <div style={{ display: "flex", justifyContent: "center", gap: 8 }}>
            <button type="button" onClick={() => setTemplateDialogOpen(true)} style={{ padding: "8px 18px", borderRadius: 8, border: "1px solid #222", background: "#222", color: "#fff", fontWeight: 600, fontSize: 13, cursor: "pointer" }}>テンプレートから導入</button>
            {canEdit ? <button type="button" onClick={() => void createBlankPage()} style={{ padding: "8px 18px", borderRadius: 8, border: "1px solid var(--border)", background: "#fff", color: "var(--text)", fontWeight: 500, fontSize: 13, cursor: "pointer" }}>空ページを作成</button> : null}
          </div>
        </div>
      ) : listToShow.length === 0 ? (
        <div style={{ borderRadius: 18, border: "1px solid var(--border)", background: "#fff", padding: 24, color: "var(--muted)" }}>検索条件に一致するページがありません。</div>
      ) : groupedTemplateSections && groupedTemplateSections.groups.length > 0 ? (
        <div style={{ borderRadius: 18, border: "1px solid var(--border)", background: "var(--surface)", overflow: "hidden" }}>
          {groupedTemplateSections.plainPages.map((page) => (
            <StaticRow key={page.id} page={page} canEdit={canEdit} formatUpdated={formatUpdated} onDuplicate={handleDuplicate} onArchive={setArchiveTarget} onDelete={setDeleteTarget} duplicateLoadingId={duplicateLoadingId} />
          ))}
          {groupedTemplateSections.groups.map((group) => (
            <div key={group.installId} style={{ borderTop: "1px solid var(--border)", background: "rgba(255,247,237,.42)" }}>
              <div style={{ padding: "12px 16px", borderBottom: "1px solid rgba(148,163,184,.12)", display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 800, color: "var(--text)" }}>{group.installName}</div>
                  <div style={{ fontSize: 11, color: "var(--muted)" }}>{group.pages.length} ページ / {installStatusLabel(group.installStatus)}{group.updateAvailable ? " / 更新あり" : ""}</div>
                </div>
              </div>
              {group.pages.map((page, index) => (
                <StaticRow key={page.id} page={page} canEdit={canEdit} formatUpdated={formatUpdated} onDuplicate={handleDuplicate} onArchive={setArchiveTarget} onDelete={setDeleteTarget} duplicateLoadingId={duplicateLoadingId} indentLevel={index === 0 ? 0 : 1} />
              ))}
            </div>
          ))}
        </div>
      ) : allowDnd ? (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <SortableContext items={listToShow.map((page) => page.id)} strategy={verticalListSortingStrategy}>
            <div style={{ borderRadius: 18, border: "1px solid var(--border)", background: "var(--surface)", overflow: "hidden" }}>{listToShow.map((page) => <SortableRow key={page.id} page={page} formatUpdated={formatUpdated} onDuplicate={handleDuplicate} onArchive={setArchiveTarget} onDelete={setDeleteTarget} duplicateLoadingId={duplicateLoadingId} />)}</div>
          </SortableContext>
        </DndContext>
      ) : (
        <div style={{ borderRadius: 18, border: "1px solid var(--border)", background: "var(--surface)", overflow: "hidden" }}>{listToShow.map((page) => <StaticRow key={page.id} page={page} canEdit={canEdit} formatUpdated={formatUpdated} onDuplicate={handleDuplicate} onArchive={setArchiveTarget} onDelete={setDeleteTarget} duplicateLoadingId={duplicateLoadingId} />)}</div>
      )}

      {showArchived && canEdit ? (
        <div style={{ marginTop: 16, borderRadius: 18, border: "1px solid var(--border)", background: "var(--surface)", overflow: "hidden" }}>
          <div style={{ padding: 16, borderBottom: "1px solid var(--border)", fontSize: 15, fontWeight: 800, color: "var(--text)" }}>アーカイブ済み</div>
          {loadingArchived ? <div style={{ padding: 16, color: "var(--muted)", fontSize: 13 }}>読み込み中…</div> : archivedPages.length === 0 ? <div style={{ padding: 16, color: "var(--muted)", fontSize: 13 }}>アーカイブ済みページはありません。</div> : archivedPages.map((page) => (
            <div key={page.id} style={{ padding: 14, borderBottom: "1px solid var(--border)", display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center" }}>
              <div style={{ minWidth: 0 }}>
                <Link href={`/pages/${page.id}`} style={{ color: "var(--text)", textDecoration: "none", fontWeight: 700 }}>{page.title}</Link>
                <div style={{ marginTop: 6, fontSize: 12, color: "var(--muted)" }}>{formatUpdated(page.updated_at)}</div>
              </div>
              <button type="button" onClick={() => void handleUnarchive(page.id)} style={{ padding: "8px 12px", borderRadius: 10, border: "1px solid var(--border)", background: "#fff", color: "var(--text)", cursor: "pointer" }}>復元</button>
            </div>
          ))}
        </div>
      ) : null}

      <TemplateInstallDialog open={templateDialogOpen} onClose={() => setTemplateDialogOpen(false)} onInstalled={({ pageCount, templateName }) => {
        setToast(`${templateName} を導入しました。${pageCount} ページを追加しています。`)
        void loadPages()
      }} />

      {archiveTarget ? <ConfirmDialog title="ページをアーカイブしますか？" description={`「${archiveTarget.title}」を一覧から隠します。あとで復元できます。`} confirmLabel="アーカイブ" onCancel={() => setArchiveTarget(null)} onConfirm={() => void handleArchive()} /> : null}
      {deleteTarget ? <ConfirmDialog title="ページを削除しますか？" description={`「${deleteTarget.title}」を完全に削除します。テンプレ導入履歴は残りますが、ページ本文は元に戻せません。`} confirmLabel="削除する" danger onCancel={() => setDeleteTarget(null)} onConfirm={() => void handleDelete()} /> : null}
      {toast ? <div style={{ position: "fixed", bottom: 24, left: "50%", transform: "translateX(-50%)", zIndex: 130, padding: "10px 14px", borderRadius: 12, background: "rgba(17,24,39,.94)", color: "#fff", fontSize: 13, fontWeight: 700 }}>{toast}</div> : null}
    </div>
  )
}

function Meta({ page }: { page: PageRow }) {
  const binding = page.template_binding
  const chip = (label: string, background: string, color: string, border: string) => <span style={{ display: "inline-flex", alignItems: "center", padding: "4px 8px", borderRadius: 999, background, color, border, fontSize: 11, fontWeight: 700 }}>{label}</span>
  const pageTypeLabel =
    binding?.pageType === "checklist"
      ? "チェックリスト"
      : binding?.pageType === "snippets"
        ? "スニペット"
        : binding?.pageType === "table_like"
          ? "台帳"
          : binding?.pageType === "link_hub"
            ? "導線ハブ"
            : "ドキュメント"
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8 }}>
      {binding ? (
        <>
          {chip(binding.templateName, "rgba(255,247,237,.9)", "#9a3412", "1px solid rgba(251,191,36,.22)")}
          {binding.templateSourceType === "shared" ? chip(binding.sharingScope === "industry" ? "業界共有" : "共有テンプレ", "rgba(248,250,252,.92)", "#475569", "1px solid rgba(148,163,184,.18)") : null}
          {binding.industryTag ? chip(binding.industryTag, "rgba(236,254,255,.92)", "#155e75", "1px solid rgba(34,211,238,.18)") : null}
          {binding.templateBadges.slice(0, 3).map((badge, index) => {
            const tone = templateBadgeTone(badge)
            return <Fragment key={`${badge}-${index}`}>{chip(badge, tone.background, tone.color, tone.border)}</Fragment>
          })}
          {chip(pageTypeLabel, "rgba(239,246,255,.92)", "#1d4ed8", "1px solid rgba(59,130,246,.2)")}
          {binding.isCustomized ? chip("編集済み", "rgba(254,249,195,.92)", "#92400e", "1px solid rgba(245,158,11,.18)") : chip("公式のまま", "rgba(240,253,244,.92)", "#166534", "1px solid rgba(34,197,94,.18)")}
          {binding.updateAvailable ? chip(`update ${binding.templateVersion}→${binding.latestVersion}`, "rgba(254,242,242,.92)", "#b91c1c", "1px solid rgba(220,38,38,.16)") : null}
          {binding.installStatus !== "completed" ? chip(installStatusLabel(binding.installStatus), "rgba(241,245,249,.92)", "#475569", "1px solid rgba(148,163,184,.18)") : null}
        </>
      ) : chip("自由ページ", "rgba(248,250,252,.92)", "#475569", "1px solid rgba(148,163,184,.22)")}
    </div>
  )
}

function Preview({ page }: { page: PageRow }) {
  const text = page.body_text?.trim() ?? ""
  if (!text) return null
  const preview = text.length > previewLength ? `${text.slice(0, previewLength)}…` : text
  return <p style={{ margin: "6px 0 0", fontSize: 12, lineHeight: 1.6, color: "var(--muted)" }}>{preview}</p>
}

function StaticRow(props: { page: PageRow; canEdit: boolean; formatUpdated: (value: string) => string; onDuplicate: (pageId: string) => void; onArchive: (page: { id: string; title: string }) => void; onDelete: (page: { id: string; title: string }) => void; duplicateLoadingId: string | null; indentLevel?: number }) {
  return <RowBase {...props} />
}

function SortableRow(props: { page: PageRow; formatUpdated: (value: string) => string; onDuplicate: (pageId: string) => void; onArchive: (page: { id: string; title: string }) => void; onDelete: (page: { id: string; title: string }) => void; duplicateLoadingId: string | null; indentLevel?: number }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: props.page.id })
  return <RowBase {...props} canEdit dragHandle={<span {...attributes} {...listeners} style={{ width: 28, height: 28, borderRadius: 8, background: "var(--surface-2)", display: "inline-flex", alignItems: "center", justifyContent: "center", color: "var(--muted)", fontSize: 11, cursor: "grab", flexShrink: 0, alignSelf: "flex-start" }}>::</span>} rowStyle={{ transform: CSS.Transform.toString(transform), transition, background: isDragging ? "var(--surface-2)" : "var(--surface)" }} nodeRef={setNodeRef} />
}

function RowBase(props: { page: PageRow; canEdit?: boolean; formatUpdated: (value: string) => string; onDuplicate: (pageId: string) => void; onArchive: (page: { id: string; title: string }) => void; onDelete: (page: { id: string; title: string }) => void; duplicateLoadingId: string | null; dragHandle?: ReactNode; rowStyle?: CSSProperties; nodeRef?: (node: HTMLElement | null) => void; indentLevel?: number }) {
  const { page, canEdit = true, formatUpdated, onDuplicate, onArchive, onDelete, duplicateLoadingId, dragHandle, rowStyle, nodeRef, indentLevel = 0 } = props
  return (
    <div ref={nodeRef} style={{ padding: 16, paddingLeft: 16 + indentLevel * 28, borderBottom: "1px solid var(--border)", display: "flex", gap: 12, ...(rowStyle ?? {}) }}>
      {dragHandle}
      <div style={{ flex: 1, minWidth: 0 }}>
        <Link href={`/pages/${page.id}`} style={{ color: "var(--text)", textDecoration: "none" }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}>
            <div style={{ fontSize: 16, fontWeight: 800, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{page.title}</div>
            <div style={{ fontSize: 12, color: "var(--muted)", whiteSpace: "nowrap" }}>{formatUpdated(page.updated_at)}</div>
          </div>
          <Meta page={page} />
          <Preview page={page} />
        </Link>
      </div>
      {canEdit ? <div style={{ display: "flex", gap: 6, flexShrink: 0, alignSelf: "flex-start" }}>
        <button type="button" onClick={() => onDuplicate(page.id)} style={{ padding: "7px 10px", borderRadius: 9, border: "1px solid var(--border)", background: "var(--surface-2)", color: "var(--text)", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>{duplicateLoadingId === page.id ? "複製中..." : "複製"}</button>
        <button type="button" onClick={() => onArchive({ id: page.id, title: page.title })} style={{ padding: "7px 10px", borderRadius: 9, border: "1px solid var(--border)", background: "var(--surface-2)", color: "var(--text)", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>アーカイブ</button>
        <button type="button" onClick={() => onDelete({ id: page.id, title: page.title })} style={{ padding: "7px 10px", borderRadius: 9, border: "1px solid rgba(220,38,38,.18)", background: "rgba(254,242,242,.92)", color: "#b91c1c", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>削除</button>
      </div> : null}
    </div>
  )
}

function ConfirmDialog(props: { title: string; description: string; confirmLabel: string; danger?: boolean; onCancel: () => void; onConfirm: () => void }) {
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 100, background: "rgba(15,23,42,.45)", display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }} onClick={props.onCancel}>
      <div style={{ width: "min(440px, 100%)", borderRadius: 20, border: "1px solid rgba(148,163,184,.18)", background: "rgba(255,255,255,.98)", padding: 22 }} onClick={(event) => event.stopPropagation()}>
        <div style={{ fontSize: 18, fontWeight: 800, color: "var(--text)", marginBottom: 10 }}>{props.title}</div>
        <p style={{ margin: "0 0 18px", fontSize: 14, lineHeight: 1.7, color: "var(--muted)" }}>{props.description}</p>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
          <button type="button" onClick={props.onCancel} style={{ padding: "11px 16px", borderRadius: 12, border: "1px solid var(--border)", background: "#fff", color: "var(--text)", fontWeight: 700, cursor: "pointer" }}>キャンセル</button>
          <button type="button" onClick={props.onConfirm} style={{ padding: "11px 16px", borderRadius: 12, border: "none", background: props.danger ? "linear-gradient(135deg, #b91c1c 0%, #dc2626 100%)" : "linear-gradient(135deg, #c2410c 0%, #ea580c 100%)", color: "#fff", fontWeight: 800, cursor: "pointer" }}>{props.confirmLabel}</button>
        </div>
      </div>
    </div>
  )
}
