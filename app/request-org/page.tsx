"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import OnboardingShell from "@/components/OnboardingShell"
import { supabase } from "@/lib/supabase"
import { licenseAccessState } from "@/lib/platform"

type LicensePayload = {
  entitlement: { status: string; grant_type?: string | null; activated_at?: string | null } | null
  paymentRequests: Array<{
    request_number: string
    invoice_number?: string | null
    due_date: string | null
  }>
}

export default function RequestOrgPage() {
  const router = useRouter()
  const [orgName, setOrgName] = useState("")
  const [displayName, setDisplayName] = useState("")
  const [license, setLicense] = useState<LicensePayload | null>(null)
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    const [{ data }, { data: authUser }] = await Promise.all([supabase.auth.getSession(), supabase.auth.getUser()])
    const token = data.session?.access_token
    if (!token) {
      router.replace("/")
      return
    }

    const [licenseRes, profileRes] = await Promise.all([
      fetch("/api/platform/my-license", { headers: { Authorization: `Bearer ${token}` } }),
      supabase.from("user_profiles").select("display_name").eq("user_id", authUser.user?.id ?? "").maybeSingle(),
    ])

    const licenseJson = await licenseRes.json().catch(() => null)
    if (!licenseRes.ok || !licenseJson?.ok) {
      setError(licenseJson?.error ?? "ライセンス状態を取得できませんでした。")
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

  /* eslint-disable */
  useEffect(() => {
    void load()
  }, [load])
  /* eslint-enable */

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

  if (loading) {
    return <div style={{ padding: 32, color: "var(--muted)" }}>読み込み中...</div>
  }

  if (accessState === "purchase_required") {
    return (
      <OnboardingShell
        stepCurrent={1}
        stepTotal={1}
        title="非効率を、ここで終わらせる"
        description={<>一度のご購入で、組織をいくつでも・いつでも<br />作成できるようになります。月額費用はかかりません。</>}
        onBack={() => router.push("/onboarding")}
        onClose={() => router.replace("/")}
        ctaLabel="ライセンス購入へ進む"
        onCtaClick={() => router.push("/purchase-license")}
        footerText="価格は 300,000円（税込）です。入金確認後に組織作成権が有効化されます。"
      >
        <div className="onboarding-confirm-card">
          <div className="onboarding-confirm-label">料金</div>
          <div className="onboarding-confirm-value">300,000円（税込）</div>
          <p className="onboarding-confirm-note">
            一度購入すると、そのGoogleアカウントで無期限・無制限に新しい組織を作成できます。
          </p>
        </div>
      </OnboardingShell>
    )
  }

  if (accessState === "pending_payment") {
    const pending = license?.paymentRequests[0]
    return (
      <OnboardingShell
        stepCurrent={1}
        stepTotal={1}
        title="入金確認待ちです"
        description="請求書を発行済みです。入金確認後に組織作成権が有効化されます。"
        onBack={() => router.push("/onboarding")}
        onClose={() => router.replace("/")}
        ctaLabel="振込案内を確認する"
        onCtaClick={() => router.push("/pending-payment")}
      >
        <div className="onboarding-confirm-card">
          <div className="onboarding-confirm-label">現在の申請</div>
          <div className="onboarding-confirm-value">{pending?.request_number ?? "pending"}</div>
          <p className="onboarding-confirm-note">
            請求書PDF、振込先、振込識別子は pending-payment 画面で確認できます。
          </p>
        </div>
      </OnboardingShell>
    )
  }

  return (
    <OnboardingShell
      stepCurrent={1}
      stepTotal={1}
      title="新しい組織を作成"
      description="支払済みのご本人だけが、新しい組織の初回オーナーになります。オーナーの追加はできません。"
      onBack={() => router.push("/onboarding")}
      onClose={() => router.replace("/")}
      ctaLabel="組織を作成する"
      ctaDisabled={submitting || !orgName.trim()}
      ctaLoading={submitting}
      onCtaClick={() => void handleCreate()}
      footerText={`現在のライセンス: ${license?.entitlement?.grant_type ?? "paid"} / ${license?.entitlement?.status ?? "active"}`}
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
          placeholder="オーナー表示名"
          maxLength={40}
        />
      </div>
    </OnboardingShell>
  )
}
