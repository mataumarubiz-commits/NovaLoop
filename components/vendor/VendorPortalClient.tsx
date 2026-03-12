"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { useCallback, useEffect, useMemo, useState, type CSSProperties, type ReactNode } from "react"
import { supabase } from "@/lib/supabase"

type Mode = "home" | "profile" | "bank" | "current" | "list" | "detail"
type Profile = { display_name: string; legal_name: string; company_name: string; email: string; billing_name: string; postal_code: string; address: string; registration_number: string; notes: string }
type Bank = { bank_name: string; branch_name: string; account_type: string; account_number: string; account_holder: string }
type Line = { content_id: string; project_name: string; title: string; client_name: string; qty: number; unit_price: number; amount: number; work_type: string }
type Invoice = { id: string; invoice_number?: string | null; billing_month: string; status: string; total: number; memo?: string | null; submitted_at?: string | null; first_submitted_at?: string | null; resubmitted_at?: string | null; approved_at?: string | null; returned_at?: string | null; pay_date?: string | null; rejected_category?: string | null; rejected_reason?: string | null }
type DetailInvoice = Invoice & { lines: Line[] }
type MonthlyPayload = { profile: Profile; bankAccount: Bank | null; preview: { month: string; counts: { items: number; amount: number }; memo?: string; lines: Line[]; existingInvoice: Invoice | null }; history: Invoice[] }
type SubmitResult = { id: string; invoice_number?: string | null; billing_month: string; total: number; submitted_at?: string | null }

const NAV = [
  { href: "/vendor", label: "ホーム" },
  { href: "/vendor/profile", label: "プロフィール" },
  { href: "/vendor/bank-account", label: "口座情報" },
  { href: "/vendor/invoices/current", label: "今月の請求" },
  { href: "/vendor/invoices", label: "履歴" },
] as const

const STATUS: Record<string, string> = { draft: "下書き", submitted: "提出済み", approved: "承認済み", rejected: "差し戻し", returned: "差し戻し", paid: "支払済み" }
const RETURN_CATEGORY: Record<string, string> = { profile_missing: "プロフィール情報の不足", bank_invalid: "口座情報の不足", memo_required: "備考の確認が必要", content_review: "対象作業の確認が必要", other: "その他" }

const card: CSSProperties = { border: "1px solid rgba(120,92,180,0.14)", borderRadius: 22, padding: 20, background: "linear-gradient(180deg, rgba(255,255,255,0.98), rgba(249,245,255,0.96))", boxShadow: "0 18px 44px rgba(70,30,140,0.06)" }
const input: CSSProperties = { width: "100%", padding: "10px 12px", borderRadius: 12, border: "1px solid rgba(120,92,180,0.18)", background: "rgba(255,255,255,0.94)", color: "var(--text)" }
const primaryButton: CSSProperties = { padding: "12px 18px", borderRadius: 999, border: "none", background: "var(--button-primary-bg)", color: "var(--primary-contrast)", fontWeight: 700, cursor: "pointer" }
const secondaryButton: CSSProperties = { padding: "10px 16px", borderRadius: 12, border: "1px solid rgba(120,92,180,0.18)", background: "rgba(255,255,255,0.92)", color: "var(--text)", fontWeight: 600, cursor: "pointer" }
const th: CSSProperties = { textAlign: "left", padding: "10px 8px", borderBottom: "1px solid var(--border)", color: "var(--muted)" }
const thRight: CSSProperties = { ...th, textAlign: "right" }
const td: CSSProperties = { padding: "10px 8px", borderBottom: "1px solid var(--table-border)", color: "var(--text)" }
const tdRight: CSSProperties = { ...td, textAlign: "right" }

const nowMonth = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}` }
const emptyBank = (): Bank => ({ bank_name: "", branch_name: "", account_type: "ordinary", account_number: "", account_holder: "" })
const fmtDate = (v?: string | null) => (v ? v.slice(0, 10) : "-")
const yen = (v: number) => `¥${new Intl.NumberFormat("ja-JP", { maximumFractionDigits: 0 }).format(Number(v || 0))}`
const maskAccount = (v?: string | null) => (v ? `****${v.slice(-4)}` : "-")
const statusLabel = (v?: string | null) => STATUS[v || "draft"] || "下書き"
const returnCategoryLabel = (v?: string | null) => (v ? RETURN_CATEGORY[v] || v : "-")
const profileReady = (v: Profile | null) => Boolean(v?.display_name.trim() && v?.billing_name.trim() && v?.email.trim())
const bankReady = (v: Bank | null) => Boolean(v?.bank_name.trim() && v?.branch_name.trim() && v?.account_number.trim() && v?.account_holder.trim())
const editable = (invoice: Invoice | null) => !invoice || invoice.status === "draft" || invoice.status === "rejected"

export default function VendorPortalClient({ mode, invoiceId }: { mode: Mode; invoiceId?: string }) {
  const pathname = usePathname()
  const [month, setMonth] = useState(nowMonth())
  const [loading, setLoading] = useState(true)
  const [loggedIn, setLoggedIn] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [saving, setSaving] = useState<"profile" | "bank" | "submit" | null>(null)
  const [data, setData] = useState<MonthlyPayload | null>(null)
  const [detail, setDetail] = useState<DetailInvoice | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [bank, setBank] = useState<Bank | null>(null)
  const [justSubmitted, setJustSubmitted] = useState<SubmitResult | null>(null)

  const currentInvoice = data?.preview.existingInvoice ?? null
  const canSubmit = profileReady(profile) && bankReady(bank) && editable(currentInvoice) && (data?.preview.lines.length ?? 0) > 0

  const token = useCallback(async () => {
    const value = (await supabase.auth.getSession()).data.session?.access_token
    if (!value) throw new Error("ログインしてください。")
    return value
  }, [])

  const openPdf = useCallback(async (id: string) => {
    try {
      const res = await fetch(`/api/vendor-invoices/${id}/pdf`, { headers: { Authorization: `Bearer ${await token()}` } })
      const json = await res.json().catch(() => null)
      if (!res.ok || !json?.signed_url) throw new Error(json?.error ?? "PDF を開けませんでした。")
      window.open(json.signed_url, "_blank", "noopener,noreferrer")
    } catch (e) {
      setError(e instanceof Error ? e.message : "PDF を開けませんでした。")
    }
  }, [token])

  const loadMonthly = useCallback(async (targetMonth: string) => {
    setLoading(true); setError(null)
    const sessionToken = (await supabase.auth.getSession()).data.session?.access_token
    if (!sessionToken) { setLoggedIn(false); setLoading(false); return }
    setLoggedIn(true)
    await fetch("/api/vendor/claim", { method: "POST", headers: { Authorization: `Bearer ${sessionToken}` } }).catch(() => null)
    const res = await fetch(`/api/vendor/monthly-invoice?month=${targetMonth}`, { headers: { Authorization: `Bearer ${sessionToken}` } })
    const json = await res.json().catch(() => null)
    if (!res.ok || !json?.ok) { setData(null); setProfile(null); setBank(emptyBank()); setError(json?.error ?? "今月の請求情報を読み込めませんでした。") }
    else { setData(json); setProfile(json.profile); setBank(json.bankAccount ?? emptyBank()) }
    setLoading(false)
  }, [])

  const loadDetail = useCallback(async (id: string) => {
    try {
      const res = await fetch(`/api/vendor/invoices/${id}`, { headers: { Authorization: `Bearer ${await token()}` } })
      const json = await res.json().catch(() => null)
      if (!res.ok || !json?.ok) throw new Error(json?.error ?? "請求詳細を読み込めませんでした。")
      setDetail(json.invoice)
    } catch (e) {
      setError(e instanceof Error ? e.message : "請求詳細を読み込めませんでした。")
    }
  }, [token])

  useEffect(() => { void loadMonthly(month) }, [loadMonthly, month])
  useEffect(() => { if (mode === "detail" && invoiceId) void loadDetail(invoiceId) }, [mode, invoiceId, loadDetail])

  async function save(path: string, body: unknown, key: "profile" | "bank", okMessage: string, ngMessage: string) {
    setSaving(key); setError(null); setSuccess(null)
    try {
      const res = await fetch(path, { method: "PUT", headers: { "Content-Type": "application/json", Authorization: `Bearer ${await token()}` }, body: JSON.stringify(body) })
      const json = await res.json().catch(() => null)
      if (!res.ok || !json?.ok) throw new Error(json?.error ?? ngMessage)
      setSuccess(okMessage)
      await loadMonthly(month)
    } catch (e) {
      setError(e instanceof Error ? e.message : ngMessage)
    } finally {
      setSaving(null)
    }
  }

  const submitCurrent = async () => {
    setSaving("submit"); setError(null); setSuccess(null)
    try {
      const res = await fetch("/api/vendor/monthly-invoice", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${await token()}` }, body: JSON.stringify({ month }) })
      const json = await res.json().catch(() => null)
      if (!res.ok || !json?.ok) throw new Error(json?.error ?? "請求を提出できませんでした。")
      setJustSubmitted(json.invoice); setSuccess("請求を提出しました。"); await loadMonthly(month)
      if (json.invoice?.signed_url) window.open(json.invoice.signed_url, "_blank", "noopener,noreferrer")
    } catch (e) {
      setError(e instanceof Error ? e.message : "請求を提出できませんでした。")
    } finally {
      setSaving(null)
    }
  }

  const homeState = useMemo(() => {
    if (!profileReady(profile) || !bankReady(bank)) return { title: "最初にプロフィールと口座情報を登録してください", description: "請求を提出するには、プロフィールと口座情報の両方が必要です。", meta: [] as Array<[string, string]>, actions: [{ href: "/vendor/profile", label: "プロフィールを登録" }, { href: "/vendor/bank-account", label: "口座情報を登録" }, { href: "", label: "今月の請求を確認", disabled: true }] }
    if (!currentInvoice || currentInvoice.status === "draft") return { title: "今月の請求はまだ提出前です", description: "対象作業と請求内容を確認して、今月の請求を提出してください。", meta: [["対象月", month], ["件数", `${data?.preview.counts.items ?? 0}件`], ["合計金額", yen(data?.preview.counts.amount ?? 0)]] as Array<[string, string]>, actions: [{ href: "/vendor/invoices/current", label: "今月の請求を確認する" }] }
    if (currentInvoice.status === "submitted") return { title: "今月の請求は提出済みです", description: "会社側の確認待ちです。必要なら PDF と詳細を確認してください。", meta: [["提出日", fmtDate(currentInvoice.submitted_at)], ["ステータス", "submitted"]] as Array<[string, string]>, actions: [{ href: `/vendor/invoices/${currentInvoice.id}`, label: "請求詳細を見る" }] }
    if (currentInvoice.status === "rejected") return { title: "今月の請求は差し戻し中です", description: "差し戻し理由を確認して、必要な修正後に再提出してください。", meta: [["対象月", currentInvoice.billing_month], ["差し戻し日", fmtDate(currentInvoice.returned_at)], ["理由", currentInvoice.rejected_reason || "-"]] as Array<[string, string]>, actions: [{ href: "/vendor/invoices/current", label: "差し戻し内容を確認する" }] }
    if (currentInvoice.status === "approved") return { title: "今月の請求は承認済みです", description: "支払い予定日を確認しながら、そのままお待ちください。", meta: [["承認日", fmtDate(currentInvoice.approved_at)], ["支払予定日", fmtDate(currentInvoice.pay_date)]] as Array<[string, string]>, actions: [] as Array<{ href: string; label: string }> }
    return { title: "今月の請求は支払済みです", description: "請求 PDF は履歴から再ダウンロードできます。", meta: [["支払日", fmtDate(currentInvoice.pay_date)]] as Array<[string, string]>, actions: [{ href: "/vendor/invoices", label: "履歴を見る" }] }
  }, [profile, bank, currentInvoice, month, data])

  if (loading) return <div style={{ padding: 32, color: "var(--muted)" }}>読み込み中...</div>
  if (!loggedIn) return <div style={{ padding: 32, color: "var(--muted)" }}>ログイン後に利用できます。</div>

  const pageTitle = mode === "home" ? "ホーム" : mode === "profile" ? "プロフィール" : mode === "bank" ? "口座情報" : mode === "current" ? "今月の請求" : mode === "list" ? "履歴" : "請求詳細"

  return (
    <div style={{ padding: "32px 40px 64px", minHeight: "100vh", background: "var(--bg-grad)" }}>
      <div style={{ maxWidth: 1120, margin: "0 auto", display: "grid", gap: 16 }}>
        <header style={{ display: "grid", gap: 12 }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 16, flexWrap: "wrap", alignItems: "end" }}>
            <div>
              <p style={{ margin: 0, fontSize: 12, letterSpacing: "0.08em", color: "var(--primary)" }}>VENDOR PORTAL</p>
              <h1 style={{ margin: "6px 0 8px", fontSize: 30, color: "var(--text)" }}>{pageTitle}</h1>
              <p style={{ margin: 0, color: "var(--muted)", fontSize: 14 }}>{mode === "home" ? "今月の請求状態と、プロフィール・口座情報の準備状況をまとめて確認できます。" : "会社側へ提出する請求に必要な情報を確認・更新できます。"}</p>
            </div>
            {(mode === "home" || mode === "current") ? <label style={{ display: "grid", gap: 6, fontSize: 13, color: "var(--muted)" }}>対象月<input type="month" value={month} onChange={(e) => setMonth(e.target.value)} style={input} /></label> : null}
          </div>
          <nav style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>{NAV.map((item) => <Link key={item.href} href={item.href} style={{ padding: "9px 14px", borderRadius: 999, border: "1px solid rgba(120,92,180,0.16)", background: pathname === item.href ? "var(--button-primary-bg)" : "rgba(255,255,255,0.88)", color: pathname === item.href ? "var(--primary-contrast)" : "var(--text)", textDecoration: "none", fontWeight: 700, fontSize: 13 }}>{item.label}</Link>)}</nav>
        </header>

        {error ? <section style={{ ...card, borderColor: "#fecaca", background: "#fff1f2", color: "#b91c1c" }}>{error}</section> : null}
        {success ? <section style={{ ...card, borderColor: "#bbf7d0", background: "#f0fdf4", color: "#166534" }}>{success}</section> : null}

        {mode === "home" ? <>
          <section style={card}><div style={{ display: "grid", gap: 12 }}><div style={{ fontSize: 12, color: "var(--primary)", fontWeight: 700 }}>今月の状態</div><h2 style={{ margin: 0, fontSize: 26, color: "var(--text)" }}>{homeState.title}</h2><p style={{ margin: 0, color: "var(--muted)", lineHeight: 1.7 }}>{homeState.description}</p><div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>{homeState.meta.map(([k, v]) => <Meta key={k} label={k} value={v} />)}</div><div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>{homeState.actions.map((a, index) => a.disabled ? <span key={a.label} style={{ ...secondaryButton, opacity: 0.5, cursor: "not-allowed" }}>{a.label}</span> : <Link key={a.label} href={a.href} style={index === 0 ? { ...primaryButton, display: "inline-flex", textDecoration: "none", alignItems: "center" } : { ...secondaryButton, display: "inline-flex", textDecoration: "none", alignItems: "center" }}>{a.label}</Link>)}</div></div></section>
          <section style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(300px,1fr))", gap: 16 }}>
            <InfoCard title="プロフィール情報" href="/vendor/profile" label="プロフィールを編集" rows={[["表示名 / 請求名義", profile?.display_name || "-"], ["会社名 / 屋号", profile?.company_name || "-"], ["メール", profile?.email || "-"]]} />
            <InfoCard title="口座情報" href="/vendor/bank-account" label="口座情報を編集" rows={[["銀行名", bank?.bank_name || "-"], ["支店名", bank?.branch_name || "-"], ["口座種別", bank?.account_type || "-"], ["口座番号", maskAccount(bank?.account_number)], ["口座名義", bank?.account_holder || "-"]]} />
            <InfoCard title="請求履歴" href="/vendor/invoices" label="すべて見る" rows={(data?.history ?? []).slice(0, 3).map((invoice) => [invoice.billing_month, `${yen(invoice.total)} / ${statusLabel(invoice.status)}`])} />
          </section>
        </> : null}

        {mode === "profile" && profile ? <FormCard title="プロフィール" saving={saving === "profile"} onSave={() => save("/api/vendor/profile", profile, "profile", "プロフィールを保存しました。", "プロフィールを保存できませんでした。")}>
          <Field label="表示名"><input value={profile.display_name} onChange={(e) => setProfile({ ...profile, display_name: e.target.value })} style={input} /></Field>
          <Field label="氏名 / 法人名"><input value={profile.legal_name} onChange={(e) => setProfile({ ...profile, legal_name: e.target.value })} style={input} /></Field>
          <Field label="会社名 / 屋号"><input value={profile.company_name} onChange={(e) => setProfile({ ...profile, company_name: e.target.value })} style={input} /></Field>
          <Field label="メールアドレス"><input value={profile.email} onChange={(e) => setProfile({ ...profile, email: e.target.value })} style={input} /></Field>
          <Field label="請求書の名義"><input value={profile.billing_name} onChange={(e) => setProfile({ ...profile, billing_name: e.target.value })} style={input} /></Field>
          <Field label="郵便番号"><input value={profile.postal_code} onChange={(e) => setProfile({ ...profile, postal_code: e.target.value })} style={input} /></Field>
          <Field label="住所" wide><textarea value={profile.address} onChange={(e) => setProfile({ ...profile, address: e.target.value })} rows={3} style={{ ...input, resize: "vertical" }} /></Field>
          <Field label="登録番号 / インボイス番号"><input value={profile.registration_number} onChange={(e) => setProfile({ ...profile, registration_number: e.target.value })} style={input} /></Field>
          <Field label="備考" wide><textarea value={profile.notes} onChange={(e) => setProfile({ ...profile, notes: e.target.value })} rows={3} style={{ ...input, resize: "vertical" }} /></Field>
        </FormCard> : null}

        {mode === "bank" && bank ? <FormCard title="口座情報" saving={saving === "bank"} onSave={() => save("/api/vendor/bank-account", bank, "bank", "口座情報を保存しました。", "口座情報を保存できませんでした。")}>
          <Field label="銀行名"><input value={bank.bank_name} onChange={(e) => setBank({ ...bank, bank_name: e.target.value })} style={input} /></Field>
          <Field label="支店名"><input value={bank.branch_name} onChange={(e) => setBank({ ...bank, branch_name: e.target.value })} style={input} /></Field>
          <Field label="口座種別"><select value={bank.account_type} onChange={(e) => setBank({ ...bank, account_type: e.target.value })} style={input}><option value="ordinary">普通</option><option value="checking">当座</option><option value="savings">貯蓄</option></select></Field>
          <Field label="口座番号"><input value={bank.account_number} onChange={(e) => setBank({ ...bank, account_number: e.target.value })} style={input} /></Field>
          <Field label="口座名義"><input value={bank.account_holder} onChange={(e) => setBank({ ...bank, account_holder: e.target.value })} style={input} /></Field>
        </FormCard> : null}

        {mode === "current" ? <CurrentSection justSubmitted={justSubmitted} currentInvoice={currentInvoice} data={data} profile={profile} bank={bank} month={month} openPdf={openPdf} canSubmit={canSubmit} saving={saving === "submit"} onSubmit={submitCurrent} /> : null}
        {mode === "list" ? <HistorySection history={data?.history ?? []} openPdf={openPdf} /> : null}
        {mode === "detail" ? <DetailSection detail={detail} openPdf={openPdf} /> : null}
      </div>
    </div>
  )
}

function CurrentSection({ justSubmitted, currentInvoice, data, profile, bank, month, openPdf, canSubmit, saving, onSubmit }: { justSubmitted: SubmitResult | null; currentInvoice: Invoice | null; data: MonthlyPayload | null; profile: Profile | null; bank: Bank | null; month: string; openPdf: (id: string) => Promise<void>; canSubmit: boolean; saving: boolean; onSubmit: () => Promise<void> }) {
  return <><section style={card}>{justSubmitted ? <div style={{ display: "grid", gap: 10, marginBottom: 18, paddingBottom: 18, borderBottom: "1px solid rgba(120,92,180,0.12)" }}><div style={{ fontSize: 12, color: "#166534", fontWeight: 700 }}>提出完了</div><h2 style={{ margin: 0, fontSize: 24, color: "#166534" }}>請求を提出しました</h2><div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))", gap: 12 }}><Stat title="対象月" value={justSubmitted.billing_month} /><Stat title="請求番号" value={justSubmitted.invoice_number || "-"} /><Stat title="提出日" value={fmtDate(justSubmitted.submitted_at)} /><Stat title="金額" value={yen(justSubmitted.total)} /></div><div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}><button type="button" onClick={() => void openPdf(justSubmitted.id)} style={primaryButton}>PDF をダウンロード</button><Link href="/vendor/invoices" style={{ ...secondaryButton, display: "inline-flex", textDecoration: "none", alignItems: "center" }}>履歴を見る</Link></div></div> : null}
    {currentInvoice?.status === "rejected" ? <section style={{ ...card, marginBottom: 16, borderColor: "#fdba74", background: "#fff7ed" }}><h2 style={{ margin: 0, fontSize: 18, color: "#9a3412" }}>差し戻し理由</h2><div style={{ display: "grid", gap: 8, marginTop: 12, color: "#9a3412" }}><div>カテゴリ: {returnCategoryLabel(currentInvoice.rejected_category)}</div><div>理由: {currentInvoice.rejected_reason || "-"}</div></div></section> : null}
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))", gap: 14 }}><Stat title="対象月" value={month} /><Stat title="ステータス" value={statusLabel(currentInvoice?.status)} /><Stat title="対象作業件数" value={`${data?.preview.counts.items ?? 0}件`} /><Stat title="合計金額" value={yen(data?.preview.counts.amount ?? 0)} /></div>
    <div style={{ marginTop: 16, padding: 14, borderRadius: 16, border: "1px solid rgba(120,92,180,0.12)", background: "rgba(255,255,255,0.75)" }}><div style={{ fontSize: 12, color: "var(--muted)" }}>備考</div><div style={{ marginTop: 6, color: "var(--text)" }}>{data?.preview.memo || currentInvoice?.memo || "-"}</div></div></section>
    <section style={card}><h2 style={{ margin: 0, fontSize: 18, color: "var(--text)" }}>今月の請求明細</h2><table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, marginTop: 16 }}><thead><tr><th style={th}>案件名</th><th style={th}>クライアント名</th><th style={th}>作業内容</th><th style={thRight}>単価</th><th style={thRight}>数量</th><th style={thRight}>金額</th></tr></thead><tbody>{(data?.preview.lines ?? []).map((line) => <tr key={line.content_id}><td style={td}>{line.project_name}</td><td style={td}>{line.client_name}</td><td style={td}>{line.title} / {line.work_type}</td><td style={tdRight}>{yen(line.unit_price)}</td><td style={tdRight}>{String(line.qty)}</td><td style={{ ...tdRight, fontWeight: 700 }}>{yen(line.amount)}</td></tr>)}</tbody></table></section>
    <section style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(320px,1fr))", gap: 16 }}><InfoCard title="請求先情報" href="/vendor/profile" label="プロフィールを編集" rows={[["表示名 / 請求名義", profile?.display_name || "-"], ["請求書の名義", profile?.billing_name || "-"], ["住所", [profile?.postal_code, profile?.address].filter(Boolean).join(" ") || "-"], ["メール", profile?.email || "-"]]} /><InfoCard title="振込先情報" href="/vendor/bank-account" label="口座情報を編集" rows={[["銀行名", bank?.bank_name || "-"], ["支店名", bank?.branch_name || "-"], ["口座種別", bank?.account_type || "-"], ["口座番号", maskAccount(bank?.account_number)], ["口座名義", bank?.account_holder || "-"]]} /></section>
    <section style={card}><div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "center" }}><div style={{ color: "var(--muted)", lineHeight: 1.7, fontSize: 13 }}>対象作業と金額は Nova loop の作業データから自動反映しています。内容に問題がなければ、そのまま請求を提出してください。</div><div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}><Link href="/vendor/profile" style={{ ...secondaryButton, display: "inline-flex", textDecoration: "none", alignItems: "center" }}>プロフィールを編集</Link><Link href="/vendor/bank-account" style={{ ...secondaryButton, display: "inline-flex", textDecoration: "none", alignItems: "center" }}>口座情報を編集</Link>{currentInvoice?.id ? <button type="button" onClick={() => void openPdf(currentInvoice.id)} style={secondaryButton}>PDF をダウンロード</button> : null}{editable(currentInvoice) ? <button type="button" onClick={() => void onSubmit()} disabled={!canSubmit || saving} style={{ ...primaryButton, opacity: !canSubmit || saving ? 0.55 : 1 }}>{saving ? "送信中..." : currentInvoice?.status === "rejected" ? "修正して再提出する" : "確認して請求を提出"}</button> : null}</div></div></section></>
}

function HistorySection({ history, openPdf }: { history: Invoice[]; openPdf: (id: string) => Promise<void> }) {
  return <section style={card}><h2 style={{ margin: 0, fontSize: 18, color: "var(--text)" }}>請求履歴</h2><div style={{ display: "grid", gap: 10, marginTop: 14 }}>{history.length === 0 ? <div style={{ color: "var(--muted)" }}>請求履歴はまだありません。</div> : history.map((invoice) => <div key={invoice.id} style={{ border: "1px solid var(--border)", borderRadius: 14, padding: 16, background: "rgba(255,255,255,0.7)" }}><div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}><div style={{ display: "grid", gap: 6 }}><div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}><strong style={{ color: "var(--text)" }}>{invoice.billing_month}</strong><span style={{ fontSize: 12, padding: "3px 9px", borderRadius: 999, background: "rgba(110,67,208,0.08)", color: "var(--muted)" }}>{statusLabel(invoice.status)}</span></div><div style={{ fontSize: 13, color: "var(--muted)" }}>{invoice.invoice_number || "-"} / {yen(invoice.total)} / 提出日 {fmtDate(invoice.submitted_at)}</div></div><div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}><button type="button" onClick={() => void openPdf(invoice.id)} style={secondaryButton}>PDF をダウンロード</button><Link href={`/vendor/invoices/${invoice.id}`} style={{ ...secondaryButton, display: "inline-flex", textDecoration: "none", alignItems: "center" }}>詳細を見る</Link></div></div></div>)}</div></section>
}

function DetailSection({ detail, openPdf }: { detail: DetailInvoice | null; openPdf: (id: string) => Promise<void> }) {
  if (!detail) return <section style={card}>請求詳細を読み込めませんでした。</section>
  return <section style={card}><div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))", gap: 14 }}><Stat title="対象月" value={detail.billing_month} /><Stat title="ステータス" value={statusLabel(detail.status)} /><Stat title="請求番号" value={detail.invoice_number || "-"} /><Stat title="初回提出日" value={fmtDate(detail.first_submitted_at || detail.submitted_at)} /><Stat title="最新再提出日" value={fmtDate(detail.resubmitted_at)} /><Stat title="承認日" value={fmtDate(detail.approved_at)} /></div>{detail.status === "rejected" ? <section style={{ ...card, marginTop: 16, borderColor: "#fdba74", background: "#fff7ed" }}><h3 style={{ margin: 0, fontSize: 16, color: "#9a3412" }}>差し戻し理由</h3><div style={{ display: "grid", gap: 8, marginTop: 12, color: "#9a3412" }}><div>カテゴリ: {returnCategoryLabel(detail.rejected_category)}</div><div>理由: {detail.rejected_reason || "-"}</div><div>差し戻し日: {fmtDate(detail.returned_at)}</div></div></section> : null}<div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 16 }}><button type="button" onClick={() => void openPdf(detail.id)} style={primaryButton}>PDF をダウンロード</button><Link href="/vendor/invoices" style={{ ...secondaryButton, display: "inline-flex", textDecoration: "none", alignItems: "center" }}>履歴に戻る</Link>{detail.status === "rejected" ? <Link href="/vendor/invoices/current" style={{ ...secondaryButton, display: "inline-flex", textDecoration: "none", alignItems: "center" }}>修正して再提出する</Link> : null}</div><section style={{ marginTop: 16, padding: 14, borderRadius: 16, border: "1px solid rgba(120,92,180,0.12)", background: "rgba(255,255,255,0.75)" }}><div style={{ fontSize: 12, color: "var(--muted)" }}>備考</div><div style={{ marginTop: 6 }}>{detail.memo || "-"}</div></section><table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, marginTop: 16 }}><thead><tr><th style={th}>案件名</th><th style={th}>クライアント名</th><th style={th}>作業内容</th><th style={thRight}>単価</th><th style={thRight}>数量</th><th style={thRight}>金額</th></tr></thead><tbody>{detail.lines.map((line) => <tr key={line.content_id}><td style={td}>{line.project_name}</td><td style={td}>{line.client_name}</td><td style={td}>{line.title} / {line.work_type}</td><td style={tdRight}>{yen(line.unit_price)}</td><td style={tdRight}>{String(line.qty)}</td><td style={{ ...tdRight, fontWeight: 700 }}>{yen(line.amount)}</td></tr>)}</tbody></table></section>
}

function FormCard({ title, saving, onSave, children }: { title: string; saving: boolean; onSave: () => void; children: ReactNode }) {
  return <section style={card}><h2 style={{ margin: 0, fontSize: 18, color: "var(--text)" }}>{title}</h2><div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(280px,1fr))", gap: 14, marginTop: 16 }}>{children}</div><div style={{ marginTop: 16 }}><button type="button" onClick={onSave} disabled={saving} style={primaryButton}>{saving ? "保存中..." : "保存する"}</button></div></section>
}

function Field({ label, wide, children }: { label: string; wide?: boolean; children: ReactNode }) {
  return <label style={{ display: "grid", gap: 6, gridColumn: wide ? "1 / -1" : undefined }}><span style={{ fontSize: 12, color: "var(--muted)" }}>{label}</span>{children}</label>
}

function InfoCard({ title, rows, href, label }: { title: string; rows: Array<[string, string]>; href: string; label: string }) {
  return <section style={card}><div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", flexWrap: "wrap" }}><h2 style={{ margin: 0, fontSize: 18, color: "var(--text)" }}>{title}</h2><Link href={href} style={{ color: "var(--primary)", textDecoration: "none", fontWeight: 700 }}>{label}</Link></div><div style={{ display: "grid", gap: 10, marginTop: 14 }}>{rows.length === 0 ? <div style={{ color: "var(--muted)" }}>まだデータはありません。</div> : rows.map(([k, v]) => <div key={k} style={{ display: "grid", gap: 4 }}><div style={{ fontSize: 12, color: "var(--muted)" }}>{k}</div><div style={{ color: "var(--text)" }}>{v || "-"}</div></div>)}</div></section>
}

function Meta({ label, value }: { label: string; value: string }) {
  return <div style={{ padding: "10px 12px", borderRadius: 14, background: "rgba(110,67,208,0.08)" }}><div style={{ fontSize: 11, color: "var(--muted)" }}>{label}</div><div style={{ marginTop: 4, fontWeight: 700, color: "var(--text)" }}>{value}</div></div>
}

function Stat({ title, value }: { title: string; value: string }) {
  return <div><div style={{ fontSize: 12, color: "var(--muted)" }}>{title}</div><div style={{ marginTop: 6, fontSize: 18, fontWeight: 700, color: "var(--text)" }}>{value}</div></div>
}
