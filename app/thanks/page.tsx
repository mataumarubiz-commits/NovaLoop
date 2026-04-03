"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
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
  const { memberships, loading: authLoading } = useAuthOrg()
  const [license, setLicense] = useState<ThanksLicenseResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
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
      setError(json?.error ?? "購入情報を確認できませんでした。")
      setLoading(false)
      return
    }

    setLicense(json as ThanksLicenseResponse)
    setLoading(false)
  }, [router])

  useEffect(() => {
    if (authLoading) return
    void load()
  }, [authLoading, load])

  useEffect(() => {
    if (loading || !license) return

    if (license.entitlement?.status === "pending_payment") {
      router.replace("/pending-payment")
      return
    }

    if (license.entitlement?.status !== "active") {
      router.replace("/request-org?from=thanks")
    }
  }, [license, loading, router])

  const nextAction = useMemo(() => resolvePostPurchaseNextAction(memberships.length), [memberships.length])
  const latestReceipt = license?.receipts?.[0] ?? null
  const latestPayment = license?.paymentRequests?.find((row) => row.status === "paid") ?? license?.paymentRequests?.[0] ?? null
  const receiptUrl = latestReceipt?.receipt_signed_url ?? latestPayment?.receipt_signed_url ?? null

  if (authLoading || loading) {
    return <div style={{ padding: 32, color: "var(--muted)" }}>読み込み中...</div>
  }

  return (
    <OnboardingShell
      stepCurrent={3}
      stepTotal={3}
      title="購入が完了しました"
      description="ライセンスの利用準備が整いました。次は初回セットアップを進めるだけです。"
      onClose={() => router.replace("/settings/license")}
      ctaLabel={nextAction.label}
      onCtaClick={() => router.push(nextAction.href)}
      footerText="組織を作成するか既存組織に参加すると、そのまま利用を開始できます。"
    >
      {error ? <div role="alert" className="onboarding-alert">{error}</div> : null}

      <div className="onboarding-confirm-card onboarding-confirm-card--success">
        <div className="onboarding-confirm-label">購入完了</div>
        <div className="onboarding-confirm-value">NovaLoop Platform License が利用可能になりました</div>
        <p className="onboarding-confirm-note">{nextAction.description}</p>
      </div>

      <div className="onboarding-detail-card">
        <div className="onboarding-detail-label">次にやること</div>
        <div className="onboarding-detail-value">初回セットアップを完了する</div>
        <p className="onboarding-confirm-note" style={{ marginBottom: 0 }}>
          新しい組織を作成するか、既存組織に参加するとホームから利用開始できます。
        </p>
      </div>

      <div style={{ display: "grid", gap: 12 }}>
        <div className="onboarding-detail-card">
          <div className="onboarding-detail-label">購入情報</div>
          <div style={{ display: "grid", gap: 8, color: "var(--text)" }}>
            <div>ライセンス状態: {license?.entitlement?.status ?? "-"}</div>
            <div>利用開始日: {formatDate(license?.entitlement?.activated_at)}</div>
            <div>購入金額: {formatCurrency(license?.entitlement?.amount_total_jpy)}</div>
            <div>申請番号: {latestPayment?.request_number ?? "-"}</div>
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
              領収書をダウンロード
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
