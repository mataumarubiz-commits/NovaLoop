
"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { supabase } from "@/lib/supabase"
import { useAuthOrg } from "@/hooks/useAuthOrg"
import { hasOrgPermission } from "@/lib/orgRolePermissions"

type TabKey = "members" | "requests" | "invites"

type MemberRow = {
  userId: string
  displayName?: string
  email?: string
  role: string
  roleId?: string
  status: string
}

type OrgRoleOption = {
  id: string
  key: string
  name: string
  is_system: boolean
}

type RequestRow = {
  id: string
  requesterUserId: string
  requesterEmail?: string
  message?: string
  requestedRole?: string
  requestedRoleId?: string
  requestedDisplayName?: string
  createdAt: string
}

type InviteRow = {
  id: string
  email: string
  role_key: string
  role_id?: string
  token: string
  expires_at: string
  created_at: string
}

const cardStyle: React.CSSProperties = {
  background: "var(--surface)",
  border: "1px solid var(--border)",
  borderRadius: 16,
  padding: 24,
}

const avatarStyle: React.CSSProperties = {
  width: 36,
  height: 36,
  borderRadius: "50%",
  background: "color-mix(in srgb, var(--primary) 14%, var(--surface-2))",
  color: "var(--primary)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  fontWeight: 700,
  fontSize: 14,
  flexShrink: 0,
}

const badgeStyle = (variant: "default" | "success" | "warning" | "muted" = "default"): React.CSSProperties => {
  const colors: Record<string, { bg: string; text: string; border: string }> = {
    default: { bg: "color-mix(in srgb, var(--primary) 10%, var(--surface))", text: "var(--primary)", border: "color-mix(in srgb, var(--primary) 20%, var(--border))" },
    success: { bg: "var(--success-bg)", text: "var(--success-text)", border: "var(--success-border)" },
    warning: { bg: "color-mix(in srgb, orange 10%, var(--surface))", text: "color-mix(in srgb, orange 70%, var(--text))", border: "color-mix(in srgb, orange 25%, var(--border))" },
    muted: { bg: "var(--surface-2)", text: "var(--muted)", border: "var(--border)" },
  }
  const c = colors[variant] ?? colors.default
  return {
    display: "inline-flex",
    alignItems: "center",
    padding: "3px 10px",
    borderRadius: 999,
    fontSize: 12,
    fontWeight: 600,
    background: c.bg,
    color: c.text,
    border: `1px solid ${c.border}`,
    whiteSpace: "nowrap",
  }
}

const initials = (name?: string, email?: string): string => {
  const src = name || email || "?"
  return src.slice(0, 1).toUpperCase()
}

export default function MembersSettingsPage() {
  const { activeOrgId, role, permissions, loading: authLoading, needsOnboarding } = useAuthOrg({ redirectToOnboarding: true })
  const [tab, setTab] = useState<TabKey>("members")
  const [members, setMembers] = useState<MemberRow[]>([])
  const [requests, setRequests] = useState<RequestRow[]>([])
  const [invites, setInvites] = useState<InviteRow[]>([])
  const [roleOptions, setRoleOptions] = useState<OrgRoleOption[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [inviteEmail, setInviteEmail] = useState("")
  const [inviteRoleKey, setInviteRoleKey] = useState("")
  const [approveRole, setApproveRole] = useState<Record<string, string>>({})
  const [busyKey, setBusyKey] = useState<string | null>(null)
  const [showRoleGuide, setShowRoleGuide] = useState(false)

  const canEdit = hasOrgPermission(role, permissions, "members_manage")

  const getToken = useCallback(async () => {
    const { data } = await supabase.auth.getSession()
    return data.session?.access_token ?? null
  }, [])

  const callApi = useCallback(
    async (path: string, init?: RequestInit) => {
      const token = await getToken()
      if (!token) {
        throw new Error("ログインし直してからもう一度お試しください。")
      }
      const res = await fetch(path, {
        ...init,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
          ...(init?.headers ?? {}),
        },
      })
      const json = await res.json().catch(() => null)
      if (!res.ok) {
        throw new Error(json?.error ?? json?.message ?? "通信に失敗しました。")
      }
      return json
    },
    [getToken]
  )

  const fetchMembers = useCallback(async () => {
    if (!activeOrgId) return
    const json = await callApi(`/api/org/members?orgId=${encodeURIComponent(activeOrgId)}`)
    setMembers(Array.isArray(json?.members) ? json.members : [])
  }, [activeOrgId, callApi])

  const fetchRoleOptions = useCallback(async () => {
    if (!activeOrgId) return
    const { data, error: fetchError } = await supabase
      .from("org_roles")
      .select("id, key, name, is_system")
      .eq("org_id", activeOrgId)
      .order("sort_order", { ascending: true })

    if (fetchError) {
      setRoleOptions([])
      return
    }

    setRoleOptions((data ?? []) as OrgRoleOption[])
  }, [activeOrgId])

  const fetchRequests = useCallback(async () => {
    if (!activeOrgId || !canEdit) {
      setRequests([])
      return
    }
    const json = await callApi(`/api/org/requests?orgId=${encodeURIComponent(activeOrgId)}`)
    setRequests(Array.isArray(json?.requests) ? json.requests : [])
  }, [activeOrgId, canEdit, callApi])

  const fetchInvites = useCallback(async () => {
    if (!activeOrgId || !canEdit) {
      setInvites([])
      return
    }
    const json = await callApi(`/api/org/invites?orgId=${encodeURIComponent(activeOrgId)}`)
    setInvites(Array.isArray(json?.invites) ? json.invites : [])
  }, [activeOrgId, canEdit, callApi])

  const reloadAll = useCallback(async () => {
    if (!activeOrgId || authLoading || needsOnboarding) {
      setLoading(false)
      return
    }
    setError(null)
    setLoading(true)
    try {
      await Promise.all([fetchMembers(), fetchRequests(), fetchInvites(), fetchRoleOptions()])
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "読み込みに失敗しました。")
    } finally {
      setLoading(false)
    }
  }, [activeOrgId, authLoading, needsOnboarding, fetchMembers, fetchRequests, fetchInvites, fetchRoleOptions])

  useEffect(() => {
    void reloadAll()
  }, [reloadAll])

  useEffect(() => {
    if (!success) return
    const timer = setTimeout(() => setSuccess(null), 2500)
    return () => clearTimeout(timer)
  }, [success])

  useEffect(() => {
    if (!inviteRoleKey && roleOptions.length > 0) {
      setInviteRoleKey(roleOptions.find((item) => item.key === "member")?.id ?? roleOptions[0]?.id ?? "")
    }
  }, [inviteRoleKey, roleOptions])

  const roleLabel = useMemo(() => {
    const map = new Map<string, string>()
    for (const option of roleOptions) {
      map.set(option.id, option.name)
      map.set(option.key, option.name)
    }
    return map
  }, [roleOptions])

  const handleChangeRole = async (userId: string, nextRoleId: string) => {
    if (!canEdit || !activeOrgId) return
    const member = members.find((item) => item.userId === userId)
    if (!member || member.role === "owner") {
      setError("オーナーのロールは変更できません。")
      return
    }
    setBusyKey(`role:${userId}`)
    setError(null)
    try {
      await callApi("/api/org/members/update-role", {
        method: "POST",
        body: JSON.stringify({ orgId: activeOrgId, userId, roleId: nextRoleId }),
      })
      setSuccess("ロールを更新しました。")
      await fetchMembers()
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "ロールの変更に失敗しました。")
    } finally {
      setBusyKey(null)
    }
  }

  const handleRemoveMember = async (userId: string) => {
    if (!canEdit || !activeOrgId) return
    const member = members.find((item) => item.userId === userId)
    if (!member || member.role === "owner") {
      setError("オーナーは削除できません。")
      return
    }
    if (typeof window !== "undefined" && !window.confirm("このメンバーをワークスペースから削除しますか？")) return
    setBusyKey(`remove:${userId}`)
    setError(null)
    try {
      const { error: deleteError } = await supabase.from("app_users").delete().eq("user_id", userId).eq("org_id", activeOrgId)
      if (deleteError) throw deleteError
      setSuccess("メンバーを削除しました。")
      await fetchMembers()
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "メンバーの削除に失敗しました。")
    } finally {
      setBusyKey(null)
    }
  }

  const handleApprove = async (requestId: string) => {
    if (!canEdit) return
    const defaultRoleId = roleOptions.find((item) => item.key === "member")?.id ?? ""
    setBusyKey(`approve:${requestId}`)
    setError(null)
    try {
      await callApi("/api/org/requests/approve", {
        method: "POST",
        body: JSON.stringify({ requestId, roleId: approveRole[requestId] ?? defaultRoleId }),
      })
      setSuccess("参加申請を承認しました。")
      await Promise.all([fetchRequests(), fetchMembers()])
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "参加申請の承認に失敗しました。")
    } finally {
      setBusyKey(null)
    }
  }

  const handleReject = async (requestId: string) => {
    if (!canEdit) return
    setBusyKey(`reject:${requestId}`)
    setError(null)
    try {
      await callApi("/api/org/requests/reject", {
        method: "POST",
        body: JSON.stringify({ requestId }),
      })
      setSuccess("参加申請を却下しました。")
      await fetchRequests()
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "参加申請の却下に失敗しました。")
    } finally {
      setBusyKey(null)
    }
  }

  const handleCreateInvite = async () => {
    if (!canEdit || !activeOrgId || !inviteEmail.trim()) return
    setBusyKey("invite:create")
    setError(null)
    try {
      const json = await callApi("/api/org/invites/create", {
        method: "POST",
        body: JSON.stringify({ orgId: activeOrgId, email: inviteEmail.trim(), roleId: inviteRoleKey }),
      })
      setInviteEmail("")
      setInviteRoleKey(roleOptions.find((item) => item.key === "member")?.id ?? roleOptions[0]?.id ?? "")
      setSuccess("招待リンクを作成しました。")
      if (json?.inviteLink && typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(json.inviteLink)
        setSuccess("招待リンクを作成し、クリップボードにコピーしました。")
      }
      await fetchInvites()
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "招待の作成に失敗しました。")
    } finally {
      setBusyKey(null)
    }
  }

  const handleCancelInvite = async (inviteId: string) => {
    setBusyKey(`invite:cancel:${inviteId}`)
    setError(null)
    try {
      await callApi("/api/org/invites/cancel", { method: "POST", body: JSON.stringify({ inviteId }) })
      setSuccess("招待を取り消しました。")
      await fetchInvites()
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "招待の取り消しに失敗しました。")
    } finally {
      setBusyKey(null)
    }
  }

  const handleResendInvite = async (inviteId: string) => {
    setBusyKey(`invite:resend:${inviteId}`)
    setError(null)
    try {
      const json = await callApi("/api/org/invites/resend", { method: "POST", body: JSON.stringify({ inviteId }) })
      setSuccess("招待の有効期限を更新しました。")
      if (json?.inviteLink && typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(json.inviteLink)
        setSuccess("招待リンクを更新し、クリップボードにコピーしました。")
      }
      await fetchInvites()
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "招待の再発行に失敗しました。")
    } finally {
      setBusyKey(null)
    }
  }

  if (loading) {
    return <div style={{ padding: 32, color: "var(--muted)" }}>読み込み中...</div>
  }

  if (!activeOrgId || needsOnboarding) {
    return <div style={{ padding: 32, color: "var(--muted)" }}>ワークスペースを作成してからご利用ください。</div>
  }

  const statusBadgeVariant = (status: string): "default" | "success" | "warning" | "muted" => {
    if (status === "active") return "success"
    if (status === "invited" || status === "pending") return "warning"
    return "muted"
  }

  return (
    <div style={{ padding: "32px 40px", minHeight: "100vh", background: "var(--bg-grad)" }}>
      <div style={{ maxWidth: 860, margin: "0 auto", display: "grid", gap: 20 }}>
        {/* ── Header ── */}
        <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
          <div>
            <h1 style={{ margin: 0, fontSize: 24, fontWeight: 700, color: "var(--text)", letterSpacing: "-0.02em" }}>メンバー管理</h1>
            <p style={{ margin: "4px 0 0", color: "var(--muted)", fontSize: 13 }}>
              ワークスペースのメンバー・招待を管理
            </p>
          </div>
          <Link href="/settings" style={{ color: "var(--muted)", fontSize: 13, textDecoration: "none", display: "flex", alignItems: "center", gap: 4 }}>
            &larr; 設定に戻る
          </Link>
        </header>

        {/* ── Collapsible role guide ── */}
        <button
          type="button"
          onClick={() => setShowRoleGuide((v) => !v)}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "10px 16px",
            borderRadius: 12,
            border: "1px solid var(--border)",
            background: "var(--surface)",
            color: "var(--muted)",
            fontSize: 13,
            fontWeight: 500,
            cursor: "pointer",
            textAlign: "left",
            width: "100%",
          }}
        >
          <span style={{ transform: showRoleGuide ? "rotate(90deg)" : "rotate(0deg)", transition: "transform 0.15s", fontSize: 11 }}>&#9654;</span>
          役割の目安を確認する
        </button>
        {showRoleGuide && (
          <section style={{ ...cardStyle, padding: "16px 20px", background: "var(--surface)", borderColor: "var(--border)" }}>
            <div style={{ fontSize: 13, color: "var(--muted)", display: "grid", gap: 6, lineHeight: 1.6 }}>
              <div><strong style={{ color: "var(--text)" }}>オーナー</strong> — 請求・外注・支払い・招待・設定すべてを管理</div>
              <div><strong style={{ color: "var(--text)" }}>経営補佐</strong> — オーナー同等の請求・支払い実務を担当</div>
              <div><strong style={{ color: "var(--text)" }}>メンバー</strong> — 閲覧中心。請求系の更新操作は不可</div>
              <div style={{ marginTop: 4, paddingTop: 8, borderTop: "1px solid var(--border)", fontSize: 12 }}>
                税理士・会計確認者は、更新が必要なら経営補佐、閲覧中心ならメンバー + PDF共有で運用してください。
              </div>
            </div>
          </section>
        )}

        {/* ── Toasts ── */}
        {error && (
          <div style={{ padding: "12px 16px", borderRadius: 12, background: "var(--error-bg)", border: "1px solid var(--error-border)", color: "var(--error-text)", fontSize: 14 }}>
            {error}
          </div>
        )}
        {success && (
          <div style={{ padding: "12px 16px", borderRadius: 12, background: "var(--success-bg)", border: "1px solid var(--success-border)", color: "var(--success-text)", fontSize: 14 }}>
            {success}
          </div>
        )}

        {/* ── Tab bar (underline style) ── */}
        <nav style={{ display: "flex", gap: 0, borderBottom: "1px solid var(--border)" }}>
          {([
            { key: "members" as const, label: "メンバー", count: members.length },
            { key: "requests" as const, label: "申請", count: requests.length },
            { key: "invites" as const, label: "招待", count: invites.length },
          ]).map((item) => {
            const active = tab === item.key
            return (
              <button
                key={item.key}
                type="button"
                onClick={() => setTab(item.key)}
                style={{
                  padding: "12px 20px",
                  border: "none",
                  borderBottom: active ? "2px solid var(--primary)" : "2px solid transparent",
                  background: "transparent",
                  color: active ? "var(--text)" : "var(--muted)",
                  fontWeight: active ? 700 : 500,
                  fontSize: 14,
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  transition: "color 0.15s, border-color 0.15s",
                }}
              >
                {item.label}
                {item.count > 0 && (
                  <span style={{
                    fontSize: 11,
                    fontWeight: 700,
                    padding: "1px 7px",
                    borderRadius: 999,
                    background: active ? "color-mix(in srgb, var(--primary) 14%, var(--surface))" : "var(--surface-2)",
                    color: active ? "var(--primary)" : "var(--muted)",
                  }}>
                    {item.count}
                  </span>
                )}
              </button>
            )
          })}
        </nav>

        {/* ── Members tab ── */}
        {tab === "members" && (
          <section style={{ display: "grid", gap: 0 }}>
            {members.map((member, idx) => (
              <div
                key={member.userId}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 14,
                  padding: "14px 0",
                  borderBottom: idx < members.length - 1 ? "1px solid var(--border)" : "none",
                }}
              >
                <div style={avatarStyle}>{initials(member.displayName, member.email)}</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ color: "var(--text)", fontWeight: 600, fontSize: 14, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {member.displayName || member.email || member.userId}
                  </div>
                  <div style={{ color: "var(--muted)", fontSize: 12, marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {member.email || member.userId}
                  </div>
                </div>
                <span style={badgeStyle(statusBadgeVariant(member.status))}>{member.status}</span>
                <select
                  value={member.roleId ?? roleOptions.find((o) => o.key === member.role)?.id ?? ""}
                  disabled={!canEdit || member.role === "owner" || busyKey === `role:${member.userId}`}
                  onChange={(e) => void handleChangeRole(member.userId, e.target.value)}
                  style={{ padding: "6px 10px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--surface-2)", color: "var(--text)", fontSize: 13 }}
                >
                  {roleOptions.map((o) => (
                    <option key={o.id} value={o.id}>{o.name}</option>
                  ))}
                </select>
                {canEdit && member.role !== "owner" && (
                  <button
                    type="button"
                    disabled={busyKey === `remove:${member.userId}`}
                    onClick={() => void handleRemoveMember(member.userId)}
                    style={{ padding: "6px 10px", borderRadius: 8, border: "1px solid var(--border)", background: "transparent", color: "var(--muted)", fontSize: 13, cursor: "pointer" }}
                    title="メンバーを削除"
                  >
                    削除
                  </button>
                )}
              </div>
            ))}
            {members.length === 0 && (
              <p style={{ margin: 0, padding: "24px 0", color: "var(--muted)", textAlign: "center", fontSize: 14 }}>まだメンバーがいません。</p>
            )}
          </section>
        )}

        {/* ── Requests tab ── */}
        {tab === "requests" && (
          <section style={{ display: "grid", gap: 12 }}>
            {!canEdit && (
              <p style={{ margin: 0, padding: "24px 0", color: "var(--muted)", textAlign: "center", fontSize: 14 }}>参加申請の管理権限を持つロールのみ利用できます。</p>
            )}
            {canEdit && requests.map((request) => (
              <div key={request.id} style={{ ...cardStyle, padding: "16px 20px", display: "flex", alignItems: "flex-start", gap: 14 }}>
                <div style={avatarStyle}>{initials(request.requestedDisplayName, request.requesterEmail)}</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                    <span style={{ color: "var(--text)", fontWeight: 600, fontSize: 14 }}>
                      {request.requestedDisplayName || request.requesterEmail || request.requesterUserId}
                    </span>
                    <span style={badgeStyle("warning")}>申請中</span>
                  </div>
                  <div style={{ color: "var(--muted)", fontSize: 12, marginTop: 4 }}>
                    {new Date(request.createdAt).toLocaleString("ja-JP")}
                  </div>
                  {request.message && (
                    <div style={{ marginTop: 8, padding: "8px 12px", borderRadius: 8, background: "var(--surface-2)", color: "var(--text)", fontSize: 13, lineHeight: 1.5 }}>
                      {request.message}
                    </div>
                  )}
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginTop: 12 }}>
                    <select
                      value={
                        approveRole[request.id] ??
                        request.requestedRoleId ??
                        roleOptions.find((o) => o.key === request.requestedRole)?.id ??
                        roleOptions.find((o) => o.key === "member")?.id ??
                        ""
                      }
                      onChange={(e) => setApproveRole((prev) => ({ ...prev, [request.id]: e.target.value }))}
                      style={{ padding: "6px 10px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--surface-2)", color: "var(--text)", fontSize: 13 }}
                    >
                      {roleOptions.map((o) => (
                        <option key={o.id} value={o.id}>{o.name}</option>
                      ))}
                    </select>
                    <button
                      type="button"
                      disabled={busyKey === `approve:${request.id}`}
                      onClick={() => void handleApprove(request.id)}
                      style={{
                        padding: "6px 16px",
                        borderRadius: 8,
                        border: "1px solid var(--primary)",
                        background: "var(--primary)",
                        color: "#fff",
                        fontWeight: 600,
                        fontSize: 13,
                        cursor: "pointer",
                      }}
                    >
                      承認
                    </button>
                    <button
                      type="button"
                      disabled={busyKey === `reject:${request.id}`}
                      onClick={() => void handleReject(request.id)}
                      style={{
                        padding: "6px 16px",
                        borderRadius: 8,
                        border: "1px solid var(--border)",
                        background: "transparent",
                        color: "var(--muted)",
                        fontWeight: 500,
                        fontSize: 13,
                        cursor: "pointer",
                      }}
                    >
                      却下
                    </button>
                  </div>
                </div>
              </div>
            ))}
            {canEdit && requests.length === 0 && (
              <p style={{ margin: 0, padding: "24px 0", color: "var(--muted)", textAlign: "center", fontSize: 14 }}>未処理の参加申請はありません。</p>
            )}
          </section>
        )}

        {/* ── Invites tab ── */}
        {tab === "invites" && (
          <section style={{ display: "grid", gap: 16 }}>
            {canEdit && (
              <div style={{ ...cardStyle, padding: "16px 20px" }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text)", marginBottom: 10 }}>新しい招待を作成</div>
                <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
                  <input
                    value={inviteEmail}
                    onChange={(e) => setInviteEmail(e.target.value)}
                    placeholder="メールアドレスを入力"
                    style={{ flex: 1, minWidth: 200, padding: "8px 12px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--surface-2)", color: "var(--text)", fontSize: 13 }}
                  />
                  <select
                    value={inviteRoleKey}
                    onChange={(e) => setInviteRoleKey(e.target.value)}
                    style={{ padding: "8px 12px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--surface-2)", color: "var(--text)", fontSize: 13 }}
                  >
                    {roleOptions.map((o) => (
                      <option key={o.id} value={o.id}>{o.name}</option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={() => void handleCreateInvite()}
                    disabled={!inviteEmail.trim() || busyKey === "invite:create"}
                    style={{ padding: "8px 18px", borderRadius: 8, border: "1px solid var(--primary)", background: "var(--primary)", color: "#fff", fontWeight: 600, fontSize: 13, cursor: "pointer" }}
                  >
                    招待を作成
                  </button>
                </div>
              </div>
            )}
            {!canEdit && (
              <p style={{ margin: 0, padding: "24px 0", color: "var(--muted)", textAlign: "center", fontSize: 14 }}>招待リンクの発行は管理者のみ利用できます。</p>
            )}

            {invites.length > 0 && (
              <div style={{ display: "grid", gap: 0 }}>
                {invites.map((invite, idx) => (
                  <div
                    key={invite.id}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 14,
                      padding: "14px 0",
                      borderBottom: idx < invites.length - 1 ? "1px solid var(--border)" : "none",
                    }}
                  >
                    <div style={avatarStyle}>{initials(undefined, invite.email)}</div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ color: "var(--text)", fontWeight: 600, fontSize: 14, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {invite.email}
                      </div>
                      <div style={{ display: "flex", gap: 8, marginTop: 4, alignItems: "center", flexWrap: "wrap" }}>
                        <span style={badgeStyle("default")}>{roleLabel.get(invite.role_id ?? "") ?? roleLabel.get(invite.role_key) ?? invite.role_key}</span>
                        <span style={{ color: "var(--muted)", fontSize: 12 }}>
                          期限 {new Date(invite.expires_at).toLocaleDateString("ja-JP")}
                        </span>
                      </div>
                    </div>
                    {canEdit && (
                      <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                        <button
                          type="button"
                          disabled={busyKey === `invite:resend:${invite.id}`}
                          onClick={() => void handleResendInvite(invite.id)}
                          style={{ padding: "6px 10px", borderRadius: 8, border: "1px solid var(--border)", background: "transparent", color: "var(--text)", fontSize: 12, cursor: "pointer" }}
                        >
                          再発行
                        </button>
                        <button
                          type="button"
                          disabled={busyKey === `invite:cancel:${invite.id}`}
                          onClick={() => void handleCancelInvite(invite.id)}
                          style={{ padding: "6px 10px", borderRadius: 8, border: "1px solid var(--border)", background: "transparent", color: "var(--muted)", fontSize: 12, cursor: "pointer" }}
                        >
                          取消
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
            {invites.length === 0 && canEdit && (
              <p style={{ margin: 0, padding: "16px 0", color: "var(--muted)", textAlign: "center", fontSize: 14 }}>有効な招待はありません。</p>
            )}
          </section>
        )}
      </div>
    </div>
  )
}
