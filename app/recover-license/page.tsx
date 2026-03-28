"use client"

import { useCallback, useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import OnboardingShell from "@/components/OnboardingShell"
import { supabase } from "@/lib/supabase"

type FormState = {
  previous_google_email: string
  full_name: string
  company_name: string
  address: string
  phone: string
  contact_email: string
  reason: string
  reference_note: string
}

export default function RecoverLicensePage() {
  const router = useRouter()
  const [form, setForm] = useState<FormState>({
    previous_google_email: "",
    full_name: "",
    company_name: "",
    address: "",
    phone: "",
    contact_email: "",
    reason: "",
    reference_note: "",
  })
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

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
    setSubmitting(true)
    setError(null)
    setSuccess(null)
    const token = (await supabase.auth.getSession()).data.session?.access_token
    if (!token) {
      router.replace("/")
      return
    }
    const res = await fetch("/api/platform/transfers/request", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(form),
    })
    const json = await res.json().catch(() => null)
    setSubmitting(false)
    if (!res.ok || !json?.ok) {
      setError(json?.error ?? "再付与申請に失敗しました。")
      return
    }
    setSuccess("再付与申請を受け付けました。本人確認後に platform_admin が審査します。")
  }, [form, router])

  return (
    <OnboardingShell
      stepCurrent={1}
      stepTotal={1}
      title="ライセンス再付与を申請"
      description="Googleアカウントの凍結や喪失時の救済用フォームです。承認時は必要に応じて旧組織のオーナーも新アカウントへ移管します。"
      onBack={() => router.push("/settings/license")}
      onClose={() => router.replace("/")}
      ctaLabel="再付与申請を送信する"
      ctaDisabled={
        submitting ||
        !form.full_name.trim() ||
        !form.address.trim() ||
        !form.phone.trim() ||
        !form.contact_email.trim() ||
        !form.reason.trim()
      }
      ctaLoading={submitting}
      onCtaClick={() => void handleSubmit()}
    >
      {error ? <div role="alert" className="onboarding-alert">{error}</div> : null}
      {success ? <div className="onboarding-confirm-card onboarding-confirm-card--success">{success}</div> : null}
      <div className="onboarding-form-stack">
        <input
          className="onboarding-input"
          value={form.previous_google_email}
          onChange={(event) => setForm({ ...form, previous_google_email: event.target.value })}
          placeholder="以前のGoogleメール（分かれば）"
        />
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
          value={form.reason}
          onChange={(event) => setForm({ ...form, reason: event.target.value })}
          placeholder="理由"
          rows={3}
        />
        <textarea
          className="onboarding-input"
          value={form.reference_note}
          onChange={(event) => setForm({ ...form, reference_note: event.target.value })}
          placeholder="請求書番号 / 領収書番号 / 振込名義メモ（任意）"
          rows={3}
        />
      </div>
    </OnboardingShell>
  )
}
