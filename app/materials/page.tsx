"use client"

import { useMemo, useState } from "react"
import { useSearchParams } from "next/navigation"
import { ProjectInfoCard, ProjectSection, ProjectShell } from "@/components/project/ProjectShell"
import {
  buttonPrimaryStyle,
  formatDateTime,
  inputStyle,
  tableStyle,
  tdStyle,
  textareaStyle,
  textOrDash,
  thStyle,
} from "@/components/project/projectPageStyles"
import { useProjectWorkspace } from "@/hooks/useProjectWorkspace"
import { ASSET_TYPE_LABELS } from "@/lib/projectWorkspace"
import { supabase } from "@/lib/supabase"

const REVIEW_STATUS_LABELS: Record<string, string> = {
  active: "進行中",
  approved: "承認済み",
  rejected: "差し戻し",
  archived: "アーカイブ",
}

function nextVersion(versions: number[]) {
  return versions.length > 0 ? Math.max(...versions) + 1 : 1
}

export default function MaterialsPage() {
  const searchParams = useSearchParams()
  const initialProjectId = searchParams.get("projectId") ?? ""
  const {
    loading,
    error,
    canEdit,
    orgId,
    projects,
    contents,
    assets,
    refresh,
  } = useProjectWorkspace()

  const [projectFilter, setProjectFilter] = useState(initialProjectId)
  const [typeFilter, setTypeFilter] = useState("")
  const [reviewFilter, setReviewFilter] = useState("")
  const [uploadFile, setUploadFile] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const [uiError, setUiError] = useState<string | null>(null)
  const [uiSuccess, setUiSuccess] = useState<string | null>(null)
  const [form, setForm] = useState({
    projectId: initialProjectId,
    contentId: "",
    assetType: "raw",
    title: "",
    externalUrl: "",
    reviewStatus: "active",
    note: "",
  })

  const projectNameById = useMemo(() => new Map(projects.map((project) => [project.id, project.name])), [projects])
  const contentTitleById = useMemo(() => new Map(contents.map((content) => [content.id, content.title])), [contents])

  const filteredAssets = useMemo(() => {
    return assets
      .filter((asset) => !projectFilter || asset.project_id === projectFilter)
      .filter((asset) => !typeFilter || asset.asset_type === typeFilter)
      .filter((asset) => !reviewFilter || asset.review_status === reviewFilter)
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
  }, [assets, projectFilter, reviewFilter, typeFilter])

  const summary = useMemo(() => {
    return filteredAssets.reduce(
      (acc, asset) => {
        acc.total += 1
        if (asset.review_status === "approved") acc.approved += 1
        if (asset.review_status === "rejected") acc.rejected += 1
        if (asset.asset_type === "final") acc.final += 1
        return acc
      },
      { total: 0, approved: 0, rejected: 0, final: 0 }
    )
  }, [filteredAssets])

  const projectContents = useMemo(
    () => contents.filter((content) => content.project_id === form.projectId),
    [contents, form.projectId]
  )

  const createAsset = async () => {
    if (!canEdit || !orgId) return
    if (!form.projectId || !form.title.trim()) {
      setUiError("案件とタイトルを入力してください。")
      return
    }
    if (!uploadFile && !form.externalUrl.trim()) {
      setUiError("ファイルアップロードまたは URL のどちらかを設定してください。")
      return
    }

    setBusy(true)
    setUiError(null)

    let storagePath: string | null = null
    if (uploadFile) {
      const ext = uploadFile.name.split(".").pop() || "bin"
      storagePath = `${orgId}/projects/${form.projectId}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`
      const { error: uploadError } = await supabase.storage.from("project-assets").upload(storagePath, uploadFile, { upsert: false })
      if (uploadError) {
        setBusy(false)
        setUiError(`ファイルアップロードに失敗しました: ${uploadError.message}`)
        return
      }
    }

    const versionNo = nextVersion(
      assets
        .filter(
          (asset) =>
            asset.project_id === form.projectId &&
            asset.content_id === (form.contentId || null) &&
            asset.asset_type === form.assetType &&
            asset.title === form.title.trim()
        )
        .map((asset) => Number(asset.version_no || 0))
    )

    const { error: insertError } = await supabase.from("material_assets").insert({
      id: crypto.randomUUID(),
      org_id: orgId,
      project_id: form.projectId,
      content_id: form.contentId || null,
      asset_type: form.assetType,
      title: form.title.trim(),
      storage_path: storagePath,
      external_url: form.externalUrl.trim() || null,
      version_no: versionNo,
      review_status: form.reviewStatus,
      note: form.note.trim() || null,
    })
    setBusy(false)

    if (insertError) {
      setUiError(`素材登録に失敗しました: ${insertError.message}`)
      return
    }

    setUiSuccess("素材を登録しました。")
    setForm((prev) => ({
      ...prev,
      contentId: "",
      title: "",
      externalUrl: "",
      reviewStatus: "active",
      note: "",
    }))
    setUploadFile(null)
    await refresh()
  }

  const updateReviewStatus = async (assetId: string, reviewStatus: string) => {
    if (!canEdit || !orgId) return
    const { error: updateError } = await supabase
      .from("material_assets")
      .update({ review_status: reviewStatus })
      .eq("id", assetId)
      .eq("org_id", orgId)
    if (updateError) {
      setUiError(`レビュー状態の更新に失敗しました: ${updateError.message}`)
      return
    }
    await refresh()
  }

  return (
    <ProjectShell title="素材管理" description="raw / script / draft / final などの素材とレビュー状況を横断管理します。">
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12 }}>
        <ProjectInfoCard label="素材数" value={`${summary.total}件`} />
        <ProjectInfoCard label="承認済み" value={`${summary.approved}件`} accent={summary.approved > 0 ? "#166534" : undefined} />
        <ProjectInfoCard label="差し戻し" value={`${summary.rejected}件`} accent={summary.rejected > 0 ? "#b91c1c" : undefined} />
        <ProjectInfoCard label="final" value={`${summary.final}件`} />
      </div>

      <ProjectSection title="絞り込み" description="URL から `projectId` を受けると、その案件で初期表示します。">
        <div style={{ display: "grid", gap: 10, gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))" }}>
          <label style={{ display: "grid", gap: 6 }}>
            <span>案件</span>
            <select value={projectFilter} onChange={(event) => setProjectFilter(event.target.value)} style={inputStyle}>
              <option value="">すべて</option>
              {projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))}
            </select>
          </label>
          <label style={{ display: "grid", gap: 6 }}>
            <span>種別</span>
            <select value={typeFilter} onChange={(event) => setTypeFilter(event.target.value)} style={inputStyle}>
              <option value="">すべて</option>
              {Object.entries(ASSET_TYPE_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label style={{ display: "grid", gap: 6 }}>
            <span>レビュー</span>
            <select value={reviewFilter} onChange={(event) => setReviewFilter(event.target.value)} style={inputStyle}>
              <option value="">すべて</option>
              {Object.entries(REVIEW_STATUS_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
        </div>
      </ProjectSection>

      {canEdit ? (
        <ProjectSection title="素材登録" description="ファイルは `project-assets` バケットへ保存し、外部 URL でも登録できます。">
          <div style={{ display: "grid", gap: 10, gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))" }}>
            <label style={{ display: "grid", gap: 6 }}>
              <span>案件</span>
              <select value={form.projectId} onChange={(event) => setForm((prev) => ({ ...prev, projectId: event.target.value, contentId: "" }))} style={inputStyle}>
                <option value="">選択してください</option>
                {projects.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.name}
                  </option>
                ))}
              </select>
            </label>
            <label style={{ display: "grid", gap: 6 }}>
              <span>コンテンツ</span>
              <select value={form.contentId} onChange={(event) => setForm((prev) => ({ ...prev, contentId: event.target.value }))} style={inputStyle}>
                <option value="">未設定</option>
                {projectContents.map((content) => (
                  <option key={content.id} value={content.id}>
                    {content.title}
                  </option>
                ))}
              </select>
            </label>
            <label style={{ display: "grid", gap: 6 }}>
              <span>種別</span>
              <select value={form.assetType} onChange={(event) => setForm((prev) => ({ ...prev, assetType: event.target.value }))} style={inputStyle}>
                {Object.entries(ASSET_TYPE_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label style={{ display: "grid", gap: 6 }}>
              <span>レビュー状態</span>
              <select value={form.reviewStatus} onChange={(event) => setForm((prev) => ({ ...prev, reviewStatus: event.target.value }))} style={inputStyle}>
                {Object.entries(REVIEW_STATUS_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label style={{ display: "grid", gap: 6, gridColumn: "1 / -1" }}>
              <span>タイトル</span>
              <input value={form.title} onChange={(event) => setForm((prev) => ({ ...prev, title: event.target.value }))} style={inputStyle} />
            </label>
            <label style={{ display: "grid", gap: 6 }}>
              <span>ファイル</span>
              <input type="file" onChange={(event) => setUploadFile(event.target.files?.[0] ?? null)} style={inputStyle} />
            </label>
            <label style={{ display: "grid", gap: 6 }}>
              <span>外部 URL</span>
              <input value={form.externalUrl} onChange={(event) => setForm((prev) => ({ ...prev, externalUrl: event.target.value }))} style={inputStyle} />
            </label>
            <label style={{ display: "grid", gap: 6, gridColumn: "1 / -1" }}>
              <span>メモ</span>
              <textarea value={form.note} onChange={(event) => setForm((prev) => ({ ...prev, note: event.target.value }))} style={textareaStyle} />
            </label>
          </div>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center", marginTop: 12 }}>
            <button type="button" onClick={() => void createAsset()} disabled={busy} style={buttonPrimaryStyle}>
              {busy ? "保存中..." : "素材を登録"}
            </button>
            {uiError ? <span style={{ color: "#b91c1c", fontSize: 13 }}>{uiError}</span> : null}
            {uiSuccess ? <span style={{ color: "#166534", fontSize: 13 }}>{uiSuccess}</span> : null}
          </div>
        </ProjectSection>
      ) : null}

      <ProjectSection title="素材一覧" description="同一タイトル・同一種別で再登録した場合は、版数を自動で繰り上げます。">
        {loading ? <div>読み込み中...</div> : null}
        {error ? <div style={{ color: "#b91c1c" }}>{error}</div> : null}
        {!loading ? (
          <div style={{ overflowX: "auto" }}>
            <table style={{ ...tableStyle, minWidth: 1200 }}>
              <thead>
                <tr>
                  <th style={thStyle}>登録日</th>
                  <th style={thStyle}>案件</th>
                  <th style={thStyle}>コンテンツ</th>
                  <th style={thStyle}>種別</th>
                  <th style={thStyle}>タイトル</th>
                  <th style={thStyle}>版</th>
                  <th style={thStyle}>レビュー</th>
                  <th style={thStyle}>リンク</th>
                  <th style={thStyle}>メモ</th>
                </tr>
              </thead>
              <tbody>
                {filteredAssets.map((asset) => {
                  const href = asset.storage_path
                    ? `/api/project-assets?path=${encodeURIComponent(asset.storage_path)}`
                    : asset.external_url || ""
                  return (
                    <tr key={asset.id}>
                      <td style={tdStyle}>{formatDateTime(asset.created_at)}</td>
                      <td style={tdStyle}>{textOrDash(projectNameById.get(asset.project_id))}</td>
                      <td style={tdStyle}>{textOrDash(contentTitleById.get(asset.content_id ?? ""))}</td>
                      <td style={tdStyle}>{ASSET_TYPE_LABELS[asset.asset_type] ?? asset.asset_type}</td>
                      <td style={tdStyle}>{asset.title}</td>
                      <td style={tdStyle}>v{asset.version_no}</td>
                      <td style={tdStyle}>
                        {canEdit ? (
                          <select value={asset.review_status} onChange={(event) => void updateReviewStatus(asset.id, event.target.value)} style={{ ...inputStyle, padding: "6px 8px" }}>
                            {Object.entries(REVIEW_STATUS_LABELS).map(([value, label]) => (
                              <option key={value} value={value}>
                                {label}
                              </option>
                            ))}
                          </select>
                        ) : (
                          REVIEW_STATUS_LABELS[asset.review_status] ?? asset.review_status
                        )}
                      </td>
                      <td style={tdStyle}>
                        {href ? (
                          <a href={href} target="_blank" rel="noreferrer" style={{ color: "var(--primary)", fontWeight: 700, textDecoration: "none" }}>
                            開く
                          </a>
                        ) : (
                          "-"
                        )}
                      </td>
                      <td style={tdStyle}>{textOrDash(asset.note)}</td>
                    </tr>
                  )
                })}
                {filteredAssets.length === 0 ? (
                  <tr>
                    <td colSpan={9} style={tdStyle}>
                      該当する素材はありません。
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        ) : null}
      </ProjectSection>
    </ProjectShell>
  )
}
