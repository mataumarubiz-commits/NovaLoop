"use client"

import { useCallback, useEffect, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import OnboardingShell from "@/components/OnboardingShell"
import { isManualPlatformPaymentEnabled } from "@/lib/platform"
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

const MANUAL_PAYMENT_ENABLED = isManualPlatformPaymentEnabled()

export default function PurchaseLicensePage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const flowSource = searchParams.get("from") ?? "request-org"
  const isResume = searchParams.get("resume") === "1"
  const isCanceled = searchParams.get("canceled") === "1"
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
  const [manualLoading, setManualLoading] = useState(false)
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

  useEffect(() => {
    if (isCanceled) {
      setInfo("Stripe Checkout を中断しました。内容は保持されているため、この画面から再開できます。")
    } else if (isResume) {
      setInfo("未完了の購入があります。内容を確認して Stripe Checkout を再開してください。")
    }
  }, [isCanceled, isResume])

  const updateField = useCallback(
    <K extends keyof FormState,>(key: K, value: FormState[K]) => {
      setForm((current) => ({ ...current, [key]: value }))
    },
    []
  )

  const submitPurchase = useCallback(
    async (paymentMode: "stripe_checkout" | "manual_bank_transfer") => {
      setError(null)
      setInfo(null)
      paymentMode === "manual_bank_transfer" ? setManualLoading(true) : setLoading(true)

      try {
        const token = (await supabase.auth.getSession()).data.session?.access_token
        if (!token) {
          router.replace("/")
          return
        }

        const purchaseRes = await fetch("/api/platform/purchase-license", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            ...form,
            payment_mode: paymentMode,
          }),
        })
        const purchaseJson = await purchaseRes.json().catch(() => null)

        if (!purchaseRes.ok || !purchaseJson?.ok) {
          setError(purchaseJson?.error ?? "購入準備に失敗しました。")
          return
        }

        if (purchaseJson?.reused_existing) {
          setInfo("未完了の購入情報を引き継いで再開します。")
        }

        if (paymentMode === "manual_bank_transfer") {
          router.push(purchaseJson?.reused_existing ? "/pending-payment?existing=1" : "/pending-payment")
          return
        }

        const sessionRes = await fetch("/api/platform/checkout/session", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            payment_request_id: purchaseJson.payment_request_id,
          }),
        })
        const sessionJson = await sessionRes.json().catch(() => null)

        if (!sessionRes.ok || !sessionJson?.ok || !sessionJson?.checkout_url) {
          setError(sessionJson?.error ?? "Stripe Checkout の作成に失敗しました。")
          return
        }

        window.location.assign(String(sessionJson.checkout_url))
      } finally {
        setLoading(false)
        setManualLoading(false)
      }
    },
    [form, router]
  )

  const isInvalid =
    !form.full_name.trim() ||
    !form.receipt_name.trim() ||
    !form.address.trim() ||
    !form.phone.trim() ||
    !form.contact_email.trim() ||
    !form.billing_email.trim()

  return (
    <OnboardingShell
      stepCurrent={2}
      stepTotal={3}
      title="ライセンス購入情報を確認"
      description={
        <>
          決済前に、領収書と連絡先に使う情報を確認します。
          <br />
          送信後は Stripe Checkout に移動し、決済完了後はこのアプリの `/thanks` へ戻ります。
        </>
      }
      onBack={() => router.push(`/request-org?from=${encodeURIComponent(flowSource)}`)}
      onClose={() => router.replace("/?showLp=1")}
      ctaLabel="Stripe Checkout へ進む"
      ctaDisabled={loading || manualLoading || isInvalid}
      ctaLoading={loading}
      onCtaClick={() => void submitPurchase("stripe_checkout")}
      footerText="価格は 300,000 円です。正式確定は success page ではなく Stripe webhook 経由で行われます。"
    >
      {error ? <div role="alert" className="onboarding-alert">{error}</div> : null}
      {info ? <div className="onboarding-confirm-card onboarding-confirm-card--success">{info}</div> : null}

      <div className="onboarding-confirm-card">
        <div className="onboarding-confirm-label">購入対象</div>
        <div className="onboarding-confirm-value">NovaLoop Platform License</div>
        <p className="onboarding-confirm-note">
          領収書名義、会社名、住所、電話番号、メールアドレスはこの画面で管理します。
          決済の正式確定と領収書 PDF 発行は webhook 側で処理されます。
        </p>
      </div>

      <div className="onboarding-form-stack">
        <input
          className="onboarding-input"
          value={form.full_name}
          onChange={(event) => updateField("full_name", event.target.value)}
          placeholder="購入者名 *"
        />
        <input
          className="onboarding-input"
          value={form.receipt_name}
          onChange={(event) => updateField("receipt_name", event.target.value)}
          placeholder="領収書名義 *"
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
          placeholder="請求先住所"
          rows={3}
        />
        <textarea
          className="onboarding-input"
          value={form.note}
          onChange={(event) => updateField("note", event.target.value)}
          placeholder="備考"
          rows={3}
        />
      </div>

      {MANUAL_PAYMENT_ENABLED ? (
        <div className="onboarding-detail-card">
          <div className="onboarding-detail-label">手動決済 fallback</div>
          <div className="onboarding-detail-value">必要な場合のみ銀行振込フローへ切り替えます。</div>
          <div style={{ marginTop: 12 }}>
            <button
              type="button"
              onClick={() => void submitPurchase("manual_bank_transfer")}
              disabled={loading || manualLoading || isInvalid}
              style={{
                padding: "12px 16px",
                borderRadius: 10,
                border: "1px solid var(--border)",
                background: "transparent",
                color: "var(--text)",
                fontWeight: 700,
                cursor: loading || manualLoading || isInvalid ? "not-allowed" : "pointer",
              }}
            >
              {manualLoading ? "銀行振込フローへ切替中..." : "銀行振込で進める"}
            </button>
          </div>
        </div>
      ) : null}
    </OnboardingShell>
  )
}
