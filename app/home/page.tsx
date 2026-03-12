"use client"

import { useEffect, useMemo, useState, type CSSProperties } from "react"
import Link from "next/link"
import { supabase } from "@/lib/supabase"
import { useAuthOrg } from "@/hooks/useAuthOrg"
import { trackClientEvent } from "@/lib/analytics"
import type { OnboardingItemDefinition } from "@/lib/onboarding"
import {
  notificationActionHref,
  notificationPriority,
  notificationSeverity,
  notificationTitle,
} from "@/lib/notifications"

type ContentRow = {
  id: string
  clientName: string
  projectName: string
  title: string
  dueClientAt: string
  dueEditorAt: string
  status: string
  thumbnailDone: boolean
  editorSubmittedAt: string | null
  unitPrice: number
  deliveryMonth: string | null
  billableFlag: boolean
  invoiceId: string | null
}

type InvoiceRow = {
  id: string
  invoice_month: string
  status: string
}

type VendorInvoiceRow = {
  id: string
  billing_month: string
  status: string
  total: number
}

type NotificationRow = {
  id: string
  type: string
  payload: Record<string, unknown> | null
  read_at: string | null
  created_at: string
  org_id: string | null
}

type ActionTask = {
  id: string
  label: string
  description: string
  count: number
  href: string
  tone: "danger" | "warn" | "normal"
}

type OnboardingResponse = {
  ok: boolean
  items: Array<OnboardingItemDefinition & { completed: boolean; completed_at: string | null }>
  completion_rate: number
  done: boolean
}

const COMPLETED_STATUSES = new Set(["delivered", "published", "canceled", "cancelled"])
const BILLABLE_DONE_STATUSES = new Set(["delivered", "published"])

const cardStyle: CSSProperties = {
  border: "1px solid var(--border)",
  borderRadius: 12,
  padding: 16,
  background: "var(--surface)",
  boxShadow: "0 2px 8px rgba(0,0,0,0.04)",
}

const toYmd = (date: Date) => {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, "0")
  const d = String(date.getDate()).padStart(2, "0")
  return `${y}-${m}-${d}`
}

const toYm = (date: Date) => {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, "0")
  return `${y}-${m}`
}

const formatCurrency = (v: number) => `¥${new Intl.NumberFormat("ja-JP", { maximumFractionDigits: 0 }).format(v)}`

const formatTimeAgo = (v: string) => {
  const diffMin = Math.max(0, Math.floor((Date.now() - new Date(v).getTime()) / 60000))
  if (diffMin < 1) return "たった今"
  if (diffMin < 60) return `${diffMin}分前`
  const diffHour = Math.floor(diffMin / 60)
  if (diffHour < 24) return `${diffHour}時間前`
  return `${Math.floor(diffHour / 24)}日前`
}

export default function Home() {
  const { user, activeOrgId, role, loading: authLoading } = useAuthOrg({ redirectToOnboarding: true })
  const [rows, setRows] = useState<ContentRow[]>([])
  const [kgiText, setKgiText] = useState<string>("")
  const [invoices, setInvoices] = useState<InvoiceRow[]>([])
  const [vendorInvoices, setVendorInvoices] = useState<VendorInvoiceRow[]>([])
  const [unreadNotifications, setUnreadNotifications] = useState<NotificationRow[]>([])
  const [onboarding, setOnboarding] = useState<OnboardingResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const canAccessBilling = role === "owner" || role === "executive_assistant"
  const isOwner = role === "owner"
  const isExecutiveAssistant = role === "executive_assistant"
  const roleLabel = isOwner
    ? "経営モード: 売上・粗利・締め管理"
    : isExecutiveAssistant
      ? "運用管理モード: 未処理・通知・締め管理"
      : "制作進行モード: 今日やること・期限管理"

  useEffect(() => {
    if (!activeOrgId) {
      const timer = setTimeout(() => {
        setRows([])
        setKgiText("")
        setInvoices([])
        setVendorInvoices([])
        setUnreadNotifications([])
        setLoading(false)
      }, 0)
      return () => clearTimeout(timer)
    }

    let mounted = true
    const load = async () => {
      setLoading(true)
      setError(null)

      const contentsPromise = supabase
        .from("contents")
        .select("id, project_name, title, due_client_at, due_editor_at, status, thumbnail_done, editor_submitted_at, unit_price, delivery_month, billable_flag, invoice_id, client:clients(name)")
        .eq("org_id", activeOrgId)
        .order("due_client_at", { ascending: true })

      const settingPromise = supabase
        .from("org_settings")
        .select("kgi_text")
        .eq("org_id", activeOrgId)
        .maybeSingle()

      const { data: sessionData } = await supabase.auth.getSession()
      const token = sessionData.session?.access_token ?? null
      const notificationsPromise = token
        ? fetch(`/api/notifications/list?orgId=${encodeURIComponent(activeOrgId)}&unreadOnly=1&limit=8`, {
            headers: { Authorization: `Bearer ${token}` },
          })
            .then(async (res) => {
              if (!res.ok) return { notifications: [] as NotificationRow[] }
              const json = (await res.json().catch(() => null)) as { notifications?: NotificationRow[] } | null
              return { notifications: json?.notifications ?? [] }
            })
            .catch(() => ({ notifications: [] as NotificationRow[] }))
        : Promise.resolve({ notifications: [] as NotificationRow[] })

      const invoicesPromise = canAccessBilling
        ? supabase
            .from("invoices")
            .select("id, invoice_month, status")
            .eq("org_id", activeOrgId)
            .order("created_at", { ascending: false })
        : Promise.resolve({ data: [], error: null })

      const vendorInvoicesPromise = canAccessBilling
        ? supabase
            .from("vendor_invoices")
            .select("id, billing_month, status, total")
            .eq("org_id", activeOrgId)
            .order("created_at", { ascending: false })
        : Promise.resolve({ data: [], error: null })

      const [contentsRes, settingRes, notificationsRes, invoicesRes, vendorInvoicesRes] = await Promise.all([
        contentsPromise,
        settingPromise,
        notificationsPromise,
        invoicesPromise,
        vendorInvoicesPromise,
      ])

      if (!mounted) return

      if (contentsRes.error) {
        setError(contentsRes.error.message)
        setRows([])
      } else {
        const mapped = (contentsRes.data ?? []).map((row) => {
          const client = Array.isArray(row.client) ? row.client[0] : row.client
          return {
            id: row.id,
            clientName: (client as { name?: string } | null)?.name ?? "",
            projectName: row.project_name,
            title: row.title,
            dueClientAt: row.due_client_at,
            dueEditorAt: row.due_editor_at,
            status: row.status,
            thumbnailDone: row.thumbnail_done,
            editorSubmittedAt: row.editor_submitted_at ?? null,
            unitPrice: Number(row.unit_price ?? 0),
            deliveryMonth: row.delivery_month ?? null,
            billableFlag: Boolean(row.billable_flag),
            invoiceId: row.invoice_id ?? null,
          }
        })
        setRows(mapped)
      }

      setKgiText(settingRes.data?.kgi_text ?? "")

      const sorted = [...(notificationsRes.notifications ?? [])].sort((a, b) => {
        const scoreDiff = notificationPriority(b) - notificationPriority(a)
        if (scoreDiff !== 0) return scoreDiff
        return new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      })
      setUnreadNotifications(sorted as NotificationRow[])

      if (!invoicesRes.error) setInvoices((invoicesRes.data ?? []) as InvoiceRow[])
      if (!vendorInvoicesRes.error) setVendorInvoices((vendorInvoicesRes.data ?? []) as VendorInvoiceRow[])

      setLoading(false)
    }

    void load()
    return () => {
      mounted = false
    }
  }, [activeOrgId, canAccessBilling])

  const todayYmd = useMemo(() => toYmd(new Date()), [])
  const tomorrowYmd = useMemo(() => {
    const d = new Date()
    d.setDate(d.getDate() + 1)
    return toYmd(d)
  }, [])
  const thisMonth = useMemo(() => toYm(new Date()), [])

  useEffect(() => {
    if (authLoading || !activeOrgId || !user?.id) return
    const key = `digest-notif-v1:${user.id}:${activeOrgId}:${todayYmd}`
    if (window.sessionStorage.getItem(key) === "done") return

    const run = async () => {
      const { data } = await supabase.auth.getSession()
      const token = data.session?.access_token
      if (!token) return
      const res = await fetch("/api/notifications/digest", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ orgId: activeOrgId }),
      })
      if (res.ok) window.sessionStorage.setItem(key, "done")
    }

    void run()
  }, [activeOrgId, authLoading, todayYmd, user?.id])

  useEffect(() => {
    if (authLoading || !activeOrgId || !user?.id) return
    void trackClientEvent("auth.first_seen", {
      source: "home",
      entityType: "org",
      entityId: activeOrgId,
      metadata: { role },
    })
  }, [activeOrgId, authLoading, role, user?.id])

  useEffect(() => {
    if (!activeOrgId || !canAccessBilling) return
    let active = true

    const loadOnboarding = async () => {
      const token = (await supabase.auth.getSession()).data.session?.access_token
      if (!token) return
      const res = await fetch("/api/onboarding/progress", {
        headers: { Authorization: `Bearer ${token}` },
      }).catch(() => null)
      const json = (await res?.json().catch(() => null)) as OnboardingResponse | null
      if (!active || !res?.ok || !json?.ok) return
      setOnboarding(json)
    }

    void loadOnboarding()
    return () => {
      active = false
    }
  }, [activeOrgId, canAccessBilling])

  const incompleteRows = useMemo(() => rows.filter((row) => !COMPLETED_STATUSES.has(row.status)), [rows])
  const sortedIncomplete = useMemo(() => [...incompleteRows].sort((a, b) => (a.dueClientAt < b.dueClientAt ? -1 : 1)), [incompleteRows])
  const clientRiskRows = useMemo(() => {
    const map = new Map<string, { clientName: string; clientOverdue: number; editorOverdue: number; total: number }>()
    for (const row of incompleteRows) {
      const key = row.clientName?.trim() || "未設定クライアント"
      if (!map.has(key)) map.set(key, { clientName: key, clientOverdue: 0, editorOverdue: 0, total: 0 })
      const entry = map.get(key)!
      const isClientOverdue = row.dueClientAt < todayYmd
      const isEditorOverdue = row.dueEditorAt < todayYmd && !row.editorSubmittedAt
      if (isClientOverdue) entry.clientOverdue += 1
      if (isEditorOverdue) entry.editorOverdue += 1
      entry.total = entry.clientOverdue + entry.editorOverdue
    }
    return [...map.values()].filter((v) => v.total > 0).sort((a, b) => b.total - a.total || a.clientName.localeCompare(b.clientName, "ja"))
  }, [incompleteRows, todayYmd])

  const todayTotal = rows.filter((row) => row.dueClientAt === todayYmd).length
  const tomorrowTotal = rows.filter((row) => row.dueClientAt === tomorrowYmd).length
  const editorOverdue = incompleteRows.filter((row) => row.dueEditorAt < todayYmd && !row.editorSubmittedAt).length
  const clientOverdue = incompleteRows.filter((row) => row.dueClientAt < todayYmd).length

  const monthSales = rows
    .filter((row) => row.deliveryMonth === thisMonth && row.billableFlag && BILLABLE_DONE_STATUSES.has(row.status))
    .reduce((sum, row) => sum + row.unitPrice, 0)

  const monthOutsource = vendorInvoices
    .filter((row) => row.billing_month === thisMonth && row.status !== "void")
    .reduce((sum, row) => sum + Number(row.total ?? 0), 0)

  const grossProfit = monthSales - monthOutsource

  const invoiceTargets = rows.filter(
    (row) => row.deliveryMonth === thisMonth && row.billableFlag && BILLABLE_DONE_STATUSES.has(row.status)
  )
  const unprocessedInvoiceTargetCount = invoiceTargets.filter((row) => !row.invoiceId).length
  const createdInvoiceCount = invoices.filter((row) => row.invoice_month === thisMonth).length
  const pendingPayoutCount = vendorInvoices.filter(
    (row) => row.billing_month === thisMonth && (row.status === "submitted" || row.status === "approved")
  ).length
  const closingProgressPercent =
    invoiceTargets.length > 0 ? Math.min(100, Math.round((createdInvoiceCount / invoiceTargets.length) * 100)) : 100
  const urgentCount = canAccessBilling
    ? clientOverdue + editorOverdue + unprocessedInvoiceTargetCount + pendingPayoutCount
    : clientOverdue + editorOverdue

  const quickActions = useMemo(() => {
    if (isOwner) {
      return [
        { label: "請求未処理を確認", href: `/billing?month=${encodeURIComponent(thisMonth)}` },
        { label: "粗利を確認", href: `/invoices?month=${encodeURIComponent(thisMonth)}` },
        { label: "支払未処理を確認", href: `/payouts?month=${encodeURIComponent(thisMonth)}` },
      ]
    }
    if (isExecutiveAssistant) {
      return [
        { label: "未読通知を処理", href: "/notifications" },
        { label: "請求未処理を確認", href: `/billing?month=${encodeURIComponent(thisMonth)}` },
        { label: "支払未処理を確認", href: `/payouts?month=${encodeURIComponent(thisMonth)}` },
      ]
    }
    return [
      { label: "今日提出の一覧を開く", href: "/contents?due=today" },
      { label: "納期遅れを確認", href: "/contents?filter=client_overdue" },
      { label: "外注遅延を確認", href: "/contents?filter=editor_overdue" },
    ]
  }, [isOwner, isExecutiveAssistant, thisMonth])

  const actionTasks = useMemo<ActionTask[]>(() => {
    const tasks: ActionTask[] = []
    tasks.push({
      id: "client-overdue",
      label: "納期遅れ対応",
      description: "先方提出の遅延案件",
      count: clientOverdue,
      href: "/contents?filter=client_overdue",
      tone: "danger",
    })
    tasks.push({
      id: "editor-overdue",
      label: "外注遅延対応",
      description: "編集者提出の遅延案件",
      count: editorOverdue,
      href: "/contents?filter=editor_overdue",
      tone: "danger",
    })
    tasks.push({
      id: "today-submit",
      label: "今日提出の確認",
      description: "本日提出予定の案件",
      count: todayTotal,
      href: "/contents?due=today",
      tone: "warn",
    })
    if (canAccessBilling) {
      tasks.push({
        id: "invoice-unprocessed",
        label: "請求未処理",
        description: "請求対象の未処理案件",
        count: unprocessedInvoiceTargetCount,
        href: `/billing?month=${encodeURIComponent(thisMonth)}`,
        tone: "warn",
      })
      tasks.push({
        id: "payout-pending",
        label: "支払未処理",
        description: "支払い承認待ち案件",
        count: pendingPayoutCount,
        href: `/payouts?month=${encodeURIComponent(thisMonth)}`,
        tone: "warn",
      })
    }

    const toneWeight = (tone: ActionTask["tone"]) => (tone === "danger" ? 100 : tone === "warn" ? 60 : 20)
    return tasks
      .filter((t) => t.count > 0)
      .sort((a, b) => b.count + toneWeight(b.tone) - (a.count + toneWeight(a.tone)))
      .slice(0, 4)
  }, [
    canAccessBilling,
    clientOverdue,
    editorOverdue,
    pendingPayoutCount,
    thisMonth,
    todayTotal,
    unprocessedInvoiceTargetCount,
  ])

  if (authLoading || loading) {
    return <div style={{ padding: 32, color: "var(--muted)" }}>読み込み中…</div>
  }

  return (
    <div style={{ padding: "28px 24px 52px", background: "var(--bg-grad)", minHeight: "100vh" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <div>
          <p style={{ fontSize: 12, letterSpacing: "0.08em", color: "var(--muted)" }}>SNS Ops SaaS</p>
          <h1 style={{ fontSize: 28, margin: "6px 0 8px", color: "var(--text)" }}>ホーム</h1>
          <p style={{ fontSize: 12, color: "var(--muted)", margin: 0 }}>{roleLabel}</p>
        </div>
        <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
          <Link href="/help/setup" style={{ fontSize: 13, color: "var(--primary)", fontWeight: 600 }}>
            使い方を見る
          </Link>
          <Link href="/notifications" style={{ fontSize: 13, color: "var(--primary)", fontWeight: 600 }}>
            通知センターへ
          </Link>
        </div>
      </div>

      {error && (
        <div style={{ ...cardStyle, marginTop: 12, borderColor: "#fca5a5", background: "#fef2f2", color: "#991b1b" }}>
          データ取得に失敗しました: {error}
        </div>
      )}

      <header style={{ marginTop: 18, marginBottom: 20 }}>
        <div style={{ color: "var(--text)" }}>
          KGI:
          <span style={{ marginLeft: 8, fontWeight: 600 }}>{kgiText || "KGI未設定（/settings で設定）"}</span>
        </div>
      </header>

      {canAccessBilling && onboarding && !onboarding.done ? (
        <section
          style={{
            ...cardStyle,
            marginBottom: 14,
            borderColor: "rgba(167, 139, 250, 0.35)",
            background: "linear-gradient(180deg, rgba(255,255,255,0.96), rgba(248,244,255,0.96))",
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", gap: 16, flexWrap: "wrap", alignItems: "start" }}>
            <div>
              <div style={{ fontSize: 12, color: "#7c3aed", fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase" }}>
                導入チェックリスト
              </div>
              <h2 style={{ margin: "6px 0 8px", fontSize: 18, color: "var(--text)" }}>最初にやることをここで揃えます</h2>
              <p style={{ margin: 0, fontSize: 13, color: "var(--muted)", lineHeight: 1.7 }}>
                会社情報、クライアント、マニュアル、請求、外注導線までを順番に確認できます。
              </p>
            </div>
            <div style={{ minWidth: 140 }}>
              <div style={{ fontSize: 12, color: "var(--muted)" }}>完了率</div>
              <div style={{ marginTop: 6, fontSize: 24, fontWeight: 800, color: "var(--text)" }}>{onboarding.completion_rate}%</div>
            </div>
          </div>
          <div style={{ marginTop: 14, display: "grid", gap: 8 }}>
            {onboarding.items.map((item) => (
              <div
                key={item.key}
                style={{
                  display: "grid",
                  gridTemplateColumns: "auto 1fr auto",
                  gap: 12,
                  alignItems: "center",
                  border: "1px solid var(--border)",
                  borderRadius: 12,
                  padding: "10px 12px",
                  background: item.completed ? "#f0fdf4" : "var(--surface)",
                }}
              >
                <span
                  style={{
                    width: 26,
                    height: 26,
                    borderRadius: 999,
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    background: item.completed ? "#16a34a" : "rgba(124,58,237,0.12)",
                    color: item.completed ? "#fff" : "#6d28d9",
                    fontSize: 12,
                    fontWeight: 800,
                  }}
                >
                  {item.completed ? "完" : "未"}
                </span>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 700, color: "var(--text)" }}>{item.title}</div>
                  <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 2 }}>{item.description}</div>
                </div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  {item.helpHref ? (
                    <Link
                      href={item.helpHref}
                      style={{ fontSize: 12, color: "var(--text)", textDecoration: "none", border: "1px solid var(--border)", borderRadius: 999, padding: "6px 10px", background: "var(--surface-2)" }}
                    >
                      使い方
                    </Link>
                  ) : null}
                  <Link href={item.href} style={{ fontSize: 12, color: "var(--primary)", fontWeight: 700, textDecoration: "none" }}>
                    開く
                  </Link>
                </div>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      <section style={{ ...cardStyle, marginBottom: 14, borderColor: urgentCount > 0 ? "#fca5a5" : "#86efac", background: urgentCount > 0 ? "#fff7f7" : "#f0fdf4" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <div>
            <div style={{ fontSize: 12, color: urgentCount > 0 ? "#991b1b" : "#166534", fontWeight: 700 }}>
              {urgentCount > 0 ? "危険: 優先対応が必要です" : "安心: 重大な遅延はありません"}
            </div>
            <div style={{ fontSize: 14, color: "var(--text)", marginTop: 2 }}>
              緊急対応件数 <strong>{urgentCount}件</strong>
            </div>
          </div>
          <Link href={urgentCount > 0 ? "/contents?filter=client_overdue" : "/contents?due=today"} style={{ fontSize: 13, fontWeight: 700, color: "var(--primary)", textDecoration: "none" }}>
            今すぐ確認
          </Link>
        </div>
      </section>

      <section style={{ ...cardStyle, marginBottom: 14 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, marginBottom: 8 }}>
          <h2 style={{ margin: 0, fontSize: 15, color: "var(--text)" }}>今すぐ動くタスク</h2>
          <span style={{ fontSize: 12, color: "var(--muted)" }}>優先度順</span>
        </div>
        {actionTasks.length === 0 ? (
          <p style={{ margin: 0, fontSize: 13, color: "var(--muted)" }}>緊急タスクはありません。通常進行を維持してください。</p>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))", gap: 8 }}>
            {actionTasks.map((task) => {
              const tone =
                task.tone === "danger"
                  ? { bg: "#fff1f2", border: "#fecdd3", text: "#9f1239" }
                  : task.tone === "warn"
                    ? { bg: "#fffbeb", border: "#fde68a", text: "#92400e" }
                    : { bg: "var(--surface-2)", border: "var(--border)", text: "var(--text)" }
              return (
                <Link
                  key={task.id}
                  href={task.href}
                  style={{
                    textDecoration: "none",
                    border: `1px solid ${tone.border}`,
                    background: tone.bg,
                    color: tone.text,
                    borderRadius: 10,
                    padding: "10px 12px",
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "baseline" }}>
                    <span style={{ fontSize: 13, fontWeight: 700 }}>{task.label}</span>
                    <span style={{ fontSize: 16, fontWeight: 800 }}>{task.count}</span>
                  </div>
                  <div style={{ marginTop: 2, fontSize: 12, opacity: 0.9 }}>{task.description}</div>
                </Link>
              )
            })}
          </div>
        )}
      </section>

      <section style={{ ...cardStyle, marginBottom: 16 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <h2 style={{ margin: 0, fontSize: 15, color: "var(--text)" }}>最優先アクション</h2>
          <span style={{ fontSize: 12, color: "var(--muted)" }}>ロール別に最適化</span>
        </div>
        <div style={{ marginTop: 10, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 8 }}>
          {quickActions.map((a) => (
            <Link key={a.href + a.label} href={a.href} style={{ border: "1px solid var(--border)", borderRadius: 10, padding: "10px 12px", textDecoration: "none", color: "var(--text)", background: "var(--surface-2)", fontSize: 13, fontWeight: 600 }}>
              {a.label}
            </Link>
          ))}
        </div>
      </section>

      <section style={{ marginBottom: 22 }}>
        <h2 style={{ fontSize: 16, marginBottom: 10, color: "var(--text)" }}>今日の行動</h2>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: 12 }}>
          <Link href="/contents?due=today" style={{ ...cardStyle, textDecoration: "none", color: "inherit" }}>
            <div style={{ fontSize: 12, color: "var(--muted)" }}>今日の先方提出</div>
            <div style={{ fontSize: 22, fontWeight: 700, marginTop: 6 }}>{todayTotal}</div>
          </Link>
          <Link href="/contents?due=tomorrow" style={{ ...cardStyle, textDecoration: "none", color: "inherit" }}>
            <div style={{ fontSize: 12, color: "var(--muted)" }}>明日の先方提出</div>
            <div style={{ fontSize: 22, fontWeight: 700, marginTop: 6 }}>{tomorrowTotal}</div>
          </Link>
          <Link href="/contents?filter=editor_overdue" style={{ ...cardStyle, textDecoration: "none", color: "inherit", borderColor: editorOverdue > 0 ? "#f87171" : "var(--border)", background: editorOverdue > 0 ? "#fff5f5" : "var(--surface)" }}>
            <div style={{ fontSize: 12, color: "var(--muted)" }}>外注未提出</div>
            <div style={{ fontSize: 22, fontWeight: 700, marginTop: 6, color: editorOverdue > 0 ? "#b91c1c" : "var(--text)" }}>{editorOverdue}</div>
          </Link>
          <Link href="/contents?filter=client_overdue" style={{ ...cardStyle, textDecoration: "none", color: "inherit", borderColor: clientOverdue > 0 ? "#f87171" : "var(--border)", background: clientOverdue > 0 ? "#fff5f5" : "var(--surface)" }}>
            <div style={{ fontSize: 12, color: "var(--muted)" }}>納期遅れ</div>
            <div style={{ fontSize: 22, fontWeight: 700, marginTop: 6, color: clientOverdue > 0 ? "#b91c1c" : "var(--text)" }}>{clientOverdue}</div>
          </Link>
          {canAccessBilling ? (
            <>
              <Link href={`/billing?month=${encodeURIComponent(thisMonth)}`} style={{ ...cardStyle, textDecoration: "none", color: "inherit" }}>
                <div style={{ fontSize: 12, color: "var(--muted)" }}>今月売上</div>
                <div style={{ fontSize: 22, fontWeight: 700, marginTop: 6 }}>{formatCurrency(monthSales)}</div>
              </Link>
              <Link href={`/payouts?month=${encodeURIComponent(thisMonth)}`} style={{ ...cardStyle, textDecoration: "none", color: "inherit" }}>
                <div style={{ fontSize: 12, color: "var(--muted)" }}>今月外注費</div>
                <div style={{ fontSize: 22, fontWeight: 700, marginTop: 6 }}>{formatCurrency(monthOutsource)}</div>
              </Link>
              <Link href={`/billing?month=${encodeURIComponent(thisMonth)}`} style={{ ...cardStyle, textDecoration: "none", color: "inherit" }}>
                <div style={{ fontSize: 12, color: "var(--muted)" }}>粗利</div>
                <div style={{ fontSize: 22, fontWeight: 700, marginTop: 6 }}>{formatCurrency(grossProfit)}</div>
              </Link>
            </>
          ) : (
            <Link href="/contents?filter=client_overdue" style={{ ...cardStyle, textDecoration: "none", color: "inherit" }}>
              <div style={{ fontSize: 12, color: "var(--muted)" }}>優先対応件数</div>
              <div style={{ fontSize: 22, fontWeight: 700, marginTop: 6, color: clientOverdue + editorOverdue > 0 ? "#b91c1c" : "var(--text)" }}>
                {clientOverdue + editorOverdue}
              </div>
            </Link>
          )}
        </div>
      </section>

      <section style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 12, marginBottom: 18 }}>
        <div style={cardStyle}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
            <h2 style={{ fontSize: 16, color: "var(--text)", margin: 0 }}>通知サマリ</h2>
            <Link href="/notifications" style={{ fontSize: 12, color: "var(--primary)", fontWeight: 600 }}>もっと見る</Link>
          </div>
          {unreadNotifications.length === 0 ? (
            <p style={{ margin: 0, fontSize: 13, color: "var(--muted)" }}>未読通知はありません。</p>
          ) : (
            <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 8 }}>
              {unreadNotifications.slice(0, 5).map((n) => (
                <li key={n.id} style={{ border: "1px solid var(--border)", borderRadius: 8, padding: "8px 10px", fontSize: 13, color: "var(--text)", background: "var(--surface-2)" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center" }}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 2 }}>
                        <span
                          style={{
                            fontSize: 10,
                            borderRadius: 999,
                            padding: "2px 6px",
                            background: notificationSeverity(n).bg,
                            color: notificationSeverity(n).text,
                            fontWeight: 700,
                            flexShrink: 0,
                          }}
                        >
                          {notificationSeverity(n).label}
                        </span>
                        <span style={{ fontSize: 11, color: "var(--muted)" }}>{formatTimeAgo(n.created_at)}</span>
                      </div>
                      <div style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{notificationTitle(n)}</div>
                    </div>
                    <Link
                      href={notificationActionHref(n)}
                      onClick={() =>
                        void trackClientEvent("notification.clicked", {
                          source: "home_notification_summary",
                          entityType: "notification",
                          entityId: n.id,
                          metadata: { type: n.type },
                        })
                      }
                      style={{ fontSize: 12, color: "var(--primary)", fontWeight: 600 }}
                    >
                      対応
                    </Link>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div style={cardStyle}>
          <h2 style={{ fontSize: 16, color: "var(--text)", margin: "0 0 10px 0" }}>締め状況</h2>
          {canAccessBilling ? (
            <>
              <div style={{ fontSize: 13, color: "var(--muted)", marginBottom: 6 }}>請求生成状況</div>
              <div style={{ fontSize: 20, fontWeight: 700, color: "var(--text)", marginBottom: 12 }}>
                {createdInvoiceCount} / {invoiceTargets.length}
              </div>
              <div style={{ height: 8, borderRadius: 999, background: "var(--surface-2)", overflow: "hidden", marginBottom: 12 }}>
                <div
                  style={{
                    width: `${closingProgressPercent}%`,
                    height: "100%",
                    background: closingProgressPercent >= 100 ? "#22c55e" : "var(--primary)",
                    transition: "width 0.2s ease",
                  }}
                />
              </div>
              <div style={{ fontSize: 13, color: "var(--muted)", marginBottom: 6 }}>未処理の請求対象</div>
              <div style={{ fontSize: 18, fontWeight: 700, color: unprocessedInvoiceTargetCount > 0 ? "#b91c1c" : "var(--text)", marginBottom: 12 }}>
                {unprocessedInvoiceTargetCount}件
              </div>
              <div style={{ fontSize: 13, color: "var(--muted)", marginBottom: 6 }}>未処理の支払い対象</div>
              <div style={{ fontSize: 18, fontWeight: 700, color: pendingPayoutCount > 0 ? "#b91c1c" : "var(--text)" }}>
                {pendingPayoutCount}件
              </div>
            </>
          ) : (
            <>
              <div style={{ fontSize: 13, color: "var(--muted)", marginBottom: 6 }}>今日・明日の提出見込み</div>
              <div style={{ fontSize: 20, fontWeight: 700, color: "var(--text)", marginBottom: 12 }}>
                {todayTotal + tomorrowTotal}件
              </div>
              <div style={{ fontSize: 13, color: "var(--muted)", marginBottom: 6 }}>遅延対応が必要</div>
              <div style={{ fontSize: 18, fontWeight: 700, color: clientOverdue + editorOverdue > 0 ? "#b91c1c" : "var(--text)" }}>
                {clientOverdue + editorOverdue}件
              </div>
            </>
          )}
        </div>
      </section>

      <section style={{ ...cardStyle, marginBottom: 18 }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
          <div>
            <h2 style={{ margin: 0, fontSize: 16, color: "var(--text)" }}>改善要望 / バグ報告</h2>
            <p style={{ margin: "6px 0 0", fontSize: 13, color: "var(--muted)" }}>
              導入で詰まった場所や改善したい点があれば、そのまま送れます。
            </p>
          </div>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <Link href="/settings/dashboard?context=/home&type=feedback" style={{ fontSize: 13, fontWeight: 700, color: "var(--primary)", textDecoration: "none" }}>
              改善要望を送る
            </Link>
            <Link href="/settings/dashboard?context=/home&type=bug" style={{ fontSize: 13, fontWeight: 700, color: "var(--primary)", textDecoration: "none" }}>
              バグ報告を送る
            </Link>
          </div>
        </div>
      </section>

      <section style={{ ...cardStyle, marginBottom: 18 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, marginBottom: 10, flexWrap: "wrap" }}>
          <h2 style={{ fontSize: 16, color: "var(--text)", margin: 0 }}>クライアント別の危険案件</h2>
          <Link href="/contents?filter=client_overdue" style={{ fontSize: 12, color: "var(--primary)", fontWeight: 600 }}>遅延一覧へ</Link>
        </div>
        {clientRiskRows.length === 0 ? (
          <p style={{ margin: 0, fontSize: 13, color: "var(--muted)" }}>危険案件はありません。進行は安定しています。</p>
        ) : (
          <div style={{ display: "grid", gap: 8 }}>
            {clientRiskRows.slice(0, 8).map((r) => (
              <div key={r.clientName} style={{ border: "1px solid #fecaca", borderRadius: 10, background: "#fff7f7", padding: "8px 10px", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: "#991b1b", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{r.clientName}</div>
                  <div style={{ fontSize: 12, color: "#7f1d1d" }}>納期遅れ {r.clientOverdue}件 / 外注遅延 {r.editorOverdue}件</div>
                </div>
                <Link href="/contents?filter=client_overdue" style={{ fontSize: 12, color: "var(--primary)", fontWeight: 700, textDecoration: "none", flexShrink: 0 }}>
                  対応する
                </Link>
              </div>
            ))}
          </div>
        )}
      </section>

      <section>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <h2 style={{ fontSize: 18, marginBottom: 8, color: "var(--text)" }}>未完了一覧</h2>
          <span style={{ fontSize: 12, color: "var(--muted)" }}>先方提出日 昇順</span>
        </div>
        <div style={{ display: "grid", gap: 10 }}>
          {sortedIncomplete.slice(0, 12).map((row) => {
            const isOverdue = row.dueClientAt < todayYmd
            const isEditorLate = row.dueEditorAt < todayYmd && !row.editorSubmittedAt
            return (
              <div key={row.id} style={{ ...cardStyle, borderColor: isOverdue ? "#ef4444" : "var(--border)", background: isOverdue ? "#fff5f5" : "var(--surface)" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 14 }}>
                  <div>
                    <div style={{ fontSize: 13, color: "var(--muted)", marginBottom: 4 }}>{row.clientName} / {row.projectName}</div>
                    <div style={{ fontSize: 16, fontWeight: 600, color: "var(--text)" }}>{row.title}</div>
                    <div style={{ fontSize: 12, marginTop: 6, color: "var(--text)" }}>先方提出: {row.dueClientAt} / 編集者提出: {row.dueEditorAt}</div>
                  </div>
                  <div style={{ textAlign: "right", display: "grid", gap: 4 }}>
                    {isOverdue && <span style={{ fontSize: 11, borderRadius: 999, background: "#fee2e2", color: "#b91c1c", padding: "2px 8px" }}>納期遅れ</span>}
                    {isEditorLate && <span style={{ fontSize: 11, borderRadius: 999, background: "#fee2e2", color: "#b91c1c", padding: "2px 8px" }}>外注遅れ</span>}
                    {!row.thumbnailDone && <span style={{ fontSize: 11, borderRadius: 999, border: "1px solid var(--chip-border)", color: "var(--chip-text)", padding: "2px 8px" }}>サムネ未</span>}
                  </div>
                </div>
              </div>
            )
          })}
          {sortedIncomplete.length === 0 && <p style={{ color: "var(--muted)" }}>未完了のコンテンツはありません。</p>}
        </div>
      </section>
    </div>
  )
}
