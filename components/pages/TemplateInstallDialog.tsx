"use client"

import Link from "next/link"
import type { CSSProperties } from "react"
import { useCallback, useEffect, useMemo, useState } from "react"
import { supabase } from "@/lib/supabase"

/* ─── Types ──────────────────────────────────── */

type TemplateInstallSummary = {
  installId: string
  installName: string
  installedAt: string
  version: string
  status: "pending" | "completed" | "failed"
  rootPageId: string | null
  pageCount: number
  updateAvailable: boolean
  latestVersion: string
  failureMessage: string | null
  groupUnderRoot: boolean
}

type TemplateListItem = {
  id: string
  key: string
  name: string
  description: string
  improvementText: string
  category: string
  badges: string[]
  isOfficial: boolean
  sourceType: "official" | "shared"
  sharingScope: "official" | "org" | "industry"
  industryTag: string | null
  version: string
  status: string
  integrationTargets: string[]
  previewImagePath: string | null
  preview: {
    headline: string
    summary: string
    highlightedPages: string[]
    textPreview: string[]
  }
  pageCount: number
  installedCount: number
  recommendationKeys: string[]
  installs: TemplateInstallSummary[]
  pages: Array<{
    key: string
    title: string
    pageType: string
    parentPageKey: string | null
    orderIndex: number
    icon: string | null
  }>
  canManage: boolean
}

type TemplateDiff = {
  templateKey: string
  templateName: string
  installId: string
  fromVersion: string
  toVersion: string
  hasChanges: boolean
  addedCount: number
  changedCount: number
  removedCount: number
  pages: Array<{
    slugSeed: string
    title: string
    changeType: "added" | "changed" | "removed"
    beforeText: string
    afterText: string
  }>
}

type TemplateInstallDialogProps = {
  open: boolean
  onClose: () => void
  initialTemplateKey?: string | null
  initialInstallName?: string
  onInstalled?: (payload: {
    rootPageId: string
    pageCount: number
    templateName: string
    recommendedTemplateKeys?: string[]
  }) => void
}

/* ─── Helpers ──────────────────────────────────── */

function categoryLabel(cat: string) {
  switch (cat) {
    case "core_ops": return "コア運用"
    case "people_ops": return "人員運用"
    case "content_intake": return "案件入力支援"
    case "quality": return "修正・品質管理"
    case "notification": return "連携・通知"
    case "client_ops": return "クライアント運用"
    default: return cat
  }
}

function pageTypeLabel(pt: string) {
  switch (pt) {
    case "checklist": return "チェック"
    case "snippets": return "文面"
    case "table_like": return "台帳"
    case "link_hub": return "導線"
    default: return "ドキュメント"
  }
}

function integrationTargetLabel(t: string) {
  switch (t) {
    case "/contents": return "進行管理"
    case "/billing": return "請求"
    case "/vendors": return "外注"
    case "/payouts": return "支払い"
    case "/notifications": return "通知"
    case "/settings": return "設定"
    case "/settings/members": return "メンバー設定"
    default: return t.replace(/^\//, "") || "本体画面"
  }
}

function formatInstalledAt(v: string) {
  const d = new Date(v)
  if (Number.isNaN(d.getTime())) return v
  return d.toLocaleDateString("ja-JP", { year: "numeric", month: "short", day: "numeric" })
}

function installStatusLabel(s: "pending" | "completed" | "failed") {
  switch (s) { case "pending": return "準備中"; case "failed": return "失敗"; default: return "完了" }
}

function diffChangeLabel(c: "added" | "changed" | "removed") {
  switch (c) { case "added": return "追加"; case "removed": return "削除"; default: return "変更" }
}

function sharingScopeLabel(s: "official" | "org" | "industry") {
  switch (s) { case "industry": return "業界配布"; case "org": return "組織内共有"; default: return "公式" }
}

/** 1文だけ取り出す。長すぎたら切る */
function oneLiner(text: string, max = 50) {
  const first = text.split(/[。\n]/)[0] ?? text
  if (first.length <= max) return first
  return `${first.slice(0, max)}…`
}

/* ─── Main Component ──────────────────────────── */

export default function TemplateInstallDialog({
  open, onClose, initialTemplateKey, initialInstallName, onInstalled,
}: TemplateInstallDialogProps) {
  const [templates, setTemplates] = useState<TemplateListItem[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const [category, setCategory] = useState("all")
  const [installName, setInstallName] = useState("")
  const [includeSampleContent, setIncludeSampleContent] = useState(true)
  const [groupUnderRoot, setGroupUnderRoot] = useState(true)
  const [runningInstallId, setRunningInstallId] = useState<string | null>(null)
  const [completedInstall, setCompletedInstall] = useState<{
    rootPageId: string; pageCount: number; templateName: string; recommendedTemplateKeys: string[]
  } | null>(null)
  const [diff, setDiff] = useState<TemplateDiff | null>(null)
  const [shareInstallId, setShareInstallId] = useState<string | null>(null)
  const [shareName, setShareName] = useState("")
  const [sharingScope, setSharingScope] = useState<"org" | "industry">("org")
  const [industryTag, setIndustryTag] = useState("")
  const [showOptions, setShowOptions] = useState(false)
  const [showMore, setShowMore] = useState(false)
  const [selectedPageKeys, setSelectedPageKeys] = useState<Set<string>>(new Set())

  async function getToken() {
    const { data } = await supabase.auth.getSession()
    return data.session?.access_token ?? null
  }

  const fetchTemplates = useCallback(async () => {
    const token = await getToken()
    if (!token) { setError("ログイン状態を確認してください。"); return }
    setLoading(true); setError(null)
    const res = await fetch("/api/pages/templates", { headers: { Authorization: `Bearer ${token}` } })
    const json = (await res.json().catch(() => null)) as { ok?: boolean; templates?: TemplateListItem[]; message?: string } | null
    if (!res.ok || !json?.ok) { setError(json?.message ?? "テンプレ一覧の取得に失敗しました。"); setTemplates([]); setLoading(false); return }
    const next = json.templates ?? []
    setTemplates(next)
    setSelectedKey((cur) => {
      const resolved = (initialTemplateKey && next.some((t) => t.key === initialTemplateKey)) ? initialTemplateKey
        : (cur && next.some((t) => t.key === cur)) ? cur
        : next[0]?.key ?? null
      const found = next.find((t) => t.key === resolved)
      if (found) setSelectedPageKeys(new Set(found.pages.map((p) => p.key)))
      return resolved
    })
    setLoading(false)
  }, [initialTemplateKey])

  useEffect(() => {
    if (!open) return
    const id = window.requestAnimationFrame(() => {
      setCompletedInstall(null); setDiff(null); setShareInstallId(null)
      setInstallName(initialInstallName ?? ""); setIncludeSampleContent(true)
      setGroupUnderRoot(true); setShowOptions(false); setShowMore(false)
      void fetchTemplates()
    })
    return () => window.cancelAnimationFrame(id)
  }, [fetchTemplates, initialInstallName, open])

  const categoryOptions = useMemo(() => {
    const vals = Array.from(new Set(templates.map((t) => t.category)))
    return vals.map((v) => ({ value: v, label: categoryLabel(v) }))
  }, [templates])

  const filteredTemplates = useMemo(() => {
    if (category === "all") return templates
    return templates.filter((t) => t.category === category)
  }, [category, templates])

  const sel = filteredTemplates.find((t) => t.key === selectedKey) ?? templates.find((t) => t.key === selectedKey) ?? filteredTemplates[0] ?? templates[0] ?? null

  const recommendedTemplates = useMemo(() => {
    if (!sel) return []
    return sel.recommendationKeys.map((k) => templates.find((t) => t.key === k) ?? null).filter((t): t is TemplateListItem => t !== null)
  }, [sel, templates])

  const selectTemplate = useCallback((key: string, name = "", switchCategory = false) => {
    if (switchCategory) {
      const t = templates.find((x) => x.key === key) ?? null
      if (t) setCategory(t.category)
    }
    const t = templates.find((x) => x.key === key)
    setSelectedPageKeys(new Set(t?.pages.map((p) => p.key) ?? []))
    setSelectedKey(key); setInstallName(name); setCompletedInstall(null)
    setDiff(null); setShareInstallId(null); setShowOptions(false); setShowMore(false)
  }, [templates])

  // ─── API actions ───
  async function runInstall(installId: string) {
    const token = await getToken()
    if (!token) { setError("ログイン状態を確認してください。"); return }
    setRunningInstallId(installId)
    const pageKeys = sel ? Array.from(selectedPageKeys) : undefined
    const res = await fetch("/api/pages/templates", {
      method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ action: "run_install", installId, selectedPageKeys: pageKeys }),
    })
    const json = (await res.json().catch(() => null)) as { ok?: boolean; rootPageId?: string; pageCount?: number; templateName?: string; message?: string } | null
    if (!res.ok || !json?.ok || !json.rootPageId || !sel) { setError(json?.message ?? "テンプレ導入に失敗しました。"); setRunningInstallId(null); await fetchTemplates(); return }
    setCompletedInstall({ rootPageId: json.rootPageId, pageCount: json.pageCount ?? sel.pageCount, templateName: json.templateName ?? sel.name, recommendedTemplateKeys: sel.recommendationKeys })
    setRunningInstallId(null); await fetchTemplates()
  }

  async function handleInstall() {
    if (!sel) return
    const token = await getToken()
    if (!token) { setError("ログイン状態を確認してください。"); return }
    setError(null)
    const res = await fetch("/api/pages/templates", {
      method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ action: "queue_install", templateKey: sel.key, installName: installName.trim() || undefined, includeSampleContent, groupUnderRoot }),
    })
    const json = (await res.json().catch(() => null)) as { ok?: boolean; installId?: string; message?: string } | null
    if (!res.ok || !json?.ok || !json.installId) { setError(json?.message ?? "テンプレ導入の開始に失敗しました。"); return }
    await runInstall(json.installId)
  }

  async function handleDeleteInstall(installId: string) {
    const token = await getToken(); if (!token) return
    const res = await fetch(`/api/pages/templates?installId=${installId}`, { method: "DELETE", headers: { Authorization: `Bearer ${token}` } })
    const json = (await res.json().catch(() => null)) as { ok?: boolean; message?: string } | null
    if (!res.ok || !json?.ok) { setError(json?.message ?? "導入単位の削除に失敗しました。"); return }
    await fetchTemplates()
  }

  async function handleApplyUpdate(installId: string) {
    const token = await getToken(); if (!token) return
    const res = await fetch("/api/pages/templates", { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ action: "apply_update", installId }) })
    const json = (await res.json().catch(() => null)) as { ok?: boolean; message?: string } | null
    if (!res.ok || !json?.ok) { setError(json?.message ?? "テンプレ更新の反映に失敗しました。"); return }
    await fetchTemplates()
  }

  async function handleDiff(installId: string) {
    const token = await getToken(); if (!token) return
    const res = await fetch(`/api/pages/templates?view=diff&installId=${installId}`, { headers: { Authorization: `Bearer ${token}` } })
    const json = (await res.json().catch(() => null)) as { ok?: boolean; diff?: TemplateDiff; message?: string } | null
    if (!res.ok || !json?.ok || !json.diff) { setError(json?.message ?? "テンプレ差分の取得に失敗しました。"); return }
    setDiff(json.diff)
  }

  async function handleShareInstall(installId: string, targetTemplateKey?: string) {
    const token = await getToken(); if (!token) return
    const name = shareName.trim() || sel?.name || "共有テンプレ"
    const res = await fetch("/api/pages/templates", { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ action: "share_install", installId, shareName: name, sharingScope, industryTag: industryTag.trim() || undefined, targetTemplateKey }) })
    const json = (await res.json().catch(() => null)) as { ok?: boolean; message?: string } | null
    if (!res.ok || !json?.ok) { setError(json?.message ?? "共有テンプレの保存に失敗しました。"); return }
    setShareInstallId(null); setShareName(""); setIndustryTag(""); await fetchTemplates()
  }

  async function handleToggleTemplateStatus() {
    if (!sel || !sel.canManage) return
    const token = await getToken(); if (!token) return
    const next = sel.status === "archived" ? "active" : "archived"
    const res = await fetch("/api/pages/templates", { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ action: "set_template_status", templateKey: sel.key, status: next }) })
    const json = (await res.json().catch(() => null)) as { ok?: boolean; message?: string } | null
    if (!res.ok || !json?.ok) { setError(json?.message ?? "テンプレ状態の更新に失敗しました。"); return }
    await fetchTemplates()
  }

  if (!open) return null

  // ─── Render ───
  return (
    <div style={S.overlay} onClick={() => !runningInstallId && onClose()}>
      <div style={S.dialog} onClick={(e) => e.stopPropagation()}>

        {/* ━━━ Left: template list ━━━ */}
        <aside style={S.left}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: "#111" }}>テンプレート</span>
            <button type="button" onClick={onClose} style={S.closeBtn} aria-label="閉じる">✕</button>
          </div>

          <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginBottom: 12 }}>
            <button type="button" style={chipStyle(category === "all")} onClick={() => setCategory("all")}>すべて</button>
            {categoryOptions.map((o) => <button key={o.value} type="button" style={chipStyle(category === o.value)} onClick={() => setCategory(o.value)}>{o.label}</button>)}
          </div>

          <div style={{ flex: 1, overflow: "auto", minHeight: 0, margin: "0 -12px", padding: "0 12px" }}>
            {loading ? <div style={{ padding: "32px 0", textAlign: "center", color: "#aaa", fontSize: 12 }}>読み込み中…</div> : filteredTemplates.map((t) => {
              const active = selectedKey === t.key
              return (
                <button key={t.key} type="button" onClick={() => selectTemplate(t.key)} style={listRow(active)}>
                  <div style={{ fontSize: 13, fontWeight: active ? 600 : 500, color: active ? "#111" : "#444", marginBottom: 1 }}>{t.name}</div>
                  <div style={{ fontSize: 11, color: "#aaa" }}>{t.pageCount}ページ</div>
                </button>
              )
            })}
          </div>
        </aside>

        {/* ━━━ Right: detail ━━━ */}
        <main style={S.right}>
          {error && <div style={S.error}>{error}</div>}

          {!sel ? (
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", color: "#bbb" }}>テンプレートを選択</div>
          ) : completedInstall ? (
            /* ── 導入完了 ── */
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", minHeight: "60vh", textAlign: "center" }}>
              <div style={{ fontSize: 40, marginBottom: 16 }}>✓</div>
              <div style={{ fontSize: 18, fontWeight: 700, color: "#111", marginBottom: 4 }}>{completedInstall.templateName}</div>
              <div style={{ fontSize: 13, color: "#888", marginBottom: 24 }}>{completedInstall.pageCount}ページ追加しました</div>
              <button type="button" onClick={() => { onInstalled?.(completedInstall); onClose() }} style={S.cta}>ページを開く</button>
              {recommendedTemplates.length > 0 && (
                <div style={{ marginTop: 32, width: "100%", maxWidth: 360 }}>
                  <div style={{ fontSize: 11, color: "#999", marginBottom: 8, textAlign: "left" }}>次におすすめ</div>
                  {recommendedTemplates.map((r) => (
                    <button key={r.key} type="button" onClick={() => selectTemplate(r.key, "", true)} style={S.recRow}>
                      <span style={{ fontSize: 13, color: "#333" }}>{r.name}</span>
                      <span style={{ fontSize: 11, color: "#bbb" }}>{r.pageCount}ページ →</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          ) : (
            /* ── テンプレ詳細 ── */
            <div>
              {/* Hero: 名前 + 一文 + 導入ボタン */}
              <div style={{ marginBottom: 28 }}>
                <div style={{ fontSize: 11, color: "#999", marginBottom: 6 }}>
                  {categoryLabel(sel.category)}{sel.isOfficial ? " · 公式" : ""} · {sel.pageCount}ページ
                </div>
                <h3 style={{ margin: "0 0 6px", fontSize: 22, fontWeight: 700, color: "#111", letterSpacing: "-0.02em" }}>
                  {sel.name}
                </h3>
                <p style={{ margin: "0 0 16px", fontSize: 13, color: "#777", lineHeight: 1.5 }}>
                  {oneLiner(sel.improvementText, 80)}
                </p>

                <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                  <button type="button" onClick={handleInstall} disabled={Boolean(runningInstallId) || selectedPageKeys.size === 0} style={{ ...S.cta, opacity: selectedPageKeys.size === 0 ? 0.4 : 1 }}>
                    {runningInstallId ? "導入中…" : selectedPageKeys.size === sel.pages.length ? "すべて導入" : `${selectedPageKeys.size}ページを導入`}
                  </button>
                  <button type="button" onClick={() => setShowOptions(!showOptions)} style={S.ghost}>
                    オプション{showOptions ? " ▴" : " ▾"}
                  </button>
                  {sel.installs.length > 0 && (
                    <span style={{ fontSize: 11, color: "#bbb" }}>導入済み {sel.installs.length}件</span>
                  )}
                </div>

                {/* オプション（折りたたみ） */}
                {showOptions && (
                  <div style={{ marginTop: 12, padding: "12px 14px", borderRadius: 10, background: "#f7f7f8", display: "grid", gap: 8 }}>
                    <div>
                      <label style={{ fontSize: 11, color: "#888", display: "block", marginBottom: 3 }}>導入名</label>
                      <input value={installName} onChange={(e) => setInstallName(e.target.value)} placeholder={sel.name} style={S.input} />
                    </div>
                    <div style={{ display: "flex", gap: 16 }}>
                      <label style={S.checkLabel}><input type="checkbox" checked={includeSampleContent} onChange={(e) => setIncludeSampleContent(e.target.checked)} style={{ accentColor: "#111" }} /> サンプル記入あり</label>
                      <label style={S.checkLabel}><input type="checkbox" checked={groupUnderRoot} onChange={(e) => setGroupUnderRoot(e.target.checked)} style={{ accentColor: "#111" }} /> ルート配下にまとめる</label>
                    </div>
                  </div>
                )}
              </div>

              {/* 含まれるページ — チェックボックス付きリスト */}
              <div style={{ marginBottom: 24 }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                  <div style={{ fontSize: 11, fontWeight: 600, color: "#999", textTransform: "uppercase" as const, letterSpacing: "0.05em" }}>
                    含まれるページ
                    {selectedPageKeys.size < sel.pages.length && <span style={{ marginLeft: 6, color: "#111", fontWeight: 700 }}>{selectedPageKeys.size}/{sel.pages.length}</span>}
                  </div>
                  <button
                    type="button"
                    onClick={() => setSelectedPageKeys(selectedPageKeys.size === sel.pages.length ? new Set() : new Set(sel.pages.map((p) => p.key)))}
                    style={{ background: "none", border: "none", color: "#999", fontSize: 11, cursor: "pointer", padding: 0 }}
                  >
                    {selectedPageKeys.size === sel.pages.length ? "すべて外す" : "すべて選択"}
                  </button>
                </div>
                <div style={{ display: "grid", gap: 1 }}>
                  {sel.pages.map((p) => {
                    const checked = selectedPageKeys.has(p.key)
                    return (
                      <label
                        key={p.key}
                        style={{
                          display: "flex", alignItems: "center", gap: 8,
                          padding: "5px 8px", paddingLeft: p.parentPageKey ? 28 : 8,
                          borderRadius: 6, cursor: "pointer",
                          opacity: checked ? 1 : 0.45,
                          background: checked ? "transparent" : "transparent",
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => {
                            const next = new Set(selectedPageKeys)
                            if (checked) next.delete(p.key); else next.add(p.key)
                            setSelectedPageKeys(next)
                          }}
                          style={{ accentColor: "#111", flexShrink: 0 }}
                        />
                        <span style={{ fontSize: 13, flexShrink: 0 }}>{p.icon || "📄"}</span>
                        <span style={{ fontSize: 13, color: "#333", flex: 1 }}>{p.title}</span>
                        <span style={{ fontSize: 10, color: "#ccc" }}>{pageTypeLabel(p.pageType)}</span>
                      </label>
                    )
                  })}
                </div>
              </div>

              {/* もっと見る（詳細） */}
              <button type="button" onClick={() => setShowMore(!showMore)} style={{ ...S.ghost, fontSize: 12, marginBottom: 16 }}>
                {showMore ? "詳細を閉じる ▴" : "詳細を見る ▾"}
              </button>

              {showMore && (
                <div style={{ display: "grid", gap: 20, marginBottom: 20 }}>
                  {/* 改善説明 */}
                  <div>
                    <div style={S.sectionLabel}>何が改善されるか</div>
                    <p style={{ margin: 0, fontSize: 13, color: "#555", lineHeight: 1.7 }}>{sel.improvementText}</p>
                  </div>

                  {/* 連携先 */}
                  {sel.integrationTargets.length > 0 && (
                    <div>
                      <div style={S.sectionLabel}>連携先</div>
                      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                        {sel.integrationTargets.map((t) => <Link key={t} href={t} style={S.chip}>{integrationTargetLabel(t)}</Link>)}
                      </div>
                    </div>
                  )}

                  {/* おすすめ */}
                  {recommendedTemplates.length > 0 && (
                    <div>
                      <div style={S.sectionLabel}>おすすめの組み合わせ</div>
                      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                        {recommendedTemplates.map((r) => (
                          <button key={r.key} type="button" onClick={() => selectTemplate(r.key, "", true)} style={S.chip}>{r.name}</button>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* テンプレ管理 */}
                  {sel.canManage && (
                    <button type="button" onClick={handleToggleTemplateStatus} style={S.ghost}>
                      {sel.status === "archived" ? "再公開する" : "アーカイブする"}
                    </button>
                  )}

                  {/* 導入履歴 */}
                  {sel.installs.length > 0 && (
                    <div>
                      <div style={S.sectionLabel}>導入履歴</div>
                      <div style={{ display: "grid", gap: 6 }}>
                        {sel.installs.map((inst) => (
                          <div key={inst.installId} style={{ padding: "10px 12px", borderRadius: 8, border: "1px solid #eee" }}>
                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                              <div>
                                <span style={{ fontSize: 13, fontWeight: 600, color: "#222" }}>{inst.installName}</span>
                                <span style={{ fontSize: 11, color: "#bbb", marginLeft: 8 }}>{installStatusLabel(inst.status)} · {formatInstalledAt(inst.installedAt)}</span>
                              </div>
                              <div style={{ display: "flex", gap: 4 }}>
                                {inst.rootPageId && <Link href={`/pages/${inst.rootPageId}`} style={S.tinyBtn}>開く</Link>}
                                <button type="button" onClick={() => handleDiff(inst.installId)} style={S.tinyBtn}>差分</button>
                                {inst.updateAvailable && <button type="button" onClick={() => handleApplyUpdate(inst.installId)} style={S.tinyBtn}>更新</button>}
                                <button type="button" onClick={() => { setInstallName(`${inst.installName} コピー`); setCompletedInstall(null) }} style={S.tinyBtn}>複製</button>
                                {inst.status !== "completed" && <button type="button" onClick={() => runInstall(inst.installId)} style={S.tinyBtn}>再開</button>}
                                <button type="button" onClick={() => { setShareInstallId(shareInstallId === inst.installId ? null : inst.installId); setShareName(`${inst.installName} 共有テンプレ`) }} style={S.tinyBtn}>共有</button>
                                <button type="button" onClick={() => handleDeleteInstall(inst.installId)} style={{ ...S.tinyBtn, color: "#e55" }}>削除</button>
                              </div>
                            </div>
                            {inst.failureMessage && <div style={{ fontSize: 12, color: "#e55", marginTop: 4 }}>{inst.failureMessage}</div>}

                            {shareInstallId === inst.installId && (
                              <div style={{ marginTop: 8, paddingTop: 8, borderTop: "1px solid #f0f0f0", display: "grid", gap: 6 }}>
                                <input value={shareName} onChange={(e) => setShareName(e.target.value)} placeholder="共有テンプレ名" style={S.input} />
                                <div style={{ display: "flex", gap: 6 }}>
                                  <select value={sharingScope} onChange={(e) => setSharingScope(e.target.value === "industry" ? "industry" : "org")} style={S.input}>
                                    <option value="org">組織内共有</option>
                                    <option value="industry">業界テンプレ配布</option>
                                  </select>
                                  {sharingScope === "industry" && <input value={industryTag} onChange={(e) => setIndustryTag(e.target.value)} placeholder="業界タグ" style={S.input} />}
                                </div>
                                <div style={{ display: "flex", gap: 6 }}>
                                  <button type="button" onClick={() => handleShareInstall(inst.installId, sel.canManage ? sel.key : undefined)} style={S.cta}>{sel.canManage ? "更新版を公開" : "共有テンプレを作る"}</button>
                                  <button type="button" onClick={() => setShareInstallId(null)} style={S.ghost}>キャンセル</button>
                                </div>
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </main>
      </div>

      {diff && <DiffModal diff={diff} onClose={() => setDiff(null)} />}
    </div>
  )
}

/* ─── Diff Modal ──────────────────────────────── */

function DiffModal({ diff, onClose }: { diff: TemplateDiff; onClose: () => void }) {
  return (
    <div style={S.overlay} onClick={onClose}>
      <div style={{ width: "min(820px, 100%)", maxHeight: "calc(100vh - 48px)", borderRadius: 14, background: "#fff", boxShadow: "0 16px 48px rgba(0,0,0,.12)", overflow: "auto" }} onClick={(e) => e.stopPropagation()}>
        <div style={{ padding: 24 }}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 16 }}>
            <div>
              <div style={{ fontSize: 16, fontWeight: 700, color: "#111" }}>{diff.templateName}</div>
              <div style={{ fontSize: 12, color: "#999" }}>v{diff.fromVersion} → v{diff.toVersion} · 追加{diff.addedCount} · 変更{diff.changedCount} · 削除{diff.removedCount}</div>
            </div>
            <button type="button" onClick={onClose} style={S.ghost}>閉じる</button>
          </div>
          {diff.pages.length === 0 ? (
            <div style={{ textAlign: "center", padding: "32px 0", color: "#bbb", fontSize: 13 }}>差分なし</div>
          ) : diff.pages.map((p) => (
            <div key={`${p.slugSeed}-${p.changeType}`} style={{ marginBottom: 10, borderRadius: 8, border: "1px solid #eee", overflow: "hidden" }}>
              <div style={{ display: "flex", gap: 8, alignItems: "center", padding: "8px 12px", background: "#fafafa" }}>
                <span style={diffBadge(p.changeType)}>{diffChangeLabel(p.changeType)}</span>
                <span style={{ fontSize: 13, fontWeight: 600, color: "#222" }}>{p.title}</span>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr" }}>
                <div style={{ padding: 12, fontSize: 12, lineHeight: 1.7, color: "#888", background: "#fafafa", borderRight: "1px solid #eee" }}>{p.beforeText || "（空）"}</div>
                <div style={{ padding: 12, fontSize: 12, lineHeight: 1.7, color: "#444", background: "#fffef5" }}>{p.afterText || "（空）"}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

/* ━━━━━━━━━━━━━━━ Styles ━━━━━━━━━━━━━━━ */

const S = {
  overlay: { position: "fixed", inset: 0, zIndex: 120, background: "rgba(0,0,0,.35)", backdropFilter: "blur(3px)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 } satisfies CSSProperties,

  dialog: { width: "min(960px, 100%)", maxHeight: "calc(100vh - 32px)", overflow: "hidden", borderRadius: 14, background: "#fff", boxShadow: "0 20px 60px rgba(0,0,0,.1)", display: "grid", gridTemplateColumns: "240px 1fr" } satisfies CSSProperties,

  left: { padding: "16px 12px", borderRight: "1px solid #f0f0f0", display: "flex", flexDirection: "column", minHeight: 0, background: "#fafafa" } satisfies CSSProperties,

  right: { padding: "24px 28px", overflow: "auto", minHeight: 0 } satisfies CSSProperties,

  error: { marginBottom: 12, padding: "8px 12px", borderRadius: 8, background: "#fef2f2", border: "1px solid #fcc", color: "#d44", fontSize: 13 } satisfies CSSProperties,

  closeBtn: { background: "none", border: "none", cursor: "pointer", color: "#ccc", fontSize: 14, padding: 4 } satisfies CSSProperties,

  cta: { padding: "9px 22px", borderRadius: 8, border: "none", background: "#111", color: "#fff", fontWeight: 600, fontSize: 13, cursor: "pointer" } satisfies CSSProperties,

  ghost: { padding: "7px 14px", borderRadius: 8, border: "1px solid #e5e5e5", background: "#fff", color: "#555", fontWeight: 500, fontSize: 13, cursor: "pointer", textDecoration: "none" } satisfies CSSProperties,

  tinyBtn: { padding: "3px 8px", borderRadius: 5, border: "1px solid #eee", background: "#fff", color: "#555", fontSize: 11, cursor: "pointer", textDecoration: "none", fontWeight: 500 } satisfies CSSProperties,

  input: { width: "100%", padding: "7px 10px", borderRadius: 7, border: "1px solid #e5e5e5", background: "#fff", color: "#222", fontSize: 13, outline: "none" } satisfies CSSProperties,

  checkLabel: { display: "flex", gap: 5, alignItems: "center", fontSize: 12, color: "#777", cursor: "pointer" } satisfies CSSProperties,

  sectionLabel: { fontSize: 11, fontWeight: 600, color: "#aaa", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 8 } satisfies CSSProperties,

  chip: { display: "inline-flex", alignItems: "center", padding: "5px 12px", borderRadius: 6, border: "1px solid #eee", background: "#fff", color: "#444", fontSize: 12, fontWeight: 500, cursor: "pointer", textDecoration: "none" } satisfies CSSProperties,

  recRow: { display: "flex", justifyContent: "space-between", alignItems: "center", width: "100%", padding: "10px 12px", borderRadius: 8, border: "1px solid #f0f0f0", background: "#fff", cursor: "pointer", marginBottom: 4, textAlign: "left" as const } satisfies CSSProperties,
}

function chipStyle(active: boolean) {
  return {
    padding: "4px 9px", borderRadius: 5,
    border: active ? "1px solid #111" : "1px solid transparent",
    background: active ? "#111" : "transparent",
    color: active ? "#fff" : "#888",
    fontSize: 11, fontWeight: 600, cursor: "pointer",
  } satisfies CSSProperties
}

function listRow(active: boolean) {
  return {
    width: "100%", padding: "8px 10px", borderRadius: 7, border: "none",
    background: active ? "#fff" : "transparent",
    boxShadow: active ? "0 1px 3px rgba(0,0,0,.05)" : "none",
    cursor: "pointer", marginBottom: 1, textAlign: "left" as const,
  } satisfies CSSProperties
}

function diffBadge(type: "added" | "changed" | "removed") {
  const c = { added: { bg: "#dcfce7", color: "#166534" }, changed: { bg: "#dbeafe", color: "#1d4ed8" }, removed: { bg: "#fee2e2", color: "#dc2626" } }[type]
  return { fontSize: 10, fontWeight: 600, padding: "2px 7px", borderRadius: 4, background: c.bg, color: c.color } satisfies CSSProperties
}
