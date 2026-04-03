"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import OnboardingShell from "@/components/OnboardingShell"
import { POST_PURCHASE_ONBOARDING_PATH } from "@/lib/platformFlow"
import { supabase } from "@/lib/supabase"

type OwnerOrgOption = {
  ownerUserId: string
  orgs: Array<{ id: string; name: string }>
}

function isValidEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
}

export default function JoinRequestPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [displayName, setDisplayName] = useState("")
  const [ownerEmail, setOwnerEmail] = useState("")
  const [ownerOrgs, setOwnerOrgs] = useState<OwnerOrgOption | null>(null)
  const [selectedOrgId, setSelectedOrgId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const backHref = searchParams.get("from") === "post-purchase" ? POST_PURCHASE_ONBOARDING_PATH : "/onboarding"

  useEffect(() => {
    let active = true
    void supabase.auth.getUser().then(async ({ data }) => {
      if (!active) return
      if (!data.user) {
        router.replace("/")
        return
      }
      const { data: profile } = await supabase
        .from("user_profiles")
        .select("display_name")
        .eq("user_id", data.user.id)
        .maybeSingle()
      if (!active) return
      setDisplayName(String(profile?.display_name ?? ""))
      setLoading(false)
    })
    return () => {
      active = false
    }
  }, [router])

  const getToken = useCallback(async () => {
    const { data } = await supabase.auth.getSession()
    return data.session?.access_token ?? null
  }, [])

  const lookupOrgsByOwnerEmail = useCallback(async (email: string) => {
    const res = await fetch("/api/orgs/lookup-by-owner-email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ownerEmail: email }),
    })
    const json = await res.json().catch(() => null)
    if (!res.ok || !json?.ownerUserId) {
      throw new Error(json?.message ?? "参加先を取得できませんでした")
    }
    return {
      ownerUserId: String(json.ownerUserId),
      orgs: Array.isArray(json.orgs) ? json.orgs : [],
    } satisfies OwnerOrgOption
  }, [])

  const submitJoinRequest = useCallback(
    async (orgId: string, ownerUserId: string) => {
      const token = await getToken()
      if (!token) throw new Error("ログインを確認できませんでした")

      const res = await fetch("/api/join-request", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          orgId,
          ownerUserId,
          displayNameInOrg: displayName.trim() || undefined,
        }),
      })

      const json = await res.json().catch(() => null)
      if (!res.ok) {
        throw new Error(json?.error ?? "参加申請に失敗しました")
      }
    },
    [displayName, getToken]
  )

  const selectionMode = useMemo(() => Boolean(ownerOrgs && ownerOrgs.orgs.length > 1), [ownerOrgs])

  const handleSubmit = useCallback(async () => {
    setError(null)
    setSuccess(null)
    if (!ownerEmail.trim() || !isValidEmail(ownerEmail.trim())) {
      setError("owner の Google メールアドレスを入力してください")
      return
    }

    setSubmitting(true)
    try {
      if (selectionMode && ownerOrgs?.ownerUserId) {
        if (!selectedOrgId) {
          throw new Error("参加先の組織を選択してください")
        }
        await submitJoinRequest(selectedOrgId, ownerOrgs.ownerUserId)
        setSuccess("参加申請を送信しました。承認後に再度アクセスしてください。")
        return
      }

      const result = await lookupOrgsByOwnerEmail(ownerEmail.trim())
      if (result.orgs.length === 0) {
        throw new Error("owner に紐づく組織が見つかりませんでした")
      }
      if (result.orgs.length === 1) {
        await submitJoinRequest(result.orgs[0].id, result.ownerUserId)
        setSuccess("参加申請を送信しました。承認後に再度アクセスしてください。")
        return
      }
      setOwnerOrgs(result)
      setSelectedOrgId(result.orgs[0]?.id ?? null)
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "参加申請に失敗しました")
    } finally {
      setSubmitting(false)
    }
  }, [lookupOrgsByOwnerEmail, ownerEmail, ownerOrgs?.ownerUserId, selectedOrgId, selectionMode, submitJoinRequest])

  if (loading) {
    return <div style={{ padding: 32, color: "var(--muted)" }}>読み込み中...</div>
  }

  return (
    <OnboardingShell
      stepCurrent={1}
      stepTotal={1}
      title={selectionMode ? "参加先を選択" : "既存組織に参加する"}
      description={
        selectionMode
          ? "同じ owner に複数の組織があるため、申請先を選択してください。"
          : "owner の Google メールアドレスを使って参加申請を送ります。owner は追加できません。"
      }
      onBack={() => {
        if (selectionMode) {
          setOwnerOrgs(null)
          setSelectedOrgId(null)
          return
        }
        router.push(backHref)
      }}
      onClose={() => router.replace("/")}
      ctaLabel={selectionMode ? "この組織に申請する" : "参加申請を送る"}
      ctaDisabled={submitting || !ownerEmail.trim() || (selectionMode && !selectedOrgId)}
      ctaLoading={submitting}
      onCtaClick={() => void handleSubmit()}
    >
      {error ? <div role="alert" className="onboarding-alert">{error}</div> : null}
      {success ? (
        <div className="onboarding-confirm-card onboarding-confirm-card--success">
          <div className="onboarding-confirm-value">{success}</div>
        </div>
      ) : null}

      {!selectionMode ? (
        <div className="onboarding-form-stack">
          <input
            className="onboarding-input"
            value={displayName}
            onChange={(event) => setDisplayName(event.target.value)}
            placeholder="組織内の表示名（任意）"
            maxLength={40}
          />
          <input
            className="onboarding-input"
            value={ownerEmail}
            onChange={(event) => setOwnerEmail(event.target.value)}
            placeholder="owner@example.com"
            type="email"
          />
        </div>
      ) : (
        <div className="onboarding-selection-list" role="list" aria-label="参加先の組織一覧">
          {ownerOrgs?.orgs.map((org) => (
            <button
              key={org.id}
              type="button"
              className={selectedOrgId === org.id ? "onboarding-selection-card is-selected" : "onboarding-selection-card"}
              onClick={() => setSelectedOrgId(org.id)}
            >
              <span className="onboarding-selection-title">{org.name}</span>
              <span className="onboarding-selection-description">この組織へ参加申請を送ります</span>
            </button>
          ))}
        </div>
      )}
    </OnboardingShell>
  )
}
