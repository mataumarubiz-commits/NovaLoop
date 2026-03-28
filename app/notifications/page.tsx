"use client"

import Link from "next/link"
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react"
import ChecklistReturnButton from "@/components/home/ChecklistReturnButton"
import GuideEmptyState from "@/components/shared/GuideEmptyState"
import { useAuthOrg } from "@/hooks/useAuthOrg"
import { trackClientEvent } from "@/lib/analytics"
import {
  normalizeNotificationType,
  notificationActionHref,
  notificationPriority,
  notificationResolved,
  notificationSeverity,
  notificationTitle,
} from "@/lib/notifications"
import { supabase } from "@/lib/supabase"

const cardStyle: CSSProperties = {
  border: "1px solid var(--border)",
  borderRadius: 12,
  padding: 16,
  background: "var(--surface)",
}

type NotificationRow = {
  id: string
  org_id: string | null
  type: string
  payload: Record<string, unknown> & { resolved?: boolean; join_request_id?: string }
  read_at: string | null
  created_at: string
}

type FilterKey = "unread" | "read_pending" | "read_done" | "all"

function formatTimeAgo(value: string): string {
  const diffMin = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 60000))
  if (diffMin < 1) return "たった今"
  if (diffMin < 60) return `${diffMin}分前`
  const diffHour = Math.floor(diffMin / 60)
  if (diffHour < 24) return `${diffHour}時間前`
  return `${Math.floor(diffHour / 24)}日前`
}

export default function NotificationsPage() {
  const { user, activeOrgId, role, loading: authLoading } = useAuthOrg({ redirectToOnboarding: true })
  const [list, setList] = useState<NotificationRow[]>([])
  const [filter, setFilter] = useState<FilterKey>("unread")
  const [loading, setLoading] = useState(true)
  const [working, setWorking] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selectedRole, setSelectedRole] = useState<Record<string, "member" | "executive_assistant">>({})
  const canManageMembership = role === "owner" || role === "executive_assistant"
  const viewTrackedRef = useRef(false)
  const checklistSyncedRef = useRef(false)

  const withToken = useCallback(async () => {
    const { data } = await supabase.auth.getSession()
    return data.session?.access_token ?? null
  }, [])

  const fetchNotifications = useCallback(async () => {
    if (!activeOrgId || !user) {
      setList([])
      setLoading(false)
      return
    }

    setError(null)
    setLoading(true)
    const token = await withToken()
    if (!token) {
      setList([])
      setLoading(false)
      return
    }

    const res = await fetch(`/api/notifications/list?orgId=${encodeURIComponent(activeOrgId)}&limit=200`, {
      headers: { Authorization: `Bearer ${token}` },
    })

    if (!res.ok) {
      const json = (await res.json().catch(() => null)) as { error?: string } | null
      setError(json?.error ?? "通知の取得に失敗しました")
      setList([])
      setLoading(false)
      return
    }

    const json = (await res.json().catch(() => null)) as { notifications?: NotificationRow[] } | null
    const sorted = [...(json?.notifications ?? [])].sort((a, b) => {
      const scoreDiff = notificationPriority(b) - notificationPriority(a)
      if (scoreDiff !== 0) return scoreDiff
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    })
    setList(sorted)
    setLoading(false)
  }, [activeOrgId, user, withToken])

  useEffect(() => {
    if (authLoading) return
    const id = window.setTimeout(() => {
      void fetchNotifications()
    }, 0)
    return () => window.clearTimeout(id)
  }, [authLoading, fetchNotifications])

  useEffect(() => {
    if (authLoading || !activeOrgId || !user || viewTrackedRef.current) return
    viewTrackedRef.current = true
    void trackClientEvent("notification.center_viewed", {
      source: "notifications.page",
      metadata: { org_id: activeOrgId },
    })
  }, [activeOrgId, authLoading, user])

  useEffect(() => {
    if (authLoading || !activeOrgId || !user || !canManageMembership || checklistSyncedRef.current) return
    checklistSyncedRef.current = true
    void (async () => {
      const token = await withToken()
      if (!token) return
      await fetch("/api/onboarding/progress", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ completed_keys: ["notifications_checked"] }),
      }).catch(() => null)
    })()
  }, [activeOrgId, authLoading, canManageMembership, user, withToken])

  const markRead = useCallback(
    async (notificationId: string) => {
      if (!activeOrgId) return
      const token = await withToken()
      if (!token) return
      setWorking(true)
      const res = await fetch("/api/notifications/mark-read", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ orgId: activeOrgId, notificationId }),
      })
      if (!res.ok) {
        const json = (await res.json().catch(() => null)) as { error?: string } | null
        setError(json?.error ?? "既読更新に失敗しました")
      }
      await fetchNotifications()
      setWorking(false)
    },
    [activeOrgId, fetchNotifications, withToken]
  )

  const markAllRead = useCallback(async () => {
    if (!activeOrgId) return
    const token = await withToken()
    if (!token) return
    setWorking(true)
    const res = await fetch("/api/notifications/mark-all-read", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ orgId: activeOrgId }),
    })
    if (!res.ok) {
      const json = (await res.json().catch(() => null)) as { error?: string } | null
      setError(json?.error ?? "一括既読に失敗しました")
    }
    await fetchNotifications()
    setWorking(false)
  }, [activeOrgId, fetchNotifications, withToken])

  const markResolved = useCallback(
    async (notificationId: string) => {
      if (!activeOrgId) return
      const token = await withToken()
      if (!token) return
      setWorking(true)
      const res = await fetch("/api/notifications/mark-resolved", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ orgId: activeOrgId, notificationId }),
      })
      if (!res.ok) {
        const json = (await res.json().catch(() => null)) as { error?: string } | null
        setError(json?.error ?? "対応済み更新に失敗しました")
      }
      await fetchNotifications()
      setWorking(false)
    },
    [activeOrgId, fetchNotifications, withToken]
  )

  const handleApproveMembership = useCallback(
    async (requestId: string) => {
      if (!canManageMembership) return
      const roleKey = selectedRole[requestId] ?? "member"
      const token = await withToken()
      if (!token) return
      setWorking(true)
      const res = await fetch("/api/org/requests/approve", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ requestId, roleKey }),
      })
      if (!res.ok) {
        const json = (await res.json().catch(() => null)) as { error?: string } | null
        setError(json?.error ?? "参加承認に失敗しました")
      }
      await fetchNotifications()
      setWorking(false)
    },
    [canManageMembership, fetchNotifications, selectedRole, withToken]
  )

  const handleRejectMembership = useCallback(
    async (requestId: string) => {
      if (!canManageMembership) return
      const token = await withToken()
      if (!token) return
      setWorking(true)
      const res = await fetch("/api/org/requests/reject", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ requestId }),
      })
      if (!res.ok) {
        const json = (await res.json().catch(() => null)) as { error?: string } | null
        setError(json?.error ?? "参加却下に失敗しました")
      }
      await fetchNotifications()
      setWorking(false)
    },
    [canManageMembership, fetchNotifications, withToken]
  )

  const unreadCount = useMemo(() => list.filter((n) => !n.read_at).length, [list])
  const readDoneCount = useMemo(() => list.filter((n) => !!n.read_at && notificationResolved(n)).length, [list])
  const readPendingCount = useMemo(() => list.filter((n) => !!n.read_at && !notificationResolved(n)).length, [list])
  const filtered = useMemo(() => {
    if (filter === "all") return list
    if (filter === "unread") return list.filter((n) => !n.read_at)
    if (filter === "read_pending") return list.filter((n) => !!n.read_at && !notificationResolved(n))
    return list.filter((n) => !!n.read_at && notificationResolved(n))
  }, [filter, list])

  return (
    <div style={{ padding: "24px 20px 40px", minHeight: "100vh", background: "var(--bg-grad)" }}>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center", marginBottom: 16 }}>
        <ChecklistReturnButton />
        <Link href="/home" style={{ fontSize: 14, color: "var(--primary)", fontWeight: 600 }}>
          Home
        </Link>
      </div>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 10 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: "var(--text)", margin: 0 }}>通知センター</h1>
          <p style={{ margin: "6px 0 0", fontSize: 13, color: "var(--muted)" }}>
            未読、確認中、対応済みを切り替えながら、次に動くべき通知を優先度順に確認できます。
          </p>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <Link href="/help/notifications" style={{ textDecoration: "none", ...cardStyle, padding: "8px 12px", fontWeight: 700, color: "var(--text)" }}>
            使い方
          </Link>
          <button
            type="button"
            onClick={() => void markAllRead()}
            disabled={working || unreadCount === 0}
            style={{ border: "1px solid var(--border)", borderRadius: 8, background: unreadCount > 0 ? "var(--surface-2)" : "var(--surface)", color: "var(--text)", padding: "8px 12px", fontSize: 13, fontWeight: 700, cursor: working || unreadCount === 0 ? "not-allowed" : "pointer" }}
          >
            すべて既読にする ({unreadCount})
          </button>
        </div>
      </div>

      <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
        {(
          [
            { key: "unread" as const, label: `未読 (${unreadCount})` },
            { key: "read_pending" as const, label: `既読・未対応 (${readPendingCount})` },
            { key: "read_done" as const, label: `既読・対応済み (${readDoneCount})` },
            { key: "all" as const, label: `すべて (${list.length})` },
          ] as const
        ).map(({ key, label }) => {
          const active = filter === key
          return (
            <button
              key={key}
              type="button"
              onClick={() => setFilter(key)}
              style={{ border: "1px solid var(--border)", borderRadius: 999, padding: "8px 12px", background: active ? "var(--button-primary-bg)" : "var(--surface)", color: active ? "var(--primary-contrast)" : "var(--text)", fontSize: 13, fontWeight: 700, cursor: "pointer" }}
            >
              {label}
            </button>
          )
        })}
      </div>

      {error ? (
        <div style={{ ...cardStyle, borderColor: "var(--error-border)", background: "var(--error-bg)", color: "var(--error-text)", marginBottom: 16, fontSize: 13 }}>
          {error}
        </div>
      ) : null}

      {authLoading || loading ? (
        <p style={{ color: "var(--muted)" }}>通知を読み込み中...</p>
      ) : filtered.length === 0 ? (
        <GuideEmptyState
          title="まだ通知はありません"
          description="承認、請求、外注提出、参加申請などの対応が必要になると、この画面に通知が並びます。"
          primaryHref="/help/notifications"
          primaryLabel="通知の使い方を見る"
          helpHref="/home"
          helpLabel="Home に戻る"
        />
      ) : (
        <div style={{ display: "grid", gap: 10 }}>
          {filtered.map((n) => {
            const normalizedType = normalizeNotificationType(n.type)
            const joinRequestId = typeof n.payload?.join_request_id === "string" ? n.payload.join_request_id : null
            const resolved = notificationResolved(n)
            const isMembershipRequested = normalizedType === "membership.requested"
            const canHandleMembership = canManageMembership && isMembershipRequested && !!joinRequestId && !resolved
            const showResolveButton = !resolved && !isMembershipRequested
            const href = notificationActionHref(n)
            const severity = notificationSeverity(n)

            return (
              <div key={n.id} style={{ ...cardStyle, borderColor: !n.read_at ? "#c4b5fd" : "var(--border)", boxShadow: !n.read_at ? "var(--shadow-sm)" : undefined }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "flex-start", flexWrap: "wrap" }}>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", marginBottom: 4 }}>
                      <span style={{ fontSize: 10, borderRadius: 999, padding: "2px 6px", background: severity.bg, color: severity.text, fontWeight: 700 }}>
                        {severity.label}
                      </span>
                      {!n.read_at ? (
                        <span style={{ fontSize: 10, borderRadius: 999, padding: "2px 6px", background: "#ede9fe", color: "#6d28d9", fontWeight: 700 }}>
                          未読
                        </span>
                      ) : null}
                      {resolved ? (
                        <span style={{ fontSize: 10, borderRadius: 999, padding: "2px 6px", background: "var(--success-bg)", color: "var(--success-text)", fontWeight: 700 }}>
                          対応済み
                        </span>
                      ) : null}
                      <span style={{ fontSize: 12, color: "var(--muted)" }}>{formatTimeAgo(n.created_at)}</span>
                    </div>

                    <div style={{ fontSize: 16, fontWeight: 700, color: "var(--text)", marginBottom: 6 }}>{notificationTitle(n)}</div>

                    <div style={{ fontSize: 13, color: "var(--muted)", lineHeight: 1.7 }}>
                      通知種別: {normalizedType}
                    </div>
                  </div>

                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
                    {!n.read_at ? (
                      <button type="button" onClick={() => void markRead(n.id)} disabled={working} style={actionButtonStyle}>
                        既読にする
                      </button>
                    ) : null}

                    {href ? (
                      <Link
                        href={href}
                        onClick={() => {
                          void trackClientEvent("notification.clicked", {
                            metadata: {
                              notification_id: n.id,
                              notification_type: normalizedType,
                              action_href: href,
                            },
                          })
                        }}
                        style={{ ...actionButtonStyle, textDecoration: "none" }}
                      >
                        対応する
                      </Link>
                    ) : null}

                    {showResolveButton ? (
                      <button type="button" onClick={() => void markResolved(n.id)} disabled={working} style={actionButtonStyle}>
                        対応済みにする
                      </button>
                    ) : null}
                  </div>
                </div>

                {canHandleMembership ? (
                  <div style={{ marginTop: 14, paddingTop: 14, borderTop: "1px solid var(--border)", display: "grid", gap: 10 }}>
                    <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
                      <label style={{ display: "grid", gap: 4 }}>
                        <span style={{ fontSize: 12, color: "var(--muted)" }}>参加後ロール</span>
                        <select
                          value={selectedRole[joinRequestId] ?? "member"}
                          onChange={(event) =>
                            setSelectedRole((prev) => ({
                              ...prev,
                              [joinRequestId]: event.target.value as "member" | "executive_assistant",
                            }))
                          }
                          style={{ border: "1px solid var(--border)", borderRadius: 8, padding: "8px 10px", background: "var(--surface)" }}
                        >
                          <option value="member">メンバー</option>
                          <option value="executive_assistant">経営補佐</option>
                        </select>
                      </label>
                    </div>
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                      <button type="button" onClick={() => void handleApproveMembership(joinRequestId)} disabled={working} style={actionButtonStyle}>
                        参加承認
                      </button>
                      <button type="button" onClick={() => void handleRejectMembership(joinRequestId)} disabled={working} style={actionButtonStyle}>
                        却下
                      </button>
                    </div>
                  </div>
                ) : null}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

const actionButtonStyle: CSSProperties = {
  border: "1px solid var(--border)",
  borderRadius: 8,
  background: "var(--surface-2)",
  color: "var(--text)",
  padding: "8px 12px",
  fontSize: 13,
  fontWeight: 700,
  cursor: "pointer",
}
