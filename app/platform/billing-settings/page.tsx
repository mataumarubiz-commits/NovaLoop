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
  invoice_registration_number: string | null
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
    const res = await fetch("/api/platform/billing-settings", { headers: { Authorization: `Bearer ${token}` } })
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
    // eslint-disable-next-line
    void load()
  }, [load])

  const save = useCallback(async () => {
    if (!form) return
    const token = (await supabase.auth.getSession()).data.session?.access_token
    if (!token) return
    setSaving(true)
    setError(null)
    setSuccess(null)
    const res = await fetch("/api/platform/billing-settings", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
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
          <h1 style={{ margin: 0, color: "var(--text)" }}>請求設定</h1>
          {error ? <p style={{ margin: 0, color: "var(--error-text)" }}>{error}</p> : null}
          {success ? <p style={{ margin: 0, color: "var(--success-text)" }}>{success}</p> : null}
        </header>

        <PlatformAdminNav />

        {!form ? <div style={{ color: "var(--muted)" }}>設定を表示できません。</div> : null}

        {form ? (
          <section style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 18, padding: 18, display: "grid", gap: 12 }}>
            {Object.entries(form).map(([key, value]) => (
              <label key={key} style={{ display: "grid", gap: 6 }}>
                <span style={{ fontSize: 13, color: "var(--muted)" }}>{key}</span>
                <input
                  className="onboarding-input"
                  value={value ?? ""}
                  onChange={(event) => setForm({ ...form, [key]: event.target.value } as BillingSettings)}
                />
              </label>
            ))}
            <button
              type="button"
              disabled={saving}
              onClick={() => void save()}
              style={{ width: "fit-content", padding: "10px 14px", borderRadius: 10, border: "1px solid var(--primary)", background: "var(--primary)", color: "#fff" }}
            >
              保存する
            </button>
          </section>
        ) : null}
      </div>
    </div>
  )
}
