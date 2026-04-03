"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import OnboardingShell from "@/components/OnboardingShell"
import { useAuthOrg } from "@/hooks/useAuthOrg"
import { licenseAccessState } from "@/lib/platform"
import {
  PLATFORM_THANKS_PATH,
  POST_PURCHASE_ONBOARDING_PATH,
  resolvePlatformEntryPath,
} from "@/lib/platformFlow"
import { supabase } from "@/lib/supabase"

type LicensePayload = {
  entitlement: { status: string; grant_type?: string | null; activated_at?: string | null } | null
  paymentRequests: Array<{
    request_number: string
    invoice_number?: string | null
    due_date: string | null
  }>
}

function resolveBackHref(source: string | null) {
  if (source === "post-purchase") return POST_PURCHASE_ONBOARDING_PATH
  if (source === "thanks") return PLATFORM_THANKS_PATH
  if (source === "onboarding") return "/onboarding"
  return "/?showLp=1"
}

export default function RequestOrgPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const flowSource = searchParams.get("from")
  const { user, memberships, loading: authLoading } = useAuthOrg()
  const [orgName, setOrgName] = useState("")
  const [displayName, setDisplayName] = useState("")
  const [license, setLicense] = useState<LicensePayload | null>(null)
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const backHref = useMemo(() => resolveBackHref(flowSource), [flowSource])

  const load = useCallback(async () => {
    setLoading(true)

    const [{ data: sessionData }, { data: authUser }] = await Promise.all([
      supabase.auth.getSession(),
      supabase.auth.getUser(),
    ])
    const token = sessionData.session?.access_token

    if (!token || !authUser.user) {
      router.replace("/")
      return
    }

    const [licenseRes, profileRes] = await Promise.all([
      fetch("/api/platform/my-license", { headers: { Authorization: `Bearer ${token}` } }),
      supabase.from("user_profiles").select("display_name").eq("user_id", authUser.user.id).maybeSingle(),
    ])

    const licenseJson = await licenseRes.json().catch(() => null)
    if (!licenseRes.ok || !licenseJson?.ok) {
      setError(licenseJson?.error ?? "ライセンス状態を確認できませんでした。")
      setLoading(false)
      return
    }

    setLicense({
      entitlement: licenseJson.entitlement,
      paymentRequests: Array.isArray(licenseJson.paymentRequests) ? licenseJson.paymentRequests : [],
    })
    setDisplayName(String(profileRes.data?.display_name ?? ""))
    setLoading(false)
  }, [router])

  useEffect(() => {
    if (authLoading) return

    if (!user) {
      router.replace("/")
      return
    }

    if (flowSource && memberships.length > 0) {
      router.replace(resolvePlatformEntryPath(memberships.length))
    }
  }, [authLoading, flowSource, memberships.length, router, user])

  useEffect(() => {
    if (authLoading) return
    void load()
  }, [authLoading, load])

  const accessState = useMemo(
    () => licenseAccessState((license?.entitlement?.status as "active" | "pending_payment" | null) ?? null),
    [license?.entitlement?.status]
  )

  const handleCreate = useCallback(async () => {
    const token = (await supabase.auth.getSession()).data.session?.access_token
    if (!token) {
      router.replace("/")
      return
    }

    setSubmitting(true)
    setError(null)
    const res = await fetch("/api/orgs/create", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        org_name: orgName,
        display_name: displayName,
      }),
    })
    const json = await res.json().catch(() => null)
    setSubmitting(false)

    if (!res.ok || !json?.ok) {
      setError(json?.error ?? "組織を作成できませんでした。")
      return
    }

    window.location.assign("/home")
  }, [displayName, orgName, router])

  if (authLoading || loading) {
    return <div style={{ padding: 32, color: "var(--muted)" }}>読み込み中...</div>
  }

  if (accessState === "purchase_required") {
    return (
      <OnboardingShell
        stepCurrent={1}
        stepTotal={3}
        title="導入フローをここから始めます"
        description={
          <>
            まずはライセンス購入を完了させます。
            <br />
            購入申請のあと、入金確認が完了すると初回セットアップへそのまま進めます。
          </>
        }
        onBack={() => router.push(backHref)}
        onClose={() => router.replace("/?showLp=1")}
        ctaLabel="ライセンス購入へ進む"
        onCtaClick={() => router.push(`/purchase-license?from=${encodeURIComponent(flowSource ?? "request-org")}`)}
        footerText="このあと 購入申請 -> 入金確認 -> 初回セットアップ の順で進みます。"
      >
        <div className="onboarding-confirm-card">
          <div className="onboarding-confirm-label">購入内容</div>
          <div className="onboarding-confirm-value">NovaLoop Platform License</div>
          <p className="onboarding-confirm-note">
            購入後は振込先と確認状況を 1 画面で確認できます。入金確認が完了したら、初回セットアップへ進みます。
          </p>
        </div>
      </OnboardingShell>
    )
  }

  if (accessState === "pending_payment") {
    const pending = license?.paymentRequests[0]

    return (
      <OnboardingShell
        stepCurrent={2}
        stepTotal={3}
        title="入金確認をお待ちください"
        description={
          <>
            購入申請は完了しています。
            <br />
            振込情報の確認と入金連絡は次の画面でまとめて行えます。確認が完了するとサンクスページへ進みます。
          </>
        }
        onBack={() => router.push(backHref)}
        onClose={() => router.replace("/?showLp=1")}
        ctaLabel="支払い状況を確認する"
        onCtaClick={() => router.push("/pending-payment")}
      >
        <div className="onboarding-confirm-card">
          <div className="onboarding-confirm-label">現在の購入申請</div>
          <div className="onboarding-confirm-value">{pending?.request_number ?? "pending"}</div>
          <p className="onboarding-confirm-note">
            振込先、振込識別子、入金連絡、確認状況は pending-payment 画面でまとめて確認できます。
          </p>
        </div>
      </OnboardingShell>
    )
  }

  const isPostPurchaseFlow = flowSource === "post-purchase"

  return (
    <OnboardingShell
      stepCurrent={1}
      stepTotal={1}
      title={isPostPurchaseFlow ? "初回セットアップを始めましょう" : "新しい組織を作成"}
      description={
        isPostPurchaseFlow
          ? "購入は完了しています。最初に組織を作成すると、そのままホームから利用を始められます。"
          : "利用を始める組織名を決めてください。作成後はそのままホームへ進みます。"
      }
      onBack={() => router.push(backHref)}
      onClose={() => router.replace(isPostPurchaseFlow ? PLATFORM_THANKS_PATH : "/?showLp=1")}
      ctaLabel="組織を作成して利用を開始"
      ctaDisabled={submitting || !orgName.trim()}
      ctaLoading={submitting}
      onCtaClick={() => void handleCreate()}
      footerText={`現在のライセンス状態: ${license?.entitlement?.grant_type ?? "paid"} / ${license?.entitlement?.status ?? "active"}`}
    >
      {error ? <div role="alert" className="onboarding-alert">{error}</div> : null}
      <div className="onboarding-form-stack">
        <input
          className="onboarding-input"
          value={orgName}
          onChange={(event) => setOrgName(event.target.value)}
          placeholder="組織名"
          maxLength={60}
        />
        <input
          className="onboarding-input"
          value={displayName}
          onChange={(event) => setDisplayName(event.target.value)}
          placeholder="ホームに表示する名前"
          maxLength={40}
        />
      </div>
    </OnboardingShell>
  )
}
