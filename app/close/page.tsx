"use client"

import Link from "next/link"
import { useCallback, useEffect, useMemo, useState } from "react"
import { FinanceOpsShell } from "@/components/finance/FinanceOpsShell"
import { ProjectInfoCard, ProjectSection } from "@/components/project/ProjectShell"
import { formatCurrency, tableStyle, tdStyle, textOrDash, thStyle } from "@/components/project/projectPageStyles"
import { useProjectWorkspace } from "@/hooks/useProjectWorkspace"
import { getContentBillingMonthYm, isBillableDoneStatus } from "@/lib/contentWorkflow"
import { supabase } from "@/lib/supabase"

type InvoiceRequestLog = {
  id: string
  created_at: string
}

type InvoiceRequestRow = {
  id: string
  client_name?: string | null
  guest_name: string | null
  guest_company_name: string | null
  requested_title: string | null
  request_deadline: string | null
  due_date: string | null
  status: string
  issued_invoice_id: string | null
  issued_invoice_status?: string | null
  reminder_count?: number | null
  reminder_logs?: InvoiceRequestLog[]
  created_at: string
}

type QueueCard = {
  title: string
  count: number
  description: string
  href: string
}

type ClosingCheckRow = {
  id: string
  check_type: string
  entity_type: string
  severity: string
  status: string
  title: string
  description: string
  created_at?: string
}

type CloseSummaryResponse = {
  ok?: boolean
  openCount?: number
  highCount?: number
  checks?: ClosingCheckRow[]
  error?: string
}

function requestProgressLabel(row: InvoiceRequestRow) {
  if (row.issued_invoice_status === "issued") return "発行済み"
  if (row.issued_invoice_status === "draft") return "下書き作成済み"
  if (row.issued_invoice_status === "void") return "請求書無効"
  if (row.status === "viewed") return "確認済み"
  if (row.status === "sent") return "送付済み"
  return row.status || "-"
}

async function getAccessToken() {
  const { data } = await supabase.auth.getSession()
  return data.session?.access_token ?? null
}

function requestMonthKey(row: InvoiceRequestRow) {
  const candidate = row.request_deadline || row.due_date || row.created_at
  return candidate?.slice(0, 7) ?? ""
}

export default function ClosePage() {
  const {
    loading,
    error,
    canViewFinance,
    month,
    todayYmd,
    clients,
    projects,
    contents,
    expenses,
    invoices,
    vendorInvoices,
    projectSummaries,
    refresh,
  } = useProjectWorkspace({ requireAdminSurface: true })
  const [requestLoading, setRequestLoading] = useState(true)
  const [requestError, setRequestError] = useState<string | null>(null)
  const [invoiceRequests, setInvoiceRequests] = useState<InvoiceRequestRow[]>([])
  const [selectedMonth, setSelectedMonth] = useState(month)
  const [closeSummary, setCloseSummary] = useState<CloseSummaryResponse | null>(null)
  const [closeActionBusy, setCloseActionBusy] = useState<string | null>(null)
  const [closeActionMessage, setCloseActionMessage] = useState<string | null>(null)
  const [closeActionError, setCloseActionError] = useState<string | null>(null)

  const clientNameById = useMemo(() => new Map(clients.map((client) => [client.id, client.name])), [clients])
  const projectNameById = useMemo(() => new Map(projects.map((project) => [project.id, project.name])), [projects])
  const monthOptions = useMemo(() => {
    const values = new Set<string>([month, selectedMonth])
    contents.forEach((row) => values.add(getContentBillingMonthYm(row.delivery_month, row.due_client_at)))
    expenses.forEach((row) => values.add((row.occurred_on ?? "").slice(0, 7)))
    invoices.forEach((row) => values.add(row.invoice_month))
    vendorInvoices.forEach((row) => values.add(row.billing_month))
    return [...values].filter(Boolean).sort().reverse()
  }, [contents, expenses, invoices, month, selectedMonth, vendorInvoices])

  const loadRequests = useCallback(async () => {
    setRequestLoading(true)
    setRequestError(null)
    try {
      const token = await getAccessToken()
      if (!token) {
        setRequestError("ログイン状態を確認できませんでした。")
        return
      }
      const res = await fetch("/api/invoice-requests?limit=100", {
        headers: { Authorization: `Bearer ${token}` },
      })
      const json = (await res.json().catch(() => null)) as { ok?: boolean; requests?: InvoiceRequestRow[]; message?: string } | null
      if (!res.ok || !json?.ok) {
        setRequestError(json?.message ?? "請求依頼の取得に失敗しました。")
        return
      }
      setInvoiceRequests(Array.isArray(json.requests) ? json.requests : [])
    } finally {
      setRequestLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!canViewFinance) {
      setRequestLoading(false)
      return
    }
    void loadRequests()
  }, [canViewFinance, loadRequests])

  const loadCloseSummary = useCallback(async () => {
    if (!canViewFinance) return
    const token = await getAccessToken()
    if (!token) return
    const res = await fetch(`/api/close/summary?targetMonth=${encodeURIComponent(selectedMonth)}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    const json = (await res.json().catch(() => null)) as CloseSummaryResponse | null
    if (res.ok && json?.ok) {
      setCloseSummary(json)
      return
    }
    setCloseActionError(json?.error ?? "締めチェックの読み込みに失敗しました。")
  }, [canViewFinance, selectedMonth])

  useEffect(() => {
    void loadCloseSummary()
  }, [loadCloseSummary])

  const runCloseAction = async (key: string, path: string, body: Record<string, unknown> = {}) => {
    setCloseActionBusy(key)
    setCloseActionMessage(null)
    setCloseActionError(null)
    const token = await getAccessToken()
    if (!token) {
      setCloseActionBusy(null)
      setCloseActionError("ログイン状態を確認できませんでした。")
      return
    }
    const res = await fetch(path, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ targetMonth: selectedMonth, ...body }),
    })
    const json = (await res.json().catch(() => null)) as Record<string, unknown> | null
    setCloseActionBusy(null)
    if (!res.ok || json?.ok === false) {
      setCloseActionError(String(json?.error ?? json?.message ?? "処理に失敗しました。"))
      await loadCloseSummary()
      return
    }
    setCloseActionMessage(`${selectedMonth} / ${key} を実行しました。`)
    await Promise.all([loadCloseSummary(), refresh({ silent: true })])
  }

  const monthBillableContents = useMemo(
    () =>
      contents.filter(
        (row) =>
          getContentBillingMonthYm(row.delivery_month, row.due_client_at) === selectedMonth &&
          row.billable_flag &&
          isBillableDoneStatus(row.status)
      ),
    [contents, selectedMonth]
  )
  const unissuedContents = useMemo(
    () => monthBillableContents.filter((row) => !row.invoice_id),
    [monthBillableContents]
  )
  const monthDraftInvoices = useMemo(
    () => invoices.filter((row) => row.invoice_month === selectedMonth && row.status === "draft"),
    [invoices, selectedMonth]
  )
  const monthIssuedInvoices = useMemo(
    () => invoices.filter((row) => row.invoice_month === selectedMonth && row.status === "issued"),
    [invoices, selectedMonth]
  )
  const monthExpenses = useMemo(
    () => expenses.filter((row) => row.occurred_on.startsWith(selectedMonth)),
    [expenses, selectedMonth]
  )
  const missingReceiptExpenses = useMemo(
    () => monthExpenses.filter((row) => !String(row.receipt_path ?? "").trim()),
    [monthExpenses]
  )
  const unlinkedExpenses = useMemo(
    () => monthExpenses.filter((row) => !row.project_id && !row.content_id),
    [monthExpenses]
  )
  const reviewVendorInvoices = useMemo(
    () => vendorInvoices.filter((row) => row.billing_month === selectedMonth && (row.status === "draft" || row.status === "rejected")),
    [selectedMonth, vendorInvoices]
  )
  const payoutPendingInvoices = useMemo(
    () => vendorInvoices.filter((row) => row.billing_month === selectedMonth && (row.status === "submitted" || row.status === "approved")),
    [selectedMonth, vendorInvoices]
  )
  const monthRequests = useMemo(
    () => invoiceRequests.filter((row) => requestMonthKey(row) === selectedMonth),
    [invoiceRequests, selectedMonth]
  )
  const overdueRequests = useMemo(
    () =>
      monthRequests.filter((row) => {
        if (!row.request_deadline || row.issued_invoice_status === "issued") return false
        return row.request_deadline < todayYmd
      }),
    [monthRequests, todayYmd]
  )
  const lowMarginProjects = useMemo(
    () =>
      projectSummaries.filter(
        (summary) => summary.monthlySales > 0 && (summary.grossProfit < 0 || (summary.marginRate ?? 1) < 0.35)
      ),
    [projectSummaries]
  )

  const closeOpenCount =
    unissuedContents.length +
    overdueRequests.length +
    missingReceiptExpenses.length +
    reviewVendorInvoices.length +
    payoutPendingInvoices.length +
    lowMarginProjects.length

  const queueCards: QueueCard[] = [
    {
      title: "請求ドラフト",
      count: monthDraftInvoices.length,
      description: "下書きの確認と発行を進めます。",
      href: "/billing",
    },
    {
      title: "請求依頼期限超過",
      count: overdueRequests.length,
      description: "外部からの請求書回収が止まっている案件です。",
      href: "/billing",
    },
    {
      title: "証憑待ち経費",
      count: missingReceiptExpenses.length,
      description: "領収書パスが未登録の経費です。",
      href: "/expenses",
    },
    {
      title: "粗利警戒",
      count: lowMarginProjects.length,
      description: "粗利率 35% 未満または赤字案件です。",
      href: "/profitability",
    },
    {
      title: "外注確認待ち",
      count: reviewVendorInvoices.length,
      description: "差し戻しと下書き確認が必要な外注請求です。",
      href: "/vendors",
    },
    {
      title: "支払待ち",
      count: payoutPendingInvoices.length,
      description: "提出済み・承認済みで支払処理待ちです。",
      href: "/payouts",
    },
  ]

  if (loading) {
    return <FinanceOpsShell title="Close Cockpit" description="月次締めの未処理を集約しています。">読み込み中...</FinanceOpsShell>
  }

  if (!canViewFinance) {
    return (
      <FinanceOpsShell title="Close Cockpit" description="月次締めの未処理を集約しています。">
        <ProjectSection title="権限不足">この画面は owner / executive_assistant のみ利用できます。</ProjectSection>
      </FinanceOpsShell>
    )
  }

  return (
    <FinanceOpsShell
      title="Close Cockpit"
      description="請求、外注、経費、粗利の未処理を月次締め単位でまとめて確認します。"
      action={
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <select
            value={selectedMonth}
            onChange={(event) => setSelectedMonth(event.target.value)}
            style={{ padding: "10px 12px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--input-bg)", color: "var(--text)" }}
          >
            {monthOptions.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
          <Link href="/billing" style={{ padding: "10px 14px", borderRadius: 10, border: "1px solid var(--border)", textDecoration: "none", color: "var(--text)" }}>
            請求へ
          </Link>
          <Link href="/expenses" style={{ padding: "10px 14px", borderRadius: 10, border: "1px solid var(--border)", textDecoration: "none", color: "var(--text)" }}>
            経費へ
          </Link>
        </div>
      }
    >
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12 }}>
        <ProjectInfoCard label="対象月" value={selectedMonth} />
        <ProjectInfoCard label="未処理合計" value={`${closeOpenCount}件`} accent={closeOpenCount > 0 ? "var(--warning-text)" : undefined} />
        <ProjectInfoCard label="請求ドラフト" value={`${monthDraftInvoices.length}件`} accent={monthDraftInvoices.length > 0 ? "var(--warning-text)" : undefined} />
        <ProjectInfoCard label="未請求コンテンツ" value={`${unissuedContents.length}本`} accent={unissuedContents.length > 0 ? "var(--error-text)" : undefined} />
        <ProjectInfoCard label="請求依頼期限超過" value={`${overdueRequests.length}件`} accent={overdueRequests.length > 0 ? "var(--error-text)" : undefined} />
        <ProjectInfoCard label="未証憑経費" value={`${missingReceiptExpenses.length}件`} accent={missingReceiptExpenses.length > 0 ? "var(--warning-text)" : undefined} />
        <ProjectInfoCard label="支払待ち" value={`${payoutPendingInvoices.length}件`} accent={payoutPendingInvoices.length > 0 ? "var(--warning-text)" : undefined} />
        <ProjectInfoCard label="今月発行済み請求" value={`${monthIssuedInvoices.length}件`} />
      </div>

      {(error || requestError) && (
        <ProjectSection title="読込エラー">
          <div style={{ color: "var(--error-text)" }}>{requestError ?? error}</div>
        </ProjectSection>
      )}

      {(closeActionMessage || closeActionError) && (
        <ProjectSection title="自動化ログ">
          {closeActionMessage ? <div style={{ color: "var(--success-text)" }}>{closeActionMessage}</div> : null}
          {closeActionError ? <div style={{ color: "var(--error-text)" }}>{closeActionError}</div> : null}
        </ProjectSection>
      )}

      <ProjectSection
        title="月次締め自動化"
        description="チェック生成、請求ドラフト、支払ドラフト、freee連携ログ、締め完了判定を対象月単位で実行します。"
      >
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {[
            ["checks", "チェック生成", "/api/close/checks/run", {}],
            ["invoices", "請求ドラフト生成", "/api/invoices/auto-generate", {}],
            ["payouts", "支払ドラフト生成", "/api/payouts/auto-generate", {}],
            ["freee-invoices", "freee請求ログ", "/api/freee/sync/invoices", {}],
            ["freee-expenses", "freee経費ログ", "/api/freee/sync/expenses", {}],
            ["freee-payouts", "freee支払ログ", "/api/freee/sync/payouts", {}],
            ["complete", "締め完了判定", "/api/close/complete", {}],
          ].map(([key, label, path, body]) => (
            <button
              key={String(key)}
              type="button"
              onClick={() => void runCloseAction(String(key), String(path), body as Record<string, unknown>)}
              disabled={closeActionBusy !== null}
              style={{ padding: "9px 12px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--surface-2)", color: "var(--text)", fontWeight: 700 }}
            >
              {closeActionBusy === String(key) ? "実行中..." : String(label)}
            </button>
          ))}
        </div>
        <div style={{ marginTop: 12, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 10 }}>
          <ProjectInfoCard label="open" value={`${closeSummary?.openCount ?? 0}件`} accent={(closeSummary?.openCount ?? 0) > 0 ? "var(--warning-text)" : undefined} />
          <ProjectInfoCard label="high" value={`${closeSummary?.highCount ?? 0}件`} accent={(closeSummary?.highCount ?? 0) > 0 ? "var(--error-text)" : undefined} />
          <ProjectInfoCard label="checks" value={`${closeSummary?.checks?.length ?? 0}件`} />
        </div>
        <div style={{ marginTop: 12, overflowX: "auto" }}>
          <table style={{ ...tableStyle, minWidth: 820 }}>
            <thead>
              <tr>
                <th style={thStyle}>重要度</th>
                <th style={thStyle}>状態</th>
                <th style={thStyle}>種別</th>
                <th style={thStyle}>内容</th>
              </tr>
            </thead>
            <tbody>
              {(closeSummary?.checks ?? []).slice(0, 12).map((row) => (
                <tr key={row.id}>
                  <td style={tdStyle}>{row.severity}</td>
                  <td style={tdStyle}>{row.status}</td>
                  <td style={tdStyle}>{row.check_type}</td>
                  <td style={tdStyle}>{row.title}</td>
                </tr>
              ))}
              {(closeSummary?.checks?.length ?? 0) === 0 ? (
                <tr>
                  <td style={tdStyle} colSpan={4}>まだチェックはありません。</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </ProjectSection>

      <ProjectSection title="締めキュー" description="例外だけを順に潰せるよう、今月の処理待ちをカードでまとめています。">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12 }}>
          {queueCards.map((card) => (
            <Link
              key={card.title}
              href={card.href}
              style={{
                border: "1px solid var(--border)",
                borderRadius: 14,
                padding: 14,
                textDecoration: "none",
                color: "var(--text)",
                background: "var(--surface-2)",
                display: "grid",
                gap: 6,
              }}
            >
              <div style={{ fontSize: 12, color: "var(--muted)" }}>{card.title}</div>
              <div style={{ fontSize: 24, fontWeight: 800 }}>{card.count}</div>
              <div style={{ fontSize: 12, color: "var(--muted)", lineHeight: 1.6 }}>{card.description}</div>
            </Link>
          ))}
        </div>
      </ProjectSection>

      <div style={{ display: "grid", gap: 16, gridTemplateColumns: "minmax(0, 1.2fr) minmax(0, 0.8fr)" }}>
        <ProjectSection title="未請求コンテンツ" description="delivery_month 基準で、請求対象なのに invoice_id が未設定の行です。">
          <div style={{ overflowX: "auto" }}>
            <table style={{ ...tableStyle, minWidth: 760 }}>
              <thead>
                <tr>
                  <th style={thStyle}>取引先</th>
                  <th style={thStyle}>案件</th>
                  <th style={thStyle}>コンテンツ</th>
                  <th style={thStyle}>納品状態</th>
                  <th style={thStyle}>金額</th>
                </tr>
              </thead>
              <tbody>
                {unissuedContents.slice(0, 12).map((row) => (
                  <tr key={row.id}>
                    <td style={tdStyle}>{textOrDash(clientNameById.get(row.client_id))}</td>
                    <td style={tdStyle}>{textOrDash(projectNameById.get(row.project_id ?? "") ?? row.project_name)}</td>
                    <td style={tdStyle}>{row.title}</td>
                    <td style={tdStyle}>{row.status}</td>
                    <td style={tdStyle}>{formatCurrency(row.unit_price)}</td>
                  </tr>
                ))}
                {unissuedContents.length === 0 ? (
                  <tr>
                    <td style={tdStyle} colSpan={5}>今月の請求漏れ候補はありません。</td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </ProjectSection>

        <ProjectSection title="経費アラート" description="経費は案件直結のものだけを前提に、証憑不足と未紐付けを先に潰します。">
          <div style={{ display: "grid", gap: 10 }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 12, padding: 12, border: "1px solid var(--border)", borderRadius: 12 }}>
              <span>今月経費件数</span>
              <strong>{monthExpenses.length}件</strong>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 12, padding: 12, border: "1px solid var(--border)", borderRadius: 12 }}>
              <span>証憑待ち</span>
              <strong style={{ color: missingReceiptExpenses.length > 0 ? "var(--warning-text)" : undefined }}>{missingReceiptExpenses.length}件</strong>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 12, padding: 12, border: "1px solid var(--border)", borderRadius: 12 }}>
              <span>案件未紐付け</span>
              <strong style={{ color: unlinkedExpenses.length > 0 ? "var(--warning-text)" : undefined }}>{unlinkedExpenses.length}件</strong>
            </div>
            <Link href="/expenses" style={{ marginTop: 4, color: "var(--primary)", textDecoration: "none", fontWeight: 700 }}>
              経費一覧で処理する
            </Link>
          </div>
        </ProjectSection>
      </div>

      <div style={{ display: "grid", gap: 16, gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)" }}>
        <ProjectSection title="期限超過の請求依頼" description="発行済みになる前に期限を超えた依頼だけを表示します。">
          {requestLoading ? (
            <div style={{ color: "var(--muted)" }}>請求依頼を読み込み中...</div>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table style={{ ...tableStyle, minWidth: 720 }}>
                <thead>
                  <tr>
                    <th style={thStyle}>宛先</th>
                    <th style={thStyle}>件名</th>
                    <th style={thStyle}>期限</th>
                    <th style={thStyle}>進捗</th>
                    <th style={thStyle}>催促</th>
                  </tr>
                </thead>
                <tbody>
                  {overdueRequests.slice(0, 10).map((row) => (
                    <tr key={row.id}>
                      <td style={tdStyle}>{row.client_name || row.guest_company_name || row.guest_name || "-"}</td>
                      <td style={tdStyle}>{row.requested_title || "請求書のご提出依頼"}</td>
                      <td style={tdStyle}>{textOrDash(row.request_deadline)}</td>
                      <td style={tdStyle}>{requestProgressLabel(row)}</td>
                      <td style={tdStyle}>{row.reminder_count ?? row.reminder_logs?.length ?? 0}回</td>
                    </tr>
                  ))}
                  {overdueRequests.length === 0 ? (
                    <tr>
                      <td style={tdStyle} colSpan={5}>期限超過の請求依頼はありません。</td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          )}
        </ProjectSection>

        <ProjectSection title="粗利警戒案件" description="案件別粗利で赤字、または粗利率 35% 未満の案件を抽出します。">
          <div style={{ overflowX: "auto" }}>
            <table style={{ ...tableStyle, minWidth: 720 }}>
              <thead>
                <tr>
                  <th style={thStyle}>案件</th>
                  <th style={thStyle}>売上</th>
                  <th style={thStyle}>経費</th>
                  <th style={thStyle}>粗利</th>
                  <th style={thStyle}>粗利率</th>
                </tr>
              </thead>
              <tbody>
                {lowMarginProjects.slice(0, 10).map((summary) => (
                  <tr key={summary.project.id}>
                    <td style={tdStyle}>
                      <Link href={`/profitability?projectId=${encodeURIComponent(summary.project.id)}`} style={{ color: "var(--primary)", textDecoration: "none", fontWeight: 700 }}>
                        {summary.project.name}
                      </Link>
                    </td>
                    <td style={tdStyle}>{formatCurrency(summary.monthlySales)}</td>
                    <td style={tdStyle}>{formatCurrency(summary.monthlyExpenses)}</td>
                    <td style={{ ...tdStyle, color: summary.grossProfit < 0 ? "var(--error-text)" : tdStyle.color }}>{formatCurrency(summary.grossProfit)}</td>
                    <td style={tdStyle}>{summary.marginRate == null ? "-" : `${Math.round(summary.marginRate * 100)}%`}</td>
                  </tr>
                ))}
                {lowMarginProjects.length === 0 ? (
                  <tr>
                    <td style={tdStyle} colSpan={5}>今月の粗利警戒案件はありません。</td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </ProjectSection>
      </div>
    </FinanceOpsShell>
  )
}
