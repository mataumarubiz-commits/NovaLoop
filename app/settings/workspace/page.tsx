"use client"

import type { CSSProperties } from "react"
import { useEffect, useState } from "react"
import Link from "next/link"
import ChecklistReturnButton from "@/components/home/ChecklistReturnButton"
import { supabase } from "@/lib/supabase"
import { useAuthOrg } from "@/hooks/useAuthOrg"

type OrgSettings = {
  business_entity_type: "corporate" | "sole_proprietor"
  issuer_name: string | null
  issuer_zip: string | null
  issuer_address: string | null
  issuer_phone: string | null
  issuer_email: string | null
  issuer_registration_number: string | null
  invoice_note_fixed: string | null
  payout_csv_format: "zengin_simple" | "custom_basic"
  payout_csv_depositor_code: string | null
  payout_csv_company_name_kana: string | null
  payout_csv_notes: string | null
}

type BankAccount = {
  id: string
  bank_name: string
  branch_name: string
  account_type: string
  account_number: string
  account_holder: string
  account_holder_kana: string | null
  depositor_code: string | null
  is_default: boolean
}

type ReferralCode = {
  id: string
  code: string
  status: string
  issued_to_email: string | null
  note: string | null
}

const emptySettings: OrgSettings = {
  business_entity_type: "corporate",
  issuer_name: "",
  issuer_zip: "",
  issuer_address: "",
  issuer_phone: "",
  issuer_email: "",
  issuer_registration_number: "",
  invoice_note_fixed: "",
  payout_csv_format: "zengin_simple",
  payout_csv_depositor_code: "",
  payout_csv_company_name_kana: "",
  payout_csv_notes: "",
}

const emptyBank = {
  bank_name: "",
  branch_name: "",
  account_type: "ordinary",
  account_number: "",
  account_holder: "",
  account_holder_kana: "",
  depositor_code: "",
  is_default: false,
}

const cardStyle: CSSProperties = {
  background: "var(--surface)",
  border: "1px solid var(--border)",
  borderRadius: 16,
  padding: 20,
}

async function getAccessToken() {
  const session = await supabase.auth.getSession()
  if (session.data.session?.access_token) return session.data.session.access_token

  const refreshed = await supabase.auth.refreshSession()
  return refreshed.data.session?.access_token ?? null
}

export default function WorkspaceSettingsPage() {
  const { activeOrgId, role, memberships, loading: authLoading, refresh } = useAuthOrg()
  const currentName = activeOrgId ? memberships.find((m) => m.org_id === activeOrgId)?.org_name ?? "" : ""
  const isOwner = role === "owner"
  const canEdit = role === "owner" || role === "executive_assistant"

  const [workspaceName, setWorkspaceName] = useState(currentName)
  const [settings, setSettings] = useState<OrgSettings>(emptySettings)
  const [bankAccounts, setBankAccounts] = useState<BankAccount[]>([])
  const [referralCodes, setReferralCodes] = useState<ReferralCode[]>([])
  const [bankForm, setBankForm] = useState(emptyBank)
  const [referralEmail, setReferralEmail] = useState("")
  const [referralNote, setReferralNote] = useState("")
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<{ type: "error" | "success"; text: string } | null>(null)

  useEffect(() => {
    setWorkspaceName(currentName)
  }, [currentName])

  useEffect(() => {
    if (!activeOrgId || !canEdit) return
    let alive = true

    const load = async () => {
      const token = await getAccessToken()
      if (!token) {
        if (alive) {
          setMessage({ type: "error", text: "認証に失敗しました。ログインし直してください。" })
        }
        return
      }

      const [settingsRes, bankRes, referralRes] = await Promise.all([
        fetch("/api/org-settings", { headers: { Authorization: `Bearer ${token}` } }).then((res) => res.json().catch(() => null)),
        fetch("/api/org-bank-accounts", { headers: { Authorization: `Bearer ${token}` } }).then((res) => res.json().catch(() => null)),
        fetch("/api/referral-codes", { headers: { Authorization: `Bearer ${token}` } }).then((res) => res.json().catch(() => null)),
      ])

      if (!alive) return

      if (settingsRes?.organization?.name) {
        setWorkspaceName(settingsRes.organization.name)
      }
      if (settingsRes?.settings) {
        setSettings({ ...emptySettings, ...settingsRes.settings })
      }
      setBankAccounts((bankRes?.bankAccounts ?? []) as BankAccount[])
      setReferralCodes((referralRes?.referralCodes ?? []) as ReferralCode[])
    }

    void load()
    return () => {
      alive = false
    }
  }, [activeOrgId, canEdit])

  const reloadBankAccounts = async (token: string) => {
    const listRes = await fetch("/api/org-bank-accounts", { headers: { Authorization: `Bearer ${token}` } })
    const listJson = await listRes.json().catch(() => null)
    setBankAccounts((listJson?.bankAccounts ?? []) as BankAccount[])
  }

  const saveOrgSettings = async () => {
    if (!activeOrgId || !canEdit) return

    setSaving(true)
    setMessage(null)
    try {
      const token = await getAccessToken()
      if (!token) {
        setMessage({ type: "error", text: "認証に失敗しました。ログインし直してください。" })
        return
      }

      const res = await fetch("/api/org-settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          ...settings,
          workspace_name: workspaceName.trim() || currentName,
        }),
      })
      const json = await res.json().catch(() => null)

      if (!res.ok || !json?.ok) {
        setMessage({ type: "error", text: json?.message ?? "ワークスペース情報の更新に失敗しました。" })
        return
      }

      await refresh()
      setMessage({ type: "success", text: "ワークスペース情報を更新しました。" })
    } finally {
      setSaving(false)
    }
  }

  const addBankAccount = async () => {
    const token = await getAccessToken()
    if (!token) {
      setMessage({ type: "error", text: "認証に失敗しました。ログインし直してください。" })
      return
    }

    const res = await fetch("/api/org-bank-accounts", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify(bankForm),
    })
    const json = await res.json().catch(() => null)
    if (!res.ok || !json?.ok) {
      setMessage({ type: "error", text: json?.message ?? "口座の追加に失敗しました。" })
      return
    }

    setBankForm(emptyBank)
    await reloadBankAccounts(token)
    setMessage({ type: "success", text: "口座を追加しました。" })
  }

  const setDefaultBankAccount = async (id: string) => {
    const token = await getAccessToken()
    if (!token) {
      setMessage({ type: "error", text: "認証に失敗しました。ログインし直してください。" })
      return
    }

    const res = await fetch("/api/org-bank-accounts", {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ id, is_default: true }),
    })
    const json = await res.json().catch(() => null)
    if (!res.ok || !json?.ok) {
      setMessage({ type: "error", text: json?.message ?? "既定口座の更新に失敗しました。" })
      return
    }

    setBankAccounts((prev) => prev.map((account) => ({ ...account, is_default: account.id === id })))
    setMessage({ type: "success", text: "既定口座を更新しました。" })
  }

  const createReferralCode = async () => {
    const token = await getAccessToken()
    if (!token) {
      setMessage({ type: "error", text: "認証に失敗しました。ログインし直してください。" })
      return
    }

    const email = referralEmail.trim()
    const note = referralNote.trim()
    const res = await fetch("/api/referral-codes", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ issued_to_email: email, note }),
    })
    const json = await res.json().catch(() => null)
    if (!res.ok || !json?.ok) {
      setMessage({ type: "error", text: json?.message ?? "紹介コードの発行に失敗しました。" })
      return
    }

    setReferralEmail("")
    setReferralNote("")
    setReferralCodes((prev) => [
      {
        id: crypto.randomUUID(),
        code: json.code,
        status: "active",
        issued_to_email: email || null,
        note: note || null,
      },
      ...prev,
    ])
    setMessage({ type: "success", text: "紹介コードを発行しました。" })
  }

  if (authLoading) {
    return <div style={{ padding: 48, textAlign: "center", color: "var(--muted)" }}>読み込み中...</div>
  }

  if (!activeOrgId) {
    return (
      <div style={{ padding: 48, textAlign: "center" }}>
        <p style={{ color: "var(--muted)", marginBottom: 16 }}>ワークスペースを選択してください。</p>
        <Link href="/home" style={{ color: "var(--primary)", fontWeight: 600 }}>
          ホームへ戻る
        </Link>
      </div>
    )
  }

  return (
    <div style={{ minHeight: "100vh", background: "var(--bg-grad)", padding: "32px 24px 56px" }}>
      <div style={{ maxWidth: 980, margin: "0 auto", display: "grid", gap: 16 }}>
        <div>
          <ChecklistReturnButton />
        </div>
        <header>
          <h1 style={{ fontSize: 28, color: "var(--text)", marginBottom: 8 }}>ワークスペース</h1>
          <p style={{ margin: 0, color: "var(--muted)" }}>
            自社情報、口座、紹介コードをこの画面で管理します。
          </p>
        </header>

        {message && (
          <div
            style={{
              ...cardStyle,
              borderColor: message.type === "success" ? "#bbf7d0" : "#fecaca",
              background: message.type === "success" ? "#f0fdf4" : "#fff1f2",
              color: message.type === "success" ? "#166534" : "#b91c1c",
            }}
          >
            {message.text}
          </div>
        )}

        <section style={cardStyle}>
          <h2 style={{ marginTop: 0, fontSize: 18 }}>自社情報</h2>
          <div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))" }}>
            <label style={{ display: "grid", gap: 6 }}>
              <span>ワークスペース名</span>
              <input
                value={workspaceName}
                onChange={(e) => setWorkspaceName(e.target.value)}
                readOnly={!isOwner}
                style={{
                  padding: "10px 12px",
                  borderRadius: 8,
                  border: "1px solid var(--border)",
                  background: isOwner ? "var(--input-bg)" : "var(--surface-2)",
                }}
              />
            </label>
            <label style={{ display: "grid", gap: 6 }}>
              <span>事業形態</span>
              <select
                value={settings.business_entity_type}
                onChange={(e) =>
                  setSettings((prev) => ({
                    ...prev,
                    business_entity_type: e.target.value as "corporate" | "sole_proprietor",
                  }))
                }
                style={{ padding: "10px 12px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--input-bg)" }}
              >
                <option value="corporate">法人</option>
                <option value="sole_proprietor">個人事業主</option>
              </select>
            </label>
            <label style={{ display: "grid", gap: 6 }}>
              <span>請求者名</span>
              <input
                value={settings.issuer_name ?? ""}
                onChange={(e) => setSettings((prev) => ({ ...prev, issuer_name: e.target.value }))}
                style={{ padding: "10px 12px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--input-bg)" }}
              />
            </label>
            <label style={{ display: "grid", gap: 6 }}>
              <span>登録番号</span>
              <input
                value={settings.issuer_registration_number ?? ""}
                onChange={(e) => setSettings((prev) => ({ ...prev, issuer_registration_number: e.target.value }))}
                style={{ padding: "10px 12px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--input-bg)" }}
              />
            </label>
            <label style={{ display: "grid", gap: 6 }}>
              <span>郵便番号</span>
              <input
                value={settings.issuer_zip ?? ""}
                onChange={(e) => setSettings((prev) => ({ ...prev, issuer_zip: e.target.value }))}
                style={{ padding: "10px 12px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--input-bg)" }}
              />
            </label>
            <label style={{ display: "grid", gap: 6 }}>
              <span>電話番号</span>
              <input
                value={settings.issuer_phone ?? ""}
                onChange={(e) => setSettings((prev) => ({ ...prev, issuer_phone: e.target.value }))}
                style={{ padding: "10px 12px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--input-bg)" }}
              />
            </label>
            <label style={{ display: "grid", gap: 6 }}>
              <span>メールアドレス</span>
              <input
                value={settings.issuer_email ?? ""}
                onChange={(e) => setSettings((prev) => ({ ...prev, issuer_email: e.target.value }))}
                style={{ padding: "10px 12px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--input-bg)" }}
              />
            </label>
            <label style={{ display: "grid", gap: 6, gridColumn: "1 / -1" }}>
              <span>住所</span>
              <input
                value={settings.issuer_address ?? ""}
                onChange={(e) => setSettings((prev) => ({ ...prev, issuer_address: e.target.value }))}
                style={{ padding: "10px 12px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--input-bg)" }}
              />
            </label>
            <label style={{ display: "grid", gap: 6, gridColumn: "1 / -1" }}>
              <span>請求書の固定メモ</span>
              <textarea
                value={settings.invoice_note_fixed ?? ""}
                onChange={(e) => setSettings((prev) => ({ ...prev, invoice_note_fixed: e.target.value }))}
                rows={3}
                style={{
                  padding: "10px 12px",
                  borderRadius: 8,
                  border: "1px solid var(--border)",
                  background: "var(--input-bg)",
                  resize: "vertical",
                }}
              />
            </label>
          </div>
          <div style={{ marginTop: 16, display: "flex", justifyContent: "flex-end" }}>
            <button
              type="button"
              onClick={saveOrgSettings}
              disabled={!canEdit || saving}
              style={{
                padding: "10px 18px",
                borderRadius: 10,
                border: "none",
                background: "var(--button-primary-bg)",
                color: "var(--primary-contrast)",
                fontWeight: 600,
                cursor: saving ? "not-allowed" : "pointer",
              }}
            >
              {saving ? "保存中..." : "ワークスペース情報を保存"}
            </button>
          </div>
        </section>

        <section style={cardStyle}>
          <h2 style={{ marginTop: 0, fontSize: 18 }}>銀行CSV設定</h2>
          <p style={{ marginTop: 0, color: "var(--muted)" }}>
            支払CSVの委託者コード、会社名カナ、出力メモを組織単位で保持します。
          </p>
          <div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))" }}>
            <label style={{ display: "grid", gap: 6 }}>
              <span>出力形式</span>
              <select
                value={settings.payout_csv_format ?? "zengin_simple"}
                onChange={(e) => setSettings((prev) => ({ ...prev, payout_csv_format: e.target.value as "zengin_simple" | "custom_basic" }))}
                style={{ padding: "10px 12px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--input-bg)" }}
              >
                <option value="zengin_simple">全銀CSV（簡易）</option>
                <option value="custom_basic">汎用CSV</option>
              </select>
            </label>
            <label style={{ display: "grid", gap: 6 }}>
              <span>委託者コード</span>
              <input
                value={settings.payout_csv_depositor_code ?? ""}
                onChange={(e) => setSettings((prev) => ({ ...prev, payout_csv_depositor_code: e.target.value }))}
                style={{ padding: "10px 12px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--input-bg)" }}
              />
            </label>
            <label style={{ display: "grid", gap: 6 }}>
              <span>会社名カナ</span>
              <input
                value={settings.payout_csv_company_name_kana ?? ""}
                onChange={(e) => setSettings((prev) => ({ ...prev, payout_csv_company_name_kana: e.target.value }))}
                style={{ padding: "10px 12px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--input-bg)" }}
              />
            </label>
            <label style={{ display: "grid", gap: 6, gridColumn: "1 / -1" }}>
              <span>CSVメモ</span>
              <textarea
                value={settings.payout_csv_notes ?? ""}
                onChange={(e) => setSettings((prev) => ({ ...prev, payout_csv_notes: e.target.value }))}
                rows={3}
                style={{ padding: "10px 12px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--input-bg)", resize: "vertical" }}
              />
            </label>
          </div>
          <div style={{ marginTop: 12, color: "var(--muted)", fontSize: 13 }}>
            文字コードは UTF-8 BOM / CRLF です。実際の列プレビューと出力履歴は Payouts で確認してください。
          </div>
        </section>

        <section style={cardStyle}>
          <h2 style={{ marginTop: 0, fontSize: 18 }}>口座管理</h2>
          <div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))" }}>
            <input
              placeholder="銀行名"
              value={bankForm.bank_name}
              onChange={(e) => setBankForm((prev) => ({ ...prev, bank_name: e.target.value }))}
              style={{ padding: "10px 12px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--input-bg)" }}
            />
            <input
              placeholder="支店名"
              value={bankForm.branch_name}
              onChange={(e) => setBankForm((prev) => ({ ...prev, branch_name: e.target.value }))}
              style={{ padding: "10px 12px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--input-bg)" }}
            />
            <select
              value={bankForm.account_type}
              onChange={(e) => setBankForm((prev) => ({ ...prev, account_type: e.target.value }))}
              style={{ padding: "10px 12px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--input-bg)" }}
            >
              <option value="ordinary">普通</option>
              <option value="checking">当座</option>
              <option value="savings">貯蓄</option>
            </select>
            <input
              placeholder="口座番号"
              value={bankForm.account_number}
              onChange={(e) => setBankForm((prev) => ({ ...prev, account_number: e.target.value }))}
              style={{ padding: "10px 12px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--input-bg)" }}
            />
            <input
              placeholder="口座名義"
              value={bankForm.account_holder}
              onChange={(e) => setBankForm((prev) => ({ ...prev, account_holder: e.target.value }))}
              style={{ padding: "10px 12px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--input-bg)" }}
            />
            <input
              placeholder="口座名義カナ"
              value={bankForm.account_holder_kana}
              onChange={(e) => setBankForm((prev) => ({ ...prev, account_holder_kana: e.target.value }))}
              style={{ padding: "10px 12px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--input-bg)" }}
            />
            <input
              placeholder="委託者コード"
              value={bankForm.depositor_code}
              onChange={(e) => setBankForm((prev) => ({ ...prev, depositor_code: e.target.value }))}
              style={{ padding: "10px 12px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--input-bg)" }}
            />
            <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <input
                type="checkbox"
                checked={bankForm.is_default}
                onChange={(e) => setBankForm((prev) => ({ ...prev, is_default: e.target.checked }))}
              />
              <span>既定口座にする</span>
            </label>
          </div>
          <div style={{ marginTop: 14, display: "flex", justifyContent: "flex-end" }}>
            <button
              type="button"
              onClick={addBankAccount}
              disabled={!canEdit}
              style={{ padding: "10px 18px", borderRadius: 10, border: "1px solid var(--border)", background: "var(--surface-2)", fontWeight: 600 }}
            >
              口座を追加
            </button>
          </div>
          <div style={{ marginTop: 16, display: "grid", gap: 8 }}>
            {bankAccounts.map((account) => (
              <div
                key={account.id}
                style={{
                  padding: "12px 14px",
                  borderRadius: 10,
                  border: "1px solid var(--border)",
                  background: "var(--surface-2)",
                  display: "flex",
                  justifyContent: "space-between",
                  gap: 12,
                  flexWrap: "wrap",
                }}
              >
                <div>
                  <div style={{ fontWeight: 600 }}>
                    {account.bank_name} {account.branch_name} {account.is_default ? "(既定)" : ""}
                  </div>
                  <div style={{ color: "var(--muted)", fontSize: 13 }}>
                    {account.account_type} / {account.account_number} / {account.account_holder}
                  </div>
                </div>
                {!account.is_default && canEdit && (
                  <button
                    type="button"
                    onClick={() => setDefaultBankAccount(account.id)}
                    style={{ padding: "8px 12px", borderRadius: 8, border: "1px solid var(--border)", background: "transparent", cursor: "pointer" }}
                  >
                    既定にする
                  </button>
                )}
              </div>
            ))}
            {bankAccounts.length === 0 && <p style={{ color: "var(--muted)", margin: 0 }}>口座はまだ登録されていません。</p>}
          </div>
        </section>

        <section style={cardStyle}>
          <h2 style={{ marginTop: 0, fontSize: 18 }}>紹介コード</h2>
          <div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))" }}>
            <input
              placeholder="送付先メールアドレス"
              value={referralEmail}
              onChange={(e) => setReferralEmail(e.target.value)}
              style={{ padding: "10px 12px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--input-bg)" }}
            />
            <input
              placeholder="メモ"
              value={referralNote}
              onChange={(e) => setReferralNote(e.target.value)}
              style={{ padding: "10px 12px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--input-bg)" }}
            />
          </div>
          <div style={{ marginTop: 14, display: "flex", justifyContent: "flex-end" }}>
            <button
              type="button"
              onClick={createReferralCode}
              disabled={!canEdit}
              style={{ padding: "10px 18px", borderRadius: 10, border: "1px solid var(--border)", background: "var(--surface-2)", fontWeight: 600 }}
            >
              紹介コードを発行
            </button>
          </div>
          <div style={{ marginTop: 16, display: "grid", gap: 8 }}>
            {referralCodes.map((code) => (
              <div key={code.id} style={{ padding: "12px 14px", borderRadius: 10, border: "1px solid var(--border)", background: "var(--surface-2)" }}>
                <div style={{ fontWeight: 700 }}>{code.code}</div>
                <div style={{ color: "var(--muted)", fontSize: 13, marginTop: 4 }}>
                  {code.status}
                  {code.issued_to_email ? ` / ${code.issued_to_email}` : ""}
                  {code.note ? ` / ${code.note}` : ""}
                </div>
              </div>
            ))}
            {referralCodes.length === 0 && <p style={{ color: "var(--muted)", margin: 0 }}>紹介コードはまだありません。</p>}
          </div>
        </section>
      </div>
    </div>
  )
}
