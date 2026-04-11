"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import OnboardingShell from "@/components/OnboardingShell"
import { useAuthOrg } from "@/hooks/useAuthOrg"
import { resolvePostPurchaseNextAction } from "@/lib/platformFlow"
import { supabase } from "@/lib/supabase"

type ThanksLicenseResponse = {
  entitlement: {
    status: string
    grant_type?: string | null
    activated_at?: string | null
    amount_total_jpy?: number | null
  } | null
  paymentRequests: Array<{
    id: string
    request_number: string
    invoice_number?: string | null
    receipt_number?: string | null
    status: string
    paid_at?: string | null
    payment_provider?: string | null
    payment_channel?: string | null
    latest_checkout_status?: string | null
    receipt_signed_url?: string | null
  }>
  receipts: Array<{
    id: string
    receipt_number: string
    total_amount: number
    issued_at: string
    paid_at: string
    receipt_signed_url?: string | null
  }>
}

function formatDate(value: string | null | undefined) {
  if (!value) return "-"
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString("ja-JP")
}

function formatCurrency(value: number | null | undefined) {
  return new Intl.NumberFormat("ja-JP", {
    style: "currency",
    currency: "JPY",
    maximumFractionDigits: 0,
  }).format(Number(value ?? 0))
}

export default function ThanksPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { memberships, loading: authLoading } = useAuthOrg()
  const [license, setLicense] = useState<ThanksLicenseResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async (isRefresh = false) => {
    isRefresh ? setRefreshing(true) : setLoading(true)
    setError(null)
    const token = (await supabase.auth.getSession()).data.session?.access_token
    if (!token) {
      router.replace("/")
      return
    }

    const res = await fetch("/api/platform/my-license", {
      headers: { Authorization: `Bearer ${token}` },
    })
    const json = await res.json().catch(() => null)
    if (!res.ok || !json?.ok) {
      setError(json?.error ?? "購入状態の確認に失敗しました。")
      setLoading(false)
      setRefreshing(false)
      return
    }

    setLicense(json as ThanksLicenseResponse)
    setLoading(false)
    setRefreshing(false)
  }, [router])

  useEffect(() => {
    if (authLoading) return
    const timer = setTimeout(() => {
      void load()
    }, 0)
    return () => clearTimeout(timer)
  }, [authLoading, load])

  const latestPayment = license?.paymentRequests?.[0] ?? null
  const latestReceipt = license?.receipts?.[0] ?? null
  const isStripePending =
    license?.entitlement?.status === "pending_payment" &&
    latestPayment?.payment_provider === "stripe" &&
    latestPayment?.payment_channel === "checkout"
  const isManualPending =
    license?.entitlement?.status === "pending_payment" &&
    !isStripePending
  const hasCheckoutReturn = Boolean(searchParams.get("session_id"))

  useEffect(() => {
    if (loading || !license) return

    if (isManualPending) {
      router.replace("/pending-payment")
      return
    }

    if (license.entitlement?.status !== "active" && !isStripePending) {
      router.replace("/request-org?from=thanks")
    }
  }, [isManualPending, isStripePending, license, loading, router])

  useEffect(() => {
    if (loading || !isStripePending) return
    const intervalId = window.setInterval(() => {
      void load(true)
    }, 5000)
    return () => window.clearInterval(intervalId)
  }, [isStripePending, load, loading])

  const nextAction = useMemo(() => resolvePostPurchaseNextAction(memberships.length), [memberships.length])
  const receiptUrl = latestReceipt?.receipt_signed_url ?? latestPayment?.receipt_signed_url ?? null
  const isActive = license?.entitlement?.status === "active"

  if (authLoading || loading) {
    return <div style={{ padding: 32, color: "var(--muted)" }}>読み込み中...</div>
  }

  return (
    <OnboardingShell
      stepCurrent={3}
      stepTotal={3}
      title={isActive ? "購入が完了しました" : "決済を確認しています"}
      description={
        isActive
          ? "ライセンスが有効化されました。次はセットアップを開始してください。"
          : "Stripe Checkout からの戻りを受け取りました。正式確定は webhook 完了後に行われます。"
      }
      onClose={() => router.replace("/settings/license")}
      ctaLabel={isActive ? nextAction.label : refreshing ? "確認中..." : "状態を更新する"}
      ctaDisabled={!isActive && refreshing}
      onCtaClick={() => (isActive ? router.push(nextAction.href) : void load(true))}
      footerText={
        isActive
          ? "組織を作成すると、そのままホームから利用を開始できます。"
          : hasCheckoutReturn
            ? "Stripe からの戻りを確認済みです。webhook の反映が終わるまでこの画面でお待ちください。"
            : "画面を閉じても再度 thanks から確認できます。"
      }
    >
      {error ? <div role="alert" className="onboarding-alert">{error}</div> : null}

      <div className={`onboarding-confirm-card ${isActive ? "onboarding-confirm-card--success" : ""}`}>
        <div className="onboarding-confirm-label">ライセンス状態</div>
        <div className="onboarding-confirm-value">
          {isActive ? "NovaLoop Platform License が有効化されました" : "決済完了を確認中です"}
        </div>
        <p className="onboarding-confirm-note">
          {isActive
            ? nextAction.description
            : `決済チャネル: Stripe Checkout / Checkout 状態: ${latestPayment?.latest_checkout_status ?? "open"}`}
        </p>
      </div>

      {!isActive ? (
        <div className="onboarding-detail-card">
          <div className="onboarding-detail-label">現在の状態</div>
          <div className="onboarding-detail-value">webhook による正式確定待ち</div>
          <p className="onboarding-confirm-note" style={{ marginBottom: 0 }}>
            webhook 完了前は entitlement を有効化しません。数秒待ってから「状態を更新する」を押してください。
          </p>
          {latestPayment?.latest_checkout_status !== "completed" ? (
            <div style={{ marginTop: 12 }}>
              <Link
                href="/purchase-license?resume=1"
                style={{
                  padding: "12px 16px",
                  borderRadius: 10,
                  border: "1px solid var(--border)",
                  background: "var(--surface-2)",
                  color: "var(--text)",
                  textDecoration: "none",
                  fontWeight: 700,
                }}
              >
                Stripe Checkout を再開する
              </Link>
            </div>
          ) : null}
        </div>
      ) : null}

      <div style={{ display: "grid", gap: 12 }}>
        <div className="onboarding-detail-card">
          <div className="onboarding-detail-label">購入情報</div>
          <div style={{ display: "grid", gap: 8, color: "var(--text)" }}>
            <div>ライセンス状態: {license?.entitlement?.status ?? "-"}</div>
            <div>有効化日時: {formatDate(license?.entitlement?.activated_at)}</div>
            <div>購入金額: {formatCurrency(license?.entitlement?.amount_total_jpy)}</div>
            <div>購入番号: {latestPayment?.request_number ?? "-"}</div>
            <div>領収書番号: {latestReceipt?.receipt_number ?? latestPayment?.receipt_number ?? "-"}</div>
          </div>
        </div>

        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          {receiptUrl ? (
            <a
              href={receiptUrl}
              target="_blank"
              rel="noreferrer"
              style={{
                padding: "12px 16px",
                borderRadius: 10,
                border: "1px solid var(--border)",
                background: "var(--surface-2)",
                color: "var(--text)",
                textDecoration: "none",
                fontWeight: 700,
              }}
            >
              領収書を開く
            </a>
          ) : null}
          <Link
            href="/settings/license"
            style={{
              padding: "12px 16px",
              borderRadius: 10,
              border: "1px solid var(--border)",
              background: "transparent",
              color: "var(--text)",
              textDecoration: "none",
              fontWeight: 700,
            }}
          >
            ライセンス情報を見る
          </Link>
        </div>
      </div>
    </OnboardingShell>
  )
}
