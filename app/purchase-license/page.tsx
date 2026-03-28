"use client"

import { useCallback, useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import OnboardingShell from "@/components/OnboardingShell"
import { supabase } from "@/lib/supabase"

type FormState = {
  full_name: string
  company_name: string
  address: string
  phone: string
  contact_email: string
  note: string
}

export default function PurchaseLicensePage() {
  const router = useRouter()
  const [form, setForm] = useState<FormState>({
    full_name: "",
    company_name: "",
    address: "",
    phone: "",
    contact_email: "",
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
      }))
    })
    return () => {
      active = false
    }
  }, [router])

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
      setInfo("既存の購入申請を再利用しました。")
    }

    router.push(json?.reused_existing ? "/pending-payment?existing=1" : "/pending-payment")
  }, [form, router])

  return (
    <OnboardingShell
      stepCurrent={1}
      stepTotal={1}
      title="ライセンスを購入する"
      description={<>銀行振込のみ対応です。領収書PDFは購入後に発行されます。<br />入金確認後に組織作成権を有効化します。</>}
      onBack={() => router.push("/request-org")}
      onClose={() => router.replace("/")}
      ctaLabel="購入手続きへ進む"
      ctaDisabled={
        loading ||
        !form.full_name.trim() ||
        !form.address.trim() ||
        !form.phone.trim() ||
        !form.contact_email.trim()
      }
      ctaLoading={loading}
      onCtaClick={() => void handleSubmit()}
      footerText="価格は 300,000円（税込）です。振込手数料はお客様負担です。"
    >
      {error ? <div role="alert" className="onboarding-alert">{error}</div> : null}
      {info ? <div className="onboarding-confirm-card onboarding-confirm-card--success">{info}</div> : null}

      <div className="onboarding-confirm-card">
        <div className="onboarding-confirm-label">商品</div>
        <div className="onboarding-confirm-value">NovaLoop</div>
        <p className="onboarding-confirm-note">
          組織作成ライセンス — 一度の購入で、いつでも新しい組織を作成できます。
        </p>
      </div>

      <div className="onboarding-form-stack">
        <input
          className="onboarding-input"
          value={form.full_name}
          onChange={(event) => setForm({ ...form, full_name: event.target.value })}
          placeholder="氏名"
        />
        <input
          className="onboarding-input"
          value={form.company_name}
          onChange={(event) => setForm({ ...form, company_name: event.target.value })}
          placeholder="会社名（任意）"
        />
        <textarea
          className="onboarding-input"
          value={form.address}
          onChange={(event) => setForm({ ...form, address: event.target.value })}
          placeholder="住所"
          rows={3}
        />
        <input
          className="onboarding-input"
          value={form.phone}
          onChange={(event) => setForm({ ...form, phone: event.target.value })}
          placeholder="電話番号"
        />
        <input
          className="onboarding-input"
          value={form.contact_email}
          onChange={(event) => setForm({ ...form, contact_email: event.target.value })}
          placeholder="連絡先メールアドレス"
          type="email"
        />
        <textarea
          className="onboarding-input"
          value={form.note}
          onChange={(event) => setForm({ ...form, note: event.target.value })}
          placeholder="備考（任意）"
          rows={3}
        />
      </div>
    </OnboardingShell>
  )
}
