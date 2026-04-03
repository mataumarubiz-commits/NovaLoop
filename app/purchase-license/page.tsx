"use client"

import { useCallback, useEffect, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import OnboardingShell from "@/components/OnboardingShell"
import { supabase } from "@/lib/supabase"

type FormState = {
  full_name: string
  company_name: string
  address: string
  phone: string
  contact_email: string
  receipt_name: string
  billing_email: string
  billing_address: string
  note: string
}

export default function PurchaseLicensePage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const flowSource = searchParams.get("from") ?? "request-org"
  const [form, setForm] = useState<FormState>({
    full_name: "",
    company_name: "",
    address: "",
    phone: "",
    contact_email: "",
    receipt_name: "",
    billing_email: "",
    billing_address: "",
    note: "",
  })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    void supabase.auth.getUser().then(({ data }) => {
      if (!active) return
      if (!data.user) {
        router.replace("/")
        return
      }

      setForm((current) => ({
        ...current,
        contact_email: current.contact_email || data.user.email || "",
        billing_email: current.billing_email || data.user.email || "",
      }))
    })

    return () => {
      active = false
    }
  }, [router])

  const updateField = useCallback(
    <K extends keyof FormState,>(key: K, value: FormState[K]) => {
      setForm((current) => ({ ...current, [key]: value }))
    },
    []
  )

  const handleSubmit = useCallback(async () => {
    setLoading(true)
    setError(null)
    setInfo(null)

    const token = (await supabase.auth.getSession()).data.session?.access_token
    if (!token) {
      router.replace("/")
      return
    }

    const res = await fetch("/api/platform/purchase-license", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(form),
    })
    const json = await res.json().catch(() => null)
    setLoading(false)

    if (!res.ok || !json?.ok) {
      setError(json?.error ?? "購入申請に失敗しました。")
      return
    }

    if (json?.reused_existing) {
      setInfo("進行中の購入申請があるため、その申請に合流します。")
    }

    router.push(json?.reused_existing ? "/pending-payment?existing=1" : "/pending-payment")
  }, [form, router])

  return (
    <OnboardingShell
      stepCurrent={2}
      stepTotal={3}
      title="購入申請を完了する"
      description={
        <>
          購入申請に必要な情報を入力します。
          <br />
          申請後は振込先の確認、入金連絡、確認状況の追跡を 1 画面で進められます。
        </>
      }
      onBack={() => router.push(`/request-org?from=${encodeURIComponent(flowSource)}`)}
      onClose={() => router.replace("/?showLp=1")}
      ctaLabel="購入申請を送信"
      ctaDisabled={
        loading ||
        !form.full_name.trim() ||
        !form.receipt_name.trim() ||
        !form.address.trim() ||
        !form.phone.trim() ||
        !form.contact_email.trim() ||
        !form.billing_email.trim()
      }
      ctaLoading={loading}
      onCtaClick={() => void handleSubmit()}
      footerText="価格は 300,000円です。申請後は pending-payment 画面から入金確認まで迷わず進めます。"
    >
      {error ? <div role="alert" className="onboarding-alert">{error}</div> : null}
      {info ? <div className="onboarding-confirm-card onboarding-confirm-card--success">{info}</div> : null}

      <div className="onboarding-confirm-card">
        <div className="onboarding-confirm-label">購入対象</div>
        <div className="onboarding-confirm-value">NovaLoop Platform License</div>
        <p className="onboarding-confirm-note">
          申請後は振込先情報を確認できます。入金確認が完了すると、領収書と初回セットアップ導線が利用可能になります。
        </p>
      </div>

      <div className="onboarding-form-stack">
        <input
          className="onboarding-input"
          value={form.full_name}
          onChange={(event) => updateField("full_name", event.target.value)}
          placeholder="申請者名 *"
        />
        <input
          className="onboarding-input"
          value={form.receipt_name}
          onChange={(event) => updateField("receipt_name", event.target.value)}
          placeholder="領収書の宛名 *"
        />
        <input
          className="onboarding-input"
          value={form.company_name}
          onChange={(event) => updateField("company_name", event.target.value)}
          placeholder="会社名"
        />
        <textarea
          className="onboarding-input"
          value={form.address}
          onChange={(event) => updateField("address", event.target.value)}
          placeholder="住所 *"
          rows={3}
        />
        <input
          className="onboarding-input"
          value={form.phone}
          onChange={(event) => updateField("phone", event.target.value)}
          placeholder="電話番号 *"
        />
        <input
          className="onboarding-input"
          value={form.contact_email}
          onChange={(event) => updateField("contact_email", event.target.value)}
          placeholder="連絡先メールアドレス *"
          type="email"
        />
        <input
          className="onboarding-input"
          value={form.billing_email}
          onChange={(event) => updateField("billing_email", event.target.value)}
          placeholder="領収書送付先メールアドレス *"
          type="email"
        />
        <textarea
          className="onboarding-input"
          value={form.billing_address}
          onChange={(event) => updateField("billing_address", event.target.value)}
          placeholder="領収書の送付先住所"
          rows={3}
        />
        <textarea
          className="onboarding-input"
          value={form.note}
          onChange={(event) => updateField("note", event.target.value)}
          placeholder="補足事項"
          rows={3}
        />
      </div>
    </OnboardingShell>
  )
}
