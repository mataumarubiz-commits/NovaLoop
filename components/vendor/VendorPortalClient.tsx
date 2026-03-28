"use client"

import Link from "next/link"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { useCallback, useEffect, useMemo, useState, type CSSProperties, type ReactNode } from "react"
import { supabase } from "@/lib/supabase"

type Mode = "home" | "profile" | "bank" | "current" | "list" | "detail"
type Profile = { display_name: string; legal_name: string; company_name: string; email: string; billing_name: string; postal_code: string; address: string; registration_number: string; notes: string }
type Bank = { bank_name: string; branch_name: string; account_type: string; account_number: string; account_holder: string }
type Line = { content_id: string; project_name: string; title: string; client_name: string; qty: number; unit_price: number; amount: number; work_type: string }
type Invoice = { id: string; invoice_number?: string | null; billing_month: string; status: string; total: number; memo?: string | null; submitted_at?: string | null; first_submitted_at?: string | null; resubmitted_at?: string | null; approved_at?: string | null; returned_at?: string | null; pay_date?: string | null; submit_deadline?: string | null; rejected_category?: string | null; rejected_reason?: string | null }
type DetailInvoice = Invoice & { lines: Line[] }
type Preview = { month: string; counts: { items: number; amount: number }; memo?: string | null; lines: Line[]; existingInvoice: Invoice | null; editableInvoice?: Invoice | null; lockedInvoice?: Invoice | null; dates: { submitDeadline: string; payDate: string } }
type MonthlyPayload = { month: string; requestedMonth?: string | null; resolvedFrom?: string; autoPrepared?: boolean; profile: Profile; bankAccount: Bank | null; preview: Preview; history: Invoice[] }
type SubmitResult = { id: string; invoice_number?: string | null; billing_month: string; total: number; submitted_at?: string | null }

const NAV = [
  { href: "/vendor", label: "ホーム" },
  { href: "/vendor/profile", label: "プロフィール" },
  { href: "/vendor/bank-account", label: "口座情報" },
  { href: "/vendor/invoices/current", label: "現在の請求" },
  { href: "/vendor/invoices", label: "履歴" },
] as const

const STATUS: Record<string, string> = { draft: "確認待ち", submitted: "提出済み", approved: "承認済み", rejected: "差し戻し", returned: "差し戻し", paid: "支払済み" }
const RETURN_CATEGORY: Record<string, string> = { profile_missing: "プロフィール不足", bank_invalid: "口座情報の不備", memo_required: "備考確認", content_review: "案件内容の確認", other: "その他" }

const card: CSSProperties = { border: "1px solid rgba(120,92,180,0.14)", borderRadius: 22, padding: 20, background: "linear-gradient(180deg, rgba(255,255,255,0.98), rgba(249,245,255,0.96))", boxShadow: "0 18px 44px rgba(70,30,140,0.06)" }
const input: CSSProperties = { width: "100%", padding: "10px 12px", borderRadius: 12, border: "1px solid rgba(120,92,180,0.18)", background: "rgba(255,255,255,0.94)", color: "var(--text)" }
const primaryButton: CSSProperties = { padding: "12px 18px", borderRadius: 999, border: "none", background: "var(--button-primary-bg)", color: "var(--primary-contrast)", fontWeight: 700, cursor: "pointer" }
const secondaryButton: CSSProperties = { padding: "10px 16px", borderRadius: 12, border: "1px solid rgba(120,92,180,0.18)", background: "rgba(255,255,255,0.92)", color: "var(--text)", fontWeight: 600, cursor: "pointer" }
const th: CSSProperties = { textAlign: "left", padding: "10px 8px", borderBottom: "1px solid var(--border)", color: "var(--muted)" }
const thRight: CSSProperties = { ...th, textAlign: "right" }
const td: CSSProperties = { padding: "10px 8px", borderBottom: "1px solid var(--table-border)", color: "var(--text)" }
const tdRight: CSSProperties = { ...td, textAlign: "right" }

const nowMonth = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}` }
const normalizeMonth = (value: string | null | undefined) => (typeof value === "string" && /^\d{4}-\d{2}$/.test(value) ? value : null)
const monthHref = (path: string, month?: string | null) => { const normalized = normalizeMonth(month ?? null); return normalized ? `${path}?month=${encodeURIComponent(normalized)}` : path }
const fmtDate = (value?: string | null) => (value ? value.slice(0, 10) : "-")
const yen = (value: number) => `¥${new Intl.NumberFormat("ja-JP", { maximumFractionDigits: 0 }).format(Number(value || 0))}`
const maskAccount = (value?: string | null) => (value ? `****${value.slice(-4)}` : "-")
const statusLabel = (value?: string | null) => STATUS[value || "draft"] || "確認待ち"
const returnCategoryLabel = (value?: string | null) => (value ? RETURN_CATEGORY[value] || value : "-")
const profileReady = (value: Profile | null) => Boolean(value?.display_name.trim() && value?.billing_name.trim() && value?.email.trim())
const bankReady = (value: Bank | null) => Boolean(value?.bank_name.trim() && value?.branch_name.trim() && value?.account_number.trim() && value?.account_holder.trim())
const editable = (invoice: Invoice | null) => !invoice || invoice.status === "draft" || invoice.status === "rejected"
const emptyBank = (): Bank => ({ bank_name: "", branch_name: "", account_type: "ordinary", account_number: "", account_holder: "" })

export default function VendorPortalClient({ mode, invoiceId }: { mode: Mode; invoiceId?: string }) {
  const pathname = usePathname()
  const router = useRouter()
  const searchParams = useSearchParams()
  const queryMonth = normalizeMonth(searchParams?.get("month"))

  const [resolvedMonth, setResolvedMonth] = useState("")
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
  const [autoPrepared, setAutoPrepared] = useState(false)

  const activeMonth = queryMonth ?? resolvedMonth
  const monthValue = activeMonth || nowMonth()
  const preview = data?.preview ?? null
  const currentInvoice = preview?.existingInvoice ?? null
  const canSubmit = profileReady(profile) && bankReady(bank) && editable(currentInvoice) && (preview?.lines.length ?? 0) > 0

  const redirectTarget = useMemo(() => {
    const currentPath = pathname || "/vendor"
    const query = searchParams?.toString()
    return query ? `${currentPath}?${query}` : currentPath
  }, [pathname, searchParams])
  const loginHref = useMemo(() => `/?redirectTo=${encodeURIComponent(redirectTarget)}`, [redirectTarget])
  const scopedHref = useCallback((path: string, month?: string | null) => monthHref(path, month ?? activeMonth), [activeMonth])

  const updateMonth = useCallback((nextMonth: string) => {
    const params = new URLSearchParams(searchParams?.toString() ?? "")
    if (nextMonth) params.set("month", nextMonth)
    else params.delete("month")
    const query = params.toString()
    const basePath = pathname || "/vendor"
    router.replace(query ? `${basePath}?${query}` : basePath)
  }, [pathname, router, searchParams])

  const token = useCallback(async () => {
    const value = (await supabase.auth.getSession()).data.session?.access_token
    if (!value) throw new Error("ログインが必要です。")
    return value
  }, [])

  const openPdf = useCallback(async (id: string) => {
    try {
      const response = await fetch(`/api/vendor-invoices/${id}/pdf`, { headers: { Authorization: `Bearer ${await token()}` } })
      const json = await response.json().catch(() => null)
      if (!response.ok || !json?.signed_url) throw new Error(json?.error ?? "PDF を開けませんでした。")
      window.open(json.signed_url, "_blank", "noopener,noreferrer")
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "PDF を開けませんでした。")
    }
  }, [token])

  const loadMonthly = useCallback(async (targetMonth: string | null) => {
    setLoading(true)
    setError(null)
    const sessionToken = (await supabase.auth.getSession()).data.session?.access_token
    if (!sessionToken) {
      setLoggedIn(false)
      setLoading(false)
      setData(null)
      return
    }
    setLoggedIn(true)
    await fetch("/api/vendor/claim", { method: "POST", headers: { Authorization: `Bearer ${sessionToken}` } }).catch(() => null)
    const search = targetMonth ? `?month=${encodeURIComponent(targetMonth)}` : ""
    const response = await fetch(`/api/vendor/monthly-invoice${search}`, { headers: { Authorization: `Bearer ${sessionToken}` } })
    const json = await response.json().catch(() => null)
    if (!response.ok || !json?.ok) {
      setData(null)
      setProfile(null)
      setBank(emptyBank())
      setAutoPrepared(false)
      setError(json?.error ?? "請求情報を読み込めませんでした。")
      setLoading(false)
      return
    }
    const effectiveMonth = normalizeMonth(json.month) ?? targetMonth ?? nowMonth()
    setResolvedMonth(effectiveMonth)
    setAutoPrepared(Boolean(json.autoPrepared))
    setData(json as MonthlyPayload)
    setProfile((json as MonthlyPayload).profile)
    setBank((json as MonthlyPayload).bankAccount ?? emptyBank())
    setLoading(false)
  }, [])

  const loadDetail = useCallback(async (id: string) => {
    try {
      const response = await fetch(`/api/vendor/invoices/${id}`, { headers: { Authorization: `Bearer ${await token()}` } })
      const json = await response.json().catch(() => null)
      if (!response.ok || !json?.ok) throw new Error(json?.error ?? "請求詳細を読み込めませんでした。")
      setDetail(json.invoice)
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "請求詳細を読み込めませんでした。")
    }
  }, [token])

  useEffect(() => { setJustSubmitted(null); void loadMonthly(queryMonth) }, [loadMonthly, queryMonth])
  useEffect(() => { if (mode === "detail" && invoiceId) void loadDetail(invoiceId) }, [invoiceId, loadDetail, mode])

  async function save(path: string, body: unknown, key: "profile" | "bank", okMessage: string, ngMessage: string) {
    setSaving(key); setError(null); setSuccess(null)
    try {
      const response = await fetch(path, { method: "PUT", headers: { "Content-Type": "application/json", Authorization: `Bearer ${await token()}` }, body: JSON.stringify(body) })
      const json = await response.json().catch(() => null)
      if (!response.ok || !json?.ok) throw new Error(json?.error ?? ngMessage)
      setSuccess(okMessage)
      await loadMonthly(activeMonth || null)
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : ngMessage)
    } finally {
      setSaving(null)
    }
  }

  const submitCurrent = useCallback(async () => {
    setSaving("submit"); setError(null); setSuccess(null)
    try {
      const response = await fetch("/api/vendor/monthly-invoice", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${await token()}` }, body: JSON.stringify({ month: activeMonth || null }) })
      const json = await response.json().catch(() => null)
      if (!response.ok || !json?.ok) throw new Error(json?.error ?? "請求を提出できませんでした。")
      setJustSubmitted(json.invoice)
      setSuccess("請求を提出しました。")
      await loadMonthly(activeMonth || null)
      if (json.invoice?.signed_url) window.open(json.invoice.signed_url, "_blank", "noopener,noreferrer")
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "請求を提出できませんでした。")
    } finally {
      setSaving(null)
    }
  }, [activeMonth, loadMonthly, token])

  const homeState = useMemo(() => {
    if (!profileReady(profile) || !bankReady(bank)) return { title: "最初にプロフィールと口座情報を登録してください", description: "初回登録が終わると、以後は固定 URL からそのまま請求確認へ進めます。", meta: [] as Array<[string, string]>, actions: [{ href: "/vendor/profile", label: "プロフィールを登録" }, { href: "/vendor/bank-account", label: "口座情報を登録" }] }
    if (!currentInvoice || currentInvoice.status === "draft") return { title: "現在の請求は確認待ちです", description: "案件と請求内容は NovaLoop 側で準備済みです。内容を確認してそのまま提出してください。", meta: [["対象月", monthValue], ["件数", `${preview?.counts.items ?? 0}件`], ["合計金額", yen(preview?.counts.amount ?? 0)], ["提出期限", preview?.dates.submitDeadline ?? "-"]] as Array<[string, string]>, actions: [{ href: scopedHref("/vendor/invoices/current", monthValue), label: "現在の請求を確認する" }] }
    if (currentInvoice.status === "rejected") return { title: "差し戻しがあります", description: "理由を確認して、必要な修正を済ませたら同じ請求を再提出してください。", meta: [["対象月", currentInvoice.billing_month], ["差し戻し日", fmtDate(currentInvoice.returned_at)], ["理由", currentInvoice.rejected_reason || "-"]] as Array<[string, string]>, actions: [{ href: scopedHref("/vendor/invoices/current", currentInvoice.billing_month), label: "差し戻し内容を見る" }] }
    if (currentInvoice.status === "submitted") return { title: "現在の請求は提出済みです", description: "会社側の確認待ちです。PDF と詳細はいつでも確認できます。", meta: [["対象月", currentInvoice.billing_month], ["提出日", fmtDate(currentInvoice.submitted_at)], ["請求番号", currentInvoice.invoice_number || "-"]] as Array<[string, string]>, actions: [{ href: `/vendor/invoices/${currentInvoice.id}`, label: "請求詳細を見る" }] }
    if (currentInvoice.status === "approved") return { title: "現在の請求は承認済みです", description: "支払予定日までこのままお待ちください。PDF は履歴から再確認できます。", meta: [["対象月", currentInvoice.billing_month], ["承認日", fmtDate(currentInvoice.approved_at)], ["支払予定日", fmtDate(currentInvoice.pay_date)]] as Array<[string, string]>, actions: [{ href: "/vendor/invoices", label: "履歴を見る" }] }
    return { title: "現在の請求は支払済みです", description: "請求 PDF は履歴から再ダウンロードできます。", meta: [["対象月", currentInvoice?.billing_month ?? monthValue], ["支払日", fmtDate(currentInvoice?.pay_date)]] as Array<[string, string]>, actions: [{ href: "/vendor/invoices", label: "履歴を見る" }] }
  }, [bank, currentInvoice, monthValue, preview, profile, scopedHref])

  const pageTitle = mode === "home" ? "ホーム" : mode === "profile" ? "プロフィール" : mode === "bank" ? "口座情報" : mode === "current" ? "現在の請求" : mode === "list" ? "履歴" : "請求詳細"

  if (loading) return <div style={{ padding: 32, color: "var(--muted)" }}>読み込み中...</div>
  if (!loggedIn) return <div style={{ padding: "32px 40px 64px", minHeight: "100vh", background: "var(--bg-grad)" }}><div style={{ maxWidth: 720, margin: "0 auto" }}><section style={card}><div style={{ display: "grid", gap: 12 }}><div style={{ fontSize: 12, color: "var(--primary)", fontWeight: 700 }}>VENDOR PORTAL</div><h1 style={{ margin: 0, fontSize: 28, color: "var(--text)" }}>ログインしてください</h1><p style={{ margin: 0, color: "var(--muted)", lineHeight: 1.8 }}>固定 URL から開いたあとも、Google ログイン後にこの画面へ戻ります。</p><div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}><Link href={loginHref} style={{ ...primaryButton, display: "inline-flex", textDecoration: "none", alignItems: "center" }}>Google でログイン</Link></div></div></section></div></div>

  return (
    <div style={{ padding: "32px 40px 64px", minHeight: "100vh", background: "var(--bg-grad)" }}>
      <div style={{ maxWidth: 1120, margin: "0 auto", display: "grid", gap: 16 }}>
        <header style={{ display: "grid", gap: 12 }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 16, flexWrap: "wrap", alignItems: "end" }}>
            <div>
              <p style={{ margin: 0, fontSize: 12, letterSpacing: "0.08em", color: "var(--primary)" }}>VENDOR PORTAL</p>
              <h1 style={{ margin: "6px 0 8px", fontSize: 30, color: "var(--text)" }}>{pageTitle}</h1>
              <p style={{ margin: 0, color: "var(--muted)", fontSize: 14 }}>{mode === "home" ? "固定 URL から開いたら、その時点で確認すべき請求月を自動で表示します。" : "案件と金額は自動集計されています。必要な確認だけ済ませてください。"}</p>
            </div>
            {(mode === "home" || mode === "current") ? <label style={{ display: "grid", gap: 6, fontSize: 13, color: "var(--muted)" }}>対象月<input type="month" value={monthValue} onChange={(event) => updateMonth(event.target.value)} style={input} /></label> : null}
          </div>
          <nav style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>{NAV.map((item) => <Link key={item.href} href={item.href === "/vendor/invoices/current" ? scopedHref(item.href, monthValue) : item.href} style={{ padding: "9px 14px", borderRadius: 999, border: "1px solid rgba(120,92,180,0.16)", background: pathname === item.href ? "var(--button-primary-bg)" : "rgba(255,255,255,0.88)", color: pathname === item.href ? "var(--primary-contrast)" : "var(--text)", textDecoration: "none", fontWeight: 700, fontSize: 13 }}>{item.label}</Link>)}</nav>
        </header>
        {error ? <section style={{ ...card, borderColor: "var(--error-border)", background: "var(--error-bg)", color: "var(--error-text)" }}>{error}</section> : null}
        {success ? <section style={{ ...card, borderColor: "var(--success-border)", background: "var(--success-bg)", color: "var(--success-text)" }}>{success}</section> : null}
        {mode === "home" ? <HomeSection homeState={homeState} data={data} profile={profile} bank={bank} /> : null}
        {mode === "profile" && profile ? <ProfileSection profile={profile} setProfile={setProfile} saving={saving === "profile"} onSave={() => save("/api/vendor/profile", profile, "profile", "プロフィールを保存しました。", "プロフィールを保存できませんでした。")} /> : null}
        {mode === "bank" && bank ? <BankSection bank={bank} setBank={setBank} saving={saving === "bank"} onSave={() => save("/api/vendor/bank-account", bank, "bank", "口座情報を保存しました。", "口座情報を保存できませんでした。")} /> : null}
        {mode === "current" ? <CurrentSection justSubmitted={justSubmitted} autoPrepared={autoPrepared} currentInvoice={currentInvoice} preview={preview} profile={profile} bank={bank} month={monthValue} openPdf={openPdf} canSubmit={canSubmit} saving={saving === "submit"} onSubmit={submitCurrent} /> : null}
        {mode === "list" ? <HistorySection history={data?.history ?? []} openPdf={openPdf} /> : null}
        {mode === "detail" ? <DetailSection detail={detail} openPdf={openPdf} /> : null}
      </div>
    </div>
  )
}

function HomeSection({ homeState, data, profile, bank }: { homeState: { title: string; description: string; meta: Array<[string, string]>; actions: Array<{ href: string; label: string }> }; data: MonthlyPayload | null; profile: Profile | null; bank: Bank | null }) {
  return <><section style={card}><div style={{ display: "grid", gap: 12 }}><div style={{ fontSize: 12, color: "var(--primary)", fontWeight: 700 }}>現在の状況</div><h2 style={{ margin: 0, fontSize: 26, color: "var(--text)" }}>{homeState.title}</h2><p style={{ margin: 0, color: "var(--muted)", lineHeight: 1.7 }}>{homeState.description}</p><div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>{homeState.meta.map(([label, value]) => <Meta key={label} label={label} value={value} />)}</div><div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>{homeState.actions.map((action, index) => <Link key={action.label} href={action.href} style={index === 0 ? { ...primaryButton, display: "inline-flex", textDecoration: "none", alignItems: "center" } : { ...secondaryButton, display: "inline-flex", textDecoration: "none", alignItems: "center" }}>{action.label}</Link>)}</div></div></section><section style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(300px,1fr))", gap: 16 }}><InfoCard title="プロフィール情報" href="/vendor/profile" label="編集する" rows={[["表示名 / 請求名義", profile?.display_name || "-"], ["会社名 / 屋号", profile?.company_name || "-"], ["メール", profile?.email || "-"]]} /><InfoCard title="口座情報" href="/vendor/bank-account" label="編集する" rows={[["銀行名", bank?.bank_name || "-"], ["支店名", bank?.branch_name || "-"], ["口座種別", bank?.account_type || "-"], ["口座番号", maskAccount(bank?.account_number)], ["口座名義", bank?.account_holder || "-"]]} /><InfoCard title="請求履歴" href="/vendor/invoices" label="すべて見る" rows={(data?.history ?? []).slice(0, 3).map((invoice) => [invoice.billing_month, `${yen(invoice.total)} / ${statusLabel(invoice.status)}`])} /></section></>
}

function ProfileSection({ profile, setProfile, saving, onSave }: { profile: Profile; setProfile: (value: Profile) => void; saving: boolean; onSave: () => void }) {
  return <FormCard title="プロフィール" saving={saving} onSave={onSave}><Field label="表示名"><input value={profile.display_name} onChange={(event) => setProfile({ ...profile, display_name: event.target.value })} style={input} /></Field><Field label="法人名 / 事業者名"><input value={profile.legal_name} onChange={(event) => setProfile({ ...profile, legal_name: event.target.value })} style={input} /></Field><Field label="会社名 / 屋号"><input value={profile.company_name} onChange={(event) => setProfile({ ...profile, company_name: event.target.value })} style={input} /></Field><Field label="メールアドレス"><input value={profile.email} onChange={(event) => setProfile({ ...profile, email: event.target.value })} style={input} /></Field><Field label="請求書の名義"><input value={profile.billing_name} onChange={(event) => setProfile({ ...profile, billing_name: event.target.value })} style={input} /></Field><Field label="郵便番号"><input value={profile.postal_code} onChange={(event) => setProfile({ ...profile, postal_code: event.target.value })} style={input} /></Field><Field label="住所" wide><textarea value={profile.address} onChange={(event) => setProfile({ ...profile, address: event.target.value })} rows={3} style={{ ...input, resize: "vertical" }} /></Field><Field label="登録番号 / インボイス番号"><input value={profile.registration_number} onChange={(event) => setProfile({ ...profile, registration_number: event.target.value })} style={input} /></Field><Field label="備考" wide><textarea value={profile.notes} onChange={(event) => setProfile({ ...profile, notes: event.target.value })} rows={3} style={{ ...input, resize: "vertical" }} /></Field></FormCard>
}

function BankSection({ bank, setBank, saving, onSave }: { bank: Bank; setBank: (value: Bank) => void; saving: boolean; onSave: () => void }) {
  return <FormCard title="口座情報" saving={saving} onSave={onSave}><Field label="銀行名"><input value={bank.bank_name} onChange={(event) => setBank({ ...bank, bank_name: event.target.value })} style={input} /></Field><Field label="支店名"><input value={bank.branch_name} onChange={(event) => setBank({ ...bank, branch_name: event.target.value })} style={input} /></Field><Field label="口座種別"><select value={bank.account_type} onChange={(event) => setBank({ ...bank, account_type: event.target.value })} style={input}><option value="ordinary">普通</option><option value="checking">当座</option><option value="savings">貯蓄</option></select></Field><Field label="口座番号"><input value={bank.account_number} onChange={(event) => setBank({ ...bank, account_number: event.target.value })} style={input} /></Field><Field label="口座名義"><input value={bank.account_holder} onChange={(event) => setBank({ ...bank, account_holder: event.target.value })} style={input} /></Field></FormCard>
}

function CurrentSection({ justSubmitted, autoPrepared, currentInvoice, preview, profile, bank, month, openPdf, canSubmit, saving, onSubmit }: { justSubmitted: SubmitResult | null; autoPrepared: boolean; currentInvoice: Invoice | null; preview: Preview | null; profile: Profile | null; bank: Bank | null; month: string; openPdf: (id: string) => Promise<void>; canSubmit: boolean; saving: boolean; onSubmit: () => Promise<void> }) {
  const lines = preview?.lines ?? []
  return <><section style={card}>{justSubmitted ? <div style={{ display: "grid", gap: 10, marginBottom: 18, paddingBottom: 18, borderBottom: "1px solid rgba(120,92,180,0.12)" }}><div style={{ fontSize: 12, color: "var(--success-text)", fontWeight: 700 }}>提出完了</div><h2 style={{ margin: 0, fontSize: 24, color: "var(--success-text)" }}>請求を提出しました</h2><div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))", gap: 12 }}><Stat title="対象月" value={justSubmitted.billing_month} /><Stat title="請求番号" value={justSubmitted.invoice_number || "-"} /><Stat title="提出日" value={fmtDate(justSubmitted.submitted_at)} /><Stat title="金額" value={yen(justSubmitted.total)} /></div><div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}><button type="button" onClick={() => void openPdf(justSubmitted.id)} style={primaryButton}>PDF をダウンロード</button><Link href="/vendor/invoices" style={{ ...secondaryButton, display: "inline-flex", textDecoration: "none", alignItems: "center" }}>履歴を見る</Link></div></div> : null}{autoPrepared && (!currentInvoice || currentInvoice.status === "draft") ? <div style={{ marginBottom: 16, padding: "14px 16px", borderRadius: 16, border: "1px solid var(--success-border)", background: "var(--success-bg)", color: "var(--success-text)", lineHeight: 1.7 }}>この月の請求は自動で準備済みです。内容を確認して、そのまま提出できます。</div> : null}{currentInvoice?.status === "rejected" ? <section style={{ ...card, marginBottom: 16, borderColor: "var(--warning-border)", background: "var(--warning-bg)" }}><h2 style={{ margin: 0, fontSize: 18, color: "var(--warning-text)" }}>差し戻し理由</h2><div style={{ display: "grid", gap: 8, marginTop: 12, color: "var(--warning-text)" }}><div>カテゴリ: {returnCategoryLabel(currentInvoice.rejected_category)}</div><div>理由: {currentInvoice.rejected_reason || "-"}</div></div></section> : null}<div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))", gap: 14 }}><Stat title="対象月" value={month} /><Stat title="ステータス" value={statusLabel(currentInvoice?.status)} /><Stat title="案件数" value={`${preview?.counts.items ?? 0}件`} /><Stat title="合計金額" value={yen(preview?.counts.amount ?? 0)} /><Stat title="提出期限" value={preview?.dates.submitDeadline ?? "-"} /><Stat title="支払予定日" value={preview?.dates.payDate ?? currentInvoice?.pay_date ?? "-"} /></div><div style={{ marginTop: 16, padding: 14, borderRadius: 16, border: "1px solid rgba(120,92,180,0.12)", background: "rgba(255,255,255,0.75)" }}><div style={{ fontSize: 12, color: "var(--muted)" }}>備考</div><div style={{ marginTop: 6, color: "var(--text)" }}>{preview?.memo || currentInvoice?.memo || "-"}</div></div></section><section style={card}><h2 style={{ margin: 0, fontSize: 18, color: "var(--text)" }}>現在の請求内容</h2>{lines.length === 0 ? <div style={{ marginTop: 16, color: "var(--muted)" }}>この月に請求対象の案件はありません。</div> : <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, marginTop: 16 }}><thead><tr><th style={th}>案件名</th><th style={th}>クライアント名</th><th style={th}>作業内容</th><th style={thRight}>単価</th><th style={thRight}>数量</th><th style={thRight}>金額</th></tr></thead><tbody>{lines.map((line) => <tr key={line.content_id}><td style={td}>{line.project_name}</td><td style={td}>{line.client_name}</td><td style={td}>{line.title} / {line.work_type}</td><td style={tdRight}>{yen(line.unit_price)}</td><td style={tdRight}>{String(line.qty)}</td><td style={{ ...tdRight, fontWeight: 700 }}>{yen(line.amount)}</td></tr>)}</tbody></table>}</section><section style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(320px,1fr))", gap: 16 }}><InfoCard title="請求先情報" href="/vendor/profile" label="編集する" rows={[["表示名 / 請求名義", profile?.display_name || "-"], ["請求書の名義", profile?.billing_name || "-"], ["住所", [profile?.postal_code, profile?.address].filter(Boolean).join(" ") || "-"], ["メール", profile?.email || "-"]]} /><InfoCard title="振込先情報" href="/vendor/bank-account" label="編集する" rows={[["銀行名", bank?.bank_name || "-"], ["支店名", bank?.branch_name || "-"], ["口座種別", bank?.account_type || "-"], ["口座番号", maskAccount(bank?.account_number)], ["口座名義", bank?.account_holder || "-"]]} /></section><section style={card}><div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "center" }}><div style={{ color: "var(--muted)", lineHeight: 1.7, fontSize: 13 }}>案件と金額は NovaLoop の作業データから自動反映しています。内容に問題がなければ、そのまま提出してください。</div><div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}><Link href="/vendor/profile" style={{ ...secondaryButton, display: "inline-flex", textDecoration: "none", alignItems: "center" }}>プロフィールを編集</Link><Link href="/vendor/bank-account" style={{ ...secondaryButton, display: "inline-flex", textDecoration: "none", alignItems: "center" }}>口座情報を編集</Link>{currentInvoice?.id ? <button type="button" onClick={() => void openPdf(currentInvoice.id)} style={secondaryButton}>PDF をダウンロード</button> : null}{editable(currentInvoice) ? <button type="button" onClick={() => void onSubmit()} disabled={!canSubmit || saving} style={{ ...primaryButton, opacity: !canSubmit || saving ? 0.55 : 1 }}>{saving ? "送信中..." : currentInvoice?.status === "rejected" ? "修正して再提出する" : "確認して提出する"}</button> : null}</div></div></section></>
}

function HistorySection({ history, openPdf }: { history: Invoice[]; openPdf: (id: string) => Promise<void> }) {
  return <section style={card}><h2 style={{ margin: 0, fontSize: 18, color: "var(--text)" }}>請求履歴</h2><div style={{ display: "grid", gap: 10, marginTop: 14 }}>{history.length === 0 ? <div style={{ color: "var(--muted)" }}>請求履歴はまだありません。</div> : history.map((invoice) => <div key={invoice.id} style={{ border: "1px solid var(--border)", borderRadius: 14, padding: 16, background: "rgba(255,255,255,0.7)" }}><div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}><div style={{ display: "grid", gap: 6 }}><div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}><strong style={{ color: "var(--text)" }}>{invoice.billing_month}</strong><span style={{ fontSize: 12, padding: "3px 9px", borderRadius: 999, background: "rgba(110,67,208,0.08)", color: "var(--muted)" }}>{statusLabel(invoice.status)}</span></div><div style={{ fontSize: 13, color: "var(--muted)" }}>{invoice.invoice_number || "-"} / {yen(invoice.total)} / 提出日 {fmtDate(invoice.submitted_at)}</div></div><div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}><button type="button" onClick={() => void openPdf(invoice.id)} style={secondaryButton}>PDF をダウンロード</button><Link href={`/vendor/invoices/${invoice.id}`} style={{ ...secondaryButton, display: "inline-flex", textDecoration: "none", alignItems: "center" }}>詳細を見る</Link></div></div></div>)}</div></section>
}

function DetailSection({ detail, openPdf }: { detail: DetailInvoice | null; openPdf: (id: string) => Promise<void> }) {
  if (!detail) return <section style={card}>請求詳細を読み込めませんでした。</section>
  return <section style={card}><div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))", gap: 14 }}><Stat title="対象月" value={detail.billing_month} /><Stat title="ステータス" value={statusLabel(detail.status)} /><Stat title="請求番号" value={detail.invoice_number || "-"} /><Stat title="初回提出日" value={fmtDate(detail.first_submitted_at || detail.submitted_at)} /><Stat title="最新再提出日" value={fmtDate(detail.resubmitted_at)} /><Stat title="承認日" value={fmtDate(detail.approved_at)} /></div>{detail.status === "rejected" ? <section style={{ ...card, marginTop: 16, borderColor: "var(--warning-border)", background: "var(--warning-bg)" }}><h3 style={{ margin: 0, fontSize: 16, color: "var(--warning-text)" }}>差し戻し理由</h3><div style={{ display: "grid", gap: 8, marginTop: 12, color: "var(--warning-text)" }}><div>カテゴリ: {returnCategoryLabel(detail.rejected_category)}</div><div>理由: {detail.rejected_reason || "-"}</div><div>差し戻し日: {fmtDate(detail.returned_at)}</div></div></section> : null}<div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 16 }}><button type="button" onClick={() => void openPdf(detail.id)} style={primaryButton}>PDF をダウンロード</button><Link href="/vendor/invoices" style={{ ...secondaryButton, display: "inline-flex", textDecoration: "none", alignItems: "center" }}>履歴に戻る</Link>{detail.status === "rejected" ? <Link href={monthHref("/vendor/invoices/current", detail.billing_month)} style={{ ...secondaryButton, display: "inline-flex", textDecoration: "none", alignItems: "center" }}>修正して再提出する</Link> : null}</div><section style={{ marginTop: 16, padding: 14, borderRadius: 16, border: "1px solid rgba(120,92,180,0.12)", background: "rgba(255,255,255,0.75)" }}><div style={{ fontSize: 12, color: "var(--muted)" }}>備考</div><div style={{ marginTop: 6 }}>{detail.memo || "-"}</div></section><table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, marginTop: 16 }}><thead><tr><th style={th}>案件名</th><th style={th}>クライアント名</th><th style={th}>作業内容</th><th style={thRight}>単価</th><th style={thRight}>数量</th><th style={thRight}>金額</th></tr></thead><tbody>{detail.lines.map((line) => <tr key={line.content_id}><td style={td}>{line.project_name}</td><td style={td}>{line.client_name}</td><td style={td}>{line.title} / {line.work_type}</td><td style={tdRight}>{yen(line.unit_price)}</td><td style={tdRight}>{String(line.qty)}</td><td style={{ ...tdRight, fontWeight: 700 }}>{yen(line.amount)}</td></tr>)}</tbody></table></section>
}

function FormCard({ title, saving, onSave, children }: { title: string; saving: boolean; onSave: () => void; children: ReactNode }) {
  return <section style={card}><h2 style={{ margin: 0, fontSize: 18, color: "var(--text)" }}>{title}</h2><div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(280px,1fr))", gap: 14, marginTop: 16 }}>{children}</div><div style={{ marginTop: 16 }}><button type="button" onClick={onSave} disabled={saving} style={primaryButton}>{saving ? "保存中..." : "保存する"}</button></div></section>
}

function Field({ label, wide, children }: { label: string; wide?: boolean; children: ReactNode }) {
  return <label style={{ display: "grid", gap: 6, gridColumn: wide ? "1 / -1" : undefined }}><span style={{ fontSize: 12, color: "var(--muted)" }}>{label}</span>{children}</label>
}

function InfoCard({ title, rows, href, label }: { title: string; rows: Array<[string, string]>; href: string; label: string }) {
  return <section style={card}><div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", flexWrap: "wrap" }}><h2 style={{ margin: 0, fontSize: 18, color: "var(--text)" }}>{title}</h2><Link href={href} style={{ color: "var(--primary)", textDecoration: "none", fontWeight: 700 }}>{label}</Link></div><div style={{ display: "grid", gap: 10, marginTop: 14 }}>{rows.length === 0 ? <div style={{ color: "var(--muted)" }}>まだデータはありません。</div> : rows.map(([key, value]) => <div key={key} style={{ display: "grid", gap: 4 }}><div style={{ fontSize: 12, color: "var(--muted)" }}>{key}</div><div style={{ color: "var(--text)" }}>{value || "-"}</div></div>)}</div></section>
}

function Meta({ label, value }: { label: string; value: string }) {
  return <div style={{ padding: "10px 12px", borderRadius: 14, background: "rgba(110,67,208,0.08)" }}><div style={{ fontSize: 11, color: "var(--muted)" }}>{label}</div><div style={{ marginTop: 4, fontWeight: 700, color: "var(--text)" }}>{value}</div></div>
}

function Stat({ title, value }: { title: string; value: string }) {
  return <div><div style={{ fontSize: 12, color: "var(--muted)" }}>{title}</div><div style={{ marginTop: 6, fontSize: 18, fontWeight: 700, color: "var(--text)" }}>{value}</div></div>
}
