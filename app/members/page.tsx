"use client"

import { useCallback, useEffect, useMemo, useState, type CSSProperties } from "react"
import Link from "next/link"
import { supabase } from "@/lib/supabase"
import { useAuthOrg } from "@/hooks/useAuthOrg"

type MemberRow = {
  userId: string
  displayName?: string
  email?: string
  role: string
  status: string
}

type RequestRow = {
  id: string
  requesterUserId: string
  requesterEmail?: string
  message?: string
  requestedRole?: string
  requestedDisplayName?: string
  createdAt: string
}

type InviteRow = {
  id: string
  email: string
  role_key: string
  token: string
  expires_at: string
  created_at: string
}

type TabKey = "members" | "requests" | "invites"

const ROLE_LABELS: Record<string, string> = {
  owner: "オーナー",
  executive_assistant: "経営補佐",
  member: "メンバー",
}

const ROLE_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  owner: { bg: "rgba(99, 102, 241, 0.10)", text: "var(--primary)", border: "rgba(99, 102, 241, 0.25)" },
  executive_assistant: { bg: "rgba(16, 185, 129, 0.10)", text: "#059669", border: "rgba(16, 185, 129, 0.25)" },
  member: { bg: "rgba(148, 163, 184, 0.10)", text: "var(--muted)", border: "rgba(148, 163, 184, 0.25)" },
}

const INVITE_ROLE_OPTIONS = [
  { key: "executive_assistant", label: "経営補佐" },
  { key: "member", label: "メンバー" },
] as const

const cardStyle: CSSProperties = {
  border: "1px solid var(--border)",
  borderRadius: 16,
  padding: 20,
  background: "var(--surface)",
  boxShadow: "var(--shadow-sm)",
}

const inputStyle: CSSProperties = {
  padding: "10px 12px",
  borderRadius: 10,
  border: "1px solid var(--input-border)",
  background: "var(--input-bg)",
  color: "var(--text)",
  fontSize: 14,
  outline: "none",
  width: "100%",
}

const btnPrimary: CSSProperties = {
  padding: "10px 16px",
  borderRadius: 10,
  border: "none",
  background: "var(--button-primary-bg)",
  color: "var(--primary-contrast)",
  fontWeight: 700,
  fontSize: 14,
  cursor: "pointer",
  whiteSpace: "nowrap",
}

const btnOutline: CSSProperties = {
  padding: "8px 12px",
  borderRadius: 10,
  border: "1px solid var(--border)",
  background: "var(--surface-2)",
  color: "var(--text)",
  fontWeight: 600,
  fontSize: 13,
  cursor: "pointer",
  whiteSpace: "nowrap",
}

function avatarColor(name: string) {
  const colors = [
    "#6366f1", "#8b5cf6", "#a78bfa", "#7c3aed",
    "#ec4899", "#f43f5e", "#10b981", "#14b8a6",
    "#f59e0b", "#ef4444", "#3b82f6", "#06b6d4",
  ]
  let hash = 0
  for (const ch of name) hash = ch.charCodeAt(0) + ((hash << 5) - hash)
  return colors[Math.abs(hash) % colors.length]
}

function Avatar({ name, size = 40 }: { name: string; size?: number }) {
  const initial = (name || "?").charAt(0).toUpperCase()
  const bg = avatarColor(name)
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: size,
        background: bg,
        color: "#fff",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontWeight: 700,
        fontSize: size * 0.42,
        flexShrink: 0,
      }}
    >
      {initial}
    </div>
  )
}

function RoleBadge({ role }: { role: string }) {
  const colors = ROLE_COLORS[role] ?? ROLE_COLORS.member
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        padding: "3px 10px",
        borderRadius: 999,
        fontSize: 12,
        fontWeight: 700,
        background: colors.bg,
        color: colors.text,
        border: `1px solid ${colors.border}`,
      }}
    >
      {ROLE_LABELS[role] ?? role}
    </span>
  )
}

function StatusDot({ status }: { status: string }) {
  const active = status === "active"
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        fontSize: 12,
        color: active ? "var(--success-text)" : "var(--muted)",
      }}
    >
      <span
        style={{
          width: 8,
          height: 8,
          borderRadius: 8,
          background: active ? "var(--success-text)" : "var(--muted)",
          opacity: active ? 1 : 0.5,
        }}
      />
      {active ? "アクティブ" : "非アクティブ"}
    </span>
  )
}

export default function MembersPage() {
  const { activeOrgId, role, user, loading: authLoading, needsOnboarding } = useAuthOrg({ redirectToOnboarding: true })
  const [members, setMembers] = useState<MemberRow[]>([])
  const [requests, setRequests] = useState<RequestRow[]>([])
  const [invites, setInvites] = useState<InviteRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [search, setSearch] = useState("")
  const [tab, setTab] = useState<TabKey>("members")
  const [inviteEmail, setInviteEmail] = useState("")
  const [inviteRoleKey, setInviteRoleKey] = useState("member")
  const [approveRole, setApproveRole] = useState<Record<string, string>>({})
  const [busyKey, setBusyKey] = useState<string | null>(null)

  const canEdit = role === "owner" || role === "executive_assistant"

  const getToken = useCallback(async () => {
    const { data } = await supabase.auth.getSession()
    return data.session?.access_token ?? null
  }, [])

  const callApi = useCallback(
    async (path: string, init?: RequestInit) => {
      const token = await getToken()
      if (!token) throw new Error("ログインし直してください。")
      const res = await fetch(path, {
        ...init,
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, ...(init?.headers ?? {}) },
      })
      const json = await res.json().catch(() => null)
      if (!res.ok) throw new Error(json?.error ?? "通信に失敗しました。")
      return json
    },
    [getToken]
  )

  const fetchMembers = useCallback(async () => {
    if (!activeOrgId) return
    const json = await callApi(`/api/org/members?orgId=${encodeURIComponent(activeOrgId)}`)
    setMembers(Array.isArray(json?.members) ? json.members : [])
  }, [activeOrgId, callApi])

  const fetchRequests = useCallback(async () => {
    if (!activeOrgId || !canEdit) { setRequests([]); return }
    const json = await callApi(`/api/org/requests?orgId=${encodeURIComponent(activeOrgId)}`)
    setRequests(Array.isArray(json?.requests) ? json.requests : [])
  }, [activeOrgId, canEdit, callApi])

  const fetchInvites = useCallback(async () => {
    if (!activeOrgId || !canEdit) { setInvites([]); return }
    const json = await callApi(`/api/org/invites?orgId=${encodeURIComponent(activeOrgId)}`)
    setInvites(Array.isArray(json?.invites) ? json.invites : [])
  }, [activeOrgId, canEdit, callApi])

  const reloadAll = useCallback(async () => {
    if (!activeOrgId || authLoading || needsOnboarding) { setLoading(false); return }
    setError(null)
    setLoading(true)
    try {
      await Promise.all([fetchMembers(), fetchRequests(), fetchInvites()])
    } catch (e) {
      setError(e instanceof Error ? e.message : "読み込みに失敗しました。")
    } finally {
      setLoading(false)
    }
  }, [activeOrgId, authLoading, needsOnboarding, fetchMembers, fetchRequests, fetchInvites])

  useEffect(() => { void reloadAll() }, [reloadAll])

  useEffect(() => {
    if (!success) return
    const t = setTimeout(() => setSuccess(null), 2500)
    return () => clearTimeout(t)
  }, [success])

  const handleInvite = async () => {
    if (!canEdit || !activeOrgId || !inviteEmail.trim()) return
    setBusyKey("invite")
    setError(null)
    try {
      await callApi("/api/org/invites/create", {
        method: "POST",
        body: JSON.stringify({ orgId: activeOrgId, email: inviteEmail.trim(), roleKey: inviteRoleKey }),
      })
      setSuccess("招待を送信しました。")
      setInviteEmail("")
      await fetchInvites()
    } catch (e) {
      setError(e instanceof Error ? e.message : "招待に失敗しました。")
    } finally {
      setBusyKey(null)
    }
  }

  const handleChangeRole = async (userId: string, newRole: string) => {
    if (!canEdit || !activeOrgId) return
    const m = members.find((x) => x.userId === userId)
    if (!m || m.role === "owner") { setError("オーナーのロールは変更できません。"); return }
    setBusyKey(`role:${userId}`)
    setError(null)
    try {
      await callApi("/api/org/members/update-role", {
        method: "POST",
        body: JSON.stringify({ orgId: activeOrgId, userId, role: newRole }),
      })
      setSuccess("ロールを更新しました。")
      await fetchMembers()
    } catch (e) {
      setError(e instanceof Error ? e.message : "ロール変更に失敗しました。")
    } finally {
      setBusyKey(null)
    }
  }

  const handleRemoveMember = async (userId: string) => {
    if (!canEdit || !activeOrgId) return
    const m = members.find((x) => x.userId === userId)
    if (!m || m.role === "owner") { setError("オーナーは削除できません。"); return }
    if (!window.confirm(`${m.displayName || m.email || "このメンバー"} をワークスペースから削除しますか？`)) return
    setBusyKey(`remove:${userId}`)
    setError(null)
    try {
      const { error: delErr } = await supabase.from("app_users").delete().eq("user_id", userId).eq("org_id", activeOrgId)
      if (delErr) throw delErr
      setSuccess("メンバーを削除しました。")
      await fetchMembers()
    } catch (e) {
      setError(e instanceof Error ? e.message : "削除に失敗しました。")
    } finally {
      setBusyKey(null)
    }
  }

  const handleApprove = async (requestId: string) => {
    if (!canEdit) return
    setBusyKey(`approve:${requestId}`)
    setError(null)
    try {
      await callApi("/api/org/requests/approve", {
        method: "POST",
        body: JSON.stringify({ requestId, roleKey: approveRole[requestId] ?? "member" }),
      })
      setSuccess("参加申請を承認しました。")
      await Promise.all([fetchRequests(), fetchMembers()])
    } catch (e) {
      setError(e instanceof Error ? e.message : "承認に失敗しました。")
    } finally {
      setBusyKey(null)
    }
  }

  const handleRevokeInvite = async (inviteId: string) => {
    if (!canEdit || !activeOrgId) return
    setBusyKey(`revoke:${inviteId}`)
    setError(null)
    try {
      const { error: delErr } = await supabase.from("org_invites").delete().eq("id", inviteId).eq("org_id", activeOrgId)
      if (delErr) throw delErr
      setSuccess("招待を取り消しました。")
      await fetchInvites()
    } catch (e) {
      setError(e instanceof Error ? e.message : "取り消しに失敗しました。")
    } finally {
      setBusyKey(null)
    }
  }

  const filteredMembers = useMemo(() => {
    if (!search.trim()) return members
    const q = search.toLowerCase()
    return members.filter(
      (m) =>
        (m.displayName ?? "").toLowerCase().includes(q) ||
        (m.email ?? "").toLowerCase().includes(q) ||
        (ROLE_LABELS[m.role] ?? m.role).toLowerCase().includes(q)
    )
  }, [members, search])

  const summary = useMemo(() => {
    const roleCount: Record<string, number> = {}
    for (const m of members) {
      roleCount[m.role] = (roleCount[m.role] ?? 0) + 1
    }
    return { total: members.length, roles: roleCount, active: members.filter((m) => m.status === "active").length }
  }, [members])

  if (authLoading || loading) {
    return <div style={{ padding: 32, color: "var(--muted)" }}>読み込み中...</div>
  }
  if (!activeOrgId) {
    return <div style={{ padding: 32, color: "var(--muted)" }}>ワークスペースを選択してください。</div>
  }

  const tabs: { key: TabKey; label: string; count?: number }[] = [
    { key: "members", label: "メンバー", count: members.length },
    ...(canEdit ? [{ key: "requests" as TabKey, label: "参加申請", count: requests.length }] : []),
    ...(canEdit ? [{ key: "invites" as TabKey, label: "招待", count: invites.length }] : []),
  ]

  return (
    <div style={{ minHeight: "100vh", background: "var(--bg-grad)", padding: "32px 40px 60px" }}>
      <div style={{ maxWidth: 1100, margin: "0 auto", display: "grid", gap: 20 }}>
        {/* Header */}
        <header style={{ display: "flex", justifyContent: "space-between", alignItems: "end", gap: 16, flexWrap: "wrap" }}>
          <div>
            <p style={{ margin: 0, fontSize: 12, letterSpacing: "0.08em", color: "var(--muted)" }}>MEMBERS</p>
            <h1 style={{ margin: "6px 0 8px", fontSize: 30, color: "var(--text)" }}>メンバー</h1>
            <p style={{ margin: 0, color: "var(--muted)", fontSize: 14 }}>
              ワークスペースに所属するメンバーの確認・招待・ロール管理を行います。
            </p>
          </div>
          {role && <RoleBadge role={role} />}
        </header>

        {/* Summary cards */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12 }}>
          <SummaryCard label="メンバー数" value={String(summary.total)} />
          <SummaryCard label="アクティブ" value={String(summary.active)} accent={summary.active === summary.total ? "var(--success-text)" : undefined} />
          {Object.entries(summary.roles).map(([r, c]) => (
            <SummaryCard key={r} label={ROLE_LABELS[r] ?? r} value={String(c)} />
          ))}
          {canEdit && requests.length > 0 && (
            <SummaryCard label="承認待ち" value={String(requests.length)} accent="var(--warning-text)" />
          )}
        </div>

        {/* Alerts */}
        {error && <div style={{ ...cardStyle, borderColor: "#fecaca", background: "#fff1f2", color: "#b91c1c", padding: 14 }}>{error}</div>}
        {success && <div style={{ ...cardStyle, borderColor: "#bbf7d0", background: "#f0fdf4", color: "#166534", padding: 14 }}>{success}</div>}

        {/* Tabs */}
        <div style={{ display: "flex", gap: 4, padding: 4, borderRadius: 14, background: "rgba(15, 23, 42, 0.06)", width: "fit-content" }}>
          {tabs.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              style={{
                padding: "8px 18px",
                borderRadius: 10,
                fontSize: 14,
                fontWeight: 600,
                border: "none",
                cursor: "pointer",
                color: tab === t.key ? "var(--text)" : "var(--muted)",
                background: tab === t.key ? "var(--surface)" : "transparent",
                boxShadow: tab === t.key ? "0 1px 3px rgba(15, 23, 42, 0.08)" : "none",
                display: "flex",
                alignItems: "center",
                gap: 6,
              }}
            >
              {t.label}
              {(t.count ?? 0) > 0 && (
                <span style={{ fontSize: 11, background: tab === t.key ? "var(--primary)" : "var(--border)", color: tab === t.key ? "#fff" : "var(--muted)", borderRadius: 99, padding: "1px 7px", fontWeight: 700 }}>
                  {t.count}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* Members Tab */}
        {tab === "members" && (
          <section style={{ ...cardStyle, display: "grid", gap: 16 }}>
            {/* Search + Invite */}
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
              <div style={{ flex: "1 1 260px", position: "relative" }}>
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="名前・メール・ロールで検索"
                  style={inputStyle}
                />
              </div>
              {canEdit && (
                <Link href="/settings/members" style={{ ...btnOutline, textDecoration: "none" }}>
                  設定で管理
                </Link>
              )}
            </div>

            {/* Member list */}
            <div style={{ display: "grid", gap: 2 }}>
              {filteredMembers.length === 0 ? (
                <p style={{ color: "var(--muted)", padding: "20px 0", textAlign: "center" }}>条件に合うメンバーはいません。</p>
              ) : (
                filteredMembers.map((m) => {
                  const isYou = m.userId === user?.id
                  const name = m.displayName || m.email || m.userId
                  return (
                    <div
                      key={m.userId}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 14,
                        padding: "14px 12px",
                        borderRadius: 12,
                        transition: "background 0.1s",
                      }}
                      onMouseEnter={(e) => { (e.currentTarget as HTMLDivElement).style.background = "rgba(99, 102, 241, 0.04)" }}
                      onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.background = "transparent" }}
                    >
                      <Avatar name={name} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                          <span style={{ fontWeight: 600, fontSize: 15, color: "var(--text)" }}>
                            {m.displayName || "(未設定)"}
                          </span>
                          {isYou && (
                            <span style={{ fontSize: 11, background: "var(--primary)", color: "#fff", borderRadius: 99, padding: "1px 8px", fontWeight: 700 }}>
                              あなた
                            </span>
                          )}
                          <RoleBadge role={m.role} />
                          <StatusDot status={m.status} />
                        </div>
                        {m.email && (
                          <p style={{ margin: "3px 0 0", fontSize: 13, color: "var(--muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {m.email}
                          </p>
                        )}
                      </div>
                      {canEdit && m.role !== "owner" && !isYou && (
                        <div style={{ display: "flex", gap: 6, alignItems: "center", flexShrink: 0 }}>
                          <select
                            value={m.role}
                            onChange={(e) => void handleChangeRole(m.userId, e.target.value)}
                            disabled={busyKey === `role:${m.userId}`}
                            style={{ ...inputStyle, width: "auto", fontSize: 13, padding: "6px 10px" }}
                          >
                            <option value="executive_assistant">経営補佐</option>
                            <option value="member">メンバー</option>
                          </select>
                          <button
                            type="button"
                            onClick={() => void handleRemoveMember(m.userId)}
                            disabled={busyKey === `remove:${m.userId}`}
                            style={{ ...btnOutline, color: "var(--error-text)", borderColor: "rgba(239, 68, 68, 0.3)", padding: "6px 10px", fontSize: 12 }}
                          >
                            削除
                          </button>
                        </div>
                      )}
                    </div>
                  )
                })
              )}
            </div>
          </section>
        )}

        {/* Requests Tab */}
        {tab === "requests" && canEdit && (
          <section style={{ ...cardStyle, display: "grid", gap: 16 }}>
            <h2 style={{ margin: 0, fontSize: 18, color: "var(--text)" }}>参加申請</h2>
            {requests.length === 0 ? (
              <p style={{ color: "var(--muted)" }}>承認待ちの申請はありません。</p>
            ) : (
              <div style={{ display: "grid", gap: 10 }}>
                {requests.map((r) => (
                  <div key={r.id} style={{ display: "flex", alignItems: "center", gap: 14, padding: "14px 12px", borderRadius: 12, border: "1px solid var(--border)" }}>
                    <Avatar name={r.requestedDisplayName || r.requesterEmail || "?"} size={36} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 600, color: "var(--text)" }}>{r.requestedDisplayName || r.requesterEmail || r.requesterUserId}</div>
                      {r.requesterEmail && <p style={{ margin: "2px 0 0", fontSize: 13, color: "var(--muted)" }}>{r.requesterEmail}</p>}
                      {r.message && <p style={{ margin: "4px 0 0", fontSize: 13, color: "var(--muted)", fontStyle: "italic" }}>&quot;{r.message}&quot;</p>}
                    </div>
                    <div style={{ display: "flex", gap: 6, alignItems: "center", flexShrink: 0 }}>
                      <select
                        value={approveRole[r.id] ?? "member"}
                        onChange={(e) => setApproveRole((prev) => ({ ...prev, [r.id]: e.target.value }))}
                        style={{ ...inputStyle, width: "auto", fontSize: 13, padding: "6px 10px" }}
                      >
                        {INVITE_ROLE_OPTIONS.map((opt) => <option key={opt.key} value={opt.key}>{opt.label}</option>)}
                      </select>
                      <button type="button" onClick={() => void handleApprove(r.id)} disabled={busyKey === `approve:${r.id}`} style={{ ...btnPrimary, padding: "6px 14px", fontSize: 13 }}>
                        承認
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        )}

        {/* Invites Tab */}
        {tab === "invites" && canEdit && (
          <section style={{ ...cardStyle, display: "grid", gap: 16 }}>
            <h2 style={{ margin: 0, fontSize: 18, color: "var(--text)" }}>招待</h2>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "end" }}>
              <div style={{ flex: "1 1 240px" }}>
                <label style={{ fontSize: 13, color: "var(--muted)", marginBottom: 4, display: "block" }}>メールアドレス</label>
                <input value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)} placeholder="name@example.com" style={inputStyle} />
              </div>
              <div>
                <label style={{ fontSize: 13, color: "var(--muted)", marginBottom: 4, display: "block" }}>ロール</label>
                <select value={inviteRoleKey} onChange={(e) => setInviteRoleKey(e.target.value)} style={{ ...inputStyle, width: "auto" }}>
                  {INVITE_ROLE_OPTIONS.map((opt) => <option key={opt.key} value={opt.key}>{opt.label}</option>)}
                </select>
              </div>
              <button type="button" onClick={() => void handleInvite()} disabled={busyKey === "invite" || !inviteEmail.trim()} style={{ ...btnPrimary, opacity: !inviteEmail.trim() ? 0.5 : 1 }}>
                {busyKey === "invite" ? "送信中..." : "招待する"}
              </button>
            </div>

            {invites.length > 0 && (
              <div style={{ display: "grid", gap: 8 }}>
                <p style={{ margin: 0, fontSize: 13, color: "var(--muted)" }}>送信済みの招待</p>
                {invites.map((inv) => {
                  const expired = new Date(inv.expires_at) < new Date()
                  return (
                    <div key={inv.id} style={{ display: "flex", alignItems: "center", gap: 14, padding: "12px", borderRadius: 12, border: "1px solid var(--border)", opacity: expired ? 0.5 : 1 }}>
                      <Avatar name={inv.email} size={32} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <span style={{ fontWeight: 600, fontSize: 14, color: "var(--text)" }}>{inv.email}</span>
                        <div style={{ display: "flex", gap: 8, marginTop: 2, fontSize: 12, color: "var(--muted)" }}>
                          <span>{ROLE_LABELS[inv.role_key] ?? inv.role_key}</span>
                          <span>{expired ? "期限切れ" : `${inv.expires_at.slice(0, 10)} まで`}</span>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => void handleRevokeInvite(inv.id)}
                        disabled={busyKey === `revoke:${inv.id}`}
                        style={{ ...btnOutline, fontSize: 12, padding: "5px 10px" }}
                      >
                        取消
                      </button>
                    </div>
                  )
                })}
              </div>
            )}
          </section>
        )}
      </div>
    </div>
  )
}

function SummaryCard({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div style={{ ...cardStyle, padding: "14px 16px", display: "grid", gap: 4 }}>
      <span style={{ fontSize: 12, color: "var(--muted)", fontWeight: 600 }}>{label}</span>
      <span style={{ fontSize: 22, fontWeight: 700, color: accent ?? "var(--text)" }}>{value}</span>
    </div>
  )
}
