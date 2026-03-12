"use client"

import { useEffect, useState, useCallback, type CSSProperties } from "react"
import { useRouter } from "next/navigation"
import { supabase } from "@/lib/supabase"
import OnboardingShell from "@/components/OnboardingShell"
import ChoiceCard from "@/components/ChoiceCard"

const inputClassName = "onboarding-input"

const labelStyle: CSSProperties = {
  display: "block",
  fontSize: 14,
  fontWeight: 600,
  color: "var(--text)",
  marginBottom: 8,
}

export default function OnboardingPage() {
  const router = useRouter()
  const [step, setStep] = useState<"name" | "choice" | "personal" | "new_org" | "join" | "joined">("name")
  const [displayName, setDisplayName] = useState("")
  const [personalWorkspaceName, setPersonalWorkspaceName] = useState("")
  const [orgName, setOrgName] = useState("")
  const [orgDisplayName, setOrgDisplayName] = useState("")
  const [ownerEmail, setOwnerEmail] = useState("")
  const [ownerOrgs, setOwnerOrgs] = useState<{ ownerUserId: string; orgs: { id: string; name: string }[] } | null>(null)
  const [selectedOrgId, setSelectedOrgId] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [userId, setUserId] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    const resolveUser = async () => {
      let user = (await supabase.auth.getUser()).data.user
      if (!user) {
        const { data } = await supabase.auth.getSession()
        user = data?.session?.user ?? null
      }
      if (!active) return
      if (!user) {
        router.push("/")
        return
      }

      const { data: profileRow } = await supabase.from("user_profiles").select("display_name").eq("user_id", user.id).maybeSingle()
      const { data: appUsersRows } = await supabase.from("app_users").select("org_id").eq("user_id", user.id).limit(1)
      const hasDisplayName = profileRow && (profileRow as { display_name?: string }).display_name?.trim()
      let hasOrgs = (appUsersRows?.length ?? 0) > 0

      if (!hasOrgs) {
        const { data } = await supabase.auth.getSession()
        const token = data?.session?.access_token
        if (token) {
          try {
            const res = await fetch("/api/auth/my-orgs", { headers: { Authorization: `Bearer ${token}` } })
            const json = await res.json().catch(() => null)
            hasOrgs = json?.ok === true && Array.isArray(json.orgs) && json.orgs.length > 0
          } catch {}
        }
      }

      if (!active) return
      if (hasOrgs) {
        router.replace("/home")
        return
      }

      setUserId(user.id)
      if (hasDisplayName && !hasOrgs) {
        setDisplayName((profileRow as { display_name?: string }).display_name?.trim() ?? "")
        setStep("choice")
      }
    }

    void resolveUser()
    return () => {
      active = false
    }
  }, [router])

  useEffect(() => {
    if (step === "personal") setPersonalWorkspaceName("")
  }, [step])

  useEffect(() => {
    if (step === "personal" || step === "new_org" || step === "join") {
      setOrgDisplayName((prev) => (prev === "" ? displayName : prev))
    }
  }, [step, displayName])

  const getToken = useCallback(async () => {
    const { data } = await supabase.auth.getSession()
    return data?.session?.access_token ?? null
  }, [])

  const handleSubmitName = useCallback(async () => {
    if (!displayName.trim() || !userId) return
    setError(null)
    setLoading(true)
    try {
      const { data: userData } = await supabase.auth.getUser()
      const user = userData.user
      if (!user || user.id !== userId) {
        router.push("/?message=relogin")
        return
      }
      const { error } = await supabase.from("user_profiles").upsert(
        { user_id: user.id, display_name: displayName.trim(), updated_at: new Date().toISOString() },
        { onConflict: "user_id" }
      )
      if (error) throw error
      setStep("choice")
    } catch (e) {
      const raw = e instanceof Error ? e.message : ""
      const isMissingTable = raw.includes("user_profiles") && (raw.includes("schema cache") || raw.includes("does not exist"))
      setError(isMissingTable ? "オンボーディング用のテーブルが不足しています。Supabase SQL を適用してください。" : raw || "表示名の保存に失敗しました。")
    } finally {
      setLoading(false)
    }
  }, [displayName, userId, router])

  const handleCreatePersonal = useCallback(async () => {
    if (!userId) return
    const name = personalWorkspaceName.trim() || (displayName.trim() ? `${displayName.trim()}のワークスペース` : "個人")
    if (!name) {
      setError("ワークスペース名を入力してください。")
      return
    }
    setError(null)
    setLoading(true)
    try {
      const token = await getToken()
      if (!token) throw new Error("ログインし直してください。")
      const displayNameInOrg = orgDisplayName.trim() || displayName.trim() || undefined
      const res = await fetch("/api/onboarding/create-org", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ type: "personal", workspaceName: name, displayNameInOrg }),
      })
      const data = await res.json().catch(() => null)
      if (!res.ok) throw new Error(data?.error ?? "作成に失敗しました。")
      await new Promise((r) => setTimeout(r, 600))
      window.location.href = "/home"
    } catch (e) {
      setError(e instanceof Error ? e.message : "作成に失敗しました。")
    } finally {
      setLoading(false)
    }
  }, [userId, displayName, personalWorkspaceName, orgDisplayName, getToken])

  const handleCreateOrg = useCallback(async () => {
    if (!orgName.trim() || !userId) return
    setError(null)
    setLoading(true)
    try {
      const token = await getToken()
      if (!token) throw new Error("ログインし直してください。")
      const displayNameInOrg = orgDisplayName.trim() || displayName.trim() || undefined
      const res = await fetch("/api/onboarding/create-org", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ type: "new_org", orgName: orgName.trim(), displayNameInOrg }),
      })
      const data = await res.json().catch(() => null)
      if (!res.ok) throw new Error(data?.error ?? "作成に失敗しました。")
      await new Promise((r) => setTimeout(r, 600))
      window.location.href = "/home"
    } catch (e) {
      setError(e instanceof Error ? e.message : "作成に失敗しました。")
    } finally {
      setLoading(false)
    }
  }, [orgName, userId, displayName, orgDisplayName, getToken])

  const fetchOrgsByOwnerEmail = useCallback(async () => {
    if (!ownerEmail.trim()) return
    setError(null)
    setSelectedOrgId(null)
    setLoading(true)
    try {
      const res = await fetch("/api/orgs/lookup-by-owner-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ownerEmail: ownerEmail.trim() }),
      })
      const data = await res.json().catch(() => null)
      if (data?.ok === true) {
        const orgs = data.orgs ?? []
        setOwnerOrgs({ ownerUserId: data.ownerUserId, orgs })
        if (orgs.length === 1) setSelectedOrgId(orgs[0].id)
      } else {
        setError(data?.message ?? "検索に失敗しました。")
        setOwnerOrgs(null)
      }
    } catch {
      setError("検索に失敗しました。")
      setOwnerOrgs(null)
    } finally {
      setLoading(false)
    }
  }, [ownerEmail])

  const handleJoinRequest = useCallback(async () => {
    if (!ownerOrgs?.ownerUserId || !selectedOrgId) return
    setError(null)
    setLoading(true)
    try {
      const token = await getToken()
      if (!token) throw new Error("ログインし直してください。")
      const displayNameInOrg = orgDisplayName.trim() || displayName.trim() || undefined
      const res = await fetch("/api/join-request", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ orgId: selectedOrgId, ownerUserId: ownerOrgs.ownerUserId, displayNameInOrg }),
      })
      const data = await res.json().catch(() => null)
      if (!res.ok) throw new Error(data?.error ?? "参加申請に失敗しました。")
      setStep("joined")
    } catch (e) {
      setError(e instanceof Error ? e.message : "参加申請に失敗しました。")
    } finally {
      setLoading(false)
    }
  }, [ownerOrgs, selectedOrgId, displayName, orgDisplayName, getToken])

  if (!userId) {
    return <div className="onboarding-page"><div className="onboarding-card" style={{ textAlign: "center", padding: "48px 28px" }}><p style={{ color: "var(--muted)", fontSize: 15 }}>読み込み中...</p></div></div>
  }

  const errorBlock = error ? <div role="alert" style={{ marginBottom: 20, padding: 12, borderRadius: 10, background: "var(--surface-2)", border: "1px solid var(--border)", color: "var(--text)", fontSize: 14 }}>{error}</div> : null

  return (
    <>
      {step === "name" && (
        <OnboardingShell stepCurrent={1} stepTotal={3} title="あなたの表示名を教えてください" description="アプリ内で表示される名前を設定します。" onClose={() => router.push("/")} ctaLabel="次へ" ctaDisabled={loading || !displayName.trim()} ctaLoading={loading} onCtaClick={handleSubmitName} ctaHint={!displayName.trim() ? "表示名を入力してください。" : undefined}>
          {errorBlock}
          <label style={labelStyle}>表示名</label>
          <input type="text" value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="例: 山田 太郎" className={inputClassName} autoComplete="name" />
        </OnboardingShell>
      )}
      {step === "choice" && (
        <OnboardingShell stepCurrent={2} stepTotal={3} title="使い方を選んでください" description="このあと作業するワークスペースの始め方を選びます。" onBack={() => setStep("name")}>
          {errorBlock}
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <ChoiceCard icon="1" title="個人で使う" description="個人用のワークスペースをすぐに作成します。" onClick={() => setStep("personal")} />
            <ChoiceCard icon="2" title="新しい組織を作る" description="チームや会社用のワークスペースを作成します。" onClick={() => setStep("new_org")} />
            <ChoiceCard icon="3" title="既存の組織に参加する" description="オーナーのメールアドレスから参加先を検索して申請します。" onClick={() => setStep("join")} />
          </div>
        </OnboardingShell>
      )}
      {step === "personal" && (
        <OnboardingShell stepCurrent={3} stepTotal={3} title="個人用ワークスペースを作成" description="ワークスペース名を決めると、すぐに利用を開始できます。" onBack={() => setStep("choice")} ctaLabel="作成してホームへ" ctaDisabled={loading} ctaLoading={loading} onCtaClick={handleCreatePersonal}>
          {errorBlock}
          <label style={labelStyle}>ワークスペース名</label>
          <input type="text" value={personalWorkspaceName} onChange={(e) => setPersonalWorkspaceName(e.target.value)} placeholder="例: 山田のワークスペース" className={inputClassName} maxLength={40} />
          <label style={{ ...labelStyle, marginTop: 16 }}>この組織での表示名</label>
          <input type="text" value={orgDisplayName} onChange={(e) => setOrgDisplayName(e.target.value)} placeholder="例: 山田 太郎" className={inputClassName} maxLength={40} />
        </OnboardingShell>
      )}
      {step === "new_org" && (
        <OnboardingShell stepCurrent={3} stepTotal={3} title="組織ワークスペースを作成" description="チームや会社で使うワークスペース名を設定します。" onBack={() => setStep("choice")} ctaLabel="作成してホームへ" ctaDisabled={loading || !orgName.trim()} ctaLoading={loading} onCtaClick={handleCreateOrg} ctaHint={!orgName.trim() ? "組織名を入力してください。" : undefined}>
          {errorBlock}
          <label style={labelStyle}>組織名</label>
          <input type="text" value={orgName} onChange={(e) => setOrgName(e.target.value)} placeholder="例: 株式会社サンプル" className={inputClassName} maxLength={40} />
          <label style={{ ...labelStyle, marginTop: 16 }}>この組織での表示名</label>
          <input type="text" value={orgDisplayName} onChange={(e) => setOrgDisplayName(e.target.value)} placeholder="例: 山田 太郎" className={inputClassName} maxLength={40} />
        </OnboardingShell>
      )}
      {step === "join" && (
        <OnboardingShell stepCurrent={3} stepTotal={3} title="既存の組織に参加" description="オーナーのメールアドレスで組織を検索し、参加申請を送ります。" onBack={() => { setStep("choice"); setOwnerOrgs(null); setOwnerEmail(""); setSelectedOrgId(null) }} ctaLabel={ownerOrgs && ownerOrgs.orgs.length > 0 ? "参加申請を送る" : undefined} ctaDisabled={loading || !selectedOrgId} ctaLoading={loading} onCtaClick={handleJoinRequest} ctaHint={ownerOrgs && ownerOrgs.orgs.length > 0 && !selectedOrgId ? "参加先を選択してください。" : undefined}>
          {errorBlock}
          <label style={labelStyle}>オーナーのメールアドレス</label>
          <div style={{ display: "flex", gap: 10, marginBottom: 20 }}>
            <input type="email" value={ownerEmail} onChange={(e) => setOwnerEmail(e.target.value)} placeholder="owner@example.com" className={inputClassName} style={{ flex: 1 }} />
            <button type="button" onClick={fetchOrgsByOwnerEmail} disabled={loading || !ownerEmail.trim()} style={{ padding: "14px 20px", borderRadius: 12, border: "none", background: loading || !ownerEmail.trim() ? "var(--surface-2)" : "var(--primary)", color: loading || !ownerEmail.trim() ? "var(--muted)" : "var(--primary-contrast)", fontSize: 14, fontWeight: 600, cursor: loading || !ownerEmail.trim() ? "not-allowed" : "pointer", whiteSpace: "nowrap" }}>{loading ? "検索中..." : "検索"}</button>
          </div>
          {ownerOrgs && (ownerOrgs.orgs.length === 0 ? <p style={{ color: "var(--muted)", fontSize: 14 }}>該当する参加先は見つかりませんでした。</p> : <>
            <label style={{ ...labelStyle, marginBottom: 12 }}>参加する組織を選択してください</label>
            <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 8 }}>
              {ownerOrgs.orgs.map((org) => (
                <button key={org.id} type="button" onClick={() => setSelectedOrgId(org.id)} style={{ padding: 16, borderRadius: 12, border: selectedOrgId === org.id ? "2px solid var(--primary)" : "1px solid var(--border)", background: selectedOrgId === org.id ? "var(--surface-2)" : "var(--surface)", color: "var(--text)", fontSize: 15, textAlign: "left", cursor: "pointer", boxShadow: "0 2px 8px rgba(0,0,0,0.04)" }}>{org.name}</button>
              ))}
            </div>
            <label style={{ ...labelStyle, marginTop: 16 }}>この組織での表示名</label>
            <input type="text" value={orgDisplayName} onChange={(e) => setOrgDisplayName(e.target.value)} placeholder="例: 山田 太郎" className={inputClassName} maxLength={40} />
          </>)}
        </OnboardingShell>
      )}
      {step === "joined" && <OnboardingShell stepCurrent={3} stepTotal={3} title="参加申請を送りました" description="オーナーの承認後に、ホームから利用できるようになります。" ctaLabel="ホームへ" onCtaClick={() => router.push("/home")}>{errorBlock}</OnboardingShell>}
    </>
  )
}
