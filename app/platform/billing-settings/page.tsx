"use client"

import { useCallback, useEffect, useState } from "react"
import { supabase } from "@/lib/supabase"
import PlatformAdminNav from "@/components/platform/PlatformAdminNav"

type BillingSettings = {
  seller_name: string
  seller_address: string
  seller_phone: string
  seller_email: string
  bank_name: string
  bank_branch_name: string
  bank_branch_code: string
  bank_account_type: string
  bank_account_number: string
  bank_account_holder: string
  transfer_fee_note: string
  qualified_invoice_enabled: boolean
  invoice_registration_number: string | null
  default_tax_mode: "exempt" | "registered_taxable"
}

export default function PlatformBillingSettingsPage() {
  const [form, setForm] = useState<BillingSettings | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    const token = (await supabase.auth.getSession()).data.session?.access_token
    if (!token) {
      setLoading(false)
      return
    }

    const res = await fetch("/api/platform/billing-settings", {
      headers: { Authorization: `Bearer ${token}` },
    })
    const json = await res.json().catch(() => null)
    if (!res.ok || !json?.ok) {
      setError(json?.error ?? "請求設定を取得できませんでした。")
      setForm(null)
      setLoading(false)
      return
    }

    setForm(json.settings ?? null)
    setLoading(false)
  }, [])

  useEffect(() => {
    queueMicrotask(() => {
      void load()
    })
  }, [load])

  const updateField = useCallback(<K extends keyof BillingSettings,>(key: K, value: BillingSettings[K]) => {
    setForm((current) => (current ? { ...current, [key]: value } : current))
  }, [])

  const save = useCallback(async () => {
    if (!form) return
    const token = (await supabase.auth.getSession()).data.session?.access_token
    if (!token) return

    setSaving(true)
    setError(null)
    setSuccess(null)
    const res = await fetch("/api/platform/billing-settings", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(form),
    })
    const json = await res.json().catch(() => null)
    setSaving(false)

    if (!res.ok || !json?.ok) {
      setError(json?.error ?? "請求設定の保存に失敗しました。")
      return
    }

    setSuccess("請求設定を保存しました。")
    await load()
  }, [form, load])

  if (loading) {
    return <div style={{ padding: 32, color: "var(--muted)" }}>読み込み中...</div>
  }

  return (
    <div style={{ padding: "32px 24px 80px", minHeight: "100vh", background: "var(--bg-grad)" }}>
      <div style={{ maxWidth: 920, margin: "0 auto", display: "grid", gap: 16 }}>
        <header style={{ display: "grid", gap: 8 }}>
          <div style={{ fontSize: 12, color: "var(--muted)" }}>Platform admin only</div>
          <h1 style={{ margin: 0, color: "var(--text)" }}>請求元設定</h1>
          <p style={{ margin: 0, color: "var(--muted)" }}>
            税区分はプロジェクト方針により免税固定です。登録番号表示のみ切り替えます。
          </p>
          {error ? <p style={{ margin: 0, color: "var(--error-text)" }}>{error}</p> : null}
          {success ? <p style={{ margin: 0, color: "var(--success-text)" }}>{success}</p> : null}
        </header>

        <PlatformAdminNav />

        {!form ? <div style={{ color: "var(--muted)" }}>設定を表示できません。</div> : null}

        {form ? (
          <section style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 18, padding: 18, display: "grid", gap: 16 }}>
            <div style={{ display: "grid", gap: 12 }}>
              <Field label="発行者名" value={form.seller_name} onChange={(value) => updateField("seller_name", value)} />
              <Field label="発行者住所" value={form.seller_address} onChange={(value) => updateField("seller_address", value)} />
              <Field label="発行者電話番号" value={form.seller_phone} onChange={(value) => updateField("seller_phone", value)} />
              <Field label="発行者メールアドレス" value={form.seller_email} onChange={(value) => updateField("seller_email", value)} type="email" />
              <Field label="銀行名" value={form.bank_name} onChange={(value) => updateField("bank_name", value)} />
              <Field label="支店名" value={form.bank_branch_name} onChange={(value) => updateField("bank_branch_name", value)} />
              <Field label="支店コード" value={form.bank_branch_code} onChange={(value) => updateField("bank_branch_code", value)} />
              <Field label="口座種別" value={form.bank_account_type} onChange={(value) => updateField("bank_account_type", value)} />
              <Field label="口座番号" value={form.bank_account_number} onChange={(value) => updateField("bank_account_number", value)} />
              <Field label="口座名義" value={form.bank_account_holder} onChange={(value) => updateField("bank_account_holder", value)} />
              <Field
                label="振込案内文"
                value={form.transfer_fee_note}
                onChange={(value) => updateField("transfer_fee_note", value)}
                multiline
              />
              <Field
                label="登録番号"
                value={form.invoice_registration_number ?? ""}
                onChange={(value) => updateField("invoice_registration_number", value || null)}
              />
            </div>

            <label style={{ display: "flex", gap: 10, alignItems: "center", color: "var(--text)" }}>
              <input
                type="checkbox"
                checked={form.qualified_invoice_enabled}
                onChange={(event) => updateField("qualified_invoice_enabled", event.target.checked)}
              />
              <span>領収書に登録番号を表示する</span>
            </label>

            <div style={{ color: "var(--muted)", fontSize: 13 }}>
              default_tax_mode: {form.default_tax_mode}
            </div>

            <button
              type="button"
              disabled={saving}
              onClick={() => void save()}
              style={{
                width: "fit-content",
                padding: "10px 14px",
                borderRadius: 10,
                border: "1px solid var(--primary)",
                background: "var(--primary)",
                color: "#fff",
              }}
            >
              保存する
            </button>
          </section>
        ) : null}
      </div>
    </div>
  )
}

function Field(props: {
  label: string
  value: string
  onChange: (value: string) => void
  type?: string
  multiline?: boolean
}) {
  return (
    <label style={{ display: "grid", gap: 6 }}>
      <span style={{ fontSize: 13, color: "var(--muted)" }}>{props.label}</span>
      {props.multiline ? (
        <textarea
          className="onboarding-input"
          value={props.value}
          onChange={(event) => props.onChange(event.target.value)}
          rows={3}
        />
      ) : (
        <input
          className="onboarding-input"
          type={props.type ?? "text"}
          value={props.value}
          onChange={(event) => props.onChange(event.target.value)}
        />
      )}
    </label>
  )
}
