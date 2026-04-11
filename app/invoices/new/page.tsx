"use client"

import { useEffect, useMemo, useState, type CSSProperties } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import Link from "next/link"
import { supabase } from "@/lib/supabase"
import { useAuthOrg } from "@/hooks/useAuthOrg"
import type { ApplyAiResultDetail } from "@/lib/aiClientEvents"

const cardStyle: CSSProperties = {
  border: "1px solid var(--border)",
  borderRadius: 12,
  padding: 16,
  background: "var(--surface)",
  boxShadow: "var(--shadow-sm)",
}

type ClientRow = {
  id: string
  name: string
  billing_name: string | null
  billing_email: string | null
  billing_address: string | null
}

type BankAccount = {
  id: string
  bank_name: string
  branch_name: string
  account_type: string
  account_number: string
  account_holder: string
  is_default: boolean
}

type LineItem = {
  id: string
  description: string
  quantity: number
  unit_price: number
}

type InvoiceRequestPrefill = {
  id: string
  client_id: string | null
  guest_name: string | null
  guest_company_name: string | null
  recipient_email: string | null
  requested_title: string | null
  requested_description: string | null
  due_date: string | null
  request_deadline: string | null
}

const formatCurrency = (value: number) =>
  new Intl.NumberFormat("ja-JP", { style: "currency", currency: "JPY", maximumFractionDigits: 0 }).format(value)

function yenFloor(value: number): number {
  return Math.floor(Number.isFinite(value) ? value : 0)
}

export default function NewInvoicePage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const requestId = searchParams.get("requestId")
  const { activeOrgId, role, loading: authLoading } = useAuthOrg({ redirectToOnboarding: true })
  const [loading, setLoading] = useState(true)
  const [clients, setClients] = useState<ClientRow[]>([])
  const [bankAccounts, setBankAccounts] = useState<BankAccount[]>([])
  const [clientId, setClientId] = useState("")
  const [guestName, setGuestName] = useState("")
  const [guestCompanyName, setGuestCompanyName] = useState("")
  const [guestEmail, setGuestEmail] = useState("")
  const [guestAddress, setGuestAddress] = useState("")
  const [invoiceTitle, setInvoiceTitle] = useState("請求書")
  const [invoiceMonth, setInvoiceMonth] = useState(new Date().toISOString().slice(0, 7))
  const [issueDate, setIssueDate] = useState(new Date().toISOString().slice(0, 10))
  const [dueDate, setDueDate] = useState(new Date().toISOString().slice(0, 10))
  const [taxMode, setTaxMode] = useState<"exempt" | "exclusive" | "inclusive">("exempt")
  const [taxRate, setTaxRate] = useState(10)
  const [withholdingEnabled, setWithholdingEnabled] = useState(false)
  const [bankAccountId, setBankAccountId] = useState("")
  const [notes, setNotes] = useState("")
  const [sendDraft, setSendDraft] = useState("")
  const [lines, setLines] = useState<LineItem[]>([{ id: crypto.randomUUID(), description: "", quantity: 1, unit_price: 0 }])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [requestPrefill, setRequestPrefill] = useState<InvoiceRequestPrefill | null>(null)

  const canAccess = role === "owner" || role === "executive_assistant"

  useEffect(() => {
    if (!activeOrgId || !canAccess) {
      setLoading(false)
      return
    }
    let active = true
    const load = async () => {
      const [{ data: clientRows }, accountsRes] = await Promise.all([
        supabase
          .from("clients")
          .select("id, name, billing_name, billing_email, billing_address")
          .eq("org_id", activeOrgId)
          .order("name"),
        fetch("/api/org-bank-accounts", {
          headers: {
            Authorization: `Bearer ${(await supabase.auth.getSession()).data.session?.access_token ?? ""}`,
          },
        }).then((res) => res.json().catch(() => null)),
      ])
      if (!active) return
      setClients((clientRows ?? []) as ClientRow[])
      const accounts = (accountsRes?.bankAccounts ?? []) as BankAccount[]
      setBankAccounts(accounts)
      const defaultAccount = accounts.find((account) => account.is_default)
      if (defaultAccount) setBankAccountId(defaultAccount.id)
      setLoading(false)
    }
    void load()
    return () => {
      active = false
    }
  }, [activeOrgId, canAccess])

  useEffect(() => {
    if (!activeOrgId || !canAccess || !requestId) return
    let active = true

    const loadRequest = async () => {
      const { data, error: requestError } = await supabase
        .from("invoice_requests")
        .select("id, client_id, guest_name, guest_company_name, recipient_email, requested_title, requested_description, due_date, request_deadline")
        .eq("org_id", activeOrgId)
        .eq("id", requestId)
        .maybeSingle()

      if (!active || requestError || !data) return

      const row = data as InvoiceRequestPrefill
      setRequestPrefill(row)
      setClientId(row.client_id ?? "")
      setGuestName(row.guest_name ?? "")
      setGuestCompanyName(row.guest_company_name ?? "")
      setGuestEmail(row.recipient_email ?? "")
      setInvoiceTitle(row.requested_title?.trim() || "請求書")
      setNotes(row.requested_description?.trim() || "")
      if (row.request_deadline) setDueDate(row.request_deadline)
      else if (row.due_date) setDueDate(row.due_date)
    }

    void loadRequest()
    return () => {
      active = false
    }
  }, [activeOrgId, canAccess, requestId])

  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<ApplyAiResultDetail>).detail
      if (detail?.source !== "billing" || !detail.result?.text) return
      if (detail.applyTarget === "invoice_new_title") setInvoiceTitle(detail.result.text)
      if (detail.applyTarget === "invoice_new_notes") setNotes(detail.result.text)
      if (detail.applyTarget === "invoice_new_send_draft") setSendDraft(detail.result.text)
    }

    window.addEventListener("apply-ai-result", handler as EventListener)
    return () => window.removeEventListener("apply-ai-result", handler as EventListener)
  }, [])

  useEffect(() => {
    const client = clients.find((row) => row.id === clientId)
    if (!client) return
    setGuestName(client.billing_name?.trim() || client.name)
    setGuestCompanyName(client.name)
    setGuestEmail(client.billing_email ?? "")
    setGuestAddress(client.billing_address ?? "")
  }, [clientId, clients])

  const totals = useMemo(() => {
    const subtotal = lines.reduce((sum, line) => sum + yenFloor(line.quantity) * yenFloor(line.unit_price), 0)
    const tax =
      taxMode === "exclusive"
        ? yenFloor((subtotal * taxRate) / 100)
        : taxMode === "inclusive"
          ? yenFloor(subtotal - subtotal / (1 + taxRate / 100))
          : 0
    const withholding = withholdingEnabled ? yenFloor(subtotal * 0.1021) : 0
    return { subtotal, tax, withholding, total: subtotal + tax - withholding }
  }, [lines, taxMode, taxRate, withholdingEnabled])

  const selectedClient = useMemo(() => clients.find((row) => row.id === clientId) ?? null, [clientId, clients])

  const invoiceAiContext = useMemo(() => {
    const lineSummary =
      lines
        .filter((line) => line.description.trim())
        .map((line) => `${line.description} / 数量 ${line.quantity} / 単価 ${formatCurrency(line.unit_price)}`)
        .join("\n") || "-"

    return [
      `請求先: ${(selectedClient?.name ?? guestCompanyName) || guestName || "-"}`,
      `請求タイトル: ${invoiceTitle || "-"}`,
      `対象月: ${invoiceMonth}`,
      `発行日: ${issueDate}`,
      `支払期限: ${dueDate}`,
      `税区分: ${taxMode}`,
      `備考: ${notes || "-"}`,
      `送付前文: ${sendDraft || "-"}`,
      `明細:\n${lineSummary}`,
      `合計: ${formatCurrency(totals.total)}`,
    ].join("\n")
  }, [dueDate, guestCompanyName, guestName, invoiceMonth, invoiceTitle, issueDate, lines, notes, selectedClient, sendDraft, taxMode, totals.total])

  const updateLine = (id: string, patch: Partial<LineItem>) => {
    setLines((prev) => prev.map((line) => (line.id === id ? { ...line, ...patch } : line)))
  }

  const addLine = () => {
    setLines((prev) => [...prev, { id: crypto.randomUUID(), description: "", quantity: 1, unit_price: 0 }])
  }

  const removeLine = (id: string) => {
    setLines((prev) => (prev.length === 1 ? prev : prev.filter((line) => line.id !== id)))
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const validLines = lines.filter((line) => line.description.trim())
    if (!clientId && !guestName.trim()) {
      setError("取引先またはゲスト宛先を入力してください")
      return
    }
    if (validLines.length === 0) {
      setError("明細を1行以上入力してください")
      return
    }
    setSaving(true)
    setError(null)
    try {
      const token = (await supabase.auth.getSession()).data.session?.access_token
      if (!token) {
        setError("ログイン状態を確認してください")
        return
      }
      const res = await fetch("/api/invoices/create", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          client_id: clientId || null,
          guest_client_name: clientId ? null : guestName,
          guest_company_name: clientId ? null : guestCompanyName,
          guest_client_email: clientId ? null : guestEmail,
          guest_client_address: clientId ? null : guestAddress,
          invoice_title: invoiceTitle,
          invoice_month: invoiceMonth,
          issue_date: issueDate,
          due_date: dueDate,
          tax_mode: taxMode,
          tax_rate: taxRate,
          withholding_enabled: withholdingEnabled,
          bank_account_id: bankAccountId || null,
          notes,
          request_id: requestId || null,
          source_type: requestId ? "request" : "manual",
          lines: validLines,
        }),
      })
      const json = (await res.json().catch(() => null)) as { ok?: boolean; invoiceId?: string; message?: string } | null
      if (!res.ok || !json?.ok || !json.invoiceId) {
        setError(json?.message ?? "請求書の作成に失敗しました")
        return
      }
      router.push(`/invoices/${json.invoiceId}`)
    } finally {
      setSaving(false)
    }
  }

  if (authLoading || loading) {
    return <div style={{ padding: 32, color: "var(--muted)" }}>読み込み中...</div>
  }

  if (!canAccess) {
    return (
      <div style={{ padding: 32 }}>
        <div style={cardStyle}>
          <p>owner / executive_assistant のみアクセスできます。</p>
          <Link href="/invoices" style={{ color: "var(--primary)", fontWeight: 600 }}>請求書へ戻る</Link>
        </div>
      </div>
    )
  }

  return (
    <div style={{ padding: "32px 40px 60px", background: "var(--bg-grad)", minHeight: "100vh" }}>
      <header style={{ marginBottom: 24 }}>
        <Link href="/invoices" style={{ color: "var(--primary)", fontWeight: 600, textDecoration: "none" }}>← 請求書</Link>
        <h1 style={{ margin: "12px 0 6px", fontSize: 28, color: "var(--text)" }}>手動で請求書下書きを作成</h1>
        <p style={{ color: "var(--muted)", margin: 0 }}>請求条件を先に整えて下書きを作成し、発行は請求書詳細で確定します。</p>
      </header>

      {requestPrefill ? (
        <section style={{ ...cardStyle, marginBottom: 16, borderColor: "var(--info-border)", background: "var(--info-bg)" }}>
          <strong style={{ color: "var(--info-text)" }}>請求依頼から下書きを作成中</strong>
          <p style={{ margin: "6px 0 0", color: "var(--info-text)" }}>
            依頼タイトル、宛先、期限を引き継いでいます。作成後は依頼台帳から請求書へリンクされます。
          </p>
        </section>
      ) : null}

      <form onSubmit={handleSubmit} style={{ display: "grid", gap: 16 }}>
        <section style={cardStyle}>
          <h2 style={{ marginTop: 0, fontSize: 16 }}>宛先</h2>
          <div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))" }}>
            <label style={{ display: "grid", gap: 6 }}>
              <span>登録済み取引先</span>
              <select value={clientId} onChange={(e) => setClientId(e.target.value)} style={{ padding: "8px 12px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--input-bg)" }}>
                <option value="">ゲスト宛先を使う</option>
                {clients.map((client) => (
                  <option key={client.id} value={client.id}>{client.name}</option>
                ))}
              </select>
            </label>
            {!clientId && (
              <>
                <label style={{ display: "grid", gap: 6 }}>
                  <span>ゲスト宛先名</span>
                  <input value={guestName} onChange={(e) => setGuestName(e.target.value)} style={{ padding: "8px 12px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--input-bg)" }} />
                </label>
                <label style={{ display: "grid", gap: 6 }}>
                  <span>会社名</span>
                  <input value={guestCompanyName} onChange={(e) => setGuestCompanyName(e.target.value)} style={{ padding: "8px 12px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--input-bg)" }} />
                </label>
                <label style={{ display: "grid", gap: 6 }}>
                  <span>メールアドレス</span>
                  <input value={guestEmail} onChange={(e) => setGuestEmail(e.target.value)} style={{ padding: "8px 12px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--input-bg)" }} />
                </label>
                <label style={{ display: "grid", gap: 6, gridColumn: "1 / -1" }}>
                  <span>住所</span>
                  <input value={guestAddress} onChange={(e) => setGuestAddress(e.target.value)} style={{ padding: "8px 12px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--input-bg)" }} />
                </label>
              </>
            )}
          </div>
        </section>

        <section style={cardStyle}>
          <h2 style={{ marginTop: 0, fontSize: 16 }}>請求条件</h2>
          <div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))" }}>
            <label style={{ display: "grid", gap: 6 }}>
              <span>件名</span>
              <input value={invoiceTitle} onChange={(e) => setInvoiceTitle(e.target.value)} style={{ padding: "8px 12px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--input-bg)" }} />
            </label>
            <label style={{ display: "grid", gap: 6 }}>
              <span>対象月</span>
              <input type="month" value={invoiceMonth} onChange={(e) => setInvoiceMonth(e.target.value)} style={{ padding: "8px 12px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--input-bg)" }} />
            </label>
            <label style={{ display: "grid", gap: 6 }}>
              <span>請求日</span>
              <input type="date" value={issueDate} onChange={(e) => setIssueDate(e.target.value)} style={{ padding: "8px 12px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--input-bg)" }} />
            </label>
            <label style={{ display: "grid", gap: 6 }}>
              <span>支払期限</span>
              <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} style={{ padding: "8px 12px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--input-bg)" }} />
            </label>
            <label style={{ display: "grid", gap: 6 }}>
              <span>税区分</span>
              <select value={taxMode} onChange={(e) => setTaxMode(e.target.value as "exempt" | "exclusive" | "inclusive")} style={{ padding: "8px 12px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--input-bg)" }}>
                <option value="exempt">免税</option>
                <option value="exclusive">外税</option>
                <option value="inclusive">内税</option>
              </select>
            </label>
            <label style={{ display: "grid", gap: 6 }}>
              <span>税率 (%)</span>
              <input type="number" value={taxRate} onChange={(e) => setTaxRate(Number(e.target.value))} style={{ padding: "8px 12px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--input-bg)" }} />
            </label>
            <label style={{ display: "grid", gap: 6 }}>
              <span>振込口座</span>
              <select value={bankAccountId} onChange={(e) => setBankAccountId(e.target.value)} style={{ padding: "8px 12px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--input-bg)" }}>
                <option value="">口座を選択</option>
                {bankAccounts.map((account) => (
                  <option key={account.id} value={account.id}>
                    {account.bank_name} {account.branch_name} {account.account_number} {account.is_default ? "(既定)" : ""}
                  </option>
                ))}
              </select>
            </label>
            <label style={{ display: "flex", alignItems: "center", gap: 8, alignSelf: "end" }}>
              <input type="checkbox" checked={withholdingEnabled} onChange={(e) => setWithholdingEnabled(e.target.checked)} />
              <span>源泉徴収を適用</span>
            </label>
          </div>
          <label style={{ display: "grid", gap: 6, marginTop: 12 }}>
            <span>備考</span>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <span>メモ / notes</span>
              <button
                type="button"
                onClick={() =>
                  window.dispatchEvent(
                    new CustomEvent("open-ai-palette", {
                      detail: {
                        source: "billing" as const,
                        mode: "rewrite" as const,
                        modes: ["rewrite", "format", "request_message"],
                        text: notes,
                        compareText: notes,
                        context: invoiceAiContext,
                        title: "Billing AI",
                        applyLabel: "notes に反映",
                        applyTarget: "invoice_new_notes",
                        meta: {
                          sourceObject: "invoice_draft",
                          recordId: requestId || "new-invoice",
                          recordLabel: invoiceTitle || "新規請求書",
                        },
                      },
                    })
                  )
                }
                style={{ padding: "4px 8px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--surface-2)", cursor: "pointer", fontSize: 12, fontWeight: 700 }}
              >
                AIメモ整形
              </button>
            </div>
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} style={{ padding: "10px 12px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--input-bg)", resize: "vertical" }} />
          </label>
          <label style={{ display: "grid", gap: 6, marginTop: 12 }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <span>送付前文ドラフト</span>
              <button
                type="button"
                onClick={() =>
                  window.dispatchEvent(
                    new CustomEvent("open-ai-palette", {
                      detail: {
                        source: "billing" as const,
                        mode: "send_message" as const,
                        text: sendDraft,
                        compareText: sendDraft,
                        context: invoiceAiContext,
                        title: "Billing AI",
                        applyLabel: "送付前文に反映",
                        applyTarget: "invoice_new_send_draft",
                        meta: {
                          sourceObject: "invoice_draft",
                          recordId: requestId || "new-invoice",
                          recordLabel: invoiceTitle || "新規請求書",
                        },
                      },
                    })
                  )
                }
                style={{ padding: "4px 8px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--surface-2)", cursor: "pointer", fontSize: 12, fontWeight: 700 }}
              >
                AI送付文生成
              </button>
            </div>
            <textarea value={sendDraft} onChange={(e) => setSendDraft(e.target.value)} rows={3} style={{ padding: "10px 12px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--input-bg)", resize: "vertical" }} />
            <div style={{ fontSize: 12, color: "var(--muted)" }}>この欄は作成前の下書きです。請求書データには保存されません。</div>
          </label>
        </section>

        <section style={cardStyle}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap", marginBottom: 12 }}>
            <h2 style={{ margin: 0, fontSize: 16 }}>明細</h2>
            <button type="button" onClick={addLine} style={{ padding: "8px 12px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--surface-2)", cursor: "pointer" }}>
              明細を追加
            </button>
          </div>
          <div style={{ display: "grid", gap: 12 }}>
            {lines.map((line, index) => (
              <div key={line.id} style={{ display: "grid", gap: 10, gridTemplateColumns: "minmax(0, 1.8fr) 120px 160px auto", alignItems: "end" }}>
                <label style={{ display: "grid", gap: 6 }}>
                  <span>内容 {index + 1}</span>
                  <input value={line.description} onChange={(e) => updateLine(line.id, { description: e.target.value })} style={{ padding: "8px 12px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--input-bg)" }} />
                </label>
                <label style={{ display: "grid", gap: 6 }}>
                  <span>数量</span>
                  <input type="number" min={1} value={line.quantity} onChange={(e) => updateLine(line.id, { quantity: Number(e.target.value) })} style={{ padding: "8px 12px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--input-bg)" }} />
                </label>
                <label style={{ display: "grid", gap: 6 }}>
                  <span>単価</span>
                  <input type="number" min={0} value={line.unit_price} onChange={(e) => updateLine(line.id, { unit_price: Number(e.target.value) })} style={{ padding: "8px 12px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--input-bg)" }} />
                </label>
                <button type="button" onClick={() => removeLine(line.id)} style={{ height: 40, padding: "0 12px", borderRadius: 8, border: "1px solid var(--border)", background: "transparent", cursor: "pointer" }}>
                  削除
                </button>
              </div>
            ))}
          </div>
        </section>

        <section style={cardStyle}>
          <h2 style={{ marginTop: 0, fontSize: 16 }}>内容確認</h2>
          <div style={{ display: "grid", gap: 8, fontSize: 14 }}>
            <div>小計: {formatCurrency(totals.subtotal)}</div>
            <div>税額: {formatCurrency(totals.tax)}</div>
            <div>源泉徴収: {formatCurrency(totals.withholding)}</div>
            <div style={{ fontWeight: 700 }}>合計: {formatCurrency(totals.total)}</div>
          </div>
          {error && <p style={{ color: "var(--error-text)", marginBottom: 0 }}>{error}</p>}
          <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 16 }}>
            <button type="submit" disabled={saving} style={{ padding: "10px 18px", borderRadius: 10, border: "none", background: "var(--button-primary-bg)", color: "var(--primary-contrast)", fontWeight: 600, cursor: saving ? "not-allowed" : "pointer" }}>
              {saving ? "作成中..." : "請求書を作成"}
            </button>
          </div>
        </section>
      </form>
    </div>
  )
}
