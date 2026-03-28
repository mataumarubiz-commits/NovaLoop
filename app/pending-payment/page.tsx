"use client"

import { useCallback, useEffect, useState } from "react"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import { supabase } from "@/lib/supabase"

type BillingSettings = {
  bank_name: string
  bank_branch_name: string
  bank_branch_code: string
  bank_account_type: string
  bank_account_number: string
  bank_account_holder: string
  transfer_fee_note: string
  seller_email: string
  seller_address: string
  seller_phone: string
  seller_name: string
  invoice_registration_number: string | null
  license_price_jpy: number
}

type LicenseResponse = {
  entitlement: { status: string } | null
  paymentRequests: Array<{
    id: string
    request_number: string
    invoice_number: string
    amount_jpy: number
    due_date: string | null
    transfer_reference: string
    invoice_signed_url?: string | null
  }>
}

export default function PendingPaymentPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [license, setLicense] = useState<LicenseResponse | null>(null)
  const [settings, setSettings] = useState<BillingSettings | null>(null)
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

    const [licenseRes, settingsRes] = await Promise.all([
      fetch("/api/platform/my-license", { headers: { Authorization: `Bearer ${token}` } }),
      fetch("/api/platform/payment-instructions", { headers: { Authorization: `Bearer ${token}` } }),
    ])

    const licenseJson = await licenseRes.json().catch(() => null)
    const settingsJson = await settingsRes.json().catch(() => null)

    if (!licenseRes.ok || !licenseJson?.ok) {
      setError(licenseJson?.error ?? "購入情報を取得できませんでした。")
      setLoading(false)
      return
    }
    if (!settingsRes.ok || !settingsJson?.ok) {
      setError(settingsJson?.error ?? "振込先情報を取得できませんでした。")
      setLoading(false)
      return
    }

    setLicense(licenseJson)
    setSettings(settingsJson.settings ?? null)
    setLoading(false)
  }, [router])

  useEffect(() => {
    // eslint-disable-next-line
    void load()
  }, [load])

  if (loading) {
    return <div style={{ padding: 32, color: "var(--muted)" }}>読み込み中...</div>
  }

  const payment = license?.paymentRequests?.[0]
  if (!payment || !settings) {
    return (
      <div style={{ padding: 32, display: "grid", gap: 12 }}>
        <p style={{ color: "var(--muted)", margin: 0 }}>有効な購入申請が見つかりませんでした。</p>
        <Link href="/purchase-license">ライセンス購入へ進む</Link>
      </div>
    )
  }

  return (
    <div style={{ minHeight: "100vh", background: "var(--bg-grad)", padding: "32px 24px 80px" }}>
      <div style={{ maxWidth: 880, margin: "0 auto", display: "grid", gap: 16 }}>
        <header style={{ display: "grid", gap: 8 }}>
          <div style={{ fontSize: 12, color: "var(--muted)" }}>入金確認後に新規組織作成権が有効化されます。</div>
          <h1 style={{ margin: 0, fontSize: 30, color: "var(--text)" }}>振込案内</h1>
          {searchParams.get("existing") === "1" ? (
            <p style={{ margin: 0, color: "var(--success-text)" }}>既存の購入申請を再利用しています。</p>
          ) : null}
          {error ? <p style={{ margin: 0, color: "var(--error-text)" }}>{error}</p> : null}
        </header>

        <section style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 18, padding: 20, display: "grid", gap: 10 }}>
          <div>申請ステータス: {license?.entitlement?.status ?? "pending_payment"}</div>
          <div>請求書番号: {payment.invoice_number}</div>
          <div>申請番号: {payment.request_number}</div>
          <div>金額: {payment.amount_jpy.toLocaleString("ja-JP")}円（税込）</div>
          <div>振込識別子: {payment.transfer_reference}</div>
          <div>支払目安日: {payment.due_date ?? "-"}</div>
          <div>案内: 入金確認後に新規組織作成権が有効化されます。</div>
          {payment.invoice_signed_url ? (
            <a href={payment.invoice_signed_url} target="_blank" rel="noreferrer">
              請求書PDFをダウンロード
            </a>
          ) : null}
        </section>

        <section style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 18, padding: 20, display: "grid", gap: 8 }}>
          <h2 style={{ margin: 0, fontSize: 18 }}>振込先</h2>
          <div>銀行名: {settings.bank_name}</div>
          <div>支店名: {settings.bank_branch_name}（{settings.bank_branch_code}）</div>
          <div>口座種別: {settings.bank_account_type}</div>
          <div>口座番号: {settings.bank_account_number}</div>
          <div>口座名義: {settings.bank_account_holder}</div>
          <div>{settings.transfer_fee_note}</div>
        </section>

        <section style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 18, padding: 20, display: "grid", gap: 8 }}>
          <h2 style={{ margin: 0, fontSize: 18 }}>問い合わせ先</h2>
          <div>担当者: {settings.seller_name}</div>
          <div>住所: {settings.seller_address}</div>
          <div>電話番号: {settings.seller_phone}</div>
          <div>メール: {settings.seller_email}</div>
          <div>適格請求書発行事業者番号: {settings.invoice_registration_number ?? "なし"}</div>
        </section>
      </div>
    </div>
  )
}
