"use client"

import { useEffect, useState } from "react"
import { supabase } from "@/lib/supabase"
import { useAuthOrg } from "@/hooks/useAuthOrg"

type MemberRow = {
  user_id: string
  role: string
  status: string
  display_name: string | null
}

export default function MembersPage() {
  const { activeOrgId, role, loading: authLoading, needsOnboarding } = useAuthOrg({ redirectToOnboarding: true })
  const [members, setMembers] = useState<MemberRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    const load = async () => {
      if (authLoading || needsOnboarding || !activeOrgId) {
        setLoading(false)
        return
      }
      setError(null)
      setLoading(true)
      let data: MemberRow[] | null = null
      let e: Error | null = null

      const { data: fullData, error: fullError } = await supabase
        .from("app_users")
        .select("user_id, role, status, display_name")
        .eq("org_id", activeOrgId)
        .order("role", { ascending: true })

      if (!fullError && fullData != null) {
        data = fullData as MemberRow[]
      } else if (fullError?.code === "42703" || fullError?.message?.includes("column")) {
        const { data: minimalData, error: minimalError } = await supabase
          .from("app_users")
          .select("user_id, role")
          .eq("org_id", activeOrgId)
          .order("role", { ascending: true })
        if (!minimalError && minimalData != null) {
          data = (minimalData as { user_id: string; role: string }[]).map((r) => ({
            user_id: r.user_id,
            role: r.role,
            status: "active",
            display_name: null,
          }))
        } else {
          e = minimalError ?? fullError
        }
      } else {
        e = fullError
      }

      if (!active) return
      if (e) {
        setError("メンバー一覧の取得に失敗しました。")
        setMembers([])
      } else {
        setMembers(data ?? [])
      }
      setLoading(false)
    }
    load()
    return () => {
      active = false
    }
  }, [activeOrgId, authLoading, needsOnboarding])

  const header = (
    <div style={{ marginBottom: 20, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
      <div>
        <h1 style={{ fontSize: 20, fontWeight: 700, color: "var(--text)", marginBottom: 4 }}>メンバー</h1>
        <p style={{ fontSize: 13, color: "var(--muted)" }}>このワークスペースに所属しているメンバー一覧です。</p>
      </div>
      {role && (
        <span style={{ fontSize: 12, color: "var(--muted)", borderRadius: 999, border: "1px solid var(--border)", padding: "4px 10px" }}>
          あなたのロール: {role}
        </span>
      )}
    </div>
  )

  return (
    <div style={{ padding: "32px 40px", minHeight: "100vh", background: "var(--bg)" }}>
      {header}
      {error && (
        <div
          style={{
            marginBottom: 16,
            padding: 10,
            borderRadius: 8,
            background: "#fef2f2",
            color: "#b91c1c",
            fontSize: 14,
          }}
        >
          {error}
        </div>
      )}
      {authLoading || loading ? (
        <p style={{ color: "var(--muted)" }}>読み込み中…</p>
      ) : !activeOrgId ? (
        <p style={{ color: "var(--muted)" }}>所属中のワークスペースがありません。</p>
      ) : members.length === 0 ? (
        <p style={{ color: "var(--muted)" }}>まだメンバーはいません。</p>
      ) : (
        <div
          style={{
            borderRadius: 16,
            border: "1px solid var(--border)",
            background: "var(--surface)",
            padding: 12,
          }}
        >
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "minmax(0, 2fr) minmax(0, 1fr) minmax(0, 1fr)",
              padding: "8px 12px",
              fontSize: 12,
              color: "var(--muted)",
              borderBottom: "1px solid var(--border)",
            }}
          >
            <span>表示名</span>
            <span>ロール</span>
            <span>ステータス</span>
          </div>
          {members.map((m) => (
            <div
              key={m.user_id + m.role}
              style={{
                display: "grid",
                gridTemplateColumns: "minmax(0, 2fr) minmax(0, 1fr) minmax(0, 1fr)",
                padding: "10px 12px",
                fontSize: 14,
                color: "var(--text)",
                borderBottom: "1px solid rgba(148, 163, 184, 0.25)",
              }}
            >
              <span>{m.display_name || "(未設定)"}</span>
              <span>{m.role}</span>
              <span>{m.status}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

