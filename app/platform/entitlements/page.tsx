"use client"

import { useCallback, useEffect, useState } from "react"
import { supabase } from "@/lib/supabase"
import PlatformAdminNav from "@/components/platform/PlatformAdminNav"

type EntitlementRow = {
  id: string
  user_id: string
  status: string
  grant_type: string
  amount_total_jpy?: number | null
  activated_at?: string | null
  admin_note?: string | null
  creator_profile?: {
    full_name?: string | null
    company_name?: string | null
    google_email?: string | null
  } | null
  user_profile?: {
    display_name?: string | null
  } | null
}

type CandidateRow = {
  user_id: string
  creator_profile?: {
    full_name?: string | null
    company_name?: string | null
    google_email?: string | null
  } | null
  user_profile?: {
    display_name?: string | null
  } | null
  entitlement?: EntitlementRow | null
}

export default function PlatformEntitlementsPage() {
  const [currentUserId, setCurrentUserId] = useState("")
  const [query, setQuery] = useState("")
  const [targetUserId, setTargetUserId] = useState("")
  const [note, setNote] = useState("")
  const [rows, setRows] = useState<EntitlementRow[]>([])
  const [candidates, setCandidates] = useState<CandidateRow[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  const load = useCallback(async (q?: string) => {
    setLoading(true)
    setError(null)
    const token = (await supabase.auth.getSession()).data.session?.access_token
    if (!token) {
      setLoading(false)
      return
    }

    const url = q?.trim() ? `/api/platform/entitlements?q=${encodeURIComponent(q.trim())}` : "/api/platform/entitlements"
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })
    const json = await res.json().catch(() => null)
    if (!res.ok || !json?.ok) {
      setError(json?.error ?? "entitlement一覧を取得できませんでした。")
      setRows([])
      setCandidates([])
      setLoading(false)
      return
    }

    setRows(Array.isArray(json.entitlements) ? json.entitlements : [])
    setCandidates(Array.isArray(json.candidates) ? json.candidates : [])
    setLoading(false)
  }, [])

  /* eslint-disable */
  useEffect(() => {
    void supabase.auth.getUser().then(({ data }) => {
      setCurrentUserId(data.user?.id ?? "")
    })
    void load()
  }, [load])
  /* eslint-enable */

  const grant = useCallback(
    async (grantType: "manual_test" | "manual_grant", explicitUserId?: string) => {
      const userId = (explicitUserId ?? targetUserId).trim()
      if (!userId) {
        setError("target_user_id を入力してください。")
        return
      }

      const token = (await supabase.auth.getSession()).data.session?.access_token
      if (!token) return

      setBusy(`grant:${grantType}:${userId}`)
      setError(null)
      setSuccess(null)
      const res = await fetch("/api/platform/entitlements/grant", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          target_user_id: userId,
          grant_type: grantType,
          note,
        }),
      })
      const json = await res.json().catch(() => null)
      setBusy(null)
      if (!res.ok || !json?.ok) {
        setError(json?.error ?? "手動付与に失敗しました。")
        return
      }

      setSuccess(`${grantType} を付与しました。`)
      await load(query)
    },
    [load, note, query, targetUserId]
  )

  const revoke = useCallback(
    async (userId: string) => {
      const token = (await supabase.auth.getSession()).data.session?.access_token
      if (!token) return

      setBusy(`revoke:${userId}`)
      setError(null)
      setSuccess(null)
      const res = await fetch("/api/platform/entitlements/revoke", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          target_user_id: userId,
          note,
        }),
      })
      const json = await res.json().catch(() => null)
      setBusy(null)
      if (!res.ok || !json?.ok) {
        setError(json?.error ?? "revoke に失敗しました。")
        return
      }

      setSuccess("entitlement を revoke しました。")
      await load(query)
    },
    [load, note, query]
  )

  return (
    <div style={{ padding: "32px 24px 80px", minHeight: "100vh", background: "var(--bg-grad)" }}>
      <div style={{ maxWidth: 1100, margin: "0 auto", display: "grid", gap: 16 }}>
        <header style={{ display: "grid", gap: 6 }}>
          <div style={{ fontSize: 12, color: "var(--muted)" }}>Platform admin only</div>
          <h1 style={{ margin: 0, color: "var(--text)" }}>手動付与 / revoke</h1>
          <p style={{ margin: 0, color: "var(--muted)" }}>
            公開販売フローとは別の運営者専用オペレーションです。一般ユーザーには無料バイパスを表示しません。
          </p>
        </header>

        <PlatformAdminNav />

        <section style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 18, padding: 18, display: "grid", gap: 12 }}>
          <div style={{ display: "grid", gap: 10, gridTemplateColumns: "minmax(0, 1.2fr) minmax(0, 1.4fr)" }}>
            <label style={{ display: "grid", gap: 6 }}>
              <span style={{ color: "var(--muted)", fontSize: 12 }}>検索</span>
              <input
                className="onboarding-input"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="display name / email / company / user id"
              />
            </label>
            <label style={{ display: "grid", gap: 6 }}>
              <span style={{ color: "var(--muted)", fontSize: 12 }}>target_user_id</span>
              <input
                className="onboarding-input"
                value={targetUserId}
                onChange={(event) => setTargetUserId(event.target.value)}
                placeholder="uuid"
              />
            </label>
          </div>

          <label style={{ display: "grid", gap: 6 }}>
            <span style={{ color: "var(--muted)", fontSize: 12 }}>note</span>
            <textarea
              className="onboarding-input"
              rows={3}
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder="付与理由 / revoke 理由"
            />
          </label>

          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <button
              type="button"
              onClick={() => void load(query)}
              disabled={loading}
              style={{ padding: "10px 14px", borderRadius: 10, border: "1px solid var(--border)", background: "var(--surface-2)", color: "var(--text)" }}
            >
              検索
            </button>
            <button
              type="button"
              onClick={() => void grant("manual_test")}
              disabled={busy === `grant:manual_test:${targetUserId.trim()}`}
              style={{ padding: "10px 14px", borderRadius: 10, border: "1px solid var(--primary)", background: "var(--primary)", color: "#fff" }}
            >
              manual_test 付与
            </button>
            <button
              type="button"
              onClick={() => void grant("manual_grant")}
              disabled={busy === `grant:manual_grant:${targetUserId.trim()}`}
              style={{ padding: "10px 14px", borderRadius: 10, border: "1px solid var(--primary)", background: "var(--primary)", color: "#fff" }}
            >
              manual_grant 付与
            </button>
            <button
              type="button"
              onClick={() => {
                if (!currentUserId) return
                setTargetUserId(currentUserId)
                void grant("manual_test", currentUserId)
              }}
              disabled={!currentUserId || busy === `grant:manual_test:${currentUserId}`}
              style={{ padding: "10px 14px", borderRadius: 10, border: "1px solid var(--border)", background: "var(--surface-2)", color: "var(--text)" }}
            >
              自分に manual_test
            </button>
          </div>

          {currentUserId ? <div style={{ color: "var(--muted)", fontSize: 13 }}>current_user_id: {currentUserId}</div> : null}
          {error ? <div style={{ color: "var(--error-text)" }}>{error}</div> : null}
          {success ? <div style={{ color: "var(--success-text)" }}>{success}</div> : null}
        </section>

        {query ? (
          <section style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 18, padding: 18, display: "grid", gap: 12 }}>
            <h2 style={{ margin: 0, color: "var(--text)", fontSize: 18 }}>検索結果</h2>
            {candidates.length === 0 ? <div style={{ color: "var(--muted)" }}>該当ユーザーが見つかりません。</div> : null}
            {candidates.map((candidate) => (
              <div key={candidate.user_id} style={{ borderTop: "1px solid var(--border)", paddingTop: 12, display: "grid", gap: 6 }}>
                <div style={{ color: "var(--text)", fontWeight: 600 }}>
                  {candidate.user_profile?.display_name || candidate.creator_profile?.full_name || candidate.user_id}
                </div>
                <div style={{ color: "var(--muted)", fontSize: 13 }}>{candidate.creator_profile?.google_email || candidate.user_id}</div>
                <div style={{ color: "var(--muted)", fontSize: 13 }}>
                  {candidate.entitlement ? `${candidate.entitlement.status} / ${candidate.entitlement.grant_type}` : "entitlement なし"}
                </div>
                <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                  <button
                    type="button"
                    onClick={() => {
                      setTargetUserId(candidate.user_id)
                      void grant("manual_test", candidate.user_id)
                    }}
                    disabled={busy === `grant:manual_test:${candidate.user_id}`}
                    style={{ padding: "8px 12px", borderRadius: 10, border: "1px solid var(--primary)", background: "var(--primary)", color: "#fff" }}
                  >
                    manual_test
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setTargetUserId(candidate.user_id)
                      void grant("manual_grant", candidate.user_id)
                    }}
                    disabled={busy === `grant:manual_grant:${candidate.user_id}`}
                    style={{ padding: "8px 12px", borderRadius: 10, border: "1px solid var(--primary)", background: "var(--primary)", color: "#fff" }}
                  >
                    manual_grant
                  </button>
                  {candidate.entitlement ? (
                    <button
                      type="button"
                      onClick={() => {
                        setTargetUserId(candidate.user_id)
                        void revoke(candidate.user_id)
                      }}
                      disabled={busy === `revoke:${candidate.user_id}`}
                      style={{ padding: "8px 12px", borderRadius: 10, border: "1px solid var(--error-border)", background: "var(--error-bg)", color: "var(--error-text)" }}
                    >
                      revoke
                    </button>
                  ) : null}
                </div>
              </div>
            ))}
          </section>
        ) : null}

        <section style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 18, padding: 18, display: "grid", gap: 12 }}>
          <h2 style={{ margin: 0, color: "var(--text)", fontSize: 18 }}>最近のentitlement</h2>
          {loading ? <div style={{ color: "var(--muted)" }}>読み込み中...</div> : null}
          {!loading && rows.length === 0 ? <div style={{ color: "var(--muted)" }}>entitlement はありません。</div> : null}
          {rows.map((row) => (
            <div key={row.id} style={{ borderTop: "1px solid var(--border)", paddingTop: 12, display: "grid", gap: 6 }}>
              <div style={{ color: "var(--text)", fontWeight: 600 }}>
                {row.user_profile?.display_name || row.creator_profile?.full_name || row.user_id}
              </div>
              <div style={{ color: "var(--muted)", fontSize: 13 }}>{row.creator_profile?.google_email || row.user_id}</div>
              <div style={{ color: "var(--muted)", fontSize: 13 }}>
                {row.status} / {row.grant_type} / amount {Number(row.amount_total_jpy ?? 0).toLocaleString("ja-JP")}円
              </div>
              <div style={{ color: "var(--muted)", fontSize: 13 }}>
                activated_at: {row.activated_at ? new Date(row.activated_at).toLocaleString("ja-JP") : "-"}
              </div>
              {row.admin_note ? <div style={{ color: "var(--muted)", fontSize: 13 }}>note: {row.admin_note}</div> : null}
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                <button
                  type="button"
                  onClick={() => {
                    setTargetUserId(row.user_id)
                    void grant("manual_test", row.user_id)
                  }}
                  disabled={busy === `grant:manual_test:${row.user_id}`}
                  style={{ padding: "8px 12px", borderRadius: 10, border: "1px solid var(--primary)", background: "var(--primary)", color: "#fff" }}
                >
                  manual_test
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setTargetUserId(row.user_id)
                    void grant("manual_grant", row.user_id)
                  }}
                  disabled={busy === `grant:manual_grant:${row.user_id}`}
                  style={{ padding: "8px 12px", borderRadius: 10, border: "1px solid var(--primary)", background: "var(--primary)", color: "#fff" }}
                >
                  manual_grant
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setTargetUserId(row.user_id)
                    void revoke(row.user_id)
                  }}
                  disabled={busy === `revoke:${row.user_id}`}
                  style={{ padding: "8px 12px", borderRadius: 10, border: "1px solid var(--error-border)", background: "var(--error-bg)", color: "var(--error-text)" }}
                >
                  revoke
                </button>
              </div>
            </div>
          ))}
        </section>
      </div>
    </div>
  )
}
