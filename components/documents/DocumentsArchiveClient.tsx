"use client"

import Link from "next/link"
import { useDeferredValue, useEffect, useMemo, useState, type CSSProperties } from "react"
import { useSearchParams } from "next/navigation"
import GuideEmptyState from "@/components/shared/GuideEmptyState"
import { useAuthOrg } from "@/hooks/useAuthOrg"
import {
  type DocumentPdfFilter,
  type DocumentSort,
  type DocumentScope,
  type DocumentsArchiveItem,
  type DocumentsArchiveMonthGroup,
  type DocumentsArchiveResponse,
} from "@/lib/documentsArchive"
import { supabase } from "@/lib/supabase"

const shellStyle: CSSProperties = { minHeight: "100vh", background: "var(--bg-grad)", padding: "20px 16px 56px" }
const sectionCardStyle: CSSProperties = {
  border: "1px solid var(--border)",
  borderRadius: 18,
  background: "var(--surface)",
  boxShadow: "0 12px 28px rgba(15,23,42,0.06)",
}
const monthRowColumns = "minmax(340px, 2.8fr) minmax(120px, 0.9fr) minmax(120px, 0.8fr) minmax(90px, 0.7fr) minmax(180px, 1.2fr) auto"

function formatCurrency(value: number) {
  return new Intl.NumberFormat("ja-JP", { style: "currency", currency: "JPY", maximumFractionDigits: 0 }).format(Number(value || 0))
}

function formatMonth(value: string) {
  const [year, month] = value.split("-").map(Number)
  if (!year || !month) return value
  return `${year}年${month}月`
}

function formatDate(value: string | null) {
  if (!value) return "-"
  return value.slice(0, 10)
}

function statusBadgeStyle(item: DocumentsArchiveItem): CSSProperties {
  if (item.scope === "sales") {
    if (item.status === "issued") return { background: "#dcfce7", color: "#166534", border: "1px solid #86efac" }
    if (item.status === "draft") return { background: "#e2e8f0", color: "#334155", border: "1px solid #cbd5e1" }
    return { background: "#fee2e2", color: "#b91c1c", border: "1px solid #fecaca" }
  }
  if (item.status === "paid") return { background: "#ede9fe", color: "#6d28d9", border: "1px solid #c4b5fd" }
  if (item.status === "approved") return { background: "#dcfce7", color: "#166534", border: "1px solid #86efac" }
  if (item.status === "submitted") return { background: "#dbeafe", color: "#1d4ed8", border: "1px solid #93c5fd" }
  if (item.status === "rejected") return { background: "#fef3c7", color: "#b45309", border: "1px solid #fcd34d" }
  return { background: "#e2e8f0", color: "#334155", border: "1px solid #cbd5e1" }
}

function pdfBadgeStyle(hasPdf: boolean): CSSProperties {
  return hasPdf
    ? { background: "#ecfccb", color: "#3f6212", border: "1px solid #bef264" }
    : { background: "#fff1f2", color: "#be123c", border: "1px solid #fecdd3" }
}

async function getAccessToken() {
  const { data } = await supabase.auth.getSession()
  return data.session?.access_token ?? null
}

export default function DocumentsArchiveClient() {
  const searchParams = useSearchParams()
  const { role, loading: authLoading } = useAuthOrg({ redirectToOnboarding: true })
  const canAccess = role === "owner" || role === "executive_assistant"

  const [activeTab, setActiveTab] = useState<DocumentScope>(searchParams.get("tab") === "vendor" ? "vendor" : "sales")
  const [month, setMonth] = useState(searchParams.get("month") ?? "")
  const [status, setStatus] = useState(searchParams.get("status") ?? "")
  const [pdfFilter, setPdfFilter] = useState<DocumentPdfFilter>("all")
  const [sort, setSort] = useState<DocumentSort>("newest")
  const [query, setQuery] = useState("")
  const deferredQuery = useDeferredValue(query)
  const [monthLimit, setMonthLimit] = useState(6)
  const [archive, setArchive] = useState<DocumentsArchiveResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<{ tone: "success" | "error"; text: string } | null>(null)
  const [busyKey, setBusyKey] = useState<string | null>(null)
  const [openMonths, setOpenMonths] = useState<string[]>([])

  useEffect(() => {
    setMonthLimit(6)
  }, [activeTab, month, status, pdfFilter, sort, deferredQuery])

  useEffect(() => {
    if (!canAccess) {
      setLoading(false)
      return
    }

    let active = true
    const load = async () => {
      setLoading(true)
      setError(null)
      try {
        const token = await getAccessToken()
        if (!token) throw new Error("ログイン状態を確認できませんでした。")
        const params = new URLSearchParams()
        if (month) params.set("month", month)
        if (status) params.set("status", status)
        if (pdfFilter !== "all") params.set("pdf", pdfFilter)
        if (deferredQuery.trim()) params.set("q", deferredQuery.trim())
        params.set("sort", sort)
        params.set("monthLimit", String(monthLimit))
        const res = await fetch(`/api/documents/archive?${params.toString()}`, {
          headers: { Authorization: `Bearer ${token}` },
        })
        const json = (await res.json().catch(() => null)) as { ok?: boolean; archive?: DocumentsArchiveResponse; error?: string } | null
        if (!active) return
        if (!res.ok || !json?.ok || !json.archive) throw new Error(json?.error ?? "請求書保管を読み込めませんでした。")
        setArchive(json.archive)
      } catch (loadError) {
        if (!active) return
        setArchive(null)
        setError(loadError instanceof Error ? loadError.message : "請求書保管を読み込めませんでした。")
      } finally {
        if (active) setLoading(false)
      }
    }

    void load()
    return () => {
      active = false
    }
  }, [canAccess, deferredQuery, month, monthLimit, pdfFilter, sort, status])

  useEffect(() => {
    if (!archive || !status) return
    const options = activeTab === "sales" ? archive.filters.statusOptions.sales : archive.filters.statusOptions.vendor
    if (!options.some((option) => option.value === status)) setStatus("")
  }, [activeTab, archive, status])

  useEffect(() => {
    if (!notice) return
    const timer = window.setTimeout(() => setNotice(null), 3500)
    return () => window.clearTimeout(timer)
  }, [notice])

  const currentSection = useMemo(() => {
    if (!archive) return null
    return activeTab === "sales" ? archive.sales : archive.vendor
  }, [activeTab, archive])

  const currentStatusOptions = useMemo(() => {
    if (!archive) return []
    return activeTab === "sales" ? archive.filters.statusOptions.sales : archive.filters.statusOptions.vendor
  }, [activeTab, archive])

  const visibleMonths = useMemo(() => currentSection?.monthGroups.map((group) => group.month) ?? [], [currentSection])
  const visibleMonthsKey = useMemo(() => visibleMonths.join("|"), [visibleMonths])

  useEffect(() => {
    setOpenMonths((current) => {
      const valid = current.filter((value) => visibleMonths.includes(value))
      if (valid.length > 0) return valid
      return visibleMonths.slice(0, 1)
    })
  }, [visibleMonths, visibleMonthsKey])

  const allMonthsExpanded = visibleMonths.length > 0 && openMonths.length === visibleMonths.length

  const handlePdfOpen = async (item: DocumentsArchiveItem, download = false) => {
    const token = await getAccessToken()
    if (!token) {
      setNotice({ tone: "error", text: "ログイン状態を確認できませんでした。" })
      return
    }

    setBusyKey(`${download ? "download" : "open"}:${item.id}`)
    try {
      const res = await fetch(item.pdfEndpoint, { headers: { Authorization: `Bearer ${token}` } })
      const json = (await res.json().catch(() => null)) as { signed_url?: string; error?: string } | null
      if (!res.ok || !json?.signed_url) throw new Error(json?.error ?? "PDF を開けませんでした。")
      if (download) {
        const anchor = document.createElement("a")
        anchor.href = json.signed_url
        anchor.download = ""
        anchor.rel = "noopener noreferrer"
        anchor.target = "_blank"
        anchor.click()
      } else {
        window.open(json.signed_url, "_blank", "noopener,noreferrer")
      }
    } catch (openError) {
      setNotice({ tone: "error", text: openError instanceof Error ? openError.message : "PDF を開けませんでした。" })
    } finally {
      setBusyKey(null)
    }
  }

  const refreshArchive = async () => {
    const token = await getAccessToken()
    if (!token) return
    const params = new URLSearchParams()
    if (month) params.set("month", month)
    if (status) params.set("status", status)
    if (pdfFilter !== "all") params.set("pdf", pdfFilter)
    if (deferredQuery.trim()) params.set("q", deferredQuery.trim())
    params.set("sort", sort)
    params.set("monthLimit", String(monthLimit))
    const res = await fetch(`/api/documents/archive?${params.toString()}`, { headers: { Authorization: `Bearer ${token}` } })
    const json = (await res.json().catch(() => null)) as { ok?: boolean; archive?: DocumentsArchiveResponse } | null
    if (res.ok && json?.ok && json.archive) setArchive(json.archive)
  }

  const handleSalesPdfRegenerate = async (item: DocumentsArchiveItem) => {
    const token = await getAccessToken()
    if (!token) {
      setNotice({ tone: "error", text: "ログイン状態を確認できませんでした。" })
      return
    }
    setBusyKey(`repair:${item.id}`)
    try {
      const res = await fetch(`/api/invoices/${item.id}/generate-pdf`, { method: "POST", headers: { Authorization: `Bearer ${token}` } })
      const json = (await res.json().catch(() => null)) as { signed_url?: string; error?: string } | null
      if (!res.ok) throw new Error(json?.error ?? "PDF の再生成に失敗しました。")
      setNotice({ tone: "success", text: "請求書 PDF を再生成しました。" })
      await refreshArchive()
    } catch (regenerateError) {
      setNotice({ tone: "error", text: regenerateError instanceof Error ? regenerateError.message : "PDF の再生成に失敗しました。" })
    } finally {
      setBusyKey(null)
    }
  }

  const handleVendorPdfUpload = async (item: DocumentsArchiveItem, file: File | null) => {
    if (!file) return
    const token = await getAccessToken()
    if (!token) {
      setNotice({ tone: "error", text: "ログイン状態を確認できませんでした。" })
      return
    }
    setBusyKey(`upload:${item.id}`)
    try {
      const formData = new FormData()
      formData.append("file", file)
      const endpoint = item.pdfActionKind === "replace" ? `/api/vendor-invoices/${item.id}/replace-pdf` : `/api/vendor-invoices/${item.id}/upload-pdf`
      const res = await fetch(endpoint, { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: formData })
      const json = (await res.json().catch(() => null)) as { ok?: boolean; error?: string } | null
      if (!res.ok || !json?.ok) throw new Error(json?.error ?? "外注請求書 PDF の保存に失敗しました。")
      setNotice({ tone: "success", text: item.pdfActionKind === "replace" ? "外注請求書 PDF を差し替えました。" : "外注請求書 PDF を添付しました。" })
      await refreshArchive()
    } catch (uploadError) {
      setNotice({ tone: "error", text: uploadError instanceof Error ? uploadError.message : "外注請求書 PDF の保存に失敗しました。" })
    } finally {
      setBusyKey(null)
    }
  }

  const toggleMonth = (targetMonth: string) => {
    setOpenMonths((current) => (current.includes(targetMonth) ? current.filter((value) => value !== targetMonth) : [...current, targetMonth]))
  }

  if (authLoading || loading) return <div style={{ padding: 32, color: "var(--muted)" }}>読み込み中...</div>

  if (!canAccess) {
    return (
      <div style={{ padding: 32 }}>
        <div style={{ ...sectionCardStyle, padding: 24 }}>
          <h1 style={{ margin: 0, fontSize: 24, color: "var(--text)" }}>請求書保管</h1>
          <p style={{ margin: "10px 0 0", color: "var(--muted)" }}>請求書保管は owner / executive_assistant のみ利用できます。</p>
          <Link href="/home" style={{ display: "inline-flex", marginTop: 14, color: "var(--primary)", fontWeight: 700, textDecoration: "none" }}>
            Home に戻る
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div style={shellStyle}>
      <div style={{ maxWidth: 1360, margin: "0 auto", display: "grid", gap: 14 }}>
        <section style={{ ...sectionCardStyle, padding: 18, display: "grid", gap: 14 }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 14, alignItems: "start", flexWrap: "wrap" }}>
            <div style={{ display: "grid", gap: 6, maxWidth: 720 }}>
              <div style={{ fontSize: 12, letterSpacing: "0.08em", color: "var(--muted)" }}>DOCUMENTS</div>
              <h1 style={{ margin: 0, fontSize: 28, lineHeight: 1.15, color: "var(--text)" }}>請求書保管</h1>
              <p style={{ margin: 0, fontSize: 13, lineHeight: 1.7, color: "var(--muted)" }}>
                月ごとに請求済み請求書と外注請求書を確認する画面です。必要な PDF 操作もここで完了します。
              </p>
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <Link href="/invoices" style={headerLinkStyle}>請求書一覧</Link>
              <Link href="/vendors" style={headerLinkStyle}>外注管理</Link>
              <Link href="/payouts" style={headerLinkStyle}>支払管理</Link>
            </div>
          </div>
          {archive ? (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 8 }}>
              <OverviewMetric label="今月の請求書" value={String(archive.summary.currentMonthSalesCount)} />
              <OverviewMetric label="今月の外注請求" value={String(archive.summary.currentMonthVendorCount)} />
              <OverviewMetric label="PDF未保存" value={String(archive.summary.pdfMissingCount)} />
              <OverviewMetric label="要対応" value={String(archive.summary.actionRequiredCount)} />
            </div>
          ) : null}
        </section>

        {notice ? (
          <section style={{ ...sectionCardStyle, padding: "12px 14px", borderColor: notice.tone === "success" ? "#86efac" : "#fecaca", background: notice.tone === "success" ? "#f0fdf4" : "#fff1f2", color: notice.tone === "success" ? "#166534" : "#b91c1c" }}>
            {notice.text}
          </section>
        ) : null}

        {error ? (
          <section style={{ ...sectionCardStyle, padding: "14px 16px", borderColor: "var(--error-border)", background: "var(--error-bg)", color: "var(--error-text)" }}>
            {error}
          </section>
        ) : null}

        <section style={{ ...sectionCardStyle, padding: 14, display: "grid", gap: 12 }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
            <div style={{ display: "inline-flex", padding: 4, borderRadius: 999, background: "var(--surface-2)", border: "1px solid var(--border)", gap: 4 }}>
              <button type="button" onClick={() => setActiveTab("sales")} style={tabButtonStyle(activeTab === "sales")}>
                請求済み{archive ? <span style={tabCountStyle}>{archive.sales.totalDocuments}</span> : null}
              </button>
              <button type="button" onClick={() => setActiveTab("vendor")} style={tabButtonStyle(activeTab === "vendor")}>
                外注{archive ? <span style={tabCountStyle}>{archive.vendor.totalDocuments}</span> : null}
              </button>
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", color: "var(--muted)", fontSize: 12 }}>
              {currentSection ? <span>{currentSection.totalMonths}か月 / {currentSection.totalDocuments}件</span> : null}
              {visibleMonths.length > 0 ? (
                <>
                  <button type="button" onClick={() => setOpenMonths(visibleMonths)} disabled={allMonthsExpanded} style={toolbarButtonStyle}>すべて開く</button>
                  <button type="button" onClick={() => setOpenMonths([])} disabled={openMonths.length === 0} style={toolbarButtonStyle}>すべて閉じる</button>
                </>
              ) : null}
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 8 }}>
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={activeTab === "sales" ? "請求先名 / 請求書名で検索" : "外注先名 / 請求書番号で検索"} style={{ ...filterInputStyle, gridColumn: "1 / -1" }} />
            <select value={month} onChange={(event) => setMonth(event.target.value)} style={filterInputStyle}>
              <option value="">すべての月</option>
              {(archive?.filters.availableMonths ?? []).map((option) => <option key={option} value={option}>{option}</option>)}
            </select>
            <select value={status} onChange={(event) => setStatus(event.target.value)} style={filterInputStyle}>
              <option value="">すべてのステータス</option>
              {currentStatusOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
            <select value={pdfFilter} onChange={(event) => setPdfFilter(event.target.value as DocumentPdfFilter)} style={filterInputStyle}>
              <option value="all">PDFあり/なし</option>
              <option value="with_pdf">PDFあり</option>
              <option value="missing_pdf">PDFなし</option>
            </select>
            <select value={sort} onChange={(event) => setSort(event.target.value as DocumentSort)} style={filterInputStyle}>
              <option value="newest">新しい順</option>
              <option value="oldest">古い順</option>
              <option value="amount_desc">金額が大きい順</option>
              <option value="amount_asc">金額が小さい順</option>
            </select>
          </div>
        </section>

        {archive && currentSection ? (
          <section style={{ display: "grid", gap: 10 }}>
            {currentSection.monthGroups.length === 0 ? (
              <section style={{ ...sectionCardStyle, padding: 24 }}>
                <GuideEmptyState
                  title={activeTab === "sales" ? "条件に合う請求書はありません" : "条件に合う外注請求書はありません"}
                  description={activeTab === "sales" ? "月・ステータス・PDF条件を見直すか、Billing / Invoices 側で新しい請求書を作成してください。" : "月・ステータス・PDF条件を見直すか、外注先の請求依頼と提出状況を確認してください。"}
                  primaryHref={activeTab === "sales" ? "/invoices" : "/vendors"}
                  primaryLabel={activeTab === "sales" ? "請求書一覧へ" : "外注管理へ"}
                  helpHref="/help"
                />
              </section>
            ) : (
              currentSection.monthGroups.map((group) => (
                <MonthSection
                  key={`${activeTab}-${group.month}`}
                  activeTab={activeTab}
                  busyKey={busyKey}
                  expanded={openMonths.includes(group.month)}
                  group={group}
                  onDownload={(item) => void handlePdfOpen(item, true)}
                  onOpen={(item) => void handlePdfOpen(item, false)}
                  onRepair={(item) => void handleSalesPdfRegenerate(item)}
                  onToggle={() => toggleMonth(group.month)}
                  onUpload={(item, file) => void handleVendorPdfUpload(item, file)}
                />
              ))
            )}
            {currentSection.hasMore ? (
              <div style={{ display: "flex", justifyContent: "center", paddingTop: 4 }}>
                <button type="button" onClick={() => setMonthLimit((current) => Math.min(current + 6, 12))} style={loadMoreButtonStyle}>
                  さらに月を表示する
                </button>
              </div>
            ) : null}
          </section>
        ) : null}
      </div>
    </div>
  )
}

function MonthSection({
  activeTab,
  busyKey,
  expanded,
  group,
  onOpen,
  onDownload,
  onRepair,
  onToggle,
  onUpload,
}: {
  activeTab: DocumentScope
  busyKey: string | null
  expanded: boolean
  group: DocumentsArchiveMonthGroup
  onOpen: (item: DocumentsArchiveItem) => void
  onDownload: (item: DocumentsArchiveItem) => void
  onRepair: (item: DocumentsArchiveItem) => void
  onToggle: () => void
  onUpload: (item: DocumentsArchiveItem, file: File | null) => void
}) {
  return (
    <section style={{ ...sectionCardStyle, overflow: "hidden" }}>
      <button type="button" onClick={onToggle} style={{ width: "100%", padding: "14px 16px", border: "none", background: group.actionRequiredCount > 0 ? "rgba(255,247,237,0.8)" : "transparent", cursor: "pointer", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 16, textAlign: "left" }}>
        <div style={{ display: "grid", gap: 8, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <span style={{ fontSize: 20, fontWeight: 800, color: "var(--text)" }}>{formatMonth(group.month)}</span>
            <span style={monthScopePillStyle}>{activeTab === "sales" ? "請求済み請求書" : "外注請求書"}</span>
            {group.actionRequiredCount > 0 ? <span style={attentionSummaryPillStyle}>要対応 {group.actionRequiredCount}</span> : null}
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <SummaryPill label="件数" value={String(group.count)} />
            <SummaryPill label="合計" value={formatCurrency(group.totalAmount)} />
            <SummaryPill label="PDF" value={`${group.pdfSavedCount}/${group.count}`} />
            <SummaryPill label="未保存" value={String(group.pdfMissingCount)} tone={group.pdfMissingCount > 0 ? "danger" : "default"} />
          </div>
        </div>
        <span style={{ fontSize: 18, color: "var(--muted)", transform: expanded ? "rotate(180deg)" : "rotate(0deg)", transition: "transform 0.16s ease" }}>▾</span>
      </button>

      {expanded ? (
        <div style={{ borderTop: "1px solid var(--border)", padding: 10 }}>
          <div style={{ overflowX: "auto" }}>
            <div style={{ minWidth: 980 }}>
              <div style={tableHeaderStyle}>
                <span>取引先 / 請求名</span>
                <span style={{ textAlign: "right" }}>金額</span>
                <span>ステータス</span>
                <span>PDF</span>
                <span>日付</span>
                <span style={{ textAlign: "right" }}>操作</span>
              </div>
              {group.items.map((item) => <DocumentRow key={item.id} busyKey={busyKey} item={item} onDownload={onDownload} onOpen={onOpen} onRepair={onRepair} onUpload={onUpload} />)}
            </div>
          </div>
        </div>
      ) : null}
    </section>
  )
}

function DocumentRow({
  busyKey,
  item,
  onOpen,
  onDownload,
  onRepair,
  onUpload,
}: {
  busyKey: string | null
  item: DocumentsArchiveItem
  onOpen: (item: DocumentsArchiveItem) => void
  onDownload: (item: DocumentsArchiveItem) => void
  onRepair: (item: DocumentsArchiveItem) => void
  onUpload: (item: DocumentsArchiveItem, file: File | null) => void
}) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: monthRowColumns, gap: 12, alignItems: "center", padding: "12px 10px", borderTop: "1px solid var(--border)", background: item.actionRequired && !item.hasPdf ? "rgba(255,249,245,0.88)" : "transparent" }}>
      <div style={{ minWidth: 0 }}>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <span style={{ fontSize: 12, fontWeight: 700, color: "var(--muted)" }}>{item.partyName}</span>
          {item.documentNumber ? <span style={miniMetaChipStyle}>{item.documentNumber}</span> : null}
          {item.actionRequired ? <span style={attentionMiniPillStyle}>要対応</span> : null}
        </div>
        <div style={{ marginTop: 4, fontSize: 14, fontWeight: 700, color: "var(--text)", lineHeight: 1.45 }}>{item.title}</div>
        <div style={{ marginTop: 4, display: "flex", gap: 10, flexWrap: "wrap", fontSize: 12, color: "var(--muted)" }}>
          <span>{item.month}</span>
          <span>{item.primaryDateLabel}: {formatDate(item.primaryDate)}</span>
          <span>{item.secondaryDateLabel}: {formatDate(item.secondaryDate)}</span>
        </div>
      </div>
      <div style={{ textAlign: "right", fontSize: 14, fontWeight: 800, color: "var(--text)", whiteSpace: "nowrap" }}>{formatCurrency(item.amount)}</div>
      <div><span style={{ ...pillBaseStyle, ...statusBadgeStyle(item) }}>{item.statusLabel}</span></div>
      <div><span style={{ ...pillBaseStyle, ...pdfBadgeStyle(item.hasPdf) }}>{item.hasPdf ? "あり" : "なし"}</span></div>
      <div style={{ fontSize: 12, color: "var(--muted)", lineHeight: 1.6 }}>
        <div>{item.primaryDateLabel}</div>
        <div style={{ color: "var(--text)", fontWeight: 600 }}>{formatDate(item.primaryDate)}</div>
      </div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", justifyContent: "flex-end" }}>
        <button type="button" onClick={() => onOpen(item)} disabled={!item.hasPdf || busyKey === `open:${item.id}`} style={compactActionStyle}>閲覧</button>
        <button type="button" onClick={() => onDownload(item)} disabled={!item.hasPdf || busyKey === `download:${item.id}`} style={compactActionStyle}>DL</button>
        <Link href={item.detailHref} style={compactLinkActionStyle}>詳細</Link>
        {item.scope === "sales" && item.pdfActionKind === "regenerate" ? <button type="button" onClick={() => onRepair(item)} disabled={busyKey === `repair:${item.id}`} style={compactPrimaryActionStyle}>再生成</button> : null}
        {item.scope === "vendor" && item.pdfActionKind ? (
          <label style={{ ...compactPrimaryActionStyle, display: "inline-flex", alignItems: "center", cursor: busyKey === `upload:${item.id}` ? "wait" : "pointer" }}>
            <span>{busyKey === `upload:${item.id}` ? "保存中" : item.pdfActionLabel}</span>
            <input type="file" accept="application/pdf,.pdf" style={{ display: "none" }} disabled={busyKey === `upload:${item.id}`} onChange={(event) => {
              const file = event.currentTarget.files?.[0] ?? null
              void onUpload(item, file)
              event.currentTarget.value = ""
            }} />
          </label>
        ) : null}
      </div>
    </div>
  )
}

function OverviewMetric({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ borderRadius: 14, padding: "12px 14px", background: "var(--surface-2)", border: "1px solid var(--border)" }}>
      <div style={{ fontSize: 11, color: "var(--muted)" }}>{label}</div>
      <div style={{ marginTop: 4, fontSize: 22, fontWeight: 800, color: "var(--text)" }}>{value}</div>
    </div>
  )
}

function SummaryPill({ label, tone = "default", value }: { label: string; tone?: "default" | "danger"; value: string }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "6px 10px", borderRadius: 999, border: tone === "danger" ? "1px solid #fecaca" : "1px solid var(--border)", background: tone === "danger" ? "#fff1f2" : "var(--surface-2)", color: tone === "danger" ? "#b91c1c" : "var(--text)", fontSize: 12 }}>
      <span style={{ color: "var(--muted)" }}>{label}</span>
      <strong style={{ color: "inherit" }}>{value}</strong>
    </span>
  )
}

const monthScopePillStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  padding: "4px 8px",
  borderRadius: 999,
  border: "1px solid var(--border)",
  background: "var(--surface-2)",
  color: "var(--muted)",
  fontSize: 12,
  fontWeight: 700,
}

const attentionSummaryPillStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  padding: "4px 8px",
  borderRadius: 999,
  border: "1px solid #fdba74",
  background: "#fff7ed",
  color: "#c2410c",
  fontSize: 12,
  fontWeight: 700,
}

const attentionMiniPillStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  padding: "3px 8px",
  borderRadius: 999,
  border: "1px solid #fdba74",
  background: "#fff7ed",
  color: "#c2410c",
  fontSize: 11,
  fontWeight: 700,
}

const headerLinkStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  padding: "8px 10px",
  borderRadius: 10,
  border: "1px solid var(--border)",
  background: "var(--surface-2)",
  color: "var(--text)",
  textDecoration: "none",
  fontSize: 12,
  fontWeight: 700,
}

const filterInputStyle: CSSProperties = {
  width: "100%",
  minWidth: 0,
  padding: "10px 12px",
  borderRadius: 12,
  border: "1px solid var(--border)",
  background: "var(--input-bg)",
  color: "var(--input-text)",
  fontSize: 13,
}

function tabButtonStyle(active: boolean): CSSProperties {
  return {
    display: "inline-flex",
    alignItems: "center",
    gap: 8,
    padding: "9px 12px",
    borderRadius: 999,
    border: active ? "1px solid rgba(15,23,42,0.08)" : "1px solid transparent",
    background: active ? "var(--surface)" : "transparent",
    color: "var(--text)",
    cursor: "pointer",
    fontWeight: 700,
    fontSize: 13,
  }
}

const tabCountStyle: CSSProperties = {
  display: "inline-flex",
  minWidth: 22,
  height: 22,
  borderRadius: 999,
  alignItems: "center",
  justifyContent: "center",
  background: "var(--surface-2)",
  fontSize: 11,
}

const toolbarButtonStyle: CSSProperties = {
  padding: "7px 10px",
  borderRadius: 10,
  border: "1px solid var(--border)",
  background: "var(--surface-2)",
  color: "var(--text)",
  cursor: "pointer",
  fontSize: 12,
  fontWeight: 700,
}

const loadMoreButtonStyle: CSSProperties = {
  padding: "10px 14px",
  borderRadius: 999,
  border: "1px solid var(--border)",
  background: "var(--surface)",
  color: "var(--text)",
  fontWeight: 700,
  cursor: "pointer",
}

const tableHeaderStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: monthRowColumns,
  gap: 12,
  padding: "0 10px 8px",
  color: "var(--muted)",
  fontSize: 11,
  fontWeight: 700,
  letterSpacing: "0.04em",
  textTransform: "uppercase",
}

const pillBaseStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  padding: "3px 9px",
  borderRadius: 999,
  fontSize: 11,
  fontWeight: 700,
}

const miniMetaChipStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  padding: "3px 8px",
  borderRadius: 999,
  background: "var(--surface-2)",
  border: "1px solid var(--border)",
  color: "var(--muted)",
  fontSize: 11,
}

const compactActionStyle: CSSProperties = {
  padding: "7px 10px",
  borderRadius: 10,
  border: "1px solid var(--border)",
  background: "var(--surface)",
  color: "var(--text)",
  cursor: "pointer",
  fontWeight: 700,
  fontSize: 12,
}

const compactPrimaryActionStyle: CSSProperties = {
  padding: "7px 10px",
  borderRadius: 10,
  border: "1px solid #1d4ed8",
  background: "#1d4ed8",
  color: "#ffffff",
  cursor: "pointer",
  fontWeight: 700,
  fontSize: 12,
}

const compactLinkActionStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  padding: "7px 10px",
  borderRadius: 10,
  border: "1px solid var(--border)",
  background: "var(--surface)",
  color: "var(--text)",
  textDecoration: "none",
  fontWeight: 700,
  fontSize: 12,
}
