"use client"

import { useState, useCallback, useEffect, useMemo } from "react"
import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core"
import { arrayMove, SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable"
import { CSS } from "@dnd-kit/utilities"
import TemplateInstallDialog from "@/components/pages/TemplateInstallDialog"
import { supabase } from "@/lib/supabase"
import { useAuthOrg } from "@/hooks/useAuthOrg"
import {
  hasClientSubmissionSignal,
  isContentClientOverdue,
  isContentEditorOverdue,
  normalizeContentDueYmd,
} from "@/lib/contentWorkflow"
import { notificationActionHref, notificationPriority, notificationTitle } from "@/lib/notifications"

const SIDEBAR_NAV_ORDER_KEY = "sidebar_nav_order"

const SIDEBAR_WIDTH = 260
const PRIMARY_NAV_HREFS = ["/home", "/contents", "/projects", "/billing", "/vendors", "/documents"] as const
const NAV_ITEMS: { href: string; label: string; locked?: boolean; childPaths?: string[] }[] = [
  { href: "/home", label: "ホーム" },
  { href: "/members", label: "メンバー" },
  { href: "/resources", label: "稼働管理" },
  { href: "/contents", label: "タスク" },
  { href: "/projects", label: "案件" },
  { href: "/billing", label: "請求", locked: true, childPaths: ["/invoices"] },
  { href: "/vendors", label: "外注", locked: true, childPaths: ["/payouts"] },
  { href: "/documents", label: "請求書保管", locked: true },
  { href: "/settings", label: "設定" },
  { href: "/notifications", label: "通知" },
]

type SidebarProps = {
  isMobile?: boolean
  onNavigate?: () => void
}

type UnreadNotification = {
  id: string
  type: string
  payload: Record<string, unknown> | null
  org_id: string | null
  created_at: string
}

type SidebarNavBadge = {
  text: string
  tone: "danger" | "warn" | "info"
}

type SidebarPageSummary = {
  id: string
  title: string
}

const EMPTY_STATUS_SNAPSHOT = {
  todaySubmitCount: 0,
  overdueCount: 0,
  unissuedCount: 0,
  vendorReviewCount: 0,
  payoutPendingCount: 0,
}

const SIDEBAR_FETCH_TTL_MS = 15_000

const COMPLETED_CONTENT_STATUSES = new Set([
  "delivered",
  "invoiced",
  "completed",
  "published",
  "canceled",
  "cancelled",
])
const BILLABLE_DONE_STATUSES = new Set(["delivered", "completed", "published"])

let sidebarPagesCache: { orgId: string; loadedAt: number; pages: SidebarPageSummary[] } | null = null
let sidebarUnreadCache: { orgId: string; loadedAt: number; notifications: UnreadNotification[] } | null = null
let sidebarStatusCache:
  | { orgId: string; month: string; loadedAt: number; snapshot: typeof EMPTY_STATUS_SNAPSHOT }
  | null = null

function toYmd(date: Date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, "0")
  const day = String(date.getDate()).padStart(2, "0")
  return `${year}-${month}-${day}`
}

function toYm(date: Date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, "0")
  return `${year}-${month}`
}

function badgeStyle(tone: SidebarNavBadge["tone"]): React.CSSProperties {
  if (tone === "danger") {
    return {
      background: "var(--error-bg)",
      border: "1px solid var(--error-border)",
      color: "var(--error-text)",
    }
  }

  if (tone === "warn") {
    return {
      background: "var(--warning-bg)",
      border: "1px solid var(--warning-border)",
      color: "var(--warning-text)",
    }
  }

  return {
    background: "var(--chip-bg)",
    border: "1px solid var(--chip-border)",
    color: "var(--chip-text)",
  }
}

export default function Sidebar({ isMobile, onNavigate }: SidebarProps) {
  const pathname = usePathname()
  const router = useRouter()
  const { activeOrgId, role, memberships, setActiveOrgId, loading } = useAuthOrg()
  const [switcherOpen, setSwitcherOpen] = useState(false)

  const canAccessBilling = role === "owner" || role === "executive_assistant"
  const canCreatePage = role === "owner" || role === "executive_assistant"
  const currentOrgName = activeOrgId ? memberships.find((m) => m.org_id === activeOrgId)?.org_name ?? "ワークスペース" : "ワークスペース"

  const [creatingPage, setCreatingPage] = useState(false)
  const [toastMessage, setToastMessage] = useState<string | null>(null)
  const [sidebarPages, setSidebarPages] = useState<SidebarPageSummary[]>([])
  const [pagesMenuOpen, setPagesMenuOpen] = useState(true)
  const [navDndReady, setNavDndReady] = useState(false)
  const [templateModalOpen, setTemplateModalOpen] = useState(false)
  const [quickCreateOpen, setQuickCreateOpen] = useState(false)
  const [savingOrder, setSavingOrder] = useState(false)
  const [sidebarPagesSearch, setSidebarPagesSearch] = useState("")
  const [pageActionLoadingId, setPageActionLoadingId] = useState<string | null>(null)
  const [unreadNotificationCount, setUnreadNotificationCount] = useState(0)
  const [unreadNotifications, setUnreadNotifications] = useState<UnreadNotification[]>([])
  const [notificationMenuOpen, setNotificationMenuOpen] = useState(false)
  const [mainFlowOpen, setMainFlowOpen] = useState(true)
  const [knowledgeOpen, setKnowledgeOpen] = useState(true)
  const [statusSnapshot, setStatusSnapshot] = useState(EMPTY_STATUS_SNAPSHOT)
  const todayYmd = useMemo(() => toYmd(new Date()), [])
  const thisMonth = useMemo(() => toYm(new Date()), [])

  const defaultNavOrder = useMemo(() => NAV_ITEMS.map((i) => i.href), [])
  const [navOrder, setNavOrder] = useState<string[]>(defaultNavOrder)

  useEffect(() => {
    try {
      const saved = localStorage.getItem(SIDEBAR_NAV_ORDER_KEY)
      if (!saved) return
      const parsed = JSON.parse(saved) as string[]
      if (!Array.isArray(parsed) || parsed.length === 0) return
      const valid = parsed.filter((h) => NAV_ITEMS.some((n) => n.href === h))
      const missing = defaultNavOrder.filter((h) => !valid.includes(h))
      setNavOrder([...valid, ...missing])
    } catch {
      // ignore
    }
  }, [defaultNavOrder])

  useEffect(() => {
    if (navOrder.length === 0) return
    try {
      localStorage.setItem(SIDEBAR_NAV_ORDER_KEY, JSON.stringify(navOrder))
    } catch {
      // ignore
    }
  }, [navOrder])

  // DnDはクライアント描画後のみ有効化してハイドレーション差分を避ける
  useEffect(() => {
    setNavDndReady(true)
  }, [])

  const orderedItems = useMemo(() => {
    return navOrder
      .map((href) => NAV_ITEMS.find((n) => n.href === href))
      .filter((n): n is (typeof NAV_ITEMS)[0] => n != null)
      .filter((n) => n.href !== "/settings/e2e" || canAccessBilling)
  }, [navOrder, canAccessBilling])

  const middleNavItems = useMemo(
    () => orderedItems.filter((n) => PRIMARY_NAV_HREFS.includes(n.href as (typeof PRIMARY_NAV_HREFS)[number])),
    [orderedItems]
  )

  const navSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  )

  const handleNavDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event
    if (!over || active.id === over.id) return
    const oldIndex = navOrder.indexOf(active.id as string)
    const newIndex = navOrder.indexOf(over.id as string)
    if (oldIndex === -1 || newIndex === -1) return
    setNavOrder((prev) => arrayMove(prev, oldIndex, newIndex))
  }, [navOrder])

  const fetchSidebarPages = useCallback(async (options?: { force?: boolean }) => {
    if (!activeOrgId) return
    const force = options?.force === true
    if (
      !force &&
      sidebarPagesCache &&
      sidebarPagesCache.orgId === activeOrgId &&
      Date.now() - sidebarPagesCache.loadedAt < SIDEBAR_FETCH_TTL_MS
    ) {
      setSidebarPages(sidebarPagesCache.pages)
      return
    }
    const { data: auth } = await supabase.auth.getSession()
    const token = auth.session?.access_token
    if (!token) return
    const res = await fetch("/api/pages/list", {
      headers: { Authorization: `Bearer ${token}` },
    })
    const json = (await res.json().catch(() => null)) as
      | { ok?: boolean; pages?: { id: string; title?: string | null }[] }
      | null
    if (!res.ok || !json?.ok) return
    const pages = (json.pages ?? [])
      .slice(0, 30)
      .map((r) => ({ id: r.id, title: (r.title ?? "無題").trim() || "無題" }))
    setSidebarPages(pages)
    sidebarPagesCache = {
      orgId: activeOrgId,
      loadedAt: Date.now(),
      pages,
    }
  }, [activeOrgId])

  useEffect(() => {
    void fetchSidebarPages()
  }, [fetchSidebarPages])

  useEffect(() => {
    if (!activeOrgId) {
      setUnreadNotificationCount(0)
      setUnreadNotifications([])
      return
    }

    const cached = sidebarUnreadCache
    if (
      cached &&
      cached.orgId === activeOrgId &&
      Date.now() - cached.loadedAt < SIDEBAR_FETCH_TTL_MS
    ) {
      setUnreadNotifications(cached.notifications)
      setUnreadNotificationCount(cached.notifications.length)
      return
    }

    let active = true
    const loadUnread = async () => {
      const { data: sessionData } = await supabase.auth.getSession()
      const token = sessionData.session?.access_token
      if (!token) return
      const res = await fetch(`/api/notifications/list?orgId=${encodeURIComponent(activeOrgId)}&unreadOnly=1&limit=8`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!active || !res.ok) return
      const json = (await res.json().catch(() => null)) as { notifications?: UnreadNotification[] } | null
      const list = json?.notifications ?? []
      const sorted = [...list].sort((a, b) => {
        const scoreDiff = notificationPriority(b) - notificationPriority(a)
        if (scoreDiff !== 0) return scoreDiff
        return new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      })
      setUnreadNotifications(sorted)
      setUnreadNotificationCount(list.length)
      sidebarUnreadCache = {
        orgId: activeOrgId,
        loadedAt: Date.now(),
        notifications: sorted,
      }
    }
    void loadUnread()
    return () => {
      active = false
    }
  }, [activeOrgId])

  useEffect(() => {
    if (!activeOrgId) {
      setStatusSnapshot(EMPTY_STATUS_SNAPSHOT)
      return
    }

    const cached = sidebarStatusCache
    if (
      cached &&
      cached.orgId === activeOrgId &&
      cached.month === thisMonth &&
      Date.now() - cached.loadedAt < SIDEBAR_FETCH_TTL_MS
    ) {
      setStatusSnapshot(cached.snapshot)
      return
    }

    let active = true
    const loadStatusSnapshot = async () => {
      const contentsPromise = supabase
        .from("contents")
        .select("due_client_at, due_editor_at, status, editor_submitted_at, client_submitted_at, billable_flag, delivery_month, invoice_id")
        .eq("org_id", activeOrgId)

      const invoicesPromise = canAccessBilling
        ? supabase.from("invoices").select("id").eq("org_id", activeOrgId).eq("invoice_month", thisMonth)
        : Promise.resolve({ data: [], error: null })

      const vendorInvoicesPromise = canAccessBilling
        ? supabase.from("vendor_invoices").select("status").eq("org_id", activeOrgId).eq("billing_month", thisMonth)
        : Promise.resolve({ data: [], error: null })

      const [contentsRes, invoicesRes, vendorInvoicesRes] = await Promise.all([
        contentsPromise,
        invoicesPromise,
        vendorInvoicesPromise,
      ])

      if (!active) return

      const contentRows =
        (contentsRes.data as Array<{
          due_client_at: string
          due_editor_at: string
          status: string
          editor_submitted_at: string | null
          client_submitted_at: string | null
          billable_flag: boolean
          delivery_month: string | null
          invoice_id: string | null
        }> | null) ?? []

      const openRows = contentRows.filter((row) => !COMPLETED_CONTENT_STATUSES.has(String(row.status ?? "")))
      const invoiceTargets = contentRows.filter(
        (row) =>
          row.delivery_month === thisMonth &&
          Boolean(row.billable_flag) &&
          BILLABLE_DONE_STATUSES.has(String(row.status ?? ""))
      )
      const vendorRows =
        (vendorInvoicesRes.data as Array<{ status: string | null }> | null) ?? []

      const dueTodayRows = openRows.filter(
        (row) =>
          normalizeContentDueYmd(row.due_client_at) === todayYmd &&
          !hasClientSubmissionSignal(row.status, row.client_submitted_at)
      )

      const nextSnapshot = {
        todaySubmitCount: dueTodayRows.length,
        overdueCount: openRows.filter(
          (row) =>
            isContentClientOverdue(row.status, row.due_client_at, todayYmd, row.client_submitted_at) ||
            isContentEditorOverdue(row.status, row.due_editor_at, todayYmd, row.editor_submitted_at)
        ).length,
        unissuedCount: invoiceTargets.filter((row) => !row.invoice_id).length,
        vendorReviewCount: vendorRows.filter((row) => row.status === "draft" || row.status === "rejected").length,
        payoutPendingCount: vendorRows.filter((row) => row.status === "submitted" || row.status === "approved").length,
      }

      setStatusSnapshot(nextSnapshot)
      sidebarStatusCache = {
        orgId: activeOrgId,
        month: thisMonth,
        loadedAt: Date.now(),
        snapshot: nextSnapshot,
      }

      if (contentsRes.error || invoicesRes.error || vendorInvoicesRes.error) {
        if (process.env.NODE_ENV === "development") {
          console.error("[Sidebar] status snapshot load error", {
            contents: contentsRes.error?.message,
            invoices: invoicesRes.error?.message,
            vendorInvoices: vendorInvoicesRes.error?.message,
          })
        }
      }
    }

    void loadStatusSnapshot()
    return () => {
      active = false
    }
  }, [activeOrgId, canAccessBilling, thisMonth, todayYmd])

  useEffect(() => {
    if (!notificationMenuOpen) return
    const onWindowClick = () => setNotificationMenuOpen(false)
    window.addEventListener("click", onWindowClick)
    return () => window.removeEventListener("click", onWindowClick)
  }, [notificationMenuOpen])

  useEffect(() => {
    if (!toastMessage) return
    const t = setTimeout(() => setToastMessage(null), 4000)
    return () => clearTimeout(t)
  }, [toastMessage])

  const navBadges = useMemo<Record<string, SidebarNavBadge | undefined>>(() => {
    const badges: Record<string, SidebarNavBadge | undefined> = {}

    if (statusSnapshot.overdueCount > 0) {
      badges["/contents"] = { text: `遅れ ${statusSnapshot.overdueCount}`, tone: "danger" }
    } else if (statusSnapshot.todaySubmitCount > 0) {
      badges["/contents"] = { text: `今日 ${statusSnapshot.todaySubmitCount}`, tone: "info" }
    }

    if (canAccessBilling && statusSnapshot.unissuedCount > 0) {
      badges["/billing"] = { text: `未発行 ${statusSnapshot.unissuedCount}`, tone: "danger" }
    }

    if (canAccessBilling && statusSnapshot.vendorReviewCount > 0) {
      badges["/vendors"] = { text: `確認待ち ${statusSnapshot.vendorReviewCount}`, tone: "warn" }
    }

    if (canAccessBilling && statusSnapshot.payoutPendingCount > 0) {
      badges["/payouts"] = { text: `未処理 ${statusSnapshot.payoutPendingCount}`, tone: "warn" }
    }

    return badges
  }, [canAccessBilling, statusSnapshot])

  const createBlankPage = useCallback(
    async () => {
      if (!activeOrgId || !canCreatePage || creatingPage) return
      setCreatingPage(true)
      setToastMessage(null)
      try {
        const { data } = await supabase.auth.getSession()
        const token = data.session?.access_token
        if (!token) {
          setToastMessage("ログイン状態を確認してください")
          return
        }
        const res = await fetch("/api/pages/create", {
          method: "POST",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        })
        const json = (await res.json().catch(() => null)) as { ok?: boolean; id?: string; message?: string } | null
        if (!res.ok || !json?.ok || !json?.id) {
          setToastMessage(json?.message ?? "ページ作成に失敗しました")
          return
        }
        void fetchSidebarPages({ force: true })
        onNavigate?.()
        router.push(`/pages/${json.id}`)
      } catch (err) {
        if (process.env.NODE_ENV === "development") console.error("[Sidebar] create page error", err)
        setToastMessage("ページ作成に失敗しました")
      } finally {
        setCreatingPage(false)
      }
    },
    [activeOrgId, canCreatePage, creatingPage, router, onNavigate, fetchSidebarPages]
  )

  const handlePagesReorder = useCallback(
    async (orderedIds: string[]) => {
      if (!canCreatePage || savingOrder || orderedIds.length === 0) return
      setSavingOrder(true)
      setToastMessage(null)
      try {
        const { data } = await supabase.auth.getSession()
        const token = data.session?.access_token
        if (!token) return
        const res = await fetch("/api/pages/reorder", {
          method: "POST",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify({ ordered_ids: orderedIds }),
        })
        const json = (await res.json().catch(() => null)) as { ok?: boolean; message?: string } | null
        if (!res.ok || !json?.ok) {
          setToastMessage(json?.message ?? "並び順の保存に失敗しました")
          void fetchSidebarPages({ force: true })
        }
      } catch {
        setToastMessage("並び順の保存に失敗しました")
        void fetchSidebarPages({ force: true })
      } finally {
        setSavingOrder(false)
      }
    },
    [canCreatePage, savingOrder, fetchSidebarPages]
  )

  const handleSwitchOrg = async (orgId: string) => {
    if (orgId === "new") {
      setSwitcherOpen(false)
      onNavigate?.()
      router.push("/request-org")
      return
    }
    await setActiveOrgId(orgId)
    setSwitcherOpen(false)
    onNavigate?.()
  }

  const handleLogout = async () => {
    await supabase.auth.signOut()
    router.push("/")
  }

  const getAccessToken = useCallback(async () => {
    const { data } = await supabase.auth.getSession()
    return data.session?.access_token ?? null
  }, [])

  const duplicatePageFromSidebar = useCallback(
    async (pageId: string) => {
      if (!canCreatePage || pageActionLoadingId) return
      setPageActionLoadingId(pageId)
      try {
        const token = await getAccessToken()
        if (!token) return
        const res = await fetch(`/api/pages/${pageId}/duplicate`, {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
        })
        const json = (await res.json().catch(() => null)) as { ok?: boolean; id?: string; message?: string } | null
        if (!res.ok || !json?.ok) {
          setToastMessage(json?.message ?? "複製に失敗しました")
          return
        }
        setToastMessage("ページを複製しました")
        await fetchSidebarPages({ force: true })
        if (json.id) {
          onNavigate?.()
          router.push(`/pages/${json.id}`)
        }
      } catch {
        setToastMessage("複製に失敗しました")
      } finally {
        setPageActionLoadingId(null)
      }
    },
    [canCreatePage, fetchSidebarPages, getAccessToken, onNavigate, pageActionLoadingId, router]
  )

  const archivePageFromSidebar = useCallback(
    async (pageId: string) => {
      if (!canCreatePage || pageActionLoadingId) return
      setPageActionLoadingId(pageId)
      try {
        const token = await getAccessToken()
        if (!token) return
        const res = await fetch(`/api/pages/${pageId}/archive`, {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
        })
        const json = (await res.json().catch(() => null)) as { ok?: boolean; message?: string } | null
        if (!res.ok || !json?.ok) {
          setToastMessage(json?.message ?? "アーカイブに失敗しました")
          return
        }
        setToastMessage("ページをアーカイブしました")
        await fetchSidebarPages({ force: true })
        if (pathname === `/pages/${pageId}`) {
          onNavigate?.()
          router.push("/pages")
        }
      } catch {
        setToastMessage("アーカイブに失敗しました")
      } finally {
        setPageActionLoadingId(null)
      }
    },
    [canCreatePage, fetchSidebarPages, getAccessToken, onNavigate, pageActionLoadingId, pathname, router]
  )

  const baseStyle: React.CSSProperties = {
    width: isMobile ? "100%" : SIDEBAR_WIDTH,
    minWidth: isMobile ? undefined : SIDEBAR_WIDTH,
    height: "100%",
    minHeight: "100%",
    background: "var(--surface)",
    borderRight: "1px solid var(--border)",
    display: "flex",
    flexDirection: "column",
    padding: "20px 0 20px",
    color: "var(--text)",
  }

  const linkBase: React.CSSProperties = {
    display: "block",
    padding: "10px 16px 10px 20px",
    fontSize: 14,
    fontWeight: 500,
    color: "var(--text)",
    textDecoration: "none",
    cursor: "pointer",
    borderLeft: "3px solid transparent",
    marginLeft: 0,
    borderRadius: 0,
    transition: "background 0.15s ease, color 0.1s ease",
  }

  return (
    <aside className="sidebar-menu" style={baseStyle}>
      <div className="sidebar-workspace" style={{ padding: "0 16px 14px", marginBottom: 4, borderBottom: "1px solid var(--border)", paddingBottom: 14 }}>
        <div style={{ fontSize: 11, fontWeight: 600, color: "var(--muted)", letterSpacing: "0.04em", marginBottom: 8 }}>ワークスペース</div>
        <button
          type="button"
          className="sidebar-workspace-btn"
          onClick={() => !loading && setSwitcherOpen(true)}
          aria-expanded={switcherOpen}
          aria-haspopup="true"
          style={{
            width: "100%",
            display: "flex",
            alignItems: "center",
            gap: 12,
            textAlign: "left",
            fontSize: 14,
            fontWeight: 600,
            color: "var(--text)",
            background: "var(--surface-2)",
            border: "1px solid var(--border)",
            borderRadius: 10,
            cursor: loading ? "default" : "pointer",
            padding: "10px 12px",
            transition: "background 0.15s ease, border-color 0.15s ease",
          }}
        >
          <span
            style={{
              width: 36,
              height: 36,
              borderRadius: 10,
              background: "var(--surface-2)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 14,
              fontWeight: 700,
              color: "var(--primary)",
              flexShrink: 0,
            }}
          >
            {loading ? "..." : (currentOrgName.charAt(0) || "W").toUpperCase()}
          </span>
          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {loading ? "..." : currentOrgName}
          </span>
        </button>
        <div style={{ marginTop: 8, display: "flex", justifyContent: "space-between", alignItems: "center", position: "relative" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
            <Link
              href="/notifications"
              onClick={onNavigate}
              style={{ fontSize: 12, color: "var(--primary)", fontWeight: 600, textDecoration: "none" }}
            >
              通知センター
            </Link>
            {unreadNotificationCount > 0 && (
              <span
                aria-label={`未読通知 ${unreadNotificationCount} 件`}
                style={{
                  minWidth: 18,
                  height: 18,
                  padding: "0 6px",
                  borderRadius: 999,
                  background: "#dc2626",
                  color: "#fff",
                  fontSize: 11,
                  fontWeight: 700,
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                {unreadNotificationCount > 99 ? "99+" : unreadNotificationCount}
              </span>
            )}
          </div>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              setNotificationMenuOpen((v) => !v)
            }}
            aria-expanded={notificationMenuOpen}
            aria-label="未読通知を開く"
            style={{
              border: "1px solid var(--border)",
              borderRadius: 999,
              background: "var(--surface-2)",
              color: "var(--text)",
              cursor: "pointer",
              fontSize: 11,
              padding: "4px 8px",
              flexShrink: 0,
            }}
          >
            未読 {unreadNotificationCount}
          </button>
          {notificationMenuOpen && (
            <div
              onClick={(e) => e.stopPropagation()}
              style={{
                position: "absolute",
                top: 28,
                right: 0,
                width: 280,
                maxHeight: 300,
                overflowY: "auto",
                background: "var(--surface)",
                border: "1px solid var(--border)",
                borderRadius: 10,
                boxShadow: "var(--shadow-md)",
                zIndex: 55,
                padding: 8,
              }}
            >
              {unreadNotifications.length === 0 ? (
                <p style={{ margin: 0, color: "var(--muted)", fontSize: 12, padding: "6px 8px" }}>未読通知はありません</p>
              ) : (
                <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 6 }}>
                  {unreadNotifications.slice(0, 6).map((n, i) => (
                    <li key={n.id} style={{ border: "1px solid var(--border)", borderRadius: 8, background: i === 0 ? "#fff7f7" : "var(--surface-2)", padding: "8px 10px" }}>
                      {i === 0 && (
                        <div style={{ fontSize: 10, fontWeight: 700, color: "#9f1239", marginBottom: 4 }}>最優先</div>
                      )}
                      <div style={{ fontSize: 12, color: "var(--text)", marginBottom: 4, lineHeight: 1.4 }}>{notificationTitle(n)}</div>
                      <Link
                        href={notificationActionHref(n)}
                        onClick={() => {
                          setNotificationMenuOpen(false)
                          onNavigate?.()
                        }}
                        style={{ fontSize: 12, color: "var(--primary)", fontWeight: 600, textDecoration: "none" }}
                      >
                        対応する
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      </div>
      {switcherOpen && (
        <>
          <div
            role="presentation"
            style={{ position: "fixed", inset: 0, zIndex: 40, background: "rgba(0,0,0,0.3)" }}
            onClick={() => setSwitcherOpen(false)}
          />
          <div
            role="dialog"
            aria-label="組織を選択"
            style={{
              position: "fixed",
              top: 80,
              left: 20,
              width: 300,
              maxHeight: 380,
              overflow: "auto",
              background: "var(--surface)",
              border: "1px solid var(--border)",
              borderRadius: 16,
              boxShadow: "var(--shadow-lg)",
              zIndex: 50,
              padding: 12,
            }}
          >
            <div style={{ fontSize: 12, color: "var(--muted)", padding: "6px 12px 10px", fontWeight: 500 }}>
              組織を切り替え            </div>
            {memberships.map((m) => {
              const name = m.org_name ?? m.org_id
              const initial = name.charAt(0).toUpperCase() || "?"
              const isActive = activeOrgId === m.org_id
              return (
                <button
                  key={m.org_id}
                  type="button"
                  onClick={() => handleSwitchOrg(m.org_id)}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 12,
                    width: "100%",
                    padding: "12px 14px",
                    textAlign: "left",
                    borderRadius: 12,
                    border: "none",
                    background: isActive ? "var(--surface-2)" : "transparent",
                    color: "var(--text)",
                    fontSize: 15,
                    fontWeight: isActive ? 600 : 500,
                    cursor: "pointer",
                  }}
                >
                  <span
                    style={{
                      width: 40,
                      height: 40,
                      borderRadius: 10,
                      background: isActive ? "var(--primary)" : "var(--surface-2)",
                      color: isActive ? "var(--primary-contrast)" : "var(--primary)",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontSize: 16,
                      fontWeight: 700,
                      flexShrink: 0,
                    }}
                  >
                    {initial}
                  </span>
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{name}</span>
                </button>
              )
            })}
            <button
              type="button"
              onClick={() => handleSwitchOrg("new")}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                width: "100%",
                padding: "12px 14px",
                textAlign: "left",
                borderRadius: 12,
                border: "2px dashed var(--border)",
                background: "transparent",
                color: "var(--primary)",
                fontSize: 15,
                fontWeight: 600,
                cursor: "pointer",
                marginTop: 8,
              }}
            >
              <span
                style={{
                  width: 40,
                  height: 40,
                  borderRadius: 10,
                  background: "var(--surface-2)",
                  color: "var(--primary)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 20,
                  flexShrink: 0,
                }}
              >
                +
              </span>
              + 新規
            </button>
          </div>
        </>
      )}
      <div style={{ flex: 1, overflowY: "auto", minHeight: 0 }}>
      <nav className="sidebar-nav" style={{ padding: "4px 0" }}>
        <button
          type="button"
          onClick={() => setMainFlowOpen((v) => !v)}
          style={{
            width: "100%",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "0 20px 8px",
            fontSize: 11,
            color: "var(--muted)",
            fontWeight: 700,
            letterSpacing: "0.05em",
            textTransform: "uppercase",
            border: "none",
            background: "transparent",
            cursor: "pointer",
          }}
        >
          <span>主要導線</span>
          <span style={{ fontSize: 11 }}>{mainFlowOpen ? "▴" : "▾"}</span>
        </button>
        {mainFlowOpen && (navDndReady ? (
          <DndContext sensors={navSensors} collisionDetection={closestCenter} onDragEnd={handleNavDragEnd}>
            <SortableContext items={navOrder} strategy={verticalListSortingStrategy}>
              {middleNavItems.map((item) => (
                <SortableNavItem
                  key={item.href}
                  item={item}
                  badge={navBadges[item.href]}
                  pathname={pathname}
                  linkBase={linkBase}
                  pagesMenuOpen={pagesMenuOpen}
                  setPagesMenuOpen={setPagesMenuOpen}
                  sidebarPages={sidebarPages}
                  setSidebarPages={setSidebarPages}
                  sidebarPagesSearch={sidebarPagesSearch}
                  setSidebarPagesSearch={setSidebarPagesSearch}
                  onNavigate={onNavigate}
                  canAccessBilling={canAccessBilling}
                  canCreatePage={canCreatePage}
                  onPagesReorder={handlePagesReorder}
                  savingOrder={savingOrder}
                  onDuplicatePage={duplicatePageFromSidebar}
                  onArchivePage={archivePageFromSidebar}
                  pageActionLoadingId={pageActionLoadingId}
                />
              ))}
            </SortableContext>
          </DndContext>
        ) : (
          // SSR直後は静的レンダーのみ表示してハイドレーション差分を避ける
          middleNavItems.map((item) => {
            const showLock = item.locked === true && !canAccessBilling
            const label = showLock ? `${item.label}（権限限定）` : item.label
            const isPages = item.href === "/pages"
            const isActive = pathname === item.href || (item.childPaths?.some((p) => pathname?.startsWith(p)) ?? false)
            const badge = navBadges[item.href]
            return (
              <div key={item.href}>
                <div style={{ display: "flex", alignItems: "stretch", minHeight: 44 }}>
                  <span
                    style={{
                      display: "flex",
                      alignItems: "center",
                      padding: "0 6px",
                      color: "var(--muted)",
                      fontSize: 12,
                    }}
                  >
                    ::
                  </span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    {isPages ? (
                      <>
                        <div
                          style={{
                            display: "flex",
                            alignItems: "center",
                            borderLeft: "3px solid transparent",
                            borderLeftColor: pathname?.startsWith("/pages") ? "var(--chip-border)" : "transparent",
                            background: pathname?.startsWith("/pages") ? "var(--surface-2)" : undefined,
                          }}
                        >
                          <Link
                            href={item.href}
                            onClick={onNavigate}
                            style={{
                              ...linkBase,
                              flex: 1,
                              borderLeft: "none",
                              background: "none",
                            }}
                          >
                            {label}
                          </Link>
                        </div>
                      </>
                    ) : (
                      <Link
                        href={item.href}
                        onClick={onNavigate}
                        style={{
                          ...linkBase,
                          borderLeftColor: isActive ? "var(--chip-border)" : "transparent",
                          background: isActive ? "var(--surface-2)" : undefined,
                        }}
                      >
                        <span style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{label}</span>
                          {badge ? (
                            <span
                              style={{
                                ...badgeStyle(badge.tone),
                                display: "inline-flex",
                                alignItems: "center",
                                justifyContent: "center",
                                minHeight: 22,
                                padding: "0 8px",
                                borderRadius: 999,
                                fontSize: 10,
                                fontWeight: 700,
                                whiteSpace: "nowrap",
                                flexShrink: 0,
                              }}
                            >
                              {badge.text}
                            </span>
                          ) : null}
                        </span>
                      </Link>
                    )}
                  </div>
                </div>
              </div>
            )
          })
        ))}
      </nav>
      <TemplateInstallDialog
        open={templateModalOpen}
        onClose={() => setTemplateModalOpen(false)}
        onInstalled={({ rootPageId, pageCount, templateName }) => {
          setToastMessage(`${templateName} を導入しました（${pageCount} ページ）`)
          void fetchSidebarPages({ force: true })
          onNavigate?.()
          router.push(`/pages/${rootPageId}`)
        }}
      />
      <div className="sidebar-bottom" style={{ padding: "14px 20px 0", borderTop: "1px solid rgba(124, 58, 237, 0.12)", marginTop: 8 }}>
        <button
          type="button"
          onClick={() => setKnowledgeOpen((v) => !v)}
          style={{
            width: "100%",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            fontSize: 11,
            color: "var(--muted)",
            fontWeight: 700,
            letterSpacing: "0.05em",
            textTransform: "uppercase",
            marginBottom: 8,
            border: "none",
            background: "transparent",
            cursor: "pointer",
            padding: 0,
          }}
        >
          <span>ナレッジと操作</span>
          <span style={{ fontSize: 11 }}>{knowledgeOpen ? "▴" : "▾"}</span>
        </button>
        {knowledgeOpen && (
        <>
        <div style={{ marginBottom: 10 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
            <Link
              href="/pages"
              onClick={onNavigate}
              style={{
                fontSize: 13,
                fontWeight: 700,
                color: pathname?.startsWith("/pages") ? "var(--primary)" : "var(--text)",
                textDecoration: "none",
              }}
            >
              Pages
            </Link>
            <span style={{ fontSize: 11, color: "var(--muted)", marginRight: 6 }}>{sidebarPages.length}件</span>
            <button
              type="button"
              onClick={() => setPagesMenuOpen(!pagesMenuOpen)}
              aria-expanded={pagesMenuOpen}
              aria-label={pagesMenuOpen ? "Pagesを閉じる" : "Pagesを開く"}
              style={{
                width: 24,
                height: 24,
                borderRadius: 999,
                border: "1px solid var(--border)",
                background: "var(--surface)",
                color: "var(--muted)",
                cursor: "pointer",
                fontSize: 11,
                fontWeight: 700,
                lineHeight: 1,
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                transition: "transform 0.16s ease, background 0.16s ease, color 0.16s ease",
              }}
            >
              {pagesMenuOpen ? "▴" : "▾"}
            </button>
          </div>
          {pagesMenuOpen && (
            <div
              style={{
                borderRadius: 8,
                background: "var(--surface)",
                padding: "4px 0",
                marginBottom: 8,
              }}
            >
              {sidebarPages.length > 0 && (
                <>
                  <input
                    type="text"
                    placeholder="ページ検索…"
                    value={sidebarPagesSearch}
                    onChange={(e) => setSidebarPagesSearch(e.target.value)}
                    style={{
                      width: "100%",
                      padding: "4px 8px",
                      fontSize: 11,
                      border: "1px solid var(--border)",
                      borderRadius: 6,
                      background: "var(--input-bg)",
                      color: "var(--text)",
                      outline: "none",
                      marginBottom: 4,
                      margin: "0 0 4px",
                    }}
                  />
                  {sidebarPagesSearch.trim() ? (
                    <div style={{ maxHeight: 200, overflowY: "auto" }}>
                      {sidebarPages
                        .filter((p) => (p.title || "").toLowerCase().includes(sidebarPagesSearch.trim().toLowerCase()))
                        .map((p) => (
                          <Link
                            key={p.id}
                            href={`/pages/${p.id}`}
                            onClick={onNavigate}
                            style={{
                              display: "block",
                              padding: "3px 8px",
                              borderRadius: 5,
                              marginBottom: 1,
                              textDecoration: "none",
                              color: pathname === `/pages/${p.id}` ? "var(--text)" : "var(--muted)",
                              background: pathname === `/pages/${p.id}` ? "var(--surface-2)" : "transparent",
                              fontSize: 11,
                            }}
                          >
                            <span style={{ display: "block", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{p.title || "無題"}</span>
                          </Link>
                        ))}
                    </div>
                  ) : (
                    <SidebarPagesList
                      pages={sidebarPages}
                      setPages={setSidebarPages}
                      pathname={pathname}
                      linkBase={{ ...linkBase, padding: "3px 8px", borderRadius: 5, borderLeft: "none", fontSize: 11 }}
                      onNavigate={onNavigate}
                      canReorder={canCreatePage && !savingOrder}
                      onReorder={handlePagesReorder}
                      canManage={canCreatePage}
                      onDuplicatePage={duplicatePageFromSidebar}
                      onArchivePage={archivePageFromSidebar}
                      pageActionLoadingId={pageActionLoadingId}
                    />
                  )}
                </>
              )}
            </div>
          )}
        </div>
        {canCreatePage && (
          <div style={{ marginBottom: 12, paddingBottom: 10, borderBottom: "1px solid rgba(124, 58, 237, 0.12)" }}>
            <button
              type="button"
              className="create-page-cta"
              onClick={() => setQuickCreateOpen((v) => !v)}
              disabled={creatingPage}
              aria-label="新規ページを作成"
              style={{
                width: "100%",
                padding: "12px 14px",
                borderRadius: 12,
                border: "1px solid rgba(76, 29, 149, 0.18)",
                background:
                  "linear-gradient(135deg, #08090b 0%, #111318 52%, #1b102c 100%)",
                color: "var(--primary-contrast)",
                fontSize: 13,
                fontWeight: 700,
                letterSpacing: "0.02em",
                cursor: creatingPage ? "wait" : "pointer",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 8,
                boxShadow: "0 8px 18px rgba(8, 10, 16, 0.34)",
                transition: "transform 0.16s ease, box-shadow 0.16s ease, filter 0.16s ease",
              }}
            >
              {creatingPage ? (
                <span style={{ fontSize: 12 }}>作成中…</span>
              ) : (
                <>
                  <span
                    style={{
                      width: 18,
                      height: 18,
                      borderRadius: 999,
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                      background: "rgba(255,255,255,0.14)",
                      fontSize: 14,
                      lineHeight: 1,
                    }}
                  >
                    +
                  </span>
                  <span>新規</span>
                </>
              )}
            </button>
            <div style={{ marginTop: 6, fontSize: 11, color: "var(--muted)", textAlign: "center" }}>
              作成メニューを開く
            </div>
          </div>
        )}
        {quickCreateOpen && (
          <div
            style={{
              marginBottom: 10,
              border: "1px solid var(--border)",
              borderRadius: 10,
              background: "var(--surface)",
              padding: 8,
              display: "grid",
              gap: 6,
            }}
          >
            <button
              type="button"
              onClick={() => {
                setQuickCreateOpen(false)
                setTemplateModalOpen(true)
              }}
              style={{ border: "1px solid var(--border)", background: "var(--surface-2)", color: "var(--text)", borderRadius: 8, padding: "8px 10px", textAlign: "left", cursor: "pointer", fontSize: 12 }}
            >
              テンプレを導入
            </button>
            <button
              type="button"
              onClick={() => {
                setQuickCreateOpen(false)
                void createBlankPage()
              }}
              style={{ border: "1px solid var(--border)", background: "var(--surface-2)", color: "var(--text)", borderRadius: 8, padding: "8px 10px", textAlign: "left", cursor: "pointer", fontSize: 12 }}
            >
              空ページ
            </button>
            <button
              type="button"
              onClick={() => {
                setQuickCreateOpen(false)
                onNavigate?.()
                router.push("/contents")
              }}
              style={{ border: "1px solid var(--border)", background: "var(--surface-2)", color: "var(--text)", borderRadius: 8, padding: "8px 10px", textAlign: "left", cursor: "pointer", fontSize: 12 }}
            >
              新規タスク
              </button>
            {canAccessBilling && (
              <button
                type="button"
                onClick={() => {
                  setQuickCreateOpen(false)
                  onNavigate?.()
                  router.push("/contents?newClient=1")
                }}
                style={{ border: "1px solid var(--border)", background: "var(--surface-2)", color: "var(--text)", borderRadius: 8, padding: "8px 10px", textAlign: "left", cursor: "pointer", fontSize: 12 }}
              >
              新規クライアント
              </button>
            )}
          </div>
        )}
        {toastMessage && (
          <div
            role="alert"
            style={{
              marginBottom: 10,
              padding: "8px 12px",
              borderRadius: 8,
              fontSize: 12,
              background: "var(--error-bg)",
              color: "var(--error-text)",
              border: "1px solid var(--error-border)",
            }}
          >
            {toastMessage}
          </div>
        )}
        </>
        )}
      </div>
      </div>
      <div className="sidebar-account" style={{ padding: "12px 20px 0", borderTop: "1px solid rgba(124, 58, 237, 0.12)", flexShrink: 0 }}>
        <Link
          href="/settings"
          onClick={onNavigate}
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 8,
            width: "100%",
            padding: "10px 12px",
            fontSize: 13,
            fontWeight: 600,
            color: pathname?.startsWith("/settings") ? "var(--text)" : "var(--text)",
            textDecoration: "none",
            borderRadius: 12,
            marginBottom: 6,
            border: "1px solid rgba(124, 58, 237, 0.26)",
            background: pathname?.startsWith("/settings") ? "rgba(255,255,255,0.4)" : "rgba(255,255,255,0.22)",
            boxShadow: pathname?.startsWith("/settings")
              ? "0 2px 5px rgba(0,0,0,0.07)"
              : "0 1px 3px rgba(0,0,0,0.04)",
          }}
        >
          <span style={{ width: 128, display: "inline-flex", alignItems: "center", justifyContent: "flex-start", gap: 8 }}>
            <span style={{ width: 16, display: "inline-flex", justifyContent: "center", fontSize: 12, lineHeight: 1 }}>⚙</span>
            <span>設定</span>
          </span>
        </Link>
        <Link
          href="/help"
          onClick={onNavigate}
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 8,
            width: "100%",
            padding: "9px 12px",
            fontSize: 13,
            fontWeight: 600,
            color: pathname?.startsWith("/help") ? "var(--text)" : "var(--sidebar-help-text, var(--muted))",
            textDecoration: "none",
            borderRadius: 10,
            marginBottom: 8,
            border: "1px solid var(--border)",
            background: pathname?.startsWith("/help") ? "var(--surface-2)" : "var(--surface)",
          }}
        >
          <span style={{ width: 128, display: "inline-flex", alignItems: "center", justifyContent: "flex-start", gap: 8 }}>
            <span
              style={{
                width: 14,
                height: 14,
                borderRadius: 999,
                border: "1px solid #c4b5fd",
                display: "inline-block",
                position: "relative",
                background: "linear-gradient(180deg, #faf5ff 0%, #ede9fe 100%)",
                boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.55)",
              }}
            >
              <span
                style={{
                  position: "absolute",
                  left: "50%",
                  top: "50%",
                  transform: "translate(-50%, -50%)",
                  fontSize: 9,
                  fontWeight: 700,
                  lineHeight: 1,
                  color: "#5b21b6",
                }}
              >
                ?
              </span>
            </span>
            <span>ヘルプ・使い方</span>
          </span>
        </Link>
        <button
          type="button"
          className="sidebar-logout-btn"
          onClick={handleLogout}
          style={{
            width: "100%",
            padding: "10px 12px",
            fontSize: 13,
            fontWeight: 600,
            color: "var(--sidebar-logout-text, var(--error-text))",
            background: "linear-gradient(180deg, #fff7f7 0%, #ffe9ea 100%)",
            border: "1px solid var(--error-border)",
            borderRadius: 12,
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 8,
            boxShadow: "var(--shadow-sm)",
            transition: "color 0.15s ease, background 0.15s ease, box-shadow 0.15s ease, transform 0.15s ease",
          }}
        >
          <span style={{ width: 128, display: "inline-flex", alignItems: "center", justifyContent: "flex-start", gap: 8 }}>
            <span style={{ width: 16, display: "inline-flex", justifyContent: "center", fontSize: 13, lineHeight: 1 }}>⎋</span>
            <span>ログアウト</span>
          </span>
        </button>
      </div>
    </aside>
  )
}

function SortableNavItem({
  item,
  badge,
  pathname,
  linkBase,
  pagesMenuOpen,
  setPagesMenuOpen,
  sidebarPages,
  setSidebarPages,
  sidebarPagesSearch,
  setSidebarPagesSearch,
  onNavigate,
  canAccessBilling,
  canCreatePage,
  onPagesReorder,
  savingOrder,
  onDuplicatePage,
  onArchivePage,
  pageActionLoadingId,
}: {
  item: (typeof NAV_ITEMS)[0]
  badge?: SidebarNavBadge
  pathname: string | null
  linkBase: React.CSSProperties
  pagesMenuOpen: boolean
  setPagesMenuOpen: (v: boolean) => void
  sidebarPages: { id: string; title: string }[]
  setSidebarPages: React.Dispatch<React.SetStateAction<{ id: string; title: string }[]>>
  sidebarPagesSearch: string
  setSidebarPagesSearch: (v: string) => void
  onNavigate?: () => void
  canAccessBilling: boolean
  canCreatePage: boolean
  onPagesReorder: (orderedIds: string[]) => void
  savingOrder: boolean
  onDuplicatePage: (pageId: string) => Promise<void>
  onArchivePage: (pageId: string) => Promise<void>
  pageActionLoadingId: string | null
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: item.href })
  const style = { transform: CSS.Transform.toString(transform), transition }
  const showLock = (item.locked === true) && !canAccessBilling
  const isActive = pathname === item.href || (item.childPaths?.some((p) => pathname?.startsWith(p)) ?? false)
  const label = showLock ? `${item.label}（権限限定）` : item.label
  const isPages = item.href === "/pages"

  return (
    <div
      ref={setNodeRef}
      style={{
        ...style,
        opacity: isDragging ? 0.85 : 1,
        cursor: isDragging ? "grabbing" : "default",
        transition: "box-shadow 0.2s ease, transform 0.2s ease",
        boxShadow: isDragging ? "var(--shadow-md)" : undefined,
      }}
    >
      <div style={{ display: "flex", alignItems: "stretch", minHeight: 44 }}>
        <span
          {...attributes}
          {...listeners}
          style={{
            display: "flex",
            alignItems: "center",
            padding: "0 6px",
            cursor: isDragging ? "grabbing" : "grab",
            color: "var(--muted)",
            fontSize: 12,
          }}
        >
          ::
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          {isPages ? (
            <>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  borderLeft: "3px solid transparent",
                  borderLeftColor: pathname?.startsWith("/pages") ? "var(--chip-border)" : "transparent",
                  background: pathname?.startsWith("/pages") ? "var(--surface-2)" : undefined,
                }}
              >
                <Link
                  href={item.href}
                  onClick={onNavigate}
                  style={{
                    ...linkBase,
                    flex: 1,
                    borderLeft: "none",
                    background: "none",
                  }}
                >
                  {label}
                </Link>
                <button
                  type="button"
                  onClick={() => setPagesMenuOpen(!pagesMenuOpen)}
                  aria-expanded={pagesMenuOpen}
                  style={{
                    padding: "10px 12px",
                    border: "none",
                    background: "none",
                    color: "var(--muted)",
                    cursor: "pointer",
                    fontSize: 12,
                  }}
                >
                  {pagesMenuOpen ? "▴" : "▾"}
                </button>
              </div>
              {pagesMenuOpen && (
                <>
                  {sidebarPages.length > 0 && (
                  <>
                  <div style={{ paddingLeft: 20, paddingRight: 12, marginBottom: 6 }}>
                    <input
                      type="text"
                      placeholder="ページを検索"
                      value={sidebarPagesSearch}
                      onChange={(e) => setSidebarPagesSearch(e.target.value)}
                      style={{
                        width: "100%",
                        padding: "6px 10px",
                        fontSize: 12,
                        border: "1px solid var(--border)",
                        borderRadius: 8,
                        background: "var(--input-bg)",
                        color: "var(--text)",
                        outline: "none",
                      }}
                    />
                  </div>
                  {sidebarPagesSearch.trim() ? (
                    <div style={{ paddingLeft: 20, marginBottom: 4 }}>
                      {sidebarPages
                        .filter((p) => (p.title || "").toLowerCase().includes(sidebarPagesSearch.trim().toLowerCase()))
                        .map((p) => (
                          <Link
                            key={p.id}
                            href={`/pages/${p.id}`}
                            onClick={onNavigate}
                            style={{
                              ...linkBase,
                              display: "block",
                              padding: "6px 8px 6px 4px",
                              fontSize: 13,
                              borderLeftColor: pathname === `/pages/${p.id}` ? "var(--chip-border)" : "transparent",
                              background: pathname === `/pages/${p.id}` ? "var(--surface-2)" : undefined,
                            }}
                          >
                            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", display: "block" }}>
                              {p.title || "無題"}
                            </span>
                          </Link>
                        ))}
                      {sidebarPages.filter((p) => (p.title || "").toLowerCase().includes(sidebarPagesSearch.trim().toLowerCase())).length === 0 && (
                        <span style={{ fontSize: 12, color: "var(--muted)", paddingLeft: 4 }}>一致するページがありません</span>
                      )}
                    </div>
                  ) : (
                    <SidebarPagesList
                      pages={sidebarPages}
                      setPages={setSidebarPages}
                      pathname={pathname}
                      linkBase={linkBase}
                      onNavigate={onNavigate}
                      canReorder={canCreatePage && !savingOrder}
                      onReorder={onPagesReorder}
                      canManage={canCreatePage}
                      onDuplicatePage={onDuplicatePage}
                      onArchivePage={onArchivePage}
                      pageActionLoadingId={pageActionLoadingId}
                    />
                  )}
                  </>
                  )}
                </>
              )}
            </>
          ) : (
            <Link
              href={item.href}
              onClick={onNavigate}
              style={{
                ...linkBase,
                borderLeftColor: isActive ? "var(--chip-border)" : "transparent",
                background: isActive ? "var(--surface-2)" : undefined,
              }}
            >
              <span style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{label}</span>
                {badge ? (
                  <span
                    style={{
                      ...badgeStyle(badge.tone),
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                      minHeight: 22,
                      padding: "0 8px",
                      borderRadius: 999,
                      fontSize: 10,
                      fontWeight: 700,
                      whiteSpace: "nowrap",
                      flexShrink: 0,
                    }}
                  >
                    {badge.text}
                  </span>
                ) : null}
              </span>
            </Link>
          )}
        </div>
      </div>
    </div>
  )
}

function SidebarPagesList({
  pages,
  setPages,
  pathname,
  linkBase,
  onNavigate,
  canReorder,
  onReorder,
  canManage,
  onDuplicatePage,
  onArchivePage,
  pageActionLoadingId,
}: {
  pages: { id: string; title: string }[]
  setPages: React.Dispatch<React.SetStateAction<{ id: string; title: string }[]>>
  pathname: string | null
  linkBase: React.CSSProperties
  onNavigate?: () => void
  canReorder: boolean
  onReorder: (orderedIds: string[]) => void
  canManage: boolean
  onDuplicatePage: (pageId: string) => Promise<void>
  onArchivePage: (pageId: string) => Promise<void>
  pageActionLoadingId: string | null
}) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  )
  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event
      if (!over || active.id === over.id) return
      const oldIndex = pages.findIndex((p) => p.id === active.id)
      const newIndex = pages.findIndex((p) => p.id === over.id)
      if (oldIndex === -1 || newIndex === -1) return
      const next = arrayMove(pages, oldIndex, newIndex)
      setPages(next)
      onReorder(next.map((p) => p.id))
    },
    [pages, setPages, onReorder]
  )

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      <SortableContext items={pages.map((p) => p.id)} strategy={verticalListSortingStrategy}>
        <div style={{ maxHeight: 240, overflowY: "auto", marginBottom: 2 }}>
          {pages.map((p) => (
            <SortableSidebarPageRow
              key={p.id}
              page={p}
              pathname={pathname}
              linkBase={linkBase}
              onNavigate={onNavigate}
              canReorder={canReorder}
              canManage={canManage}
              onDuplicatePage={onDuplicatePage}
              onArchivePage={onArchivePage}
              pageActionLoadingId={pageActionLoadingId}
            />
          ))}
        </div>
      </SortableContext>
    </DndContext>
  )
}

function SortableSidebarPageRow({
  page,
  pathname,
  linkBase,
  onNavigate,
  canReorder,
  canManage,
  onDuplicatePage,
  onArchivePage,
  pageActionLoadingId,
}: {
  page: { id: string; title: string }
  pathname: string | null
  linkBase: React.CSSProperties
  onNavigate?: () => void
  canReorder: boolean
  canManage: boolean
  onDuplicatePage: (pageId: string) => Promise<void>
  onArchivePage: (pageId: string) => Promise<void>
  pageActionLoadingId: string | null
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: page.id,
    disabled: !canReorder,
  })
  const isPageActive = pathname === `/pages/${page.id}`
  const isWorking = pageActionLoadingId === page.id
  const [hovered, setHovered] = useState(false)
  return (
    <div
      ref={setNodeRef}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        display: "flex",
        alignItems: "center",
        opacity: isDragging ? 0.85 : 1,
        borderRadius: 5,
        background: isPageActive ? "var(--surface-2)" : hovered ? "var(--surface-2)" : "transparent",
        marginBottom: 1,
      }}
    >
      {canReorder ? (
        <span
          {...attributes}
          {...listeners}
          style={{
            padding: "0 2px",
            cursor: isDragging ? "grabbing" : "grab",
            color: "var(--muted)",
            fontSize: 9,
            opacity: hovered ? 0.6 : 0,
            transition: "opacity 0.12s",
            flexShrink: 0,
          }}
        >
          ⠿
        </span>
      ) : null}
      <Link
        href={`/pages/${page.id}`}
        onClick={onNavigate}
        style={{
          ...linkBase,
          flex: 1,
          minWidth: 0,
          padding: "3px 6px",
          fontSize: 11,
          color: isPageActive ? "var(--text)" : "var(--muted)",
          background: "transparent",
          textDecoration: "none",
        }}
      >
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", display: "block" }}>
          {page.title || "無題"}
        </span>
      </Link>
      {canManage && hovered && (
        <div style={{ display: "flex", alignItems: "center", gap: 2, paddingRight: 4, flexShrink: 0 }}>
          <button
            type="button"
            disabled={isWorking}
            onClick={(e) => {
              e.preventDefault()
              e.stopPropagation()
              void onDuplicatePage(page.id)
            }}
            title="複製"
            style={{
              border: "none",
              background: "transparent",
              color: "var(--muted)",
              fontSize: 9,
              padding: "1px 4px",
              cursor: isWorking ? "wait" : "pointer",
              borderRadius: 3,
            }}
          >
            複製
          </button>
          <button
            type="button"
            disabled={isWorking}
            onClick={(e) => {
              e.preventDefault()
              e.stopPropagation()
              void onArchivePage(page.id)
            }}
            title="アーカイブ"
            style={{
              border: "none",
              background: "transparent",
              color: "var(--muted)",
              fontSize: 9,
              padding: "1px 4px",
              cursor: isWorking ? "wait" : "pointer",
              borderRadius: 3,
            }}
          >
            ✕
          </button>
        </div>
      )}
    </div>
  )
}

export { SIDEBAR_WIDTH }
