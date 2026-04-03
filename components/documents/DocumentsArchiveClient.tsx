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

const shellStyle: CSSProperties = {
  minHeight: "100vh",
  background:
    "radial-gradient(circle at top left, rgba(46, 125, 50, 0.14), transparent 30%), radial-gradient(circle at top right, rgba(15, 23, 42, 0.1), transparent 34%), var(--bg-grad)",
  padding: "32px 24px 72px",
}

const sectionCardStyle: CSSProperties = {
  border: "1px solid var(--border)",
  borderRadius: 24,
  background: "var(--surface)",
  boxShadow: "0 18px 50px rgba(15,23,42,0.08)",
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat("ja-JP", {
    style: "currency",
    currency: "JPY",
    maximumFractionDigits: 0,
  }).format(Number(value || 0))
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
        const json = (await res.json().catch(() => null)) as
          | { ok?: boolean; archive?: DocumentsArchiveResponse; error?: string }
          | null
        if (!active) return
        if (!res.ok || !json?.ok || !json.archive) {
          throw new Error(json?.error ?? "請求書保管を読み込めませんでした。")
        }
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
    const options =
      activeTab === "sales" ? archive.filters.statusOptions.sales : archive.filters.statusOptions.vendor
    if (!options.some((option) => option.value === status)) {
      setStatus("")
    }
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

  const handlePdfOpen = async (item: DocumentsArchiveItem, download = false) => {
    const token = await getAccessToken()
    if (!token) {
      setNotice({ tone: "error", text: "ログイン状態を確認できませんでした。" })
      return
    }

    setBusyKey(`${download ? "download" : "open"}:${item.id}`)
    try {
      const res = await fetch(item.pdfEndpoint, {
        headers: { Authorization: `Bearer ${token}` },
      })
      const json = (await res.json().catch(() => null)) as { signed_url?: string; error?: string } | null
      if (!res.ok || !json?.signed_url) {
        throw new Error(json?.error ?? "PDF を開けませんでした。")
      }

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
    const res = await fetch(`/api/documents/archive?${params.toString()}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
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
      const res = await fetch(`/api/invoices/${item.id}/generate-pdf`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      })
      const json = (await res.json().catch(() => null)) as { signed_url?: string; error?: string } | null
      if (!res.ok) throw new Error(json?.error ?? "PDF の再生成に失敗しました。")
      setNotice({ tone: "success", text: "請求書 PDF を再生成しました。" })
      await refreshArchive()
    } catch (regenerateError) {
      setNotice({
        tone: "error",
        text: regenerateError instanceof Error ? regenerateError.message : "PDF の再生成に失敗しました。",
      })
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
      const endpoint =
        item.pdfActionKind === "replace"
          ? `/api/vendor-invoices/${item.id}/replace-pdf`
          : `/api/vendor-invoices/${item.id}/upload-pdf`
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      })
      const json = (await res.json().catch(() => null)) as { ok?: boolean; error?: string } | null
      if (!res.ok || !json?.ok) {
        throw new Error(json?.error ?? "外注請求書 PDF の保存に失敗しました。")
      }
      setNotice({
        tone: "success",
        text: item.pdfActionKind === "replace" ? "外注請求書 PDF を差し替えました。" : "外注請求書 PDF を添付しました。",
      })
      await refreshArchive()
    } catch (uploadError) {
      setNotice({
        tone: "error",
        text: uploadError instanceof Error ? uploadError.message : "外注請求書 PDF の保存に失敗しました。",
      })
    } finally {
      setBusyKey(null)
    }
  }

  if (authLoading || loading) {
    return <div style={{ padding: 32, color: "var(--muted)" }}>読み込み中...</div>
  }

  if (!canAccess) {
    return (
      <div style={{ padding: 32 }}>
        <div style={{ ...sectionCardStyle, padding: 24 }}>
          <h1 style={{ margin: 0, fontSize: 24, color: "var(--text)" }}>請求書保管</h1>
          <p style={{ margin: "10px 0 0", color: "var(--muted)" }}>
            請求書保管は owner / executive_assistant のみ利用できます。
          </p>
          <Link href="/home" style={{ display: "inline-flex", marginTop: 14, color: "var(--primary)", fontWeight: 700, textDecoration: "none" }}>
            Home に戻る
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div style={shellStyle}>
      <div style={{ maxWidth: 1280, margin: "0 auto", display: "grid", gap: 18 }}>
        <section
          style={{
            ...sectionCardStyle,
            padding: 24,
            overflow: "hidden",
            position: "relative",
            background:
              "linear-gradient(135deg, rgba(15,23,42,0.96) 0%, rgba(30,41,59,0.92) 52%, rgba(22,101,52,0.88) 100%)",
            color: "#f8fafc",
          }}
        >
          <div
            style={{
              position: "absolute",
              inset: 0,
              background:
                "linear-gradient(90deg, rgba(255,255,255,0.06) 1px, transparent 1px), linear-gradient(rgba(255,255,255,0.05) 1px, transparent 1px)",
              backgroundSize: "28px 28px",
              opacity: 0.22,
              pointerEvents: "none",
            }}
          />
          <div style={{ position: "relative", display: "grid", gap: 20 }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 16, flexWrap: "wrap", alignItems: "start" }}>
              <div style={{ maxWidth: 760 }}>
                <p style={{ margin: 0, fontSize: 12, letterSpacing: "0.14em", opacity: 0.72 }}>DOCUMENTS</p>
                <h1 style={{ margin: "10px 0 10px", fontSize: 34, lineHeight: 1.1 }}>請求書保管</h1>
                <p style={{ margin: 0, fontSize: 15, lineHeight: 1.8, color: "rgba(241,245,249,0.84)" }}>
                  請求済み請求書と外注請求書を、月ごとにまとめて探せる画面です。PDF の有無、要対応、対象月が一目で分かり、その場で再生成や添付まで完了できます。
                </p>
              </div>
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                <Link href="/invoices" style={heroLinkStyle}>請求書一覧</Link>
                <Link href="/vendors" style={heroLinkStyle}>外注管理</Link>
                <Link href="/payouts" style={heroLinkStyle}>支払管理</Link>
              </div>
            </div>

            {archive ? (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12 }}>
                <HeroMetric label="今月の請求書件数" value={String(archive.summary.currentMonthSalesCount)} />
                <HeroMetric label="今月の外注請求件数" value={String(archive.summary.currentMonthVendorCount)} />
                <HeroMetric label="PDF未保存件数" value={String(archive.summary.pdfMissingCount)} />
                <HeroMetric label="要対応件数" value={String(archive.summary.actionRequiredCount)} />
              </div>
            ) : null}
          </div>
        </section>

        {notice ? (
          <section
            style={{
              ...sectionCardStyle,
              padding: "14px 18px",
              borderColor: notice.tone === "success" ? "#86efac" : "#fecaca",
              background: notice.tone === "success" ? "#f0fdf4" : "#fff1f2",
              color: notice.tone === "success" ? "#166534" : "#b91c1c",
            }}
          >
            {notice.text}
          </section>
        ) : null}

        {error ? (
          <section
            style={{
              ...sectionCardStyle,
              padding: "18px 20px",
              borderColor: "var(--error-border)",
              background: "var(--error-bg)",
              color: "var(--error-text)",
            }}
          >
            {error}
          </section>
        ) : null}

        <section style={{ ...sectionCardStyle, padding: 18, display: "grid", gap: 16 }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 14, flexWrap: "wrap", alignItems: "center" }}>
            <div style={{ display: "inline-flex", padding: 6, borderRadius: 999, background: "var(--surface-2)", border: "1px solid var(--border)", gap: 6 }}>
              <button type="button" onClick={() => setActiveTab("sales")} style={tabButtonStyle(activeTab === "sales")}>
                請求済み請求書
                {archive ? <span style={tabCountStyle}>{archive.sales.totalDocuments}</span> : null}
              </button>
              <button type="button" onClick={() => setActiveTab("vendor")} style={tabButtonStyle(activeTab === "vendor")}>
                外注請求書
                {archive ? <span style={tabCountStyle}>{archive.vendor.totalDocuments}</span> : null}
              </button>
            </div>
            <div style={{ fontSize: 13, color: "var(--muted)" }}>
              現在表示中: {activeTab === "sales" ? "売上請求書" : "外注請求書"}
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 10 }}>
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={activeTab === "sales" ? "請求先名 / 請求書名で検索" : "外注先名 / 請求書番号で検索"}
              style={filterInputStyle}
            />
            <select value={month} onChange={(event) => setMonth(event.target.value)} style={filterInputStyle}>
              <option value="">すべての月</option>
              {(archive?.filters.availableMonths ?? []).map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
            <select value={status} onChange={(event) => setStatus(event.target.value)} style={filterInputStyle}>
              <option value="">すべてのステータス</option>
              {currentStatusOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <select value={pdfFilter} onChange={(event) => setPdfFilter(event.target.value as DocumentPdfFilter)} style={filterInputStyle}>
              <option value="all">PDFあり/なし すべて</option>
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
          <section style={{ display: "grid", gap: 16 }}>
            {currentSection.monthGroups.length === 0 ? (
              <section style={{ ...sectionCardStyle, padding: 24 }}>
                <GuideEmptyState
                  title={activeTab === "sales" ? "条件に合う請求書はありません" : "条件に合う外注請求書はありません"}
                  description={
                    activeTab === "sales"
                      ? "月・ステータス・PDF条件を見直すか、Billing / Invoices 側で新しい請求書を作成してください。"
                      : "月・ステータス・PDF条件を見直すか、外注先の請求依頼と提出状況を確認してください。"
                  }
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
                  group={group}
                  onDownload={(item) => void handlePdfOpen(item, true)}
                  onOpen={(item) => void handlePdfOpen(item, false)}
                  onRepair={(item) => void handleSalesPdfRegenerate(item)}
                  onUpload={(item, file) => void handleVendorPdfUpload(item, file)}
                />
              ))
            )}

            {currentSection.hasMore ? (
              <div style={{ display: "flex", justifyContent: "center" }}>
                <button
                  type="button"
                  onClick={() => setMonthLimit((current) => Math.min(current + 6, 12))}
                  style={{
                    padding: "11px 16px",
                    borderRadius: 999,
                    border: "1px solid var(--border)",
                    background: "var(--surface)",
                    color: "var(--text)",
                    fontWeight: 700,
                    cursor: "pointer",
                  }}
                >
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
  group,
  onOpen,
  onDownload,
  onRepair,
  onUpload,
}: {
  activeTab: DocumentScope
  busyKey: string | null
  group: DocumentsArchiveMonthGroup
  onOpen: (item: DocumentsArchiveItem) => void
  onDownload: (item: DocumentsArchiveItem) => void
  onRepair: (item: DocumentsArchiveItem) => void
  onUpload: (item: DocumentsArchiveItem, file: File | null) => void
}) {
  return (
    <section style={{ ...sectionCardStyle, padding: 18, display: "grid", gap: 14 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 14, flexWrap: "wrap", alignItems: "end" }}>
        <div>
          <div style={{ fontSize: 12, letterSpacing: "0.08em", color: "var(--muted)" }}>{activeTab === "sales" ? "SALES" : "VENDOR"}</div>
          <h2 style={{ margin: "6px 0 0", fontSize: 24, color: "var(--text)" }}>{formatMonth(group.month)}</h2>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 10, minWidth: "min(100%, 640px)" }}>
          <MonthMetric label="件数" value={String(group.count)} />
          <MonthMetric label="合計金額" value={formatCurrency(group.totalAmount)} />
          <MonthMetric label="PDF保存済み" value={String(group.pdfSavedCount)} />
          <MonthMetric label="未保存" value={String(group.pdfMissingCount)} />
        </div>
      </div>

      <div style={{ display: "grid", gap: 12 }}>
        {group.items.map((item) => (
          <article
            key={item.id}
            style={{
              border: "1px solid var(--border)",
              borderRadius: 20,
              padding: 16,
              background:
                item.actionRequired && !item.hasPdf
                  ? "linear-gradient(180deg, rgba(255,255,255,1) 0%, rgba(255,249,245,1) 100%)"
                  : "var(--surface-2)",
              display: "grid",
              gap: 14,
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", gap: 16, flexWrap: "wrap", alignItems: "start" }}>
              <div style={{ minWidth: 0, flex: "1 1 420px" }}>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                  <span style={{ fontSize: 13, fontWeight: 700, color: "var(--muted)" }}>{item.partyName}</span>
                  <span style={{ ...pillBaseStyle, ...statusBadgeStyle(item) }}>{item.statusLabel}</span>
                  <span style={{ ...pillBaseStyle, ...pdfBadgeStyle(item.hasPdf) }}>{item.hasPdf ? "PDFあり" : "PDFなし"}</span>
                  {item.actionRequired ? (
                    <span style={{ ...pillBaseStyle, background: "#fff7ed", color: "#c2410c", border: "1px solid #fdba74" }}>要対応</span>
                  ) : null}
                </div>
                <div style={{ marginTop: 10, fontSize: 22, fontWeight: 800, color: "var(--text)", lineHeight: 1.25 }}>
                  {item.title}
                </div>
                <div style={{ marginTop: 8, display: "flex", gap: 14, flexWrap: "wrap", color: "var(--muted)", fontSize: 13 }}>
                  <span>対象月: {item.month}</span>
                  <span>{item.primaryDateLabel}: {formatDate(item.primaryDate)}</span>
                  <span>{item.secondaryDateLabel}: {formatDate(item.secondaryDate)}</span>
                  {item.documentNumber ? <span>番号: {item.documentNumber}</span> : null}
                </div>
              </div>

              <div style={{ minWidth: 220, textAlign: "right" }}>
                <div style={{ fontSize: 12, color: "var(--muted)" }}>金額</div>
                <div style={{ marginTop: 4, fontSize: 26, fontWeight: 800, color: "var(--text)" }}>{formatCurrency(item.amount)}</div>
              </div>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 10 }}>
              <MetaCell label={item.scope === "sales" ? "請求先" : "外注先"} value={item.partyName} />
              <MetaCell label="タイトル / 請求名" value={item.title} />
              <MetaCell label="ステータス" value={item.statusLabel} />
              <MetaCell label="PDF" value={item.hasPdf ? "保存済み" : "未保存"} />
            </div>

            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
              <button type="button" onClick={() => onOpen(item)} disabled={!item.hasPdf || busyKey === `open:${item.id}`} style={secondaryActionStyle}>
                閲覧
              </button>
              <button type="button" onClick={() => onDownload(item)} disabled={!item.hasPdf || busyKey === `download:${item.id}`} style={secondaryActionStyle}>
                ダウンロード
              </button>
              <Link href={item.detailHref} style={linkActionStyle}>
                詳細へ
              </Link>
              {item.scope === "sales" && item.pdfActionKind === "regenerate" ? (
                <button type="button" onClick={() => onRepair(item)} disabled={busyKey === `repair:${item.id}`} style={primaryActionStyle}>
                  PDF再生成
                </button>
              ) : null}
              {item.scope === "vendor" && item.pdfActionKind ? (
                <label style={{ ...primaryActionStyle, display: "inline-flex", alignItems: "center", cursor: busyKey === `upload:${item.id}` ? "wait" : "pointer" }}>
                  <span>{busyKey === `upload:${item.id}` ? "保存中..." : item.pdfActionLabel}</span>
                  <input
                    type="file"
                    accept="application/pdf,.pdf"
                    style={{ display: "none" }}
                    disabled={busyKey === `upload:${item.id}`}
                    onChange={(event) => {
                      const file = event.currentTarget.files?.[0] ?? null
                      void onUpload(item, file)
                      event.currentTarget.value = ""
                    }}
                  />
                </label>
              ) : null}
            </div>
          </article>
        ))}
      </div>
    </section>
  )
}

function HeroMetric({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ borderRadius: 20, padding: 16, background: "rgba(255,255,255,0.12)", border: "1px solid rgba(255,255,255,0.18)" }}>
      <div style={{ fontSize: 12, color: "rgba(241,245,249,0.72)" }}>{label}</div>
      <div style={{ marginTop: 8, fontSize: 28, fontWeight: 800 }}>{value}</div>
    </div>
  )
}

function MonthMetric({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ border: "1px solid var(--border)", borderRadius: 16, padding: 12, background: "var(--surface-2)" }}>
      <div style={{ fontSize: 12, color: "var(--muted)" }}>{label}</div>
      <div style={{ marginTop: 6, fontSize: 20, fontWeight: 800, color: "var(--text)" }}>{value}</div>
    </div>
  )
}

function MetaCell({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ border: "1px solid var(--border)", borderRadius: 14, padding: 12, background: "var(--surface)" }}>
      <div style={{ fontSize: 12, color: "var(--muted)" }}>{label}</div>
      <div style={{ marginTop: 6, fontSize: 14, fontWeight: 700, color: "var(--text)", lineHeight: 1.5 }}>{value}</div>
    </div>
  )
}

const pillBaseStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  padding: "3px 10px",
  borderRadius: 999,
  fontSize: 12,
  fontWeight: 700,
}

const heroLinkStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  padding: "10px 14px",
  borderRadius: 999,
  border: "1px solid rgba(255,255,255,0.16)",
  background: "rgba(255,255,255,0.08)",
  color: "#f8fafc",
  textDecoration: "none",
  fontWeight: 700,
}

const filterInputStyle: CSSProperties = {
  width: "100%",
  padding: "11px 12px",
  borderRadius: 14,
  border: "1px solid var(--border)",
  background: "var(--input-bg)",
  color: "var(--input-text)",
}

function tabButtonStyle(active: boolean): CSSProperties {
  return {
    display: "inline-flex",
    alignItems: "center",
    gap: 8,
    padding: "11px 14px",
    borderRadius: 999,
    border: active ? "1px solid rgba(15,23,42,0.08)" : "1px solid transparent",
    background: active ? "var(--surface)" : "transparent",
    color: "var(--text)",
    cursor: "pointer",
    fontWeight: 700,
  }
}

const tabCountStyle: CSSProperties = {
  display: "inline-flex",
  minWidth: 24,
  height: 24,
  borderRadius: 999,
  alignItems: "center",
  justifyContent: "center",
  background: "var(--surface-2)",
  fontSize: 12,
}

const secondaryActionStyle: CSSProperties = {
  padding: "10px 13px",
  borderRadius: 12,
  border: "1px solid var(--border)",
  background: "var(--surface)",
  color: "var(--text)",
  cursor: "pointer",
  fontWeight: 700,
}

const primaryActionStyle: CSSProperties = {
  padding: "10px 13px",
  borderRadius: 12,
  border: "1px solid #1d4ed8",
  background: "#1d4ed8",
  color: "#ffffff",
  cursor: "pointer",
  fontWeight: 700,
}

const linkActionStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  padding: "10px 13px",
  borderRadius: 12,
  border: "1px solid var(--border)",
  background: "var(--surface)",
  color: "var(--text)",
  textDecoration: "none",
  fontWeight: 700,
}
