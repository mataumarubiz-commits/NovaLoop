"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { supabase } from "@/lib/supabase"
import { useAuthOrg } from "@/hooks/useAuthOrg"
import { hasOrgPermission } from "@/lib/orgRolePermissions"

type ClientOption = {
  id: string
  name: string
}

type TemplateRow = {
  id: string
  client_id: string | null
  name: string
  default_title: string | null
  default_project_name: string | null
  default_unit_price: number | null
  default_billable_flag: boolean | null
  default_status: string | null
  default_due_offset_days: number | null
  sort_order: number
  created_at?: string
}

type FormState = {
  id: string | null
  clientId: string
  name: string
  defaultTitle: string
  defaultProjectName: string
  defaultUnitPrice: string
  defaultBillableFlag: boolean
  defaultStatus: string
  defaultDueOffsetDays: string
}

const emptyForm: FormState = {
  id: null,
  clientId: "",
  name: "",
  defaultTitle: "",
  defaultProjectName: "",
  defaultUnitPrice: "",
  defaultBillableFlag: true,
  defaultStatus: "billable",
  defaultDueOffsetDays: "0",
}

const cardStyle: React.CSSProperties = {
  background: "var(--surface)",
  borderRadius: 16,
  border: "1px solid var(--border)",
  padding: 20,
}

async function getAccessToken() {
  const session = await supabase.auth.getSession()
  if (session.data.session?.access_token) return session.data.session.access_token
  const refreshed = await supabase.auth.refreshSession()
  return refreshed.data.session?.access_token ?? null
}

export default function TemplatesSettingsPage() {
  const { activeOrgId, role, permissions, loading, needsOnboarding } = useAuthOrg({ redirectToOnboarding: true })
  const canEdit = hasOrgPermission(role, permissions, "contents_write")
  const [clients, setClients] = useState<ClientOption[]>([])
  const [templates, setTemplates] = useState<TemplateRow[]>([])
  const [clientFilter, setClientFilter] = useState("")
  const [form, setForm] = useState<FormState>(emptyForm)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  const callApi = useCallback(async (path: string, init?: RequestInit) => {
    const token = await getAccessToken()
    if (!token) {
      throw new Error("認証に失敗しました。ログインし直してください。")
    }
    const response = await fetch(path, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        ...(init?.headers ?? {}),
      },
    })
    const json = await response.json().catch(() => null)
    if (!response.ok || !json?.ok) {
      throw new Error(json?.message ?? "テンプレート操作に失敗しました。")
    }
    return json
  }, [])

  const loadClients = useCallback(async () => {
    if (!activeOrgId) return
    const { data, error: clientError } = await supabase
      .from("clients")
      .select("id, name")
      .eq("org_id", activeOrgId)
      .order("name", { ascending: true })
    if (clientError) {
      setClients([])
      return
    }
    setClients((data ?? []) as ClientOption[])
  }, [activeOrgId])

  const loadTemplates = useCallback(async () => {
    const query = clientFilter && clientFilter !== "__shared__" ? `?clientId=${encodeURIComponent(clientFilter)}` : ""
    const json = await callApi(`/api/content-templates${query}`)
    setTemplates((json.templates ?? []) as TemplateRow[])
  }, [callApi, clientFilter])

  useEffect(() => {
    if (!activeOrgId || !canEdit) return
    void loadClients()
    void loadTemplates()
  }, [activeOrgId, canEdit, loadClients, loadTemplates])

  const clientNameById = useMemo(() => new Map(clients.map((client) => [client.id, client.name])), [clients])

  const startEdit = (template: TemplateRow) => {
    setForm({
      id: template.id,
      clientId: template.client_id ?? "",
      name: template.name,
      defaultTitle: template.default_title ?? "",
      defaultProjectName: template.default_project_name ?? "",
      defaultUnitPrice: String(template.default_unit_price ?? 0),
      defaultBillableFlag: template.default_billable_flag !== false,
      defaultStatus: template.default_status ?? "billable",
      defaultDueOffsetDays: String(template.default_due_offset_days ?? 0),
    })
    setError(null)
    setSuccess(null)
  }

  const resetForm = () => setForm(emptyForm)

  const saveTemplate = async () => {
    setBusy(true)
    setError(null)
    setSuccess(null)
    try {
      if (!form.name.trim()) {
        throw new Error("テンプレート名を入力してください。")
      }

      const payload = {
        id: form.id,
        clientId: form.clientId || null,
        name: form.name.trim(),
        defaultTitle: form.defaultTitle.trim(),
        defaultProjectName: form.defaultProjectName.trim(),
        defaultUnitPrice: Number(form.defaultUnitPrice || 0),
        defaultBillableFlag: form.defaultBillableFlag,
        defaultStatus: form.defaultStatus,
        defaultDueOffsetDays: Number(form.defaultDueOffsetDays || 0),
        sortOrder: form.id
          ? templates.find((template) => template.id === form.id)?.sort_order ?? Date.now()
          : templates.length === 0
            ? 100
            : Math.max(...templates.map((template) => template.sort_order)) + 100,
      }

      if (form.id) {
        await callApi("/api/content-templates", { method: "PATCH", body: JSON.stringify(payload) })
        setSuccess("テンプレートを更新しました。")
      } else {
        await callApi("/api/content-templates", { method: "POST", body: JSON.stringify(payload) })
        setSuccess("テンプレートを追加しました。")
      }

      resetForm()
      await loadTemplates()
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "テンプレート操作に失敗しました。")
    } finally {
      setBusy(false)
    }
  }

  const moveTemplate = async (template: TemplateRow, direction: -1 | 1) => {
    const index = templates.findIndex((row) => row.id === template.id)
    const swapTarget = templates[index + direction]
    if (!swapTarget) return

    setBusy(true)
    setError(null)
    setSuccess(null)
    try {
      await callApi("/api/content-templates", {
        method: "PATCH",
        body: JSON.stringify({ id: template.id, sortOrder: swapTarget.sort_order }),
      })
      await callApi("/api/content-templates", {
        method: "PATCH",
        body: JSON.stringify({ id: swapTarget.id, sortOrder: template.sort_order }),
      })
      await loadTemplates()
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "並び順の更新に失敗しました。")
    } finally {
      setBusy(false)
    }
  }

  const deleteTemplate = async (template: TemplateRow) => {
    if (typeof window !== "undefined" && !window.confirm(`「${template.name}」を削除しますか。`)) {
      return
    }

    setBusy(true)
    setError(null)
    setSuccess(null)
    try {
      await callApi(`/api/content-templates?id=${encodeURIComponent(template.id)}`, { method: "DELETE" })
      if (form.id === template.id) {
        resetForm()
      }
      setSuccess("テンプレートを削除しました。")
      await loadTemplates()
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "テンプレートの削除に失敗しました。")
    } finally {
      setBusy(false)
    }
  }

  if (loading) return <div style={{ padding: 32, color: "var(--muted)" }}>読み込み中...</div>
  if (!activeOrgId || needsOnboarding) return <div style={{ padding: 32, color: "var(--muted)" }}>ワークスペースを選択してください。</div>
  if (!canEdit) return <div style={{ padding: 32, color: "var(--muted)" }}>テンプレート管理権限がありません。</div>

  return (
    <div style={{ minHeight: "100vh", background: "var(--bg-grad)", padding: "32px 24px 64px" }}>
      <div style={{ maxWidth: 1040, margin: "0 auto", display: "grid", gap: 16 }}>
        <header style={{ display: "grid", gap: 8 }}>
          <div style={{ display: "flex", gap: 8, fontSize: 12, color: "var(--muted)" }}>
            <Link href="/settings" style={{ color: "var(--primary)", textDecoration: "none", fontWeight: 600 }}>
              Settings
            </Link>
            <span>/</span>
            <span>テンプレート</span>
          </div>
          <h1 style={{ margin: 0, fontSize: 28, color: "var(--text)" }}>コンテンツテンプレート</h1>
          <p style={{ margin: 0, color: "var(--muted)", lineHeight: 1.8 }}>
            一覧・追加・編集・削除・並び順をこの画面に集約しました。作成したテンプレートは
            <Link href="/contents" style={{ marginLeft: 4, color: "var(--primary)", textDecoration: "none", fontWeight: 600 }}>
              /contents
            </Link>
            のテンプレート導線から使えます。
          </p>
        </header>

        {error ? (
          <section style={{ ...cardStyle, background: "var(--error-bg)", borderColor: "var(--error-border)", color: "var(--error-text)" }}>{error}</section>
        ) : null}
        {success ? (
          <section style={{ ...cardStyle, background: "var(--success-bg)", borderColor: "var(--success-border)", color: "var(--success-text)" }}>{success}</section>
        ) : null}

        <div style={{ display: "grid", gridTemplateColumns: "minmax(320px, 360px) minmax(0, 1fr)", gap: 16 }}>
          <section style={cardStyle}>
            <h2 style={{ marginTop: 0, fontSize: 18 }}>{form.id ? "テンプレート編集" : "テンプレート追加"}</h2>
            <div style={{ display: "grid", gap: 12 }}>
              <label style={{ display: "grid", gap: 6 }}>
                <span>クライアント</span>
                <select
                  value={form.clientId}
                  onChange={(event) => setForm((prev) => ({ ...prev, clientId: event.target.value }))}
                  style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--border)", background: "var(--input-bg)" }}
                >
                  <option value="">共通テンプレート</option>
                  {clients.map((client) => (
                    <option key={client.id} value={client.id}>
                      {client.name}
                    </option>
                  ))}
                </select>
              </label>
              <label style={{ display: "grid", gap: 6 }}>
                <span>テンプレート名</span>
                <input
                  value={form.name}
                  onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))}
                  style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--border)", background: "var(--input-bg)" }}
                />
              </label>
              <label style={{ display: "grid", gap: 6 }}>
                <span>初期タイトル</span>
                <input
                  value={form.defaultTitle}
                  onChange={(event) => setForm((prev) => ({ ...prev, defaultTitle: event.target.value }))}
                  style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--border)", background: "var(--input-bg)" }}
                />
              </label>
              <label style={{ display: "grid", gap: 6 }}>
                <span>初期案件名</span>
                <input
                  value={form.defaultProjectName}
                  onChange={(event) => setForm((prev) => ({ ...prev, defaultProjectName: event.target.value }))}
                  style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--border)", background: "var(--input-bg)" }}
                />
              </label>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <label style={{ display: "grid", gap: 6 }}>
                  <span>初期単価</span>
                  <input
                    type="number"
                    min="0"
                    value={form.defaultUnitPrice}
                    onChange={(event) => setForm((prev) => ({ ...prev, defaultUnitPrice: event.target.value }))}
                    style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--border)", background: "var(--input-bg)" }}
                  />
                </label>
                <label style={{ display: "grid", gap: 6 }}>
                  <span>納期オフセット</span>
                  <input
                    type="number"
                    value={form.defaultDueOffsetDays}
                    onChange={(event) => setForm((prev) => ({ ...prev, defaultDueOffsetDays: event.target.value }))}
                    style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--border)", background: "var(--input-bg)" }}
                  />
                </label>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 12, alignItems: "end" }}>
                <label style={{ display: "grid", gap: 6 }}>
                  <span>初期ステータス</span>
                  <input
                    value={form.defaultStatus}
                    onChange={(event) => setForm((prev) => ({ ...prev, defaultStatus: event.target.value }))}
                    style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--border)", background: "var(--input-bg)" }}
                  />
                </label>
                <label style={{ display: "flex", gap: 8, alignItems: "center", paddingBottom: 10 }}>
                  <input
                    type="checkbox"
                    checked={form.defaultBillableFlag}
                    onChange={(event) => setForm((prev) => ({ ...prev, defaultBillableFlag: event.target.checked }))}
                  />
                  <span>請求対象</span>
                </label>
              </div>
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 16 }}>
              <button
                type="button"
                onClick={() => void saveTemplate()}
                disabled={busy}
                style={{ padding: "10px 14px", borderRadius: 10, border: "none", background: "var(--button-primary-bg)", color: "var(--primary-contrast)", fontWeight: 700 }}
              >
                {busy ? "保存中..." : form.id ? "更新する" : "追加する"}
              </button>
              <button
                type="button"
                onClick={resetForm}
                disabled={busy}
                style={{ padding: "10px 14px", borderRadius: 10, border: "1px solid var(--border)", background: "var(--surface-2)", fontWeight: 700 }}
              >
                クリア
              </button>
            </div>
          </section>

          <section style={cardStyle}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
              <div>
                <h2 style={{ margin: 0, fontSize: 18 }}>テンプレート一覧</h2>
                <p style={{ margin: "6px 0 0", color: "var(--muted)", fontSize: 13 }}>
                  並び順は上下ボタンで調整できます。
                </p>
              </div>
              <label style={{ display: "grid", gap: 6, minWidth: 220 }}>
                <span style={{ fontSize: 12, color: "var(--muted)" }}>絞り込み</span>
                <select
                  value={clientFilter}
                  onChange={(event) => setClientFilter(event.target.value)}
                  style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--border)", background: "var(--input-bg)" }}
                >
                  <option value="">すべて</option>
                  <option value="__shared__">共通テンプレート</option>
                  {clients.map((client) => (
                    <option key={client.id} value={client.id}>
                      {client.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <div style={{ display: "grid", gap: 10, marginTop: 16 }}>
              {(clientFilter === "__shared__" ? templates.filter((template) => !template.client_id) : templates).map((template, index, list) => (
                <div
                  key={template.id}
                  style={{
                    border: "1px solid var(--border)",
                    borderRadius: 14,
                    padding: 14,
                    background: "var(--surface-2)",
                    display: "grid",
                    gap: 10,
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "start" }}>
                    <div style={{ display: "grid", gap: 4 }}>
                      <strong style={{ color: "var(--text)" }}>{template.name}</strong>
                      <span style={{ fontSize: 12, color: "var(--muted)" }}>
                        {template.client_id ? clientNameById.get(template.client_id) ?? "未設定クライアント" : "共通テンプレート"}
                        {" / "}
                        単価 {Number(template.default_unit_price ?? 0).toLocaleString("ja-JP")} 円
                        {" / "}
                        納期 {Number(template.default_due_offset_days ?? 0)} 日
                      </span>
                    </div>
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                      <button type="button" onClick={() => startEdit(template)} style={{ padding: "8px 10px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--surface)" }}>
                        編集
                      </button>
                      <button type="button" onClick={() => void moveTemplate(template, -1)} disabled={busy || index === 0} style={{ padding: "8px 10px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--surface)" }}>
                        ↑
                      </button>
                      <button type="button" onClick={() => void moveTemplate(template, 1)} disabled={busy || index === list.length - 1} style={{ padding: "8px 10px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--surface)" }}>
                        ↓
                      </button>
                      <button type="button" onClick={() => void deleteTemplate(template)} disabled={busy} style={{ padding: "8px 10px", borderRadius: 8, border: "1px solid var(--error-border)", background: "var(--error-bg)", color: "var(--error-text)" }}>
                        削除
                      </button>
                    </div>
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 8, fontSize: 13 }}>
                    <div>
                      <div style={{ color: "var(--muted)", marginBottom: 4 }}>初期タイトル</div>
                      <div style={{ color: "var(--text)" }}>{template.default_title || "-"}</div>
                    </div>
                    <div>
                      <div style={{ color: "var(--muted)", marginBottom: 4 }}>初期案件名</div>
                      <div style={{ color: "var(--text)" }}>{template.default_project_name || "-"}</div>
                    </div>
                    <div>
                      <div style={{ color: "var(--muted)", marginBottom: 4 }}>初期ステータス</div>
                      <div style={{ color: "var(--text)" }}>{template.default_status || "-"}</div>
                    </div>
                    <div>
                      <div style={{ color: "var(--muted)", marginBottom: 4 }}>請求対象</div>
                      <div style={{ color: "var(--text)" }}>{template.default_billable_flag === false ? "対象外" : "対象"}</div>
                    </div>
                  </div>
                </div>
              ))}
              {templates.length === 0 ? <div style={{ color: "var(--muted)" }}>テンプレートはまだありません。</div> : null}
            </div>
          </section>
        </div>
      </div>
    </div>
  )
}
