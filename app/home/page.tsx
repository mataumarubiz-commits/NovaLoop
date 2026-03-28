"use client"

import { useEffect, useMemo, useState, type CSSProperties } from "react"
import Link from "next/link"
import { useSearchParams } from "next/navigation"
import { supabase } from "@/lib/supabase"
import { useAuthOrg } from "@/hooks/useAuthOrg"
import { trackClientEvent } from "@/lib/analytics"
import OnboardingGuide from "@/components/home/OnboardingGuide"
import type { OnboardingItemDefinition } from "@/lib/onboarding"
import {
  hasClientSubmissionSignal,
  isContentClientOverdue,
  isContentClosedStatus,
  isContentEditorOverdue,
} from "@/lib/contentWorkflow"
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
  clientSubmittedAt: string | null
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

const onboardingProgressCache = new Map<string, OnboardingResponse>()

const readCachedOnboardingProgress = (orgId: string | null) => {
  if (!orgId) return null
  const cached = onboardingProgressCache.get(orgId)
  return cached ?? null
}

const writeCachedOnboardingProgress = (orgId: string, value: OnboardingResponse) => {
  onboardingProgressCache.set(orgId, value)
}

const COMPLETED_STATUSES = new Set(["completed", "approved", "launched", "invoiced", "delivered", "published", "canceled", "cancelled"])

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

const formatTimeAgo = (v: string) => {
  const diffMin = Math.max(0, Math.floor((Date.now() - new Date(v).getTime()) / 60000))
  if (diffMin < 1) return "たった今"
  if (diffMin < 60) return `${diffMin}分前`
  const diffHour = Math.floor(diffMin / 60)
  if (diffHour < 24) return `${diffHour}時間前`
  return `${Math.floor(diffHour / 24)}日前`
}

export default function Home() {
  const searchParams = useSearchParams()
  const { user, activeOrgId, role, loading: authLoading } = useAuthOrg({ redirectToOnboarding: true })
  const [rows, setRows] = useState<ContentRow[]>([])
  const [kgiText, setKgiText] = useState<string>("")
    const [unreadNotifications, setUnreadNotifications] = useState<NotificationRow[]>([])
  const [onboarding, setOnboarding] = useState<OnboardingResponse | null>(null)
  const [onboardingLoading, setOnboardingLoading] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const canAccessBilling = role === "owner" || role === "executive_assistant"
  const isOwner = role === "owner"
  const isExecutiveAssistant = role === "executive_assistant"
  const showChecklistPanel = searchParams.get("panel") === "checklist"
  const shouldShowOnboardingGuide = canAccessBilling && onboarding != null && (!onboarding.done || showChecklistPanel)
  const shouldPrioritizeOnboardingGuide = shouldShowOnboardingGuide
  const roleLabel = isOwner
    ? "運用管理モード: 期限・通知・優先対応"
    : isExecutiveAssistant
      ? "運用管理モード: 未読・期限・優先対応"
      : "制作進行モード: 今日やること・期限管理"

  useEffect(() => {
    if (!activeOrgId) {
      const timer = setTimeout(() => {
        setRows([])
        setKgiText("")
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
        .select("id, project_name, title, due_client_at, due_editor_at, status, thumbnail_done, editor_submitted_at, client_submitted_at, client:clients(name)")
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

      const [contentsRes, settingRes, notificationsRes] = await Promise.all([
        contentsPromise,
        settingPromise,
        notificationsPromise,      ])

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
            clientSubmittedAt: row.client_submitted_at ?? null,
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
    if (!activeOrgId || !canAccessBilling) {
      const reset = window.setTimeout(() => {
        setOnboarding(null)
        setOnboardingLoading(false)
      }, 0)
      return () => window.clearTimeout(reset)
    }
    let active = true
    const cached = readCachedOnboardingProgress(activeOrgId)
    const applyCached = window.setTimeout(() => {
      if (!active) return
      setOnboarding(cached)
      setOnboardingLoading(!cached)
    }, 0)

    const loadOnboarding = async () => {
      if (!cached) setOnboardingLoading(true)
      const token = (await supabase.auth.getSession()).data.session?.access_token
      if (!token) {
        if (active) setOnboardingLoading(false)
        return
      }
      const res = await fetch("/api/onboarding/progress", {
        headers: { Authorization: `Bearer ${token}` },
      }).catch(() => null)
      const json = (await res?.json().catch(() => null)) as OnboardingResponse | null
      if (!active) return
      if (!res?.ok || !json?.ok) {
        setOnboardingLoading(false)
        return
      }
      writeCachedOnboardingProgress(activeOrgId, json)
      setOnboarding(json)
      setOnboardingLoading(false)
    }

    void loadOnboarding()
    return () => {
      active = false
      window.clearTimeout(applyCached)
    }
  }, [activeOrgId, canAccessBilling])

  const incompleteRows = useMemo(
    () => rows.filter((row) => !COMPLETED_STATUSES.has(row.status) && !isContentClosedStatus(row.status)),
    [rows]
  )
  const sortedIncomplete = useMemo(() => [...incompleteRows].sort((a, b) => (a.dueClientAt < b.dueClientAt ? -1 : 1)), [incompleteRows])
  const duePendingRows = incompleteRows.filter(
    (row) => !hasClientSubmissionSignal(row.status, row.clientSubmittedAt)
  )
  const todayTotal = duePendingRows.filter((row) => row.dueClientAt === todayYmd).length
  const tomorrowTotal = duePendingRows.filter((row) => row.dueClientAt === tomorrowYmd).length
  const editorOverdue = incompleteRows.filter((row) => isContentEditorOverdue(row.status, row.dueEditorAt, todayYmd, row.editorSubmittedAt)).length
  const clientOverdue = incompleteRows.filter((row) => isContentClientOverdue(row.status, row.dueClientAt, todayYmd, row.clientSubmittedAt)).length

  const actionTasks = useMemo<ActionTask[]>(() => {
    const tasks: ActionTask[] = []
    tasks.push({
      id: "client-overdue",
      label: "邏肴悄驕・ｌ蟇ｾ蠢・,
      description: "蜈域婿謠仙・縺ｮ驕・ｻｶ譯井ｻｶ",
      count: clientOverdue,
      href: "/contents?filter=client_overdue",
      tone: "danger",
    })
    tasks.push({
      id: "editor-overdue",
      label: "螟匁ｳｨ驕・ｻｶ蟇ｾ蠢・,
      description: "邱ｨ髮・・署蜃ｺ縺ｮ驕・ｻｶ譯井ｻｶ",
      count: editorOverdue,
      href: "/contents?filter=editor_overdue",
      tone: "danger",
    })
    tasks.push({
      id: "today-submit",
      label: "莉頑律謠仙・縺ｮ遒ｺ隱・,
      description: "譛ｬ譌･謠仙・莠亥ｮ壹・譯井ｻｶ",
      count: todayTotal,
      href: "/contents?due=today",
      tone: "warn",
    })
    const toneWeight = (tone: ActionTask["tone"]) => (tone === "danger" ? 100 : tone === "warn" ? 60 : 20)
    return tasks
      .filter((t) => t.count > 0)
      .sort((a, b) => b.count + toneWeight(b.tone) - (a.count + toneWeight(a.tone)))
      .slice(0, 4)
  }, [clientOverdue, editorOverdue, todayTotal])

  const hasHomeBlockingLoad = authLoading || loading || (canAccessBilling && onboardingLoading && onboarding == null)

  if (hasHomeBlockingLoad) {
    return <div style={{ padding: 32, color: "var(--muted)" }}>隱ｭ縺ｿ霎ｼ縺ｿ荳ｭ窶ｦ</div>
  }

  return (
    <div
      style={{
        padding: shouldPrioritizeOnboardingGuide ? "6px 24px 52px" : "28px 24px 52px",
        background: "var(--bg-grad)",
        minHeight: "100vh",
      }}
    >
      {!shouldPrioritizeOnboardingGuide ? (
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <div>
            <p style={{ fontSize: 12, letterSpacing: "0.08em", color: "var(--muted)" }}>SNS Ops SaaS</p>
            <h1 style={{ fontSize: 28, margin: "6px 0 8px", color: "var(--text)" }}>繝帙・繝</h1>
            <p style={{ fontSize: 12, color: "var(--muted)", margin: 0 }}>{roleLabel}</p>
          </div>
          <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
            <Link href="/help/setup" style={{ fontSize: 13, color: "var(--primary)", fontWeight: 600 }}>
              菴ｿ縺・婿繧定ｦ九ｋ
            </Link>
            <Link href="/notifications" style={{ fontSize: 13, color: "var(--primary)", fontWeight: 600 }}>
              騾夂衍繧ｻ繝ｳ繧ｿ繝ｼ縺ｸ
            </Link>
          </div>
        </div>
      ) : null}

      {error && (
        <div style={{ ...cardStyle, marginTop: 12, borderColor: "#fca5a5", background: "#fef2f2", color: "#991b1b" }}>
          繝・・繧ｿ蜿門ｾ励↓螟ｱ謨励＠縺ｾ縺励◆: {error}
        </div>
      )}

      {!shouldPrioritizeOnboardingGuide ? (
        <header style={{ marginTop: 18, marginBottom: 20 }}>
          <div style={{ color: "var(--text)" }}>
            KGI:
            <span style={{ marginLeft: 8, fontWeight: 600 }}>{kgiText || "KGI譛ｪ險ｭ螳夲ｼ・settings 縺ｧ險ｭ螳夲ｼ・}</span>
          </div>
        </header>
      ) : null}

      {shouldShowOnboardingGuide ? (
        <OnboardingGuide items={onboarding.items} completionRate={onboarding.completion_rate} />
      ) : null}


      <section style={{ ...cardStyle, marginBottom: 14 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, marginBottom: 8 }}>
          <h2 style={{ margin: 0, fontSize: 15, color: "var(--text)" }}>莉翫☆縺仙虚縺上ち繧ｹ繧ｯ</h2>
          <span style={{ fontSize: 12, color: "var(--muted)" }}>蜆ｪ蜈亥ｺｦ鬆・/span>
        </div>
        {actionTasks.length === 0 ? (
          <p style={{ margin: 0, fontSize: 13, color: "var(--muted)" }}>邱頑･繧ｿ繧ｹ繧ｯ縺ｯ縺ゅｊ縺ｾ縺帙ｓ縲る壼ｸｸ騾ｲ陦後ｒ邯ｭ謖√＠縺ｦ縺上□縺輔＞縲・/p>
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


      <section style={{ marginBottom: 22 }}>
        <h2 style={{ fontSize: 16, marginBottom: 10, color: "var(--text)" }}>莉頑律縺ｮ陦悟虚</h2>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: 12 }}>
          <Link href="/contents?due=today" style={{ ...cardStyle, textDecoration: "none", color: "inherit" }}>
            <div style={{ fontSize: 12, color: "var(--muted)" }}>莉頑律縺ｮ蜈域婿謠仙・</div>
            <div style={{ fontSize: 22, fontWeight: 700, marginTop: 6 }}>{todayTotal}</div>
          </Link>
          <Link href="/contents?due=tomorrow" style={{ ...cardStyle, textDecoration: "none", color: "inherit" }}>
            <div style={{ fontSize: 12, color: "var(--muted)" }}>譏取律縺ｮ蜈域婿謠仙・</div>
            <div style={{ fontSize: 22, fontWeight: 700, marginTop: 6 }}>{tomorrowTotal}</div>
          </Link>
          <Link href="/contents?filter=editor_overdue" style={{ ...cardStyle, textDecoration: "none", color: "inherit", borderColor: editorOverdue > 0 ? "#f87171" : "var(--border)", background: editorOverdue > 0 ? "#fff5f5" : "var(--surface)" }}>
            <div style={{ fontSize: 12, color: "var(--muted)" }}>螟匁ｳｨ譛ｪ謠仙・</div>
            <div style={{ fontSize: 22, fontWeight: 700, marginTop: 6, color: editorOverdue > 0 ? "#b91c1c" : "var(--text)" }}>{editorOverdue}</div>
          </Link>
          <Link href="/contents?filter=client_overdue" style={{ ...cardStyle, textDecoration: "none", color: "inherit", borderColor: clientOverdue > 0 ? "#f87171" : "var(--border)", background: clientOverdue > 0 ? "#fff5f5" : "var(--surface)" }}>
            <div style={{ fontSize: 12, color: "var(--muted)" }}>邏肴悄驕・ｌ</div>
            <div style={{ fontSize: 22, fontWeight: 700, marginTop: 6, color: clientOverdue > 0 ? "#b91c1c" : "var(--text)" }}>{clientOverdue}</div>
          </Link>
          <Link href="/contents?filter=client_overdue" style={{ ...cardStyle, textDecoration: "none", color: "inherit" }}>
            <div style={{ fontSize: 12, color: "var(--muted)" }}>蜆ｪ蜈亥ｯｾ蠢應ｻｶ謨ｰ</div>
            <div style={{ fontSize: 22, fontWeight: 700, marginTop: 6, color: clientOverdue + editorOverdue > 0 ? "#b91c1c" : "var(--text)" }}>
              {clientOverdue + editorOverdue}
            </div>
          </Link>
        </div>
      </section>

      <section style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 12, marginBottom: 18 }}>
        <div style={cardStyle}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
            <h2 style={{ fontSize: 16, color: "var(--text)", margin: 0 }}>騾夂衍繧ｵ繝槭Μ</h2>
            <Link href="/notifications" style={{ fontSize: 12, color: "var(--primary)", fontWeight: 600 }}>繧ゅ▲縺ｨ隕九ｋ</Link>
          </div>
          {unreadNotifications.length === 0 ? (
            <p style={{ margin: 0, fontSize: 13, color: "var(--muted)" }}>譛ｪ隱ｭ騾夂衍縺ｯ縺ゅｊ縺ｾ縺帙ｓ縲・/p>
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
                      蟇ｾ蠢・
                    </Link>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div style={cardStyle}>
          <h2 style={{ fontSize: 16, color: "var(--text)", margin: "0 0 10px 0" }}>邱繧∫憾豕・/h2>
          <>
            <div style={{ fontSize: 13, color: "var(--muted)", marginBottom: 6 }}>莉頑律繝ｻ譏取律縺ｮ謠仙・隕玖ｾｼ縺ｿ</div>
            <div style={{ fontSize: 20, fontWeight: 700, color: "var(--text)", marginBottom: 12 }}>
              {todayTotal + tomorrowTotal}莉ｶ
            </div>
            <div style={{ fontSize: 13, color: "var(--muted)", marginBottom: 6 }}>驕・ｻｶ蟇ｾ蠢懊′蠢・ｦ・/div>
            <div style={{ fontSize: 18, fontWeight: 700, color: clientOverdue + editorOverdue > 0 ? "#b91c1c" : "var(--text)" }}>
              {clientOverdue + editorOverdue}莉ｶ
            </div>
          </>
        </div>
      </section>


      <section>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <h2 style={{ fontSize: 18, marginBottom: 8, color: "var(--text)" }}>譛ｪ螳御ｺ・ｸ隕ｧ</h2>
          <span style={{ fontSize: 12, color: "var(--muted)" }}>蜈域婿謠仙・譌･ 譏・・/span>
        </div>
        <div style={{ display: "grid", gap: 10 }}>
          {sortedIncomplete.slice(0, 12).map((row) => {
            const isOverdue = isContentClientOverdue(row.status, row.dueClientAt, todayYmd, row.clientSubmittedAt)
            const isEditorLate = isContentEditorOverdue(row.status, row.dueEditorAt, todayYmd, row.editorSubmittedAt)
            return (
              <div key={row.id} style={{ ...cardStyle, borderColor: isOverdue ? "#ef4444" : "var(--border)", background: isOverdue ? "#fff5f5" : "var(--surface)" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 14 }}>
                  <div>
                    <div style={{ fontSize: 13, color: "var(--muted)", marginBottom: 4 }}>{row.clientName} / {row.projectName}</div>
                    <div style={{ fontSize: 16, fontWeight: 600, color: "var(--text)" }}>{row.title}</div>
                    <div style={{ fontSize: 12, marginTop: 6, color: "var(--text)" }}>蜈域婿謠仙・: {row.dueClientAt} / 邱ｨ髮・・署蜃ｺ: {row.dueEditorAt}</div>
                  </div>
                  <div style={{ textAlign: "right", display: "grid", gap: 4 }}>
                    {isOverdue && <span style={{ fontSize: 11, borderRadius: 999, background: "#fee2e2", color: "#b91c1c", padding: "2px 8px" }}>邏肴悄驕・ｌ</span>}
                    {isEditorLate && <span style={{ fontSize: 11, borderRadius: 999, background: "#fee2e2", color: "#b91c1c", padding: "2px 8px" }}>螟匁ｳｨ驕・ｌ</span>}
                    {!row.thumbnailDone && <span style={{ fontSize: 11, borderRadius: 999, border: "1px solid var(--chip-border)", color: "var(--chip-text)", padding: "2px 8px" }}>繧ｵ繝繝肴悴</span>}
                  </div>
                </div>
              </div>
            )
          })}
          {sortedIncomplete.length === 0 && <p style={{ color: "var(--muted)" }}>譛ｪ螳御ｺ・・繧ｳ繝ｳ繝・Φ繝・・縺ゅｊ縺ｾ縺帙ｓ縲・/p>}
        </div>
      </section>
    </div>
  )
}


