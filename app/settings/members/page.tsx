
"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { supabase } from "@/lib/supabase"
import { useAuthOrg } from "@/hooks/useAuthOrg"

type TabKey = "members" | "requests" | "invites"

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

const ROLE_OPTIONS = [
  { key: "executive_assistant", label: "経営補佐" },
  { key: "member", label: "メンバー" },
] as const

const cardStyle: React.CSSProperties = {
  background: "var(--surface)",
  border: "1px solid var(--border)",
  borderRadius: 16,
  padding: 20,
}

export default function MembersSettingsPage() {
  const { activeOrgId, role, loading: authLoading, needsOnboarding } = useAuthOrg({ redirectToOnboarding: true })
  const [tab, setTab] = useState<TabKey>("members")
  const [members, setMembers] = useState<MemberRow[]>([])
  const [requests, setRequests] = useState<RequestRow[]>([])
  const [invites, setInvites] = useState<InviteRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
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
      await Promise.all([fetchMembers(), fetchRequests(), fetchInvites()])
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "読み込みに失敗しました。")
    } finally {
      setLoading(false)
    }
  }, [activeOrgId, authLoading, needsOnboarding, fetchMembers, fetchRequests, fetchInvites])

  useEffect(() => {
    void reloadAll()
  }, [reloadAll])

  useEffect(() => {
    if (!success) return
    const timer = setTimeout(() => setSuccess(null), 2500)
    return () => clearTimeout(timer)
  }, [success])

  const roleLabel = useMemo(() => new Map<string, string>(ROLE_OPTIONS.map((item) => [item.key, item.label])), [])

  const handleChangeRole = async (userId: string, newRole: string) => {
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
        body: JSON.stringify({ orgId: activeOrgId, userId, role: newRole }),
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
    setBusyKey(`approve:${requestId}`)
    setError(null)
    try {
      await callApi("/api/org/requests/approve", {
        method: "POST",
        body: JSON.stringify({ requestId, roleKey: approveRole[requestId] ?? "member" }),
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
        body: JSON.stringify({ orgId: activeOrgId, email: inviteEmail.trim(), roleKey: inviteRoleKey }),
      })
      setInviteEmail("")
      setInviteRoleKey("member")
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

  return (
    <div style={{ padding: "32px 40px", minHeight: "100vh", background: "var(--bg-grad)" }}>
      <div style={{ maxWidth: 1100, margin: "0 auto", display: "grid", gap: 16 }}>
        <header style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: 16, flexWrap: "wrap" }}>
          <div>
            <h1 style={{ margin: 0, fontSize: 28, color: "var(--text)" }}>メンバー</h1>
            <p style={{ margin: "8px 0 0", color: "var(--muted)", fontSize: 13 }}>
              メンバー、参加申請、招待リンクをこの画面でまとめて管理します。
            </p>
          </div>
          <Link href="/settings" style={{ color: "var(--primary)", fontWeight: 600, textDecoration: "none" }}>
            設定に戻る
          </Link>
        </header>

        <section style={{ ...cardStyle, display: "grid", gap: 8 }}>
          <div style={{ fontWeight: 700, color: "var(--text)" }}>請求・会計運用の役割目安</div>
          <div style={{ fontSize: 13, color: "var(--muted)", display: "grid", gap: 4 }}>
            <div>オーナー（owner）: 請求、外注、支払い、招待、ワークスペース設定まで含めた全体管理。</div>
            <div>経営補佐（executive_assistant）: オーナーと同様に請求 / 支払い実務を進める担当。</div>
            <div>メンバー（member）: Home / Contents / Pages などの閲覧主体。請求系の更新操作はできません。</div>
            <div>税理士・会計確認者は、更新まで必要なら経営補佐、閲覧中心ならメンバー + PDF共有で運用してください。</div>
          </div>
        </section>

        {error ? <section style={{ ...cardStyle, background: "var(--error-bg)", borderColor: "var(--error-border)", color: "var(--error-text)" }}>{error}</section> : null}
        {success ? <section style={{ ...cardStyle, background: "var(--success-bg)", borderColor: "var(--success-border)", color: "var(--success-text)" }}>{success}</section> : null}

        <section style={{ ...cardStyle, display: "flex", gap: 8, flexWrap: "wrap" }}>
          {[
            { key: "members", label: `メンバー (${members.length})` },
            { key: "requests", label: `参加申請 (${requests.length})` },
            { key: "invites", label: `招待 (${invites.length})` },
          ].map((item) => (
            <button
              key={item.key}
              type="button"
              onClick={() => setTab(item.key as TabKey)}
              style={{
                padding: "10px 14px",
                borderRadius: 999,
                border: `1px solid ${tab === item.key ? "var(--primary)" : "var(--border)"}`,
                background: tab === item.key ? "color-mix(in srgb, var(--primary) 12%, var(--surface))" : "var(--surface-2)",
                color: "var(--text)",
                fontWeight: 600,
              }}
            >
              {item.label}
            </button>
          ))}
        </section>

        {tab === "members" ? (
          <section style={cardStyle}>
            <div style={{ fontWeight: 700, marginBottom: 12, color: "var(--text)" }}>所属メンバー</div>
            <div style={{ display: "grid", gap: 12 }}>
              {members.map((member) => (
                <div key={member.userId} style={{ display: "grid", gridTemplateColumns: "minmax(0, 1.6fr) minmax(0, 1fr) auto auto", gap: 12, alignItems: "center", paddingBottom: 12, borderBottom: "1px solid var(--border)" }}>
                  <div>
                    <div style={{ color: "var(--text)", fontWeight: 600 }}>{member.displayName || member.email || member.userId}</div>
                    <div style={{ color: "var(--muted)", fontSize: 12 }}>{member.email || member.userId}</div>
                  </div>
                  <div style={{ color: "var(--muted)", fontSize: 13 }}>状態: {member.status}</div>
                  <select
                    value={member.role}
                    disabled={!canEdit || member.role === "owner" || busyKey === `role:${member.userId}`}
                    onChange={(event) => void handleChangeRole(member.userId, event.target.value)}
                    style={{ padding: "8px 10px", borderRadius: 10, border: "1px solid var(--border)", background: "var(--surface-2)", color: "var(--text)" }}
                  >
                    {ROLE_OPTIONS.map((option) => (
                      <option key={option.key} value={option.key}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    disabled={!canEdit || member.role === "owner" || busyKey === `remove:${member.userId}`}
                    onClick={() => void handleRemoveMember(member.userId)}
                    style={{ padding: "8px 12px", borderRadius: 10, border: "1px solid var(--error-border)", background: "var(--error-bg)", color: "var(--error-text)" }}
                  >
                    削除
                  </button>
                </div>
              ))}
              {members.length === 0 ? <p style={{ margin: 0, color: "var(--muted)" }}>まだメンバーがいません。</p> : null}
            </div>
          </section>
        ) : null}

        {tab === "requests" ? (
          <section style={cardStyle}>
            <div style={{ fontWeight: 700, marginBottom: 12, color: "var(--text)" }}>参加申請</div>
            {!canEdit ? <p style={{ margin: 0, color: "var(--muted)" }}>参加申請の管理は管理者のみ利用できます。</p> : null}
            {canEdit ? (
              <div style={{ display: "grid", gap: 12 }}>
                {requests.map((request) => (
                  <div key={request.id} style={{ paddingBottom: 12, borderBottom: "1px solid var(--border)", display: "grid", gap: 10 }}>
                    <div>
                      <div style={{ color: "var(--text)", fontWeight: 600 }}>{request.requestedDisplayName || request.requesterEmail || request.requesterUserId}</div>
                      <div style={{ color: "var(--muted)", fontSize: 12 }}>{new Date(request.createdAt).toLocaleString("ja-JP")}</div>
                    </div>
                    {request.message ? <div style={{ color: "var(--text)", fontSize: 14 }}>{request.message}</div> : null}
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                      <select
                        value={approveRole[request.id] ?? request.requestedRole ?? "member"}
                        onChange={(event) => setApproveRole((prev) => ({ ...prev, [request.id]: event.target.value }))}
                        style={{ padding: "8px 10px", borderRadius: 10, border: "1px solid var(--border)", background: "var(--surface-2)", color: "var(--text)" }}
                      >
                        {ROLE_OPTIONS.map((option) => (
                          <option key={option.key} value={option.key}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        disabled={busyKey === `approve:${request.id}`}
                        onClick={() => void handleApprove(request.id)}
                        style={{ padding: "8px 12px", borderRadius: 10, border: "1px solid var(--success-border)", background: "var(--success-bg)", color: "var(--success-text)" }}
                      >
                        承認
                      </button>
                      <button
                        type="button"
                        disabled={busyKey === `reject:${request.id}`}
                        onClick={() => void handleReject(request.id)}
                        style={{ padding: "8px 12px", borderRadius: 10, border: "1px solid var(--error-border)", background: "var(--error-bg)", color: "var(--error-text)" }}
                      >
                        却下
                      </button>
                    </div>
                  </div>
                ))}
                {requests.length === 0 ? <p style={{ margin: 0, color: "var(--muted)" }}>未処理の参加申請はありません。</p> : null}
              </div>
            ) : null}
          </section>
        ) : null}

        {tab === "invites" ? (
          <section style={{ ...cardStyle, display: "grid", gap: 16 }}>
            <div>
              <div style={{ fontWeight: 700, marginBottom: 12, color: "var(--text)" }}>招待リンク</div>
              <p style={{ margin: 0, color: "var(--muted)", fontSize: 13 }}>メールアドレスごとに招待リンクを発行し、状態を確認できます。</p>
            </div>

            {canEdit ? (
              <div style={{ display: "grid", gap: 10, gridTemplateColumns: "minmax(0, 1.8fr) minmax(160px, 220px) auto" }}>
                <input
                  value={inviteEmail}
                  onChange={(event) => setInviteEmail(event.target.value)}
                  placeholder="invite@example.com"
                  style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--border)", background: "var(--surface-2)", color: "var(--text)" }}
                />
                <select
                  value={inviteRoleKey}
                  onChange={(event) => setInviteRoleKey(event.target.value)}
                  style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--border)", background: "var(--surface-2)", color: "var(--text)" }}
                >
                  {ROLE_OPTIONS.map((option) => (
                    <option key={option.key} value={option.key}>
                      {option.label}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => void handleCreateInvite()}
                  disabled={!inviteEmail.trim() || busyKey === "invite:create"}
                  style={{ padding: "10px 14px", borderRadius: 10, border: "1px solid var(--primary)", background: "var(--primary)", color: "#fff", fontWeight: 700 }}
                >
                  招待を作成
                </button>
              </div>
            ) : (
              <p style={{ margin: 0, color: "var(--muted)" }}>招待リンクの発行は管理者のみ利用できます。</p>
            )}

            <div style={{ display: "grid", gap: 12 }}>
              {invites.map((invite) => (
                <div key={invite.id} style={{ display: "grid", gap: 10, paddingBottom: 12, borderBottom: "1px solid var(--border)" }}>
                  <div>
                    <div style={{ color: "var(--text)", fontWeight: 600 }}>{invite.email}</div>
                    <div style={{ color: "var(--muted)", fontSize: 12 }}>
                      期限: {new Date(invite.expires_at).toLocaleString("ja-JP")} / 権限: {roleLabel.get(invite.role_key) ?? invite.role_key}
                    </div>
                  </div>
                  {canEdit ? (
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                      <button
                        type="button"
                        disabled={busyKey === `invite:resend:${invite.id}`}
                        onClick={() => void handleResendInvite(invite.id)}
                        style={{ padding: "8px 12px", borderRadius: 10, border: "1px solid var(--border)", background: "var(--surface-2)", color: "var(--text)" }}
                      >
                        再発行
                      </button>
                      <button
                        type="button"
                        disabled={busyKey === `invite:cancel:${invite.id}`}
                        onClick={() => void handleCancelInvite(invite.id)}
                        style={{ padding: "8px 12px", borderRadius: 10, border: "1px solid var(--error-border)", background: "var(--error-bg)", color: "var(--error-text)" }}
                      >
                        取り消し
                      </button>
                    </div>
                  ) : null}
                </div>
              ))}
              {invites.length === 0 ? <p style={{ margin: 0, color: "var(--muted)" }}>有効な招待はありません。</p> : null}
            </div>
          </section>
        ) : null}
      </div>
    </div>
  )
}
