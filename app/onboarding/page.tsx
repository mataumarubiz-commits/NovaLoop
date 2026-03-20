"use client"

import { useCallback, useEffect, useState, type KeyboardEvent } from "react"
import { useRouter } from "next/navigation"
import ChoiceCard from "@/components/ChoiceCard"
import OnboardingShell from "@/components/OnboardingShell"
import { supabase } from "@/lib/supabase"

type Step = "name" | "choice" | "personal" | "new_org" | "join" | "joined"

type OwnerOrgOption = {
  ownerUserId: string
  orgs: Array<{ id: string; name: string }>
}

type PendingJoinSnapshot = {
  ownerEmail: string
  orgName: string | null
  requestedAt: string
}

const inputClassName = "onboarding-input"
const PENDING_JOIN_STORAGE_KEY = "novaloop.pendingJoinRequest"
const LP_VIEW_HREF = "/?showLp=1"

function PersonChoiceIcon() {
  return (
    <svg className="onboarding-choice-icon-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 12a4 4 0 1 0-4-4 4 4 0 0 0 4 4Z" />
      <path d="M5.5 20a6.5 6.5 0 0 1 13 0" />
    </svg>
  )
}

function TeamChoiceIcon() {
  return (
    <svg className="onboarding-choice-icon-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 20h16" />
      <path d="M6.5 20V7.5h11V20" />
      <path d="M9.5 11h1" />
      <path d="M13.5 11h1" />
      <path d="M9.5 14.5h1" />
      <path d="M13.5 14.5h1" />
      <path d="M10.5 20v-3h3v3" />
      <path d="M9 7.5V4h6v3.5" />
    </svg>
  )
}

function JoinChoiceIcon() {
  return (
    <svg className="onboarding-choice-icon-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10 13a4 4 0 1 0-4-4 4 4 0 0 0 4 4Z" />
      <path d="M3.5 20a6.5 6.5 0 0 1 9.8-5.58" />
      <path d="m15 12 6 6" />
      <path d="M18 12h3v3" />
    </svg>
  )
}

function LoadingMark() {
  return (
    <div className="onboarding-loading-shell" aria-live="polite">
      <div className="onboarding-loading-mark">N</div>
      <div className="onboarding-spinner" aria-hidden="true" />
      <p className="onboarding-loading-copy">初期設定を確認しています</p>
    </div>
  )
}

function readPendingJoinSnapshot() {
  if (typeof window === "undefined") return null

  try {
    const raw = window.localStorage.getItem(PENDING_JOIN_STORAGE_KEY)
    if (!raw) return null

    const parsed = JSON.parse(raw) as Partial<PendingJoinSnapshot> | null
    if (!parsed || typeof parsed.ownerEmail !== "string" || typeof parsed.requestedAt !== "string") {
      return null
    }

    return {
      ownerEmail: parsed.ownerEmail,
      orgName: typeof parsed.orgName === "string" ? parsed.orgName : null,
      requestedAt: parsed.requestedAt,
    }
  } catch {
    return null
  }
}

function writePendingJoinSnapshot(snapshot: PendingJoinSnapshot) {
  if (typeof window === "undefined") return
  window.localStorage.setItem(PENDING_JOIN_STORAGE_KEY, JSON.stringify(snapshot))
}

function clearPendingJoinSnapshot() {
  if (typeof window === "undefined") return
  window.localStorage.removeItem(PENDING_JOIN_STORAGE_KEY)
}

function isValidEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
}

function formatRequestedDate(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return new Intl.DateTimeFormat("ja-JP", {
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date)
}

export default function OnboardingPage() {
  const router = useRouter()
  const [checkingSession, setCheckingSession] = useState(true)
  const [step, setStep] = useState<Step>("name")
  const [displayName, setDisplayName] = useState("")
  const [orgName, setOrgName] = useState("")
  const [ownerEmail, setOwnerEmail] = useState("")
  const [ownerOrgs, setOwnerOrgs] = useState<OwnerOrgOption | null>(null)
  const [selectedOrgId, setSelectedOrgId] = useState<string | null>(null)
  const [pendingJoin, setPendingJoin] = useState<PendingJoinSnapshot | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [userId, setUserId] = useState<string | null>(null)

  useEffect(() => {
    let active = true

    const resolveBootstrap = async () => {
      try {
        const { data: sessionData } = await supabase.auth.getSession()
        let user = sessionData.session?.user ?? null

        if (!user) {
          user = (await supabase.auth.getUser()).data.user
        }

        if (!active) return

        if (!user) {
          router.replace("/")
          return
        }

        const profilePromise = supabase.from("user_profiles").select("display_name").eq("user_id", user.id).maybeSingle()

        let membershipCount = 0
        const token = sessionData.session?.access_token ?? null

        if (token) {
          try {
            const res = await fetch("/api/auth/my-orgs", {
              headers: { Authorization: `Bearer ${token}` },
            })
            const json = (await res.json().catch(() => null)) as
              | { ok?: boolean; orgs?: Array<{ org_id: string }> }
              | null
            if (json?.ok && Array.isArray(json.orgs)) {
              membershipCount = json.orgs.length
            }
          } catch {
            membershipCount = 0
          }
        }

        if (membershipCount === 0) {
          let appUserRows =
            (await supabase.from("app_users").select("org_id").eq("user_id", user.id)).data ?? []

          for (const delayMs of [400, 1000]) {
            if ((appUserRows?.length ?? 0) > 0) break
            await new Promise((resolve) => setTimeout(resolve, delayMs))
            appUserRows =
              (await supabase.from("app_users").select("org_id").eq("user_id", user.id)).data ?? []
          }

          membershipCount = new Set(
            (appUserRows as Array<{ org_id?: string | null }>)
              .map((row) => row.org_id)
              .filter((value): value is string => typeof value === "string" && value.length > 0)
          ).size
        }

        const { data: profileRow } = await profilePromise
        if (!active) return

        if (membershipCount > 0) {
          clearPendingJoinSnapshot()
        }

        if (membershipCount > 1) {
          router.replace("/orgs")
          return
        }

        if (membershipCount === 1) {
          router.replace("/home")
          return
        }

        const savedDisplayName = ((profileRow as { display_name?: string } | null)?.display_name ?? "").trim()
        const savedPendingJoin = readPendingJoinSnapshot()

        setUserId(user.id)
        setDisplayName(savedDisplayName)
        setPendingJoin(savedPendingJoin)
        setStep(savedPendingJoin ? "joined" : savedDisplayName ? "choice" : "name")
      } finally {
        if (active) {
          setCheckingSession(false)
        }
      }
    }

    void resolveBootstrap()

    return () => {
      active = false
    }
  }, [router])

  const getToken = useCallback(async () => {
    const { data } = await supabase.auth.getSession()
    return data.session?.access_token ?? null
  }, [])

  const resetJoinState = useCallback(() => {
    setOwnerOrgs(null)
    setSelectedOrgId(null)
    setOwnerEmail("")
    setError(null)
  }, [])

  const handleEnter =
    (action: () => void, disabled: boolean) =>
    (event: KeyboardEvent<HTMLInputElement>) => {
      if (event.key !== "Enter") return
      event.preventDefault()
      if (disabled) return
      action()
    }

  const handleClose = useCallback(() => {
    router.replace(LP_VIEW_HREF)
  }, [router])

  const handleSubmitName = useCallback(async () => {
    if (!displayName.trim() || !userId) return

    setError(null)
    setLoading(true)

    try {
      const { data: authData } = await supabase.auth.getUser()
      const user = authData.user

      if (!user || user.id !== userId) {
        router.replace("/?message=relogin")
        return
      }

      const { error: upsertError } = await supabase.from("user_profiles").upsert(
        {
          user_id: user.id,
          display_name: displayName.trim(),
          updated_at: new Date().toISOString(),
        },
        { onConflict: "user_id" }
      )

      if (upsertError) throw upsertError

      setStep("choice")
    } catch (submitError) {
      const message = submitError instanceof Error ? submitError.message : ""
      const missingTable =
        message.includes("user_profiles") &&
        (message.includes("schema cache") || message.includes("does not exist"))

      setError(
        missingTable
          ? "表示名を保存する準備がまだ完了していません。Supabase の SQL を適用してください。"
          : message || "表示名を保存できませんでした。"
      )
    } finally {
      setLoading(false)
    }
  }, [displayName, router, userId])

  const handleCreatePersonal = useCallback(async () => {
    if (!userId) return

    setError(null)
    setLoading(true)

    try {
      const token = await getToken()
      if (!token) throw new Error("ログイン状態を確認できませんでした。")

      const workspaceName = displayName.trim() ? `${displayName.trim()}のワークスペース` : "個人用ワークスペース"
      const res = await fetch("/api/onboarding/create-org", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          type: "personal",
          workspaceName,
          displayNameInOrg: displayName.trim() || undefined,
        }),
      })

      const data = (await res.json().catch(() => null)) as { error?: string } | null
      if (!res.ok) throw new Error(data?.error ?? "ワークスペースを作成できませんでした。")

      clearPendingJoinSnapshot()
      window.location.assign("/home")
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "ワークスペースを作成できませんでした。")
    } finally {
      setLoading(false)
    }
  }, [displayName, getToken, userId])

  const handleCreateOrg = useCallback(async () => {
    if (!orgName.trim() || !userId) return

    setError(null)
    setLoading(true)

    try {
      const token = await getToken()
      if (!token) throw new Error("ログイン状態を確認できませんでした。")

      const res = await fetch("/api/onboarding/create-org", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          type: "new_org",
          orgName: orgName.trim(),
          displayNameInOrg: displayName.trim() || undefined,
        }),
      })

      const data = (await res.json().catch(() => null)) as { error?: string } | null
      if (!res.ok) throw new Error(data?.error ?? "組織を作成できませんでした。")

      clearPendingJoinSnapshot()
      window.location.assign("/home")
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "組織を作成できませんでした。")
    } finally {
      setLoading(false)
    }
  }, [displayName, getToken, orgName, userId])

  const lookupOrgsByOwnerEmail = useCallback(async (email: string) => {
    const res = await fetch("/api/orgs/lookup-by-owner-email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ownerEmail: email }),
    })

    const data = (await res.json().catch(() => null)) as
      | {
          ok?: boolean
          message?: string
          ownerUserId?: string
          orgs?: Array<{ id: string; name: string }>
        }
      | null

    if (!res.ok || data?.ok !== true || !data.ownerUserId) {
      throw new Error(data?.message ?? "組織を確認できませんでした。")
    }

    return {
      ownerUserId: data.ownerUserId,
      orgs: Array.isArray(data.orgs) ? data.orgs : [],
    }
  }, [])

  const submitJoinRequest = useCallback(
    async (ownerUserId: string, orgId: string) => {
      const token = await getToken()
      if (!token) throw new Error("ログイン状態を確認できませんでした。")

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

      const data = (await res.json().catch(() => null)) as { error?: string } | null
      if (!res.ok) {
        const rawMessage = data?.error ?? "参加申請を送信できませんでした。"
        if (rawMessage.toLowerCase().includes("duplicate")) {
          throw new Error("この組織にはすでに申請済みです。")
        }
        throw new Error(rawMessage)
      }
    },
    [displayName, getToken]
  )

  const handleJoinContinue = useCallback(async () => {
    if (ownerOrgs?.ownerUserId) {
      if (!selectedOrgId) {
        setError("参加先の組織を選択してください。")
        return
      }

      setError(null)
      setLoading(true)

      try {
        await submitJoinRequest(ownerOrgs.ownerUserId, selectedOrgId)

        const selectedOrg = ownerOrgs.orgs.find((org) => org.id === selectedOrgId) ?? null
        const snapshot = {
          ownerEmail: ownerEmail.trim(),
          orgName: selectedOrg?.name ?? null,
          requestedAt: new Date().toISOString(),
        }

        writePendingJoinSnapshot(snapshot)
        setPendingJoin(snapshot)
        setStep("joined")
      } catch (joinError) {
        setError(joinError instanceof Error ? joinError.message : "参加申請を送信できませんでした。")
      } finally {
        setLoading(false)
      }

      return
    }

    if (!ownerEmail.trim()) return

    if (!isValidEmail(ownerEmail.trim())) {
      setError("メールアドレスの形式を確認してください。")
      return
    }

    setError(null)
    setLoading(true)

    try {
      const result = await lookupOrgsByOwnerEmail(ownerEmail.trim())

      if (result.orgs.length === 0) {
        setOwnerOrgs(null)
        setSelectedOrgId(null)
        setError("該当する組織が見つかりませんでした。")
        return
      }

      if (result.orgs.length === 1) {
        const org = result.orgs[0]
        await submitJoinRequest(result.ownerUserId, org.id)

        const snapshot = {
          ownerEmail: ownerEmail.trim(),
          orgName: org.name,
          requestedAt: new Date().toISOString(),
        }

        writePendingJoinSnapshot(snapshot)
        setPendingJoin(snapshot)
        setStep("joined")
        return
      }

      setOwnerOrgs(result)
      setSelectedOrgId(null)
    } catch (joinError) {
      setError(joinError instanceof Error ? joinError.message : "参加申請を送信できませんでした。")
    } finally {
      setLoading(false)
    }
  }, [lookupOrgsByOwnerEmail, ownerEmail, ownerOrgs, selectedOrgId, submitJoinRequest])

  if (checkingSession || !userId) {
    return (
      <div className="onboarding-page">
        <div className="onboarding-stage">
          <LoadingMark />
        </div>
      </div>
    )
  }

  const errorBlock = error ? (
    <div role="alert" className="onboarding-alert">
      {error}
    </div>
  ) : null

  const joinSelectionMode = Boolean(ownerOrgs && ownerOrgs.orgs.length > 1)
  const requestedAtLabel = pendingJoin?.requestedAt ? formatRequestedDate(pendingJoin.requestedAt) : null

  return (
    <>
      {step === "name" ? (
        <OnboardingShell
          stepCurrent={1}
          stepTotal={3}
          title="表示名を入力"
          description="組織ごとに表示名は変更できます"
          onClose={handleClose}
          ctaLabel="次へ"
          ctaDisabled={loading || !displayName.trim()}
          ctaLoading={loading}
          onCtaClick={handleSubmitName}
          footerText="後から変更できます"
        >
          {errorBlock}
          <div className="onboarding-form-stack">
            <input
              id="displayName"
              type="text"
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
              onKeyDown={handleEnter(handleSubmitName, loading || !displayName.trim())}
              placeholder="例: 一ノ瀬あさひ"
              className={inputClassName}
              autoComplete="name"
              autoFocus
              maxLength={40}
              aria-label="表示名"
            />
          </div>
        </OnboardingShell>
      ) : null}

      {step === "choice" ? (
        <OnboardingShell
          stepCurrent={2}
          stepTotal={3}
          title="利用方法を選択"
          description="あとから切り替えや追加もできます"
          onBack={() => setStep("name")}
          onClose={handleClose}
        >
          {errorBlock}
          <div className="onboarding-choice-section">
            <div className="onboarding-choice-grid">
              <ChoiceCard
                icon={<PersonChoiceIcon />}
                title="個人で使う"
                description="自分専用のワークスペースを作成します"
                onClick={() => {
                  resetJoinState()
                  setStep("personal")
                }}
              />
              <ChoiceCard
                icon={<TeamChoiceIcon />}
                title="チームで使う"
                description="チーム用の組織を作成して管理を始めます"
                onClick={() => {
                  resetJoinState()
                  setStep("new_org")
                }}
              />
            </div>
            <button
              type="button"
              className="onboarding-secondary-link"
              onClick={() => {
                setError(null)
                setStep("join")
              }}
            >
              <span className="onboarding-secondary-link-icon" aria-hidden="true">
                <JoinChoiceIcon />
              </span>
              既存組織に参加する
            </button>
          </div>
        </OnboardingShell>
      ) : null}

      {step === "personal" ? (
        <OnboardingShell
          stepCurrent={3}
          stepTotal={3}
          title="個人用ワークスペースを作成します"
          description="すぐに使い始められます"
          onBack={() => setStep("choice")}
          onClose={handleClose}
          ctaLabel="作成して続ける"
          ctaDisabled={loading}
          ctaLoading={loading}
          onCtaClick={handleCreatePersonal}
        >
          {errorBlock}
          <div className="onboarding-confirm-card">
            <div className="onboarding-confirm-label">表示名</div>
            <div className="onboarding-confirm-value">{displayName || "未設定"}</div>
            <p className="onboarding-confirm-note">この名前で個人用のワークスペースを作成します。</p>
          </div>
        </OnboardingShell>
      ) : null}

      {step === "new_org" ? (
        <OnboardingShell
          stepCurrent={3}
          stepTotal={3}
          title="組織名を入力"
          description="チームで利用する組織を作成します"
          onBack={() => setStep("choice")}
          onClose={handleClose}
          ctaLabel="組織を作成"
          ctaDisabled={loading || !orgName.trim()}
          ctaLoading={loading}
          onCtaClick={handleCreateOrg}
          footerText="組織名はあとから変更できます"
        >
          {errorBlock}
          <div className="onboarding-form-stack">
            <input
              id="orgName"
              type="text"
              value={orgName}
              onChange={(event) => setOrgName(event.target.value)}
              onKeyDown={handleEnter(handleCreateOrg, loading || !orgName.trim())}
              placeholder="例: プロジェクトX 株式会社"
              className={inputClassName}
              autoComplete="organization"
              autoFocus
              maxLength={40}
              aria-label="組織名"
            />
          </div>
        </OnboardingShell>
      ) : null}

      {step === "join" ? (
        <OnboardingShell
          stepCurrent={3}
          stepTotal={3}
          title={joinSelectionMode ? "参加先を選択" : "組織に参加する"}
          description={
            joinSelectionMode
              ? "参加申請を送る組織を選択してください"
              : "オーナーのメールアドレスを入力すると参加申請を送れます"
          }
          onBack={() => {
            if (joinSelectionMode) {
              setOwnerOrgs(null)
              setSelectedOrgId(null)
              setError(null)
              return
            }

            resetJoinState()
            setStep("choice")
          }}
          onClose={handleClose}
          ctaLabel={joinSelectionMode ? "この組織に申請する" : "参加申請を送る"}
          ctaDisabled={loading || (joinSelectionMode ? !selectedOrgId : !ownerEmail.trim())}
          ctaLoading={loading}
          onCtaClick={handleJoinContinue}
          footerText={joinSelectionMode ? undefined : "承認されると参加できます"}
        >
          {errorBlock}

          {!joinSelectionMode ? (
            <div className="onboarding-form-stack">
              <input
                id="ownerEmail"
                type="email"
                value={ownerEmail}
                onChange={(event) => setOwnerEmail(event.target.value)}
                onKeyDown={handleEnter(handleJoinContinue, loading || !ownerEmail.trim())}
                placeholder="owner@example.com"
                className={inputClassName}
                autoComplete="email"
                autoFocus
                aria-label="オーナーのメールアドレス"
              />
            </div>
          ) : (
            <div className="onboarding-selection-stack">
              <div className="onboarding-detail-card">
                <div className="onboarding-detail-label">送信先</div>
                <div className="onboarding-detail-value">{ownerEmail}</div>
              </div>

              <div className="onboarding-selection-list" role="list" aria-label="参加先の組織一覧">
                {ownerOrgs?.orgs.map((org) => {
                  const selected = selectedOrgId === org.id

                  return (
                    <button
                      key={org.id}
                      type="button"
                      className={selected ? "onboarding-selection-card is-selected" : "onboarding-selection-card"}
                      onClick={() => setSelectedOrgId(org.id)}
                    >
                      <span className="onboarding-selection-title">{org.name}</span>
                      <span className="onboarding-selection-description">この組織に参加申請を送ります</span>
                    </button>
                  )
                })}
              </div>
            </div>
          )}
        </OnboardingShell>
      ) : null}

      {step === "joined" ? (
        <OnboardingShell
          stepCurrent={3}
          stepTotal={3}
          title="申請を送信しました"
          description="承認されると参加できます"
          onClose={handleClose}
        >
          <div className="onboarding-confirm-card onboarding-confirm-card--success">
            <div className="onboarding-confirm-label">申請先</div>
            <div className="onboarding-confirm-value">{pendingJoin?.orgName ?? "オーナー確認待ち"}</div>
            <p className="onboarding-confirm-note">
              {pendingJoin?.ownerEmail ? `${pendingJoin.ownerEmail} に紐づく組織へ申請しました。` : "オーナーに参加申請を送りました。"}
            </p>
            <p className="onboarding-inline-note">オーナーにはアプリ内通知で届きます。</p>
            {requestedAtLabel ? <p className="onboarding-inline-note">送信日時: {requestedAtLabel}</p> : null}
            <p className="onboarding-inline-note">承認後に再度アクセスするとホームへ進めます。</p>
          </div>
        </OnboardingShell>
      ) : null}
    </>
  )
}
