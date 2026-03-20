"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import Link from "next/link"
import NextImage from "next/image"
import { useParams } from "next/navigation"
import { useEditor, EditorContent, type JSONContent } from "@tiptap/react"
import { BubbleMenu } from "@tiptap/react/menus"
import StarterKit from "@tiptap/starter-kit"
import LinkExtension from "@tiptap/extension-link"
import Image from "@tiptap/extension-image"
import HorizontalRule from "@tiptap/extension-horizontal-rule"
import TaskList from "@tiptap/extension-task-list"
import TaskItem from "@tiptap/extension-task-item"
import * as Diff from "diff"
import type { ApplyAiResultDetail } from "@/lib/aiClientEvents"
import { Embed } from "@/lib/embedExtension"
import { CommentHighlightExtension, commentHighlightPluginKey } from "@/lib/commentHighlightExtension"
import { titleToSlug } from "@/lib/slug"
import { supabase } from "@/lib/supabase"
import { useAuthOrg } from "@/hooks/useAuthOrg"

const DEBOUNCE_MS = 1000
const IMAGE_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp"]

function getPlainTextFromJson(node: JSONContent | null | undefined): string {
  if (!node) return ""
  if (node.type === "text" && typeof node.text === "string") {
    return node.text
  }
  if (Array.isArray(node.content)) {
    return node.content.map((child) => getPlainTextFromJson(child)).join(" ")
  }
  return ""
}

/** 目次用: doc から h1/h2/h3 を抽出 */
function getHeadingsFromJson(node: JSONContent | null | undefined): { level: number; text: string }[] {
  const out: { level: number; text: string }[] = []
  if (!node) return out
  if (node.type === "heading" && typeof node.attrs?.level === "number" && node.attrs.level >= 1 && node.attrs.level <= 3) {
    const text = Array.isArray(node.content) ? node.content.map((c) => (c as { text?: string }).text ?? "").join("").trim() : ""
    out.push({ level: node.attrs.level as 1 | 2 | 3, text: text || "無題" })
  }
  if (Array.isArray(node.content)) {
    for (const child of node.content) {
      out.push(...getHeadingsFromJson(child as JSONContent))
    }
  }
  return out
}

function sanitizeJsonContent(node: unknown): JSONContent {
  const fallbackDoc: JSONContent = { type: "doc", content: [{ type: "paragraph" }] }
  if (!node || typeof node !== "object") return fallbackDoc
  const root = node as JSONContent
  const walk = (n: unknown): JSONContent | null => {
    if (!n || typeof n !== "object") return null
    const raw = n as JSONContent
    if (typeof raw.type !== "string" || raw.type.length === 0) return null
    const next: JSONContent = { type: raw.type }
    if (raw.attrs && typeof raw.attrs === "object") next.attrs = raw.attrs
    if (typeof raw.text === "string") next.text = raw.text
    if (Array.isArray(raw.content)) {
      const children = raw.content.map((c) => walk(c)).filter((c): c is JSONContent => c != null)
      if (children.length > 0) next.content = children
    }
    if (Array.isArray(raw.marks)) next.marks = raw.marks
    return next
  }
  const cleaned = walk(root)
  if (!cleaned || cleaned.type !== "doc") return fallbackDoc
  if (!Array.isArray(cleaned.content) || cleaned.content.length === 0) return fallbackDoc
  return cleaned
}

function extractKeywords(text: string): string[] {
  const normalized = text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 2)
  return Array.from(new Set(normalized)).slice(0, 16)
}

type PageRow = {
  id: string
  org_id: string
  title: string
  content: JSONContent
  updated_at: string
  body_text?: string | null
  icon?: string | null
  cover_path?: string | null
  slug?: string | null
  updated_by?: string | null
}

type SlashCommand = {
  id: string
  token: string
  label: string
  description: string
  keywords: string[]
  run: (payload: string) => void
}

type PracticalCta = {
  href: string
  label: string
  description: string
}

type PracticalGuide = {
  key: "billing" | "payouts" | "notifications" | "operations"
  badge: string
  title: string
  description: string
  actions: PracticalCta[]
}

const PRACTICAL_GUIDE_KEYWORDS = {
  billing: ["請求", "請求書", "請求依頼", "billing", "invoice", "締め", "入金", "売上"],
  payouts: ["支払い", "支払", "外注", "vendor", "payout", "振込", "報酬", "口座"],
  notifications: ["通知", "未読", "リマインド", "reminder", "alert", "line", "slack"],
} as const

function countKeywordHits(text: string, keywords: readonly string[]): number {
  return keywords.reduce((score, keyword) => (text.includes(keyword) ? score + 1 : score), 0)
}

function buildPracticalGuide(rawText: string, canUseAccounting: boolean): PracticalGuide {
  const text = rawText.toLowerCase()
  const billingScore = countKeywordHits(text, PRACTICAL_GUIDE_KEYWORDS.billing)
  const payoutsScore = countKeywordHits(text, PRACTICAL_GUIDE_KEYWORDS.payouts)
  const notificationsScore = countKeywordHits(text, PRACTICAL_GUIDE_KEYWORDS.notifications)

  if (billingScore >= payoutsScore && billingScore >= notificationsScore && billingScore > 0) {
    if (canUseAccounting) {
      return {
        key: "billing",
        badge: "請求向け",
        title: "請求の締めと発行を先に開く",
        description: "このページは請求手順の文脈が強いため、月次請求と請求書確認の導線を優先しています。",
        actions: [
          { href: "/billing", label: "月次請求を開く", description: "対象月の請求候補と請求依頼台帳を確認します。" },
          { href: "/invoices", label: "請求書一覧へ", description: "発行済み / 下書き / PDF 出力の状況を見ます。" },
          { href: "/help/billing-monthly", label: "請求ヘルプを見る", description: "締め手順と運用ルールをヘルプで確認します。" },
        ],
      }
    }
    return {
      key: "billing",
      badge: "請求手順",
      title: "請求ルールの確認を優先する",
      description: "会計画面は owner / executive_assistant 向けのため、閲覧ロールでは手順確認と社内導線を優先表示しています。",
      actions: [
        { href: "/help/billing-monthly", label: "請求ヘルプを見る", description: "締め手順と社内ルールを確認します。" },
        { href: "/pages", label: "Pages 一覧へ", description: "関連する社内マニュアルを探します。" },
        { href: "/home", label: "ホームへ戻る", description: "優先タスクと通知から次の作業を確認します。" },
      ],
    }
  }

  if (payoutsScore >= notificationsScore && payoutsScore > 0) {
    if (canUseAccounting) {
      return {
        key: "payouts",
        badge: "支払い向け",
        title: "外注請求と支払いを先に開く",
        description: "このページは支払い / 外注運用の文脈が強いため、外注台帳と payout 導線を優先しています。",
        actions: [
          { href: "/vendors", label: "外注一覧を開く", description: "外注先ごとの請求状況と口座情報を確認します。" },
          { href: "/payouts", label: "支払い管理へ", description: "承認待ちと CSV 出力の状況を確認します。" },
          { href: "/help/vendors-payouts", label: "支払いヘルプを見る", description: "外注請求から支払いまでの運用手順を確認します。" },
        ],
      }
    }
    return {
      key: "payouts",
      badge: "支払い手順",
      title: "支払いルールの確認を優先する",
      description: "支払い画面は owner / executive_assistant 向けのため、閲覧ロールでは手順確認と社内導線を優先表示しています。",
      actions: [
        { href: "/help/vendors-payouts", label: "支払いヘルプを見る", description: "外注請求から支払いまでの基本手順を確認します。" },
        { href: "/pages", label: "Pages 一覧へ", description: "関連する社内マニュアルを探します。" },
        { href: "/home", label: "ホームへ戻る", description: "優先タスクと通知から次の作業を確認します。" },
      ],
    }
  }

  if (notificationsScore > 0) {
    return {
      key: "notifications",
      badge: "通知向け",
      title: "通知確認とフォロー導線を開く",
      description: "このページは通知 / リマインド文脈が強いため、通知センターと関連ヘルプを優先しています。",
      actions: [
        { href: "/notifications", label: "通知センターへ", description: "未読通知と優先対応をまとめて確認します。" },
        { href: "/home", label: "ホームへ戻る", description: "KPI と優先タスクから今日の着地を見ます。" },
        { href: "/help/notifications", label: "通知ヘルプを見る", description: "通知種別と見方を確認します。" },
      ],
    }
  }

  return {
    key: "operations",
    badge: "運用向け",
    title: "日常運用の導線を開く",
    description: "タイトルに強い請求 / 支払い / 通知文脈がないため、Pages と日次運用の導線を表示しています。",
    actions: [
      { href: "/contents", label: "進行管理を開く", description: "案件一覧と遅延状況を確認します。" },
      { href: "/home", label: "ホームへ戻る", description: "全体 KPI と優先タスクを確認します。" },
      { href: "/help/pages-manual", label: "Pages ヘルプを見る", description: "社内マニュアル運用の基本を確認します。" },
    ],
  }
}

export default function PageEditPage() {
  const params = useParams()
  const id = typeof params?.id === "string" ? params.id : null
  const { activeOrgId, role, loading: authLoading, needsOnboarding } = useAuthOrg({ redirectToOnboarding: true })

  const [page, setPage] = useState<PageRow | null>(null)
  const [titleInput, setTitleInput] = useState("")
  const [loadError, setLoadError] = useState<string | null>(null)
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved" | "error">("idle")
  const [saveError, setSaveError] = useState<string | null>(null)
  const [imageError, setImageError] = useState<string | null>(null)
  const [imageUploading, setImageUploading] = useState(false)
  const [toastMessage, setToastMessage] = useState<string | null>(null)
  const [charCount, setCharCount] = useState(0)
  const charCountTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [linkModalOpen, setLinkModalOpen] = useState(false)
  const [linkModalUrl, setLinkModalUrl] = useState("")
  const [linkModalText, setLinkModalText] = useState("")
  const [embedModalOpen, setEmbedModalOpen] = useState(false)
  const [embedModalUrl, setEmbedModalUrl] = useState("")
  const [pageLinkModalOpen, setPageLinkModalOpen] = useState(false)
  const [pageLinkList, setPageLinkList] = useState<{ id: string; title: string }[]>([])
  const [pageLinkLoading, setPageLinkLoading] = useState(false)
  const [relatedPages, setRelatedPages] = useState<{ id: string; title: string; updated_at: string }[]>([])
  const [coverPath, setCoverPath] = useState<string | null>(null)
  const [updatedByName, setUpdatedByName] = useState<string | null>(null)
  const [tocOpen, setTocOpen] = useState(false)
  const [tocInitialized, setTocInitialized] = useState(false)
  const [tocHeadings, setTocHeadings] = useState<{ level: number; text: string }[]>([])
  const [slashMenuOpen, setSlashMenuOpen] = useState(false)
  const [slashQuery, setSlashQuery] = useState("/")
  const slashMenuSetRef = useRef<(v: boolean) => void>(() => {})
  slashMenuSetRef.current = setSlashMenuOpen
  const slashInputRef = useRef<HTMLInputElement>(null)
  const [rightPanelOpen, setRightPanelOpen] = useState(false)
  const [panelTab, setPanelTab] = useState<"comments" | "revisions">("comments")
  const [panelSearch, setPanelSearch] = useState("")
  const [comments, setComments] = useState<{ id: string; user_id: string; display_name: string; body: string; created_at: string; selection_range?: { from: number; to: number } }[]>([])
  const [revisions, setRevisions] = useState<{ id: string; title: string; body_json?: unknown; updated_by_name: string; created_at: string }[]>([])
  const [diffRevisionId, setDiffRevisionId] = useState<string | null>(null)
  const [loadingComments, setLoadingComments] = useState(false)
  const [loadingRevisions, setLoadingRevisions] = useState(false)
  const [commentInput, setCommentInput] = useState("")
  const [restoreTargetId, setRestoreTargetId] = useState<string | null>(null)
  const [currentUserId, setCurrentUserId] = useState<string | null>(null)
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const titleSaveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const linkClickTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastSavedRef = useRef<{ title: string; content: unknown } | null>(null)
  const unsavedRef = useRef(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const uploadImageRef = useRef<(file: File) => void>(() => {})
  const editorWrapperRef = useRef<HTMLDivElement>(null)
  const [gutterBlockIndex, setGutterBlockIndex] = useState<number | null>(null)
  const [gutterTop, setGutterTop] = useState<number>(0)
  const [gutterReady, setGutterReady] = useState(false)
  const [gutterMenuOpen, setGutterMenuOpen] = useState(false)
  const [dragFromIndex, setDragFromIndex] = useState<number | null>(null)
  const [activeBlockIndex, setActiveBlockIndex] = useState<number | null>(null)
  const [aiToolsOpen, setAiToolsOpen] = useState(false)
  const aiToolsRef = useRef<HTMLDivElement>(null)
  const hydratedPageIdRef = useRef<string | null>(null)

  const canEdit = role === "owner" || role === "executive_assistant"
  const filteredComments = useMemo(() => {
    const q = panelSearch.trim().toLowerCase()
    if (!q) return comments
    return comments.filter((c) => c.body.toLowerCase().includes(q) || c.display_name.toLowerCase().includes(q))
  }, [comments, panelSearch])
  const filteredRevisions = useMemo(() => {
    const q = panelSearch.trim().toLowerCase()
    if (!q) return revisions
    return revisions.filter((r) => (r.title || "").toLowerCase().includes(q) || (r.updated_by_name || "").toLowerCase().includes(q))
  }, [revisions, panelSearch])

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        link: false,
        horizontalRule: false,
      }),
      LinkExtension.configure({
        openOnClick: false,
        autolink: true,
        linkOnPaste: true,
        HTMLAttributes: { rel: "noopener" },
      }),
      Image.configure({ HTMLAttributes: { class: "max-w-full h-auto rounded-lg" } }),
      HorizontalRule.configure({ HTMLAttributes: { class: "pages-editor-hr" } }),
      TaskList,
      TaskItem.configure({ nested: true }),
      Embed,
      CommentHighlightExtension,
    ],
    content: sanitizeJsonContent(page?.content),
    editable: canEdit,
    editorProps: {
      attributes: { "data-placeholder": "本文を書き始める…" },
      ...(canEdit
        ? {
            handleKeyDown(_view, event) {
              if (event.key === "/" && !event.metaKey && !event.ctrlKey && !event.altKey) {
                setSlashQuery("/")
                slashMenuSetRef.current(true)
                event.preventDefault()
                return true
              }
              return
            },
            // eslint-disable-next-line @typescript-eslint/no-unused-vars -- ProseMirror handleDrop の引数で未使用
            handleDrop(view, event, _slice, _moved) {
              const files = event.dataTransfer?.files
              if (!files?.length || !id || !activeOrgId) return false
              const file = Array.from(files).find((f) => IMAGE_TYPES.includes(f.type))
              if (!file) return false
              event.preventDefault()
              uploadImageRef.current(file)
              return true
            },
            handlePaste(view, event) {
              const files = event.clipboardData?.files
              if (!files?.length || !id || !activeOrgId) return false
              const file = Array.from(files).find((f) => IMAGE_TYPES.includes(f.type))
              if (!file) return false
              event.preventDefault()
              uploadImageRef.current(file)
              return true
            },
            handleClick(_view, _pos, event) {
              const target = event.target as HTMLElement | null
              const anchor = target?.closest?.("a") as HTMLAnchorElement | null
              if (!anchor) return false
              const href = anchor.getAttribute("href")
              if (!href) return true
              event.preventDefault()
              event.stopPropagation()
              if (linkClickTimeoutRef.current) {
                clearTimeout(linkClickTimeoutRef.current)
                linkClickTimeoutRef.current = null
                return true
              }
              // Single click opens link. Double click cancels this and allows editing flow.
              linkClickTimeoutRef.current = setTimeout(() => {
                window.open(href, "_blank", "noopener,noreferrer")
                linkClickTimeoutRef.current = null
              }, 220)
              return true
            },
          }
        : {}),
    },
    immediatelyRender: false,
  })

  useEffect(() => {
    if (!editor) return
    editor.setEditable(canEdit)
  }, [editor, canEdit])

  const persist = useCallback(
    async (nextTitle: string, content: unknown) => {
      if (!id || !activeOrgId || !canEdit) return
      const { data } = await supabase.auth.getSession()
      const token = data.session?.access_token
      if (!token) return

      setSaveStatus("saving")
      setSaveError(null)
      const json = content as JSONContent
      const plain = getPlainTextFromJson(json).trim() || null

      const res = await fetch(`/api/pages/${id}`, {
        method: "PATCH",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          title: nextTitle || "無題",
          content: json ?? {},
          body_text: plain,
          cover_path: coverPath,
        }),
      })
      const result = (await res.json().catch(() => null)) as { ok?: boolean; message?: string } | null
      if (!res.ok || !result?.ok) {
        setSaveError(result?.message ?? "保存に失敗しました。しばらくしてから再試行してください。")
        setSaveStatus("error")
        return
      }

      unsavedRef.current = false
      lastSavedRef.current = { title: nextTitle, content: json }
      setSaveStatus("saved")
      setTitleInput(nextTitle.trim() || "無題")
      setPage((p) => (p ? { ...p, title: nextTitle || "無題", content: content as JSONContent, updated_at: new Date().toISOString(), cover_path: coverPath } : null))
      setTimeout(() => setSaveStatus("idle"), 2000)
    },
    [id, activeOrgId, canEdit, coverPath]
  )

  const scheduleSave = useCallback(
    (content: unknown) => {
      if (!canEdit) return
      unsavedRef.current = true
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current)
      saveTimeoutRef.current = setTimeout(() => {
        saveTimeoutRef.current = null
        const nextTitle = titleInput.trim() || "無題"
        persist(nextTitle, content)
      }, DEBOUNCE_MS)
    },
    [canEdit, persist, titleInput]
  )

  const handleTitleChange = useCallback(
    (value: string) => {
      setTitleInput(value)
      if (!canEdit || !editor) return
      unsavedRef.current = true
      if (titleSaveTimeoutRef.current) clearTimeout(titleSaveTimeoutRef.current)
      titleSaveTimeoutRef.current = setTimeout(() => {
        titleSaveTimeoutRef.current = null
        persist(value.trim() || "無題", editor.getJSON())
      }, 1000)
    },
    [canEdit, editor, persist]
  )

  const uploadAndInsertImage = useCallback(
    async (file: File) => {
      if (!editor || !activeOrgId || !id) return
      setImageUploading(true)
      setImageError(null)
      const ext = file.name.split(".").pop() || "jpg"
      const path = `${activeOrgId}/pages/${id}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`
      const { error } = await supabase.storage.from("page-assets").upload(path, file, { upsert: false })
      if (error) {
        console.error("[pages] image upload failed", error)
        setImageError("画像アップロードに失敗しました。ファイル形式とサイズを確認してください。")
        setToastMessage("画像アップロードに失敗しました")
        setTimeout(() => setImageError(null), 5000)
        setImageUploading(false)
        return
      }
      const src = `/api/page-assets?path=${encodeURIComponent(path)}`
      editor.chain().focus().setImage({ src }).run()
      setImageUploading(false)
    },
    [editor, activeOrgId, id]
  )
  uploadImageRef.current = uploadAndInsertImage

  useEffect(() => {
    if (!id || !activeOrgId || needsOnboarding) return
    let active = true
    ;(async () => {
      setLoadError(null)
      const { data: auth } = await supabase.auth.getSession()
      const token = auth.session?.access_token
      if (!token) {
        if (active) {
          setLoadError("ログイン状態を確認してください。")
          setPage(null)
        }
        return
      }

      const res = await fetch(`/api/pages/${id}`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      const json = (await res.json().catch(() => null)) as
        | { ok?: boolean; page?: PageRow; message?: string }
        | null

      if (!active) return
      if (!res.ok || !json?.ok) {
        setLoadError(json?.message ?? "ページの取得に失敗しました。")
        setPage(null)
        return
      }

      const row = (json.page ?? null) as PageRow | null
      if (!row) {
        setLoadError("ページが見つかりません。")
        setPage(null)
        return
      }
      setPage(row)
      setTitleInput(row.title?.trim() || "無題")
      setCoverPath(row.cover_path ?? null)
      lastSavedRef.current = { title: row.title || "無題", content: row.content }
      if (row.updated_by) {
        const { data: up } = await supabase.from("user_profiles").select("display_name").eq("user_id", row.updated_by).maybeSingle()
        if (active && up) setUpdatedByName((up as { display_name?: string | null })?.display_name ?? null)
      } else {
        setUpdatedByName(null)
      }
    })()
    return () => {
      active = false
    }
  }, [id, activeOrgId, needsOnboarding])

  useEffect(() => {
    if (!editor || !page) return
    if (hydratedPageIdRef.current === page.id) return
    const sanitized = sanitizeJsonContent(page.content)
    editor.commands.setContent(sanitized, { emitUpdate: false })
    setCharCount(getPlainTextFromJson(sanitized).replace(/\s/g, "").length)
    setTocHeadings(getHeadingsFromJson(sanitized))
    hydratedPageIdRef.current = page.id
  }, [editor, page])

  useEffect(() => {
    if (!editor) return
    const onUpdate = () => setTocHeadings(getHeadingsFromJson(editor.getJSON()))
    editor.on("update", onUpdate)
    return () => {
      editor.off("update", onUpdate)
    }
  }, [editor])

  const loadComments = useCallback(async () => {
    if (!id) return
    setLoadingComments(true)
    try {
      const { data } = await supabase.auth.getSession()
      const token = data.session?.access_token
      if (!token) return
      const res = await fetch(`/api/pages/${id}/comments`, { headers: { Authorization: `Bearer ${token}` } })
      const json = (await res.json().catch(() => null)) as { ok?: boolean; comments?: typeof comments } | null
      if (json?.ok && Array.isArray(json.comments)) setComments(json.comments)
    } finally {
      setLoadingComments(false)
    }
  }, [id])

  const loadRevisions = useCallback(async () => {
    if (!id) return
    setLoadingRevisions(true)
    try {
      const { data } = await supabase.auth.getSession()
      const token = data.session?.access_token
      if (!token) return
      const res = await fetch(`/api/pages/${id}/revisions`, { headers: { Authorization: `Bearer ${token}` } })
      const json = (await res.json().catch(() => null)) as { ok?: boolean; revisions?: { id: string; title: string; body_json?: unknown; updated_by_name: string; created_at: string }[] } | null
      if (json?.ok && Array.isArray(json.revisions)) setRevisions(json.revisions)
    } finally {
      setLoadingRevisions(false)
    }
  }, [id])

  useEffect(() => {
    if (!rightPanelOpen || !id) return
    if (panelTab === "comments") loadComments()
    else loadRevisions()
  }, [rightPanelOpen, panelTab, id, loadComments, loadRevisions])

  useEffect(() => {
    setPanelSearch("")
  }, [panelTab])

  useEffect(() => {
    let active = true
    supabase.auth.getUser().then(({ data }) => {
      if (active && data.user?.id) setCurrentUserId(data.user.id)
    })
    return () => { active = false }
  }, [])

  useEffect(() => {
    if (tocInitialized) return
    const mq = window.matchMedia("(max-width: 768px)")
    setTocOpen(!mq.matches)
    setTocInitialized(true)
  }, [tocInitialized])

  useEffect(() => {
    if (!slashMenuOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault()
        setSlashMenuOpen(false)
        setSlashQuery("/")
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [slashMenuOpen])

  useEffect(() => {
    if (!slashMenuOpen) return
    const frame = window.requestAnimationFrame(() => {
      const input = slashInputRef.current
      if (!input) return
      input.focus()
      const length = input.value.length
      input.setSelectionRange(length, length)
    })
    return () => window.cancelAnimationFrame(frame)
  }, [slashMenuOpen])

  useEffect(() => {
    if (!aiToolsOpen) return
    const onPointerDown = (event: MouseEvent) => {
      if (!aiToolsRef.current) return
      if (!aiToolsRef.current.contains(event.target as Node)) {
        setAiToolsOpen(false)
      }
    }
    const onEsc = (event: KeyboardEvent) => {
      if (event.key === "Escape") setAiToolsOpen(false)
    }
    window.addEventListener("mousedown", onPointerDown)
    window.addEventListener("keydown", onEsc)
    return () => {
      window.removeEventListener("mousedown", onPointerDown)
      window.removeEventListener("keydown", onEsc)
    }
  }, [aiToolsOpen])

  useEffect(() => {
    if (!editor || tocHeadings.length === 0) return
    const t = setTimeout(() => {
      try {
        const dom = editor.view.dom
        const headings = dom.querySelectorAll("h1, h2, h3")
        headings.forEach((el, i) => {
          const t = tocHeadings[i]
          if (t) (el as HTMLElement).id = titleToSlug(t.text) || `h-${i}`
        })
      } catch {
        // ignore
      }
    }, 0)
    return () => clearTimeout(t)
  }, [editor, tocHeadings])

  useEffect(() => {
    if (!editor) return
    const assignBlockIds = () => {
      try {
        const dom = editor.view.dom
        const blocks = dom.querySelectorAll(".ProseMirror > *")
        blocks.forEach((el, i) => {
          (el as HTMLElement).id = `block-${i}`
        })
        const hash = typeof window !== "undefined" ? window.location.hash : ""
        const m = hash.match(/^#block-(\d+)$/)
        if (m) {
          const blockIndex = parseInt(m[1], 10)
          const el = dom.querySelector(`#block-${blockIndex}`)
          if (el) el.scrollIntoView({ behavior: "smooth", block: "start" })
        }
      } catch {
        // ignore
      }
    }
    assignBlockIds()
    editor.on("update", assignBlockIds)
    return () => {
      editor.off("update", assignBlockIds)
    }
  }, [editor])

  useEffect(() => {
    if (!pageLinkModalOpen || !activeOrgId) return
    setPageLinkLoading(true)
    let cancelled = false
    void (async () => {
      try {
        const { data: auth } = await supabase.auth.getSession()
        const token = auth.session?.access_token
        if (!token) return
        const res = await fetch("/api/pages/list", {
          headers: { Authorization: `Bearer ${token}` },
        })
        const json = (await res.json().catch(() => null)) as
          | { ok?: boolean; pages?: { id: string; title?: string | null }[] }
          | null
        if (!res.ok || !json?.ok) return
        if (!cancelled) {
          setPageLinkList((json.pages ?? []).map((r) => ({ id: r.id, title: r.title || "無題" })))
        }
      } finally {
        if (!cancelled) setPageLinkLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [pageLinkModalOpen, activeOrgId])

  useEffect(() => {
    if (!activeOrgId || !id) return
    let cancelled = false
    void (async () => {
      const baseText = `${titleInput || page?.title || ""} ${page?.body_text || ""}`
      const keywords = extractKeywords(baseText)
      const { data: auth } = await supabase.auth.getSession()
      const token = auth.session?.access_token
      if (!token) return
      const res = await fetch("/api/pages/list", {
        headers: { Authorization: `Bearer ${token}` },
      })
      const json = (await res.json().catch(() => null)) as
        | { ok?: boolean; pages?: { id: string; title?: string | null; updated_at: string; body_text?: string | null }[] }
        | null
      if (cancelled || !res.ok || !json?.ok) return
      const scored = (json.pages ?? [])
        .filter((row) => row.id !== id)
        .slice(0, 20)
        .map((row) => {
          const text = `${row.title || ""} ${row.body_text || ""}`.toLowerCase()
          const score = keywords.reduce((s, k) => (text.includes(k) ? s + 1 : s), 0)
          return { id: row.id, title: row.title || "無題", updated_at: row.updated_at, score }
        })
        .sort((a, b) => b.score - a.score || new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime())
        .slice(0, 8)
      setRelatedPages(scored.map(({ id: rowId, title, updated_at }) => ({ id: rowId, title, updated_at })))
    })()
    return () => {
      cancelled = true
    }
  }, [activeOrgId, id, page?.body_text, page?.title, titleInput])

  useEffect(() => {
    if (!editor || !canEdit) return
    const onUpdate = () => {
      const content = editor.getJSON()
      if (JSON.stringify(lastSavedRef.current?.content) !== JSON.stringify(content)) {
        scheduleSave(content)
      }
      if (charCountTimeoutRef.current) clearTimeout(charCountTimeoutRef.current)
      charCountTimeoutRef.current = setTimeout(() => {
        setCharCount(getPlainTextFromJson(content).replace(/\s/g, "").length)
      }, 800)
    }
    editor.on("update", onUpdate)
    return () => {
      editor.off("update", onUpdate)
      if (charCountTimeoutRef.current) clearTimeout(charCountTimeoutRef.current)
    }
  }, [editor, canEdit, scheduleSave])

  useEffect(() => {
    if (!editor || !canEdit) return
    const updateActiveBlock = () => {
      const from = editor.state.selection.$from
      const idx = from.depth >= 1 ? from.index(1) : 0
      setActiveBlockIndex(idx)
      if (!editorWrapperRef.current) return
      const blockEl = editorWrapperRef.current.querySelector(`#block-${idx}`) as HTMLElement | null
      if (!blockEl) {
        setGutterReady(false)
        return
      }
      const wrapperRect = editorWrapperRef.current.getBoundingClientRect()
      const blockRect = blockEl.getBoundingClientRect()
      setGutterTop(blockRect.top - wrapperRect.top + Math.max(0, (blockRect.height - 20) / 2))
      setGutterReady(true)
    }
    updateActiveBlock()
    editor.on("selectionUpdate", updateActiveBlock)
    editor.on("focus", updateActiveBlock)
    return () => {
      editor.off("selectionUpdate", updateActiveBlock)
      editor.off("focus", updateActiveBlock)
    }
  }, [editor, canEdit])

  useEffect(() => {
    return () => {
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current)
      if (titleSaveTimeoutRef.current) clearTimeout(titleSaveTimeoutRef.current)
      if (linkClickTimeoutRef.current) clearTimeout(linkClickTimeoutRef.current)
    }
  }, [])

  useEffect(() => {
    const h = (e: BeforeUnloadEvent) => {
      if (unsavedRef.current) e.preventDefault()
    }
    window.addEventListener("beforeunload", h)
    return () => window.removeEventListener("beforeunload", h)
  }, [])

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "s") {
        e.preventDefault()
        if (editor && canEdit) {
          const content = editor.getJSON()
          const nextTitle = titleInput.trim() || "無題"
          persist(nextTitle, content)
        }
      }
      if ((e.metaKey || e.ctrlKey) && e.key === "b") {
        e.preventDefault()
        if (editor && canEdit) editor.chain().focus().toggleBold().run()
      }
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [editor, canEdit, titleInput, persist])

  useEffect(() => {
    if (!toastMessage) return
    const t = setTimeout(() => setToastMessage(null), 2000)
    return () => clearTimeout(t)
  }, [toastMessage])

  const handleRetrySave = () => {
    if (editor) {
      const content = editor.getJSON()
      const nextTitle = titleInput.trim() || "無題"
      persist(nextTitle, content)
    }
  }

  const displayTitle = titleInput.trim() || page?.title?.trim() || "無題"
  const practicalGuide = useMemo(
    () => buildPracticalGuide(`${titleInput || page?.title || ""} ${page?.body_text || ""}`, canEdit),
    [canEdit, page?.body_text, page?.title, titleInput]
  )
  const isVisible = useCallback((key?: string) => key !== "__hidden__", [])

  const triggerFileInput = () => fileInputRef.current?.click()
  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file && IMAGE_TYPES.includes(file.type)) uploadAndInsertImage(file)
    e.target.value = ""
  }

  const editorInstance = editor

  const getBlockIndexFromTarget = useCallback((target: EventTarget | null) => {
    const el = target as HTMLElement | null
    if (!el) return null
    const blockEl = el.closest?.('[id^="block-"]') as HTMLElement | null
    if (!blockEl) return null
    const m = blockEl.id.match(/^block-(\d+)$/)
    if (!m) return null
    const idx = Number(m[1])
    return Number.isFinite(idx) ? idx : null
  }, [])

  const insertBlockBelow = useCallback(
    (kind: "paragraph" | "bulletList" | "taskList") => {
      if (!editorInstance || gutterBlockIndex == null || !canEdit) return
      const json = editorInstance.getJSON()
      const content = Array.isArray(json.content) ? ([...json.content] as unknown[]) : []

      let newNode: JSONContent
      if (kind === "bulletList") {
        newNode = {
          type: "bulletList",
          content: [{ type: "listItem", content: [{ type: "paragraph" }] }],
        }
      } else if (kind === "taskList") {
        newNode = {
          type: "taskList",
          content: [{ type: "taskItem", attrs: { checked: false }, content: [{ type: "paragraph" }] }],
        }
      } else {
        newNode = { type: "paragraph" }
      }

      content.splice(gutterBlockIndex + 1, 0, newNode as unknown)
      const safeDoc = sanitizeJsonContent({ type: "doc", content })
      editorInstance.commands.setContent(safeDoc, { emitUpdate: true })
      editorInstance.commands.focus("end")
      setGutterMenuOpen(false)
    },
    [editorInstance, gutterBlockIndex, canEdit]
  )

  const reorderBlock = useCallback(
    (fromIndex: number, toIndex: number) => {
      if (!editorInstance || !canEdit || fromIndex === toIndex) return
      const json = editorInstance.getJSON()
      const content = Array.isArray(json.content) ? ([...json.content] as unknown[]) : []
      if (fromIndex < 0 || toIndex < 0 || fromIndex >= content.length || toIndex >= content.length) return
      const [moved] = content.splice(fromIndex, 1)
      if (!moved || typeof moved !== "object") return
      content.splice(toIndex, 0, moved)
      const safeDoc = sanitizeJsonContent({ type: "doc", content })
      editorInstance.commands.setContent(safeDoc, { emitUpdate: true })
      editorInstance.commands.focus("end")
    },
    [editorInstance, canEdit]
  )

  const handleEditorMouseMove = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (!canEdit || !editorWrapperRef.current) return
      const idx = getBlockIndexFromTarget(e.target)
      if (idx == null) {
        setGutterBlockIndex(null)
        return
      }
      const blockEl = editorWrapperRef.current.querySelector(`#block-${idx}`) as HTMLElement | null
      if (!blockEl) {
        setGutterReady(false)
        return
      }
      const wrapperRect = editorWrapperRef.current.getBoundingClientRect()
      const blockRect = blockEl.getBoundingClientRect()
      setGutterBlockIndex(idx)
      setGutterTop(blockRect.top - wrapperRect.top + Math.max(0, (blockRect.height - 28) / 2))
      setGutterReady(true)
    },
    [canEdit, getBlockIndexFromTarget]
  )

  const openLinkModal = () => {
    if (!editorInstance) return
    if (editorInstance.isActive("link")) {
      editorInstance.chain().focus().unsetLink().run()
      return
    }
    const sel = editorInstance.state.selection
    const hasSelection = sel && !sel.empty
    const text = hasSelection ? editorInstance.state.doc.textBetween(sel.from, sel.to, " ") : ""
    setLinkModalUrl("")
    setLinkModalText(text)
    setLinkModalOpen(true)
  }

  const applyLinkModal = () => {
    if (!editorInstance || !linkModalUrl.trim()) {
      setLinkModalOpen(false)
      return
    }
    const href = linkModalUrl.trim().startsWith("http://") || linkModalUrl.trim().startsWith("https://")
      ? linkModalUrl.trim()
      : `https://${linkModalUrl.trim()}`
    const sel = editorInstance.state.selection
    const hasSelection = sel && !sel.empty
    const textForInsert = linkModalText.trim() || href
    if (hasSelection) {
      editorInstance
        .chain()
        .focus()
        .extendMarkRange("link")
        .setLink({ href })
        .run()
    } else {
      editorInstance
        .chain()
        .focus()
        .insertContent({
          type: "text",
          text: textForInsert,
          marks: [{ type: "link", attrs: { href } }],
        })
        .run()
    }
    setToastMessage("リンクを挿入しました")
    setLinkModalOpen(false)
  }

  useEffect(() => {
    if (!editorInstance || !canEdit) return
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<ApplyAiResultDetail>).detail
      if (detail?.source !== "pages" || !detail.result?.text) return
      const mode = detail.mode
      const content = detail.result.text.trim()
      const sel = editorInstance.state.selection
      const hasSelection = sel && !sel.empty
      const chain = editorInstance.chain().focus()
      if (hasSelection) {
        chain.insertContentAt({ from: sel.from, to: sel.to }, content)
      } else if (mode === "headings") {
        chain.insertContent(`\n${content}\n`)
      } else {
        chain.insertContent(`\n${content}`)
      }
      chain.run()
    }
    window.addEventListener("apply-ai-result", handler as EventListener)
    return () => {
      window.removeEventListener("apply-ai-result", handler as EventListener)
    }
  }, [editorInstance, canEdit])

  const formatUpdatedAt = (s: string) => {
    try {
      const d = new Date(s)
      return d.toLocaleString("ja-JP", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })
    } catch {
      return ""
    }
  }
  const readMinutes = Math.max(1, Math.ceil(charCount / 400))

  const pageUrl = typeof window !== "undefined" ? window.location.origin + `/pages/${id}` : ""
  const copyPageUrl = () => {
    if (!pageUrl) return
    navigator.clipboard.writeText(pageUrl).then(() => setToastMessage("URLをコピーしました")).catch(() => setToastMessage("コピーに失敗しました"))
  }
  const copyBlockLink = () => {
    if (!pageUrl || !editor) return
    try {
      const $from = editor.state.selection.$from
      const depth = $from.depth
      const blockIndex = depth >= 1 ? $from.index(1) : 0
      const url = `${pageUrl}#block-${blockIndex}`
      navigator.clipboard.writeText(url).then(() => setToastMessage("ブロックリンクをコピーしました")).catch(() => setToastMessage("コピーに失敗しました"))
    } catch {
      setToastMessage("コピーに失敗しました")
    }
  }

  const closeSlashMenu = useCallback(() => {
    setSlashMenuOpen(false)
    setSlashQuery("/")
  }, [])

  const insertEmbedBlock = useCallback(
    (rawUrl: string) => {
      const nextUrl = rawUrl.trim()
      if (!nextUrl || !editor) return false
      editor.chain().focus().insertContent({ type: "embed", attrs: { url: nextUrl } }).run()
      return true
    },
    [editor]
  )

  const openEmbedComposer = useCallback(
    (initialUrl = "") => {
      closeSlashMenu()
      setEmbedModalUrl(initialUrl)
      setEmbedModalOpen(true)
    },
    [closeSlashMenu]
  )

  const submitEmbedModal = useCallback(() => {
    if (!insertEmbedBlock(embedModalUrl)) return
    setEmbedModalOpen(false)
    setEmbedModalUrl("")
  }, [embedModalUrl, insertEmbedBlock])

  const slashCommandToken = useMemo(() => {
    const trimmed = slashQuery.trim()
    const withoutSlash = trimmed.startsWith("/") ? trimmed.slice(1) : trimmed
    const [command = ""] = withoutSlash.split(/\s+/)
    return command.toLowerCase()
  }, [slashQuery])

  const slashPayload = useMemo(() => {
    const trimmed = slashQuery.trim()
    if (!trimmed.startsWith("/")) return ""
    return trimmed.replace(/^\/\S+\s*/, "").trim()
  }, [slashQuery])

  const slashCommands = useMemo<SlashCommand[]>(
    () => [
      {
        id: "heading-1",
        token: "h1",
        label: "/h1 見出し1",
        description: "LP の先頭や大きな区切り見出しを入れます。",
        keywords: ["heading", "title", "見出し", "hero"],
        run: () => {
          editor?.chain().focus().toggleHeading({ level: 1 }).run()
          closeSlashMenu()
        },
      },
      {
        id: "heading-2",
        token: "h2",
        label: "/h2 見出し2",
        description: "セクション見出しを入れます。",
        keywords: ["heading", "section", "見出し"],
        run: () => {
          editor?.chain().focus().toggleHeading({ level: 2 }).run()
          closeSlashMenu()
        },
      },
      {
        id: "heading-3",
        token: "h3",
        label: "/h3 見出し3",
        description: "補助見出しや小見出しを入れます。",
        keywords: ["heading", "subheading", "見出し"],
        run: () => {
          editor?.chain().focus().toggleHeading({ level: 3 }).run()
          closeSlashMenu()
        },
      },
      {
        id: "bullet-list",
        token: "bullet",
        label: "/bullet 箇条書き",
        description: "特徴や要点を並べるリストを挿入します。",
        keywords: ["list", "bullet", "箇条書き"],
        run: () => {
          editor?.chain().focus().toggleBulletList().run()
          closeSlashMenu()
        },
      },
      {
        id: "ordered-list",
        token: "number",
        label: "/number 番号付きリスト",
        description: "手順やフローを順番つきで並べます。",
        keywords: ["list", "ordered", "number", "番号"],
        run: () => {
          editor?.chain().focus().toggleOrderedList().run()
          closeSlashMenu()
        },
      },
      {
        id: "blockquote",
        token: "quote",
        label: "/quote 引用",
        description: "レビューや抜粋コメントの見せ方に使えます。",
        keywords: ["quote", "blockquote", "引用"],
        run: () => {
          editor?.chain().focus().toggleBlockquote().run()
          closeSlashMenu()
        },
      },
      {
        id: "code-block",
        token: "code",
        label: "/code コードブロック",
        description: "コードや設定例を整形して載せます。",
        keywords: ["code", "snippet", "コード"],
        run: () => {
          editor?.chain().focus().toggleCodeBlock().run()
          closeSlashMenu()
        },
      },
      {
        id: "divider",
        token: "divider",
        label: "/divider 区切り線",
        description: "長い LP をセクションで区切ります。",
        keywords: ["hr", "line", "divider", "区切り"],
        run: () => {
          editor?.chain().focus().setHorizontalRule().run()
          closeSlashMenu()
        },
      },
      {
        id: "checklist",
        token: "todo",
        label: "/todo チェックリスト",
        description: "確認項目や進行タスクを並べます。",
        keywords: ["task", "check", "todo", "チェック"],
        run: () => {
          editor?.chain().focus().toggleTaskList().run()
          closeSlashMenu()
        },
      },
      {
        id: "embed",
        token: "embed",
        label: "/embed 埋め込み",
        description: "Pages URL や LP URL を貼って、そのまま iframe で全面表示します。",
        keywords: ["iframe", "lp", "url", "page", "pages", "埋め込み"],
        run: (payload) => {
          if (payload && insertEmbedBlock(payload)) {
            closeSlashMenu()
            return
          }
          openEmbedComposer(payload)
        },
      },
    ],
    [closeSlashMenu, editor, insertEmbedBlock, openEmbedComposer]
  )

  const filteredSlashCommands = useMemo(() => {
    if (!slashCommandToken) return slashCommands
    return slashCommands.filter((command) =>
      [command.token, command.label, command.description, ...command.keywords].some((value) =>
        value.toLowerCase().includes(slashCommandToken)
      )
    )
  }, [slashCommands, slashCommandToken])

  const submitSlashCommand = useCallback(() => {
    const exactMatch = slashCommands.find((command) => command.token === slashCommandToken)
    const command = exactMatch ?? filteredSlashCommands[0]
    if (!command) return
    command.run(command.token === "embed" ? slashPayload : "")
  }, [filteredSlashCommands, slashCommandToken, slashCommands, slashPayload])

  if (authLoading) {
    return (
      <div style={{ padding: "32px 40px", minHeight: "100vh", background: "var(--bg-grad)" }}>
        <p style={{ color: "var(--muted)" }}>読み込み中…</p>
      </div>
    )
  }

  if (needsOnboarding || !activeOrgId) {
    return (
      <div style={{ padding: "32px 40px", minHeight: "100vh", background: "var(--bg-grad)" }}>
        <p style={{ color: "var(--muted)" }}>ワークスペース設定後に Pages を利用できます。</p>
        <Link href="/home" style={{ color: "var(--primary)", fontSize: 14, marginTop: 8, display: "inline-block" }}>
          Home へ
        </Link>
      </div>
    )
  }

  if (loadError || !page) {
    return (
      <div
        style={{
          padding: "32px 40px",
          minHeight: "100vh",
          background: "var(--bg-grad)",
          maxWidth: 480,
          margin: "0 auto",
        }}
      >
        <p style={{ color: "var(--text)", fontSize: 15, marginBottom: 16 }}>{loadError ?? "読み込み中…"}</p>
        <Link
          href="/pages"
          style={{
            display: "inline-block",
            padding: "10px 18px",
            borderRadius: 10,
            border: "1px solid var(--border)",
            background: "var(--surface)",
            color: "var(--primary)",
            fontSize: 14,
            fontWeight: 500,
            textDecoration: "none",
          }}
        >
          ← 一覧へ戻る
        </Link>
      </div>
    )
  }

  return (
    <div style={{ display: "flex", minHeight: "100vh", background: "var(--bg-grad)" }}>
    <div style={{ flex: 1, minWidth: 0, width: "100%", padding: "32px 32px 48px" }}>
      {toastMessage && (
        <div
          role="status"
          aria-live="polite"
          style={{
            position: "fixed",
            top: 24,
            left: "50%",
            transform: "translateX(-50%)",
            padding: "12px 20px",
            borderRadius: 10,
            background: "var(--text)",
            color: "var(--surface)",
            fontSize: 14,
            fontWeight: 500,
            boxShadow: "0 4px 12px rgba(0,0,0,0.15)",
            zIndex: 9999,
          }}
        >
          {toastMessage}
        </div>
      )}

      {slashMenuOpen && (
        <div
          role="dialog"
          aria-label="ブロックメニュー"
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 9998,
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "center",
            paddingTop: 160,
            background: "transparent",
          }}
          onClick={closeSlashMenu}
        >
          <div
            style={{
              background: "var(--surface)",
              border: "1px solid var(--border)",
              borderRadius: 18,
              padding: 12,
              boxShadow: "0 24px 48px rgba(15,23,42,0.16)",
              width: "min(560px, calc(100vw - 32px))",
              maxHeight: "min(520px, calc(100vh - 220px))",
              overflowY: "auto",
              display: "grid",
              gap: 12,
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: "grid", gap: 8 }}>
              <div style={{ fontSize: 11, color: "var(--muted)", padding: "4px 2px 0" }}>
                `/embed https://...` のように打つと、URL までそのまま確定できます。
              </div>
              <input
                ref={slashInputRef}
                type="text"
                value={slashQuery}
                onChange={(e) => {
                  const nextValue = e.target.value
                  if (!nextValue) {
                    setSlashQuery("/")
                    return
                  }
                  setSlashQuery(nextValue.startsWith("/") ? nextValue : `/${nextValue}`)
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault()
                    submitSlashCommand()
                  }
                  if (e.key === "Escape") {
                    e.preventDefault()
                    closeSlashMenu()
                  }
                  if (e.key === "Backspace" && slashQuery.trim() === "/") {
                    e.preventDefault()
                    closeSlashMenu()
                  }
                }}
                placeholder="/embed https://example.com/lp"
                style={{
                  width: "100%",
                  padding: "14px 16px",
                  borderRadius: 14,
                  border: "1px solid var(--border)",
                  background: "var(--input-bg)",
                  color: "var(--text)",
                  fontSize: 15,
                }}
              />
            </div>

            <div style={{ fontSize: 11, color: "var(--muted)", padding: "0 2px" }}>ブロックを挿入</div>

            {filteredSlashCommands.length === 0 ? (
              <div
                style={{
                  padding: "16px 14px",
                  borderRadius: 14,
                  border: "1px dashed var(--border)",
                  color: "var(--muted)",
                  fontSize: 13,
                }}
              >
                一致するコマンドがありません。`/embed`、`/h1`、`/bullet` などを試してください。
              </div>
            ) : null}

            {filteredSlashCommands.map((command) => (
              <button
                key={command.id}
                type="button"
                onClick={() => {
                  command.run(command.token === "embed" ? slashPayload : "")
                }}
                style={{
                  display: "grid",
                  gap: 4,
                  width: "100%",
                  padding: "12px 14px",
                  textAlign: "left",
                  border: "none",
                  borderRadius: 14,
                  background: "transparent",
                  color: "var(--text)",
                  fontSize: 14,
                  cursor: "pointer",
                }}
                onMouseDown={(e) => e.preventDefault()}
              >
                <span style={{ fontWeight: 600 }}>{command.label}</span>
                <span style={{ fontSize: 12, color: "var(--muted)", lineHeight: 1.6 }}>
                  {command.description}
                </span>
              </button>
            ))}
            <div
              style={{
                fontSize: 11,
                color: "var(--muted)",
                padding: "6px 2px 0",
                borderTop: "1px solid var(--border)",
              }}
            >
              Enter で実行 / Esc で閉じる
            </div>
          </div>
        </div>
      )}

      {linkModalOpen && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.4)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 10000,
          }}
          onClick={() => setLinkModalOpen(false)}
        >
          <div
            style={{
              background: "var(--surface)",
              borderRadius: 12,
              padding: 24,
              maxWidth: 400,
              width: "90%",
              boxShadow: "0 8px 32px rgba(0,0,0,0.2)",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 style={{ fontSize: 16, fontWeight: 600, color: "var(--text)", marginBottom: 16 }}>リンクを挿入</h3>
            <label style={{ display: "block", fontSize: 13, color: "var(--muted)", marginBottom: 4 }}>URL</label>
            <input
              type="url"
              value={linkModalUrl}
              onChange={(e) => setLinkModalUrl(e.target.value)}
              placeholder="https://..."
              autoFocus
              onKeyDown={(e) => {
                if (e.key === "Enter") applyLinkModal()
                if (e.key === "Escape") setLinkModalOpen(false)
              }}
              style={{
                width: "100%",
                padding: "10px 12px",
                borderRadius: 8,
                border: "1px solid var(--border)",
                background: "var(--input-bg)",
                color: "var(--text)",
                fontSize: 14,
                marginBottom: 12,
              }}
            />
            <label style={{ display: "block", fontSize: 13, color: "var(--muted)", marginBottom: 4 }}>表示テキスト（任意）</label>
            <input
              type="text"
              value={linkModalText}
              onChange={(e) => setLinkModalText(e.target.value)}
              placeholder="選択範囲がそのまま使われます"
              onKeyDown={(e) => {
                if (e.key === "Enter") applyLinkModal()
                if (e.key === "Escape") setLinkModalOpen(false)
              }}
              style={{
                width: "100%",
                padding: "10px 12px",
                borderRadius: 8,
                border: "1px solid var(--border)",
                background: "var(--input-bg)",
                color: "var(--text)",
                fontSize: 14,
                marginBottom: 20,
              }}
            />
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
              <button
                type="button"
                onClick={() => setLinkModalOpen(false)}
                style={{
                  padding: "8px 16px",
                  borderRadius: 8,
                  border: "1px solid var(--border)",
                  background: "var(--surface-2)",
                  color: "var(--text)",
                  fontSize: 14,
                  cursor: "pointer",
                }}
              >
                キャンセル
              </button>
              <button
                type="button"
                onClick={applyLinkModal}
                disabled={!linkModalUrl.trim()}
                style={{
                  padding: "8px 16px",
                  borderRadius: 8,
                  border: "none",
                  background: linkModalUrl.trim() ? "var(--primary)" : "var(--surface-2)",
                  color: linkModalUrl.trim() ? "var(--primary-contrast)" : "var(--muted)",
                  fontSize: 14,
                  cursor: linkModalUrl.trim() ? "pointer" : "not-allowed",
                }}
              >
                適用
              </button>
            </div>
          </div>
        </div>
      )}

      {embedModalOpen && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 9999,
            background: "rgba(0,0,0,0.4)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 24,
          }}
          onClick={() => {
            setEmbedModalOpen(false)
            setEmbedModalUrl("")
          }}
        >
          <div
            style={{
              background: "var(--surface)",
              borderRadius: 18,
              padding: 24,
              maxWidth: 520,
              width: "90%",
              boxShadow: "0 8px 32px rgba(0,0,0,0.2)",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 style={{ fontSize: 18, fontWeight: 700, color: "var(--text)", marginBottom: 8 }}>埋め込み</h3>
            <p style={{ fontSize: 13, color: "var(--muted)", marginBottom: 14, lineHeight: 1.7 }}>
              NovaLoop Pages URL、発行した LP URL、YouTube、Loom などを貼ると、そのまま iframe で表示します。
              Pages URL は自動で埋め込み用ルートに変換します。
            </p>
            <input
              type="text"
              value={embedModalUrl}
              onChange={(e) => setEmbedModalUrl(e.target.value)}
              placeholder="/pages/abc123 または https://example.com/lp"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  submitEmbedModal()
                }
                if (e.key === "Escape") {
                  setEmbedModalOpen(false)
                  setEmbedModalUrl("")
                }
              }}
              style={{
                width: "100%",
                padding: "12px 14px",
                borderRadius: 12,
                border: "1px solid var(--border)",
                background: "var(--input-bg)",
                color: "var(--text)",
                fontSize: 14,
                marginBottom: 16,
              }}
            />
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
              <button
                type="button"
                onClick={() => {
                  setEmbedModalOpen(false)
                  setEmbedModalUrl("")
                }}
                style={{
                  padding: "8px 16px",
                  borderRadius: 8,
                  border: "1px solid var(--border)",
                  background: "var(--surface-2)",
                  color: "var(--text)",
                  fontSize: 14,
                  cursor: "pointer",
                }}
              >
                キャンセル
              </button>
              <button
                type="button"
                onClick={submitEmbedModal}
                disabled={!embedModalUrl.trim()}
                style={{
                  padding: "8px 16px",
                  borderRadius: 8,
                  border: "none",
                  background: embedModalUrl.trim() ? "var(--primary)" : "var(--surface-2)",
                  color: embedModalUrl.trim() ? "var(--primary-contrast)" : "var(--muted)",
                  fontSize: 14,
                  cursor: embedModalUrl.trim() ? "pointer" : "not-allowed",
                }}
              >
                挿入
              </button>
            </div>
          </div>
        </div>
      )}

      {pageLinkModalOpen && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 9999,
            background: "rgba(0,0,0,0.4)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 24,
          }}
          onClick={() => setPageLinkModalOpen(false)}
        >
          <div
            style={{
              background: "var(--surface)",
              borderRadius: 12,
              padding: 24,
              maxWidth: 400,
              maxHeight: "80vh",
              width: "90%",
              boxShadow: "0 8px 32px rgba(0,0,0,0.2)",
              display: "flex",
              flexDirection: "column",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 style={{ fontSize: 16, fontWeight: 600, color: "var(--text)", marginBottom: 12 }}>ページ・見出しリンク</h3>
            {pageLinkLoading && pageLinkList.length === 0 ? (
              <p style={{ fontSize: 13, color: "var(--muted)" }}>読み込み中…</p>
            ) : (
              <div style={{ overflowY: "auto", flex: 1 }}>
                {tocHeadings.length > 0 && (
                  <>
                    <div style={{ fontSize: 11, color: "var(--muted)", padding: "4px 0", marginBottom: 4 }}>このページの見出し</div>
                    <ul style={{ listStyle: "none", padding: 0, margin: "0 0 12px 0" }}>
                      {tocHeadings.map((h, i) => {
                        const slug = titleToSlug(h.text) || `h-${i}`
                        return (
                          <li key={`${h.level}-${slug}-${i}`}>
                            <button
                              type="button"
                              onClick={() => {
                                editor?.chain().focus().insertContent({ type: "paragraph", content: [{ type: "text", text: h.text, marks: [{ type: "link", attrs: { href: `#${slug}` } }] }] }).run()
                                setPageLinkModalOpen(false)
                              }}
                              style={{
                                width: "100%",
                                paddingTop: 8,
                                paddingRight: 12,
                                paddingBottom: 8,
                                textAlign: "left",
                                border: "none",
                                borderBottom: "1px solid var(--border)",
                                background: "transparent",
                                color: "var(--text)",
                                fontSize: 13,
                                cursor: "pointer",
                                paddingLeft: 12 + (h.level - 1) * 12,
                              }}
                            >
                              {"#".repeat(h.level)} {h.text}
                            </button>
                          </li>
                        )
                      })}
                    </ul>
                  </>
                )}
                <div style={{ fontSize: 11, color: "var(--muted)", padding: "4px 0", marginBottom: 4 }}>他ページ</div>
                <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
                  {pageLinkList
                    .filter((p) => p.id !== id)
                    .map((p) => (
                      <li key={p.id}>
                        <button
                          type="button"
                          onClick={() => {
                            const href = `/pages/${p.id}`
                            editor?.chain().focus().insertContent({ type: "paragraph", content: [{ type: "text", text: p.title, marks: [{ type: "link", attrs: { href } }] }] }).run()
                            setPageLinkModalOpen(false)
                          }}
                          style={{
                            width: "100%",
                            padding: "10px 12px",
                            textAlign: "left",
                            border: "none",
                            borderBottom: "1px solid var(--border)",
                            background: "transparent",
                            color: "var(--text)",
                            fontSize: 14,
                            cursor: "pointer",
                          }}
                        >
                          {p.title}
                        </button>
                      </li>
                    ))}
                </ul>
              </div>
            )}
            <button
              type="button"
              onClick={() => setPageLinkModalOpen(false)}
              style={{
                marginTop: 12,
                padding: "8px 16px",
                borderRadius: 8,
                border: "1px solid var(--border)",
                background: "var(--surface-2)",
                color: "var(--text)",
                fontSize: 14,
                cursor: "pointer",
              }}
            >
              キャンセル
            </button>
          </div>
        </div>
      )}

      <div
        style={{
          position: "relative",
          marginLeft: -24,
          marginRight: -24,
          paddingLeft: 24,
          paddingRight: 24,
          paddingBottom: 4,
          marginBottom: 4,
          background: "var(--bg-grad)",
          borderBottom: "1px solid transparent",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 4 }}>
          <Link
            href="/pages"
            onClick={(e) => {
              if (canEdit && unsavedRef.current && !window.confirm("変更が保存されていません。このページを離れますか？")) {
                e.preventDefault()
              }
            }}
            style={{ fontSize: 14, color: "var(--muted)", textDecoration: "none" }}
          >
            ← Pages
          </Link>
          <span style={{ color: "var(--muted)" }}>/</span>
          <span style={{ fontSize: 14, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 280 }}>
            {displayTitle || "無題"}
          </span>
          <span style={{ fontSize: 12, color: "var(--muted)", marginLeft: "auto", display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
            {page?.updated_at && <span>最終更新: {formatUpdatedAt(page.updated_at)}</span>}
            {updatedByName && <span>更新者: {updatedByName}</span>}
            {page?.slug && <span>slug: {page.slug}</span>}
            <span>{canEdit ? "編集可" : "閲覧のみ"}</span>
            <button type="button" onClick={copyPageUrl} style={{ padding: "4px 8px", borderRadius: 6, border: "1px solid var(--border)", background: "var(--surface-2)", color: "var(--text)", fontSize: 12, cursor: "pointer" }}>URLをコピー</button>
            <button type="button" onClick={() => setRightPanelOpen((v) => !v)} style={{ padding: "4px 8px", borderRadius: 6, border: "1px solid var(--border)", background: rightPanelOpen ? "var(--surface-2)" : "var(--surface)", color: "var(--text)", fontSize: 12, cursor: "pointer" }}>
              {rightPanelOpen ? "パネルを閉じる" : `コメント / 履歴 (${comments.length + revisions.length})`}
            </button>
            {editor && (
              <button type="button" onClick={copyBlockLink} style={{ padding: "4px 8px", borderRadius: 6, border: "1px solid var(--border)", background: "var(--surface-2)", color: "var(--text)", fontSize: 12, cursor: "pointer" }}>ブロックリンクをコピー</button>
            )}
          </span>
        </div>

        <div
          style={{
            marginBottom: 8,
            border: "1px solid var(--border)",
            borderRadius: 12,
            padding: "10px 12px",
            background:
              practicalGuide.key === "billing"
                ? "linear-gradient(135deg, #fff7ed 0%, #ffffff 100%)"
                : practicalGuide.key === "payouts"
                  ? "linear-gradient(135deg, #ecfeff 0%, #ffffff 100%)"
                  : practicalGuide.key === "notifications"
                    ? "linear-gradient(135deg, #eff6ff 0%, #ffffff 100%)"
                    : "linear-gradient(135deg, #f5f3ff 0%, #ffffff 100%)",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                padding: "4px 8px",
                borderRadius: 999,
                fontSize: 11,
                fontWeight: 700,
                letterSpacing: 0.2,
                color:
                  practicalGuide.key === "billing"
                    ? "#9a3412"
                    : practicalGuide.key === "payouts"
                      ? "#155e75"
                      : practicalGuide.key === "notifications"
                        ? "#1d4ed8"
                        : "#6d28d9",
                background:
                  practicalGuide.key === "billing"
                    ? "#ffedd5"
                    : practicalGuide.key === "payouts"
                      ? "#cffafe"
                      : practicalGuide.key === "notifications"
                        ? "#dbeafe"
                        : "#ede9fe",
              }}
            >
              {practicalGuide.badge}
            </span>
            <div style={{ fontSize: 14, fontWeight: 700, color: "var(--text)" }}>{practicalGuide.title}</div>
          </div>
          <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 10 }}>{practicalGuide.description}</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 8 }}>
            {practicalGuide.actions.map((action) => (
              <Link
                key={action.href}
                href={action.href}
                style={{
                  display: "block",
                  border: "1px solid var(--border)",
                  borderRadius: 10,
                  padding: "10px 12px",
                  textDecoration: "none",
                  background: "rgba(255,255,255,0.82)",
                  boxShadow: "0 8px 20px rgba(15, 23, 42, 0.06)",
                }}
              >
                <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text)", marginBottom: 4 }}>{action.label}</div>
                <div style={{ fontSize: 12, color: "var(--muted)", lineHeight: 1.5 }}>{action.description}</div>
              </Link>
            ))}
          </div>
        </div>

        <div style={{ marginBottom: 8, border: "1px solid var(--border)", borderRadius: 10, padding: "6px 8px", background: "var(--surface)" }}>
          <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 6 }}>関連ページ</div>
          {relatedPages.length > 0 ? (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 6 }}>
              {relatedPages.slice(0, 4).map((rp) => (
                <Link
                  key={rp.id}
                  href={`/pages/${rp.id}`}
                  style={{ border: "1px solid var(--border)", borderRadius: 8, padding: "6px 8px", textDecoration: "none", color: "var(--text)", fontSize: 12, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", background: "var(--surface-2)" }}
                >
                  {rp.title}
                </Link>
              ))}
            </div>
          ) : (
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", fontSize: 12, color: "var(--muted)" }}>
              <span>近いページはまだありません。</span>
              <Link href="/pages" style={{ color: "var(--text)", textDecoration: "none", fontWeight: 600 }}>
                Pages 一覧を見る
              </Link>
              <Link href="/help/pages-manual" style={{ color: "var(--text)", textDecoration: "none", fontWeight: 600 }}>
                Pages ヘルプを見る
              </Link>
            </div>
          )}
        </div>

        {saveError && (
          <div style={{ marginBottom: 8, padding: 10, borderRadius: 10, background: "#fff1f2", color: "#b91c1c", fontSize: 13, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
            <span>{saveError}</span>
            {canEdit && (
              <button type="button" onClick={handleRetrySave} style={{ padding: "6px 12px", borderRadius: 8, border: "1px solid #b91c1c", background: "transparent", color: "#b91c1c", fontSize: 13, cursor: "pointer" }}>
                再試行
              </button>
            )}
          </div>
        )}

        {isVisible("cover") && (
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 8 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
            <span style={{ fontSize: 11, color: "var(--muted)" }}>カバー</span>
            {coverPath ? (
              <>
                <NextImage
                  src={`/api/page-assets?path=${encodeURIComponent(coverPath)}`}
                  alt=""
                  width={84}
                  height={32}
                  unoptimized
                  style={{ height: 32, width: "auto", maxWidth: 84, objectFit: "cover", borderRadius: 6 }}
                />
                {canEdit && (
                  <button
                    type="button"
                    onClick={() => {
                      setCoverPath(null)
                      if (editor) {
                        const nextTitle = titleInput.trim() || "無題"
                        persist(nextTitle, editor.getJSON())
                      }
                    }}
                    style={{
                      padding: "4px 8px",
                      borderRadius: 6,
                      border: "1px solid var(--border)",
                      background: "var(--surface-2)",
                      color: "var(--muted)",
                      fontSize: 11,
                      cursor: "pointer",
                    }}
                  >
                    削除
                  </button>
                )}
              </>
            ) : canEdit ? (
              <label
                style={{
                  padding: "4px 8px",
                  borderRadius: 6,
                  border: "1px solid var(--border)",
                  background: "var(--surface-2)",
                  color: "var(--text)",
                  fontSize: 11,
                  cursor: "pointer",
                }}
              >
                画像を設定
                <input
                  type="file"
                  accept={IMAGE_TYPES.join(",")}
                  style={{ display: "none" }}
                  onChange={async (e) => {
                    const file = e.target.files?.[0]
                    e.target.value = ""
                    if (!file || !IMAGE_TYPES.includes(file.type) || !activeOrgId || !id) return
                    setImageUploading(true)
                    setImageError(null)
                    const ext = file.name.split(".").pop() || "jpg"
                    const path = `${activeOrgId}/pages/${id}/cover-${Date.now()}.${ext}`
                    const { error } = await supabase.storage.from("page-assets").upload(path, file, { upsert: false })
                    if (error) {
                      setImageError("カバー画像のアップロードに失敗しました。")
                      setImageUploading(false)
                      return
                    }
                    setCoverPath(path)
                    if (editor) {
                      const nextTitle = titleInput.trim() || "無題"
                      persist(nextTitle, editor.getJSON())
                    }
                    setImageUploading(false)
                  }}
                />
              </label>
            ) : null}
          </div>
        </div>
        )}

        {canEdit && (
          <div style={{ marginBottom: 8 }}>
            <input ref={fileInputRef} type="file" accept={IMAGE_TYPES.join(",")} onChange={handleFileSelect} style={{ display: "none" }} />
            <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
            <div
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 4,
                padding: "3px 5px",
                borderRadius: 999,
                border: "1px solid var(--border)",
                background: "var(--surface)",
              }}
            >
              {isVisible("bold") && (
              <button
                type="button"
                onClick={() => editorInstance?.chain().focus().toggleBold().run()}
                style={{
                  padding: "4px 6px",
                  borderRadius: 6,
                  border: "none",
                  background: editorInstance?.isActive("bold") ? "var(--surface-2)" : "transparent",
                  color: "var(--text)",
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                B
              </button>
              )}
              {isVisible("h2") && (
              <button
                type="button"
                onClick={() => editorInstance?.chain().focus().toggleHeading({ level: 2 }).run()}
                style={{
                  padding: "4px 6px",
                  borderRadius: 6,
                  border: "none",
                  background: editorInstance?.isActive("heading", { level: 2 }) ? "var(--surface-2)" : "transparent",
                  color: "var(--text)",
                  fontSize: 13,
                  cursor: "pointer",
                }}
              >
                H2
              </button>
              )}
              {isVisible("bulletList") && (
              <button
                type="button"
                onClick={() => editorInstance?.chain().focus().toggleBulletList().run()}
                style={{
                  padding: "4px 6px",
                  borderRadius: 6,
                  border: "none",
                  background: editorInstance?.isActive("bulletList") ? "var(--surface-2)" : "transparent",
                  color: "var(--text)",
                  fontSize: 13,
                  cursor: "pointer",
                }}
              >
                ・ 箇条書き
              </button>
              )}
              {isVisible("orderedList") && (
              <button
                type="button"
                onClick={() => editorInstance?.chain().focus().toggleOrderedList().run()}
                style={{
                  padding: "4px 6px",
                  borderRadius: 6,
                  border: "none",
                  background: editorInstance?.isActive("orderedList") ? "var(--surface-2)" : "transparent",
                  color: "var(--text)",
                  fontSize: 13,
                  cursor: "pointer",
                }}
              >
                1. 番号付き
              </button>
              )}
              {isVisible("blockquote") && (
              <button
                type="button"
                onClick={() => editorInstance?.chain().focus().toggleBlockquote().run()}
                style={{
                  padding: "4px 6px",
                  borderRadius: 6,
                  border: "none",
                  background: editorInstance?.isActive("blockquote") ? "var(--surface-2)" : "transparent",
                  color: "var(--text)",
                  fontSize: 13,
                  cursor: "pointer",
                }}
              >
                引用
              </button>
              )}
              {isVisible("codeBlock") && (
              <button
                type="button"
                onClick={() => editorInstance?.chain().focus().toggleCodeBlock().run()}
                style={{
                  padding: "4px 6px",
                  borderRadius: 6,
                  border: "none",
                  background: editorInstance?.isActive("codeBlock") ? "var(--surface-2)" : "transparent",
                  color: "var(--text)",
                  fontSize: 13,
                  cursor: "pointer",
                }}
              >
                {'</>'}
              </button>
              )}
              {isVisible("link") && (
              <button
                type="button"
                onClick={openLinkModal}
                style={{
                  padding: "4px 6px",
                  borderRadius: 6,
                  border: "none",
                  background: editorInstance?.isActive("link") ? "var(--surface-2)" : "transparent",
                  color: "var(--text)",
                  fontSize: 13,
                  cursor: "pointer",
                }}
              >
                リンク
              </button>
              )}
              {isVisible("pageLink") && (
              <button
                type="button"
                onClick={() => setPageLinkModalOpen(true)}
                title="他ページへのリンクを挿入"
                style={{
                  padding: "4px 6px",
                  borderRadius: 6,
                  border: "none",
                  background: "transparent",
                  color: "var(--text)",
                  fontSize: 13,
                  cursor: "pointer",
                }}
              >
                ページリンク
              </button>
              )}
              {isVisible("horizontalRule") && (
              <button
                type="button"
                onClick={() => editorInstance?.chain().focus().setHorizontalRule().run()}
                style={{
                  padding: "4px 6px",
                  borderRadius: 6,
                  border: "none",
                  background: "transparent",
                  color: "var(--text)",
                  fontSize: 13,
                  cursor: "pointer",
                }}
              >
                区切り線
              </button>
              )}
              {isVisible("embed") && (
              <button
                type="button"
                onClick={() => openEmbedComposer()}
                style={{
                  padding: "4px 6px",
                  borderRadius: 6,
                  border: "none",
                  background: "transparent",
                  color: "var(--text)",
                  fontSize: 13,
                  cursor: "pointer",
                }}
              >
                埋め込み
              </button>
              )}
              {isVisible("checklist") && (
              <button
                type="button"
                onClick={() => editorInstance?.chain().focus().toggleTaskList().run()}
                style={{
                  padding: "4px 6px",
                  borderRadius: 6,
                  border: "none",
                  background: editorInstance?.isActive("taskList") ? "var(--surface-2)" : "transparent",
                  color: "var(--text)",
                  fontSize: 13,
                  cursor: "pointer",
                }}
              >
                チェックリスト
              </button>
              )}
              {isVisible("image") && (
              <button
                type="button"
                onClick={triggerFileInput}
                disabled={imageUploading}
                style={{
                  padding: "4px 6px",
                  borderRadius: 6,
                  border: "none",
                  background: "transparent",
                  color: "var(--text)",
                  fontSize: 13,
                  cursor: imageUploading ? "not-allowed" : "pointer",
                }}
              >
                画像
              </button>
              )}
              {isVisible("ai") && (
              <div ref={aiToolsRef} style={{ position: "relative" }}>
                <button
                  type="button"
                  onClick={() => setAiToolsOpen((v) => !v)}
                  aria-expanded={aiToolsOpen}
                  aria-haspopup="true"
                  title="AIメニュー"
                  style={{
                    padding: "4px 8px",
                    borderRadius: 6,
                    border: "1px solid var(--border)",
                    background: aiToolsOpen ? "var(--surface-2)" : "transparent",
                    color: "var(--text)",
                    fontSize: 13,
                    cursor: "pointer",
                  }}
                >
                  AI {aiToolsOpen ? "▴" : "▾"}
                </button>
                {aiToolsOpen && (
                  <div
                    style={{
                      position: "absolute",
                      top: "calc(100% + 6px)",
                      left: 0,
                      minWidth: 132,
                      padding: 6,
                      borderRadius: 8,
                      border: "1px solid var(--border)",
                      background: "var(--surface)",
                      boxShadow: "0 8px 18px rgba(0,0,0,0.12)",
                      zIndex: 30,
                      display: "grid",
                      gap: 4,
                    }}
                  >
                    <button
                      type="button"
                      onClick={() => {
                        if (!editorInstance) return
                        const sel = editorInstance.state.selection
                        const hasSelection = sel && !sel.empty
                        const doc = editorInstance.state.doc
                        const selectedText = hasSelection
                          ? doc.textBetween(sel.from, sel.to, "\n")
                          : doc.textBetween(0, doc.content.size, "\n")
                        window.dispatchEvent(
                          new CustomEvent("open-ai-palette", {
                            detail: {
                              source: "pages" as const,
                              text: selectedText,
                              compareText: selectedText,
                              mode: "summarize" as const,
                              title: "Pages AI",
                            },
                          })
                        )
                        setAiToolsOpen(false)
                      }}
                      style={{
                        padding: "6px 8px",
                        borderRadius: 6,
                        border: "none",
                        background: "transparent",
                        color: "var(--text)",
                        fontSize: 12,
                        textAlign: "left",
                        cursor: "pointer",
                      }}
                    >
                      AI要約
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        if (!editorInstance) return
                        const sel = editorInstance.state.selection
                        const hasSelection = sel && !sel.empty
                        const doc = editorInstance.state.doc
                        const selectedText = hasSelection
                          ? doc.textBetween(sel.from, sel.to, "\n")
                          : doc.textBetween(0, doc.content.size, "\n")
                        window.dispatchEvent(
                          new CustomEvent("open-ai-palette", {
                            detail: {
                              source: "pages" as const,
                              text: selectedText,
                              compareText: selectedText,
                              mode: "procedure" as const,
                              title: "Pages AI",
                            },
                          })
                        )
                        setAiToolsOpen(false)
                      }}
                      style={{
                        padding: "6px 8px",
                        borderRadius: 6,
                        border: "none",
                        background: "transparent",
                        color: "var(--text)",
                        fontSize: 12,
                        textAlign: "left",
                        cursor: "pointer",
                      }}
                    >
                      AI手順化
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        if (!editorInstance) return
                        const sel = editorInstance.state.selection
                        const hasSelection = sel && !sel.empty
                        const doc = editorInstance.state.doc
                        const selectedText = hasSelection
                          ? doc.textBetween(sel.from, sel.to, "\n")
                          : doc.textBetween(0, doc.content.size, "\n")
                        window.dispatchEvent(
                          new CustomEvent("open-ai-palette", {
                            detail: {
                              source: "pages" as const,
                              text: selectedText,
                              compareText: selectedText,
                              mode: "checklist" as const,
                              title: "Pages AI",
                            },
                          })
                        )
                        setAiToolsOpen(false)
                      }}
                      style={{
                        padding: "6px 8px",
                        borderRadius: 6,
                        border: "none",
                        background: "transparent",
                        color: "var(--text)",
                        fontSize: 12,
                        textAlign: "left",
                        cursor: "pointer",
                      }}
                    >
                      AIチェックリスト化
                    </button>
                  </div>
                )}
              </div>
              )}
            </div>
            <span
              style={{
                fontSize: 12,
                fontWeight: 500,
                color: saveStatus === "error" ? "#b91c1c" : saveStatus === "saved" ? "#15803d" : "var(--muted)",
              }}
            >
              {saveStatus === "saving" && "保存中…"}
              {saveStatus === "saved" && "✓ 保存済み"}
              {saveStatus === "error" && "保存に失敗"}
            </span>
            {imageUploading && (
              <span style={{ fontSize: 12, color: "var(--muted)" }}>画像アップロード中…</span>
            )}
          </div>
          </div>
        )}

        <div style={{ marginBottom: 4 }}>
          <input
            type="text"
            value={titleInput}
            onChange={(e) => handleTitleChange(e.target.value)}
            disabled={!canEdit}
            placeholder="無題"
            style={{
              width: "100%",
              paddingTop: 10,
              paddingBottom: 10,
              fontSize: 24,
              fontWeight: 700,
              color: "var(--text)",
              background: "var(--surface)",
              border: "1px solid var(--border)",
              borderRadius: 10,
              paddingLeft: 16,
              paddingRight: 12,
              outline: "none",
              caretColor: "var(--primary)",
            }}
          />
        </div>

      </div>

      {tocHeadings.length > 0 && (
        <div style={{ marginBottom: 16 }}>
          <button
            type="button"
            onClick={() => setTocOpen((v) => !v)}
            style={{
              padding: "8px 12px",
              borderRadius: 8,
              border: "1px solid var(--border)",
              background: "var(--surface-2)",
              color: "var(--text)",
              fontSize: 13,
              cursor: "pointer",
            }}
          >
            {tocOpen ? "目次を閉じる" : "目次"}
          </button>
          {tocOpen && (
            <nav aria-label="目次" style={{ marginTop: 8, padding: "12px 16px", borderRadius: 10, border: "1px solid var(--border)", background: "var(--surface-2)" }}>
              <ul style={{ margin: 0, paddingLeft: 20, listStyle: "none" }}>
                {tocHeadings.map((h, i) => (
                  <li
                    key={i}
                    style={{
                      marginBottom: 4,
                      paddingLeft: (h.level - 1) * 12,
                      fontSize: 13,
                      lineHeight: 1.5,
                    }}
                  >
                    <button
                      type="button"
                      onClick={() => {
                        const el = editor?.view.dom.querySelectorAll("h1, h2, h3")[i]
                        el?.scrollIntoView({ behavior: "smooth" })
                      }}
                      style={{
                        background: "none",
                        border: "none",
                        padding: 0,
                        color: "var(--primary)",
                        cursor: "pointer",
                        textAlign: "left",
                        width: "100%",
                        fontSize: "inherit",
                      }}
                    >
                      {h.text}
                    </button>
                  </li>
                ))}
              </ul>
            </nav>
          )}
        </div>
      )}

      {imageError && (
        <div style={{ marginBottom: 12, padding: 10, borderRadius: 8, background: "#fff1f2", color: "#b91c1c", fontSize: 13 }}>
          {imageError}
        </div>
      )}

      <div
        className="ProseMirror-wrapper"
        onClick={() => editor?.chain().focus().run()}
        onMouseMove={handleEditorMouseMove}
        onMouseLeave={() => {
          setGutterBlockIndex(null)
          setGutterMenuOpen(false)
          setGutterReady(false)
        }}
        onDragOver={(e) => {
          if (!canEdit || dragFromIndex == null) return
          e.preventDefault()
        }}
        onDrop={(e) => {
          if (!canEdit || dragFromIndex == null) return
          e.preventDefault()
          const to = getBlockIndexFromTarget(e.target)
          if (to != null) reorderBlock(dragFromIndex, to)
          setDragFromIndex(null)
        }}
        ref={editorWrapperRef}
        style={{
          minHeight: "clamp(680px, 76vh, 1200px)",
          padding: "20px 14px 20px 44px",
          fontSize: 15,
          lineHeight: 1.7,
          color: "var(--text)",
          background: "var(--surface)",
          border: "1px solid var(--border)",
          borderRadius: 12,
          cursor: canEdit ? "text" : "default",
          position: "relative",
        }}
      >
        {canEdit && gutterReady && gutterTop > 0 && (gutterBlockIndex != null || (editor?.isFocused && activeBlockIndex != null)) && (
          <div
            style={{
              position: "absolute",
              left: 6,
              top: gutterTop,
              zIndex: 5,
              display: "flex",
              alignItems: "center",
              gap: 4,
              opacity: gutterBlockIndex != null ? 0.9 : 0.45,
              transition: "opacity 120ms ease",
            }}
          >
            <button
              type="button"
              draggable
              onDragStart={() => setDragFromIndex(gutterBlockIndex ?? activeBlockIndex)}
              onDragEnd={() => setDragFromIndex(null)}
              style={{
                width: 14,
                height: 14,
                borderRadius: 5,
                border: "1px solid var(--border)",
                background: "var(--surface-2)",
                color: "var(--muted)",
                cursor: "grab",
                fontSize: 9,
                lineHeight: 1,
                padding: 0,
              }}
              aria-label="ブロックをドラッグ"
              title="ドラッグで並び替え"
            >
              ⋮⋮
            </button>
            <button
              type="button"
              onClick={() => setGutterMenuOpen((v) => !v)}
              style={{
                width: 14,
                height: 14,
                borderRadius: 5,
                border: "1px solid var(--border)",
                background: "var(--surface-2)",
                color: "var(--text)",
                cursor: "pointer",
                fontSize: 11,
                lineHeight: 1,
                padding: 0,
              }}
              aria-label="ブロックを追加"
            >
              +
            </button>
            {gutterMenuOpen && (
              <div
                style={{
                  position: "absolute",
                  top: 24,
                  left: 0,
                  minWidth: 160,
                  borderRadius: 8,
                  border: "1px solid var(--border)",
                  background: "var(--surface)",
                  boxShadow: "0 10px 24px rgba(0,0,0,0.14)",
                  padding: 4,
                }}
              >
                <button type="button" onClick={() => insertBlockBelow("paragraph")} style={{ display: "block", width: "100%", textAlign: "left", padding: "6px 8px", borderRadius: 6, border: "none", background: "transparent", color: "var(--text)", cursor: "pointer", fontSize: 12 }}>＋ テキスト行</button>
                <button type="button" onClick={() => insertBlockBelow("bulletList")} style={{ display: "block", width: "100%", textAlign: "left", padding: "6px 8px", borderRadius: 6, border: "none", background: "transparent", color: "var(--text)", cursor: "pointer", fontSize: 12 }}>・ 箇条書き</button>
                <button type="button" onClick={() => insertBlockBelow("taskList")} style={{ display: "block", width: "100%", textAlign: "left", padding: "6px 8px", borderRadius: 6, border: "none", background: "transparent", color: "var(--text)", cursor: "pointer", fontSize: 12 }}>☑ チェックリスト</button>
              </div>
            )}
          </div>
        )}
        {editor && canEdit && (
          <BubbleMenu
            editor={editor}
            style={{
              display: "flex",
              gap: 4,
              padding: "4px 6px",
              borderRadius: 8,
              border: "1px solid var(--border)",
              background: "var(--surface)",
              boxShadow: "0 4px 12px rgba(0,0,0,0.12)",
              fontSize: 13,
            }}
          >
            <button
              type="button"
              onClick={() => {
                const sel = editor.state.selection
                const hasSelection = sel && !sel.empty
                const doc = editor.state.doc
                const text = hasSelection ? doc.textBetween(sel.from, sel.to, "\n") : doc.textBetween(0, doc.content.size, "\n")
                if (!text.trim()) return
                window.dispatchEvent(
                  new CustomEvent("open-ai-palette", {
                    detail: {
                      source: "pages" as const,
                      text,
                      compareText: text,
                      mode: "summarize" as const,
                      title: "Pages AI",
                    },
                  })
                )
              }}
              style={{
                padding: "6px 10px",
                borderRadius: 6,
                border: "none",
                background: "var(--surface-2)",
                color: "var(--text)",
                cursor: "pointer",
              }}
            >
              要約
            </button>
            <button
              type="button"
              onClick={() => {
                const sel = editor.state.selection
                const hasSelection = sel && !sel.empty
                const doc = editor.state.doc
                const text = hasSelection ? doc.textBetween(sel.from, sel.to, "\n") : doc.textBetween(0, doc.content.size, "\n")
                if (!text.trim()) return
                window.dispatchEvent(
                  new CustomEvent("open-ai-palette", {
                    detail: {
                      source: "pages" as const,
                      text,
                      compareText: text,
                      mode: "rewrite" as const,
                      title: "Pages AI",
                    },
                  })
                )
              }}
              style={{
                padding: "6px 10px",
                borderRadius: 6,
                border: "none",
                background: "var(--surface-2)",
                color: "var(--text)",
                cursor: "pointer",
              }}
            >
              書き換え
            </button>
          </BubbleMenu>
        )}
        <EditorContent editor={editor} />
      </div>

      {charCount > 0 && (
        <p style={{ marginTop: 24, fontSize: 12, color: "var(--muted)" }} aria-live="polite">
          文字数 {charCount.toLocaleString()} 字 / 読了目安 {readMinutes} 分
        </p>
      )}

      {canEdit && (
        <p style={{ marginTop: 8, fontSize: 12, color: "var(--muted)" }}>
          タイトル欄または本文エリアをクリックすると入力できます。
        </p>
      )}

      <style jsx global>{`
        .ProseMirror-wrapper .ProseMirror {
          outline: none;
          min-height: 240px;
        }
        .ProseMirror-wrapper .ProseMirror p.is-editor-empty:first-child::before {
          content: '本文を書き始める…';
          float: left;
          color: var(--muted);
          pointer-events: none;
          height: 0;
        }
        .ProseMirror-wrapper .ProseMirror img {
          max-width: 100%;
          height: auto;
          border-radius: 8px;
        }
        .ProseMirror-wrapper .ProseMirror a {
          color: #4338ca;
          text-decoration: underline;
          text-underline-offset: 2px;
          text-decoration-thickness: 2px;
          font-weight: 600;
          cursor: pointer;
        }
        .ProseMirror-wrapper .ProseMirror ul {
          list-style: disc;
          padding-left: 1.5rem;
          margin: 0.5em 0;
        }
        .ProseMirror-wrapper .ProseMirror ol {
          list-style: decimal;
          padding-left: 1.5rem;
          margin: 0.5em 0;
        }
        .ProseMirror-wrapper .ProseMirror li {
          margin: 0.2em 0;
        }
        .ProseMirror-wrapper .ProseMirror blockquote {
          margin: 0.6em 0;
          padding: 0.35em 0.8em;
          border-left: 3px solid var(--chip-border);
          background: var(--surface-2);
          border-radius: 6px;
        }
        .ProseMirror-wrapper .ProseMirror pre {
          margin: 0.6em 0;
          padding: 10px 12px;
          border-radius: 8px;
          border: 1px solid var(--border);
          background: var(--input-bg);
          overflow-x: auto;
        }
        .ProseMirror-wrapper .ProseMirror code {
          font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
          font-size: 0.9em;
        }
        .ProseMirror-wrapper .ProseMirror p:has(> a:only-child) {
          display: block;
          padding: 12px 16px;
          border: 1px solid var(--border);
          border-radius: 10px;
          background: var(--surface-2);
          margin: 0.5em 0;
        }
        .ProseMirror-wrapper .ProseMirror p:has(> a:only-child) a {
          display: block;
          word-break: break-all;
        }
        .ProseMirror-wrapper .ProseMirror .pages-embed-block {
          margin: 1.1em 0;
        }
        .ProseMirror-wrapper .ProseMirror .pages-embed-block iframe {
          display: block;
          width: 100%;
          max-width: 100%;
          box-shadow: 0 28px 48px rgba(15, 23, 42, 0.1);
        }
        .ProseMirror-wrapper .ProseMirror .pages-embed-block--bleed {
          position: relative;
          left: 50%;
          transform: translateX(-50%);
          width: min(calc(100vw - 96px), calc(100% + 220px));
          max-width: calc(100vw - 96px);
        }
        .ProseMirror-wrapper .ProseMirror .pages-embed-block--link {
          display: grid;
          gap: 8px;
          padding: 18px 20px;
          border-radius: 22px;
          border: 1px solid var(--border);
          background: linear-gradient(180deg, var(--surface-2), rgba(255, 247, 237, 0.96));
        }
        .ProseMirror-wrapper .ProseMirror .pages-embed-link-card__label {
          font-size: 12px;
          font-weight: 700;
          letter-spacing: 0.04em;
          color: var(--muted);
        }
        .ProseMirror-wrapper .ProseMirror .pages-embed-link-card__anchor {
          word-break: break-all;
          color: var(--text);
          text-decoration: none;
          font-weight: 600;
        }
        @media (max-width: 900px) {
          .ProseMirror-wrapper .ProseMirror .pages-embed-block--bleed {
            width: calc(100% + 24px);
            max-width: calc(100vw - 32px);
          }
        }
        .ProseMirror-wrapper .ProseMirror hr,
        .ProseMirror-wrapper .ProseMirror .pages-editor-hr {
          border: none;
          border-top: 1px solid var(--border);
          margin: 1em 0;
        }
        .ProseMirror-wrapper .ProseMirror ul[data-type="taskList"] {
          list-style: none;
          padding-left: 0;
        }
        .ProseMirror-wrapper .ProseMirror li[data-type="taskItem"] {
          display: flex;
          align-items: flex-start;
          gap: 8px;
        }
        .ProseMirror-wrapper .ProseMirror li[data-type="taskItem"] > label {
          flex-shrink: 0;
          cursor: pointer;
        }
      `}</style>
    </div>

      {rightPanelOpen && (
        <div
          style={{
            width: "min(100%, 360px)",
            borderLeft: "1px solid var(--border)",
            background: "var(--surface)",
            display: "flex",
            flexDirection: "column",
            maxHeight: "100vh",
            overflow: "hidden",
          }}
        >
          <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--border)", display: "flex", gap: 8 }}>
            <button type="button" onClick={() => setPanelTab("comments")} style={{ padding: "8px 12px", borderRadius: 8, border: "none", background: panelTab === "comments" ? "var(--surface-2)" : "transparent", color: "var(--text)", fontSize: 13, cursor: "pointer", fontWeight: panelTab === "comments" ? 600 : 400 }}>コメント</button>
            <button type="button" onClick={() => setPanelTab("revisions")} style={{ padding: "8px 12px", borderRadius: 8, border: "none", background: panelTab === "revisions" ? "var(--surface-2)" : "transparent", color: "var(--text)", fontSize: 13, cursor: "pointer", fontWeight: panelTab === "revisions" ? 600 : 400 }}>更新履歴</button>
            <button type="button" onClick={() => setRightPanelOpen(false)} style={{ marginLeft: "auto", padding: "8px", border: "none", background: "transparent", color: "var(--muted)", cursor: "pointer", fontSize: 18 }} aria-label="閉じる">×</button>
          </div>
          <div style={{ padding: "10px 16px 0" }}>
            <input
              type="search"
              value={panelSearch}
              onChange={(e) => setPanelSearch(e.target.value)}
              placeholder={panelTab === "comments" ? "コメントを検索" : "履歴を検索"}
              style={{ width: "100%", padding: "8px 10px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--input-bg)", color: "var(--text)", fontSize: 12 }}
            />
          </div>
          <div style={{ flex: 1, overflowY: "auto", padding: 16 }}>
            {panelTab === "comments" ? (
              <>
                {loadingComments ? <p style={{ fontSize: 13, color: "var(--muted)" }}>読み込み中…</p> : (
                  <ul style={{ listStyle: "none", padding: 0, margin: "0 0 16px 0" }}>
                    {filteredComments.map((c) => (
                      <li
                        key={c.id}
                        style={{
                          marginBottom: 12,
                          padding: 12,
                          borderRadius: 8,
                          background: "var(--surface-2)",
                          cursor: c.selection_range ? "pointer" : undefined,
                        }}
                        onClick={
                          editor
                            ? () => {
                                if (c.selection_range) {
                                  const { from, to } = c.selection_range
                                  const size = editor.state.doc.content.size
                                  const safeFrom = Math.min(from, size)
                                  const safeTo = Math.min(to, size)
                                  editor.commands.focus()
                                  editor.commands.setTextSelection({ from: safeFrom, to: safeTo })
                                  editor.view.dispatch(editor.state.tr.setMeta(commentHighlightPluginKey, { from: safeFrom, to: safeTo }))
                                } else {
                                  editor.view.dispatch(editor.state.tr.setMeta(commentHighlightPluginKey, null))
                                }
                              }
                            : undefined
                        }
                      >
                        <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 4 }}>
                          {c.display_name} ・ {new Date(c.created_at).toLocaleString("ja-JP")}
                          {c.selection_range && <span style={{ marginLeft: 6, padding: "2px 6px", borderRadius: 4, background: "var(--border)", fontSize: 11 }}>選択範囲</span>}
                        </div>
                        <p style={{ margin: 0, fontSize: 14, whiteSpace: "pre-wrap" }}>{c.body}</p>
                        {(role === "owner" || role === "executive_assistant" || c.user_id === currentUserId) && (
                          <button
                            type="button"
                            onClick={async (e) => {
                              e.stopPropagation()
                              const { data } = await supabase.auth.getSession()
                              const token = data.session?.access_token
                              if (!token) return
                              await fetch(`/api/pages/${id}/comments/${c.id}`, { method: "DELETE", headers: { Authorization: `Bearer ${token}` } })
                              loadComments()
                            }}
                            style={{ marginTop: 8, padding: "4px 8px", fontSize: 12, border: "1px solid var(--border)", borderRadius: 6, background: "transparent", color: "var(--muted)", cursor: "pointer" }}
                          >
                            削除
                          </button>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
                {role && (
                  <div style={{ marginTop: 12 }}>
                    <textarea value={commentInput} onChange={(e) => setCommentInput(e.target.value)} placeholder="コメントを追加…" rows={3} style={{ width: "100%", padding: 10, borderRadius: 8, border: "1px solid var(--border)", background: "var(--input-bg)", color: "var(--text)", fontSize: 13, resize: "vertical" }} />
                    <button
                      type="button"
                      disabled={!commentInput.trim()}
                      onClick={async () => {
                        const { data } = await supabase.auth.getSession()
                        const token = data.session?.access_token
                        if (!token || !commentInput.trim()) return
                        const sel = editor?.state.selection
                        const selectionRange =
                          sel && sel.from !== sel.to && typeof sel.from === "number" && typeof sel.to === "number"
                            ? { from: sel.from, to: sel.to }
                            : undefined
                        const body: { body: string; selection_range?: { from: number; to: number } } = { body: commentInput.trim() }
                        if (selectionRange) body.selection_range = selectionRange
                        const res = await fetch(`/api/pages/${id}/comments`, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(body) })
                        if ((await res.json())?.ok) {
                          setCommentInput("")
                          loadComments()
                          setToastMessage(selectionRange ? "選択範囲にコメントを追加しました" : "コメントを追加しました")
                        }
                      }}
                      style={{ marginTop: 8, padding: "8px 16px", borderRadius: 8, border: "none", background: commentInput.trim() ? "var(--primary)" : "var(--surface-2)", color: commentInput.trim() ? "var(--primary-contrast)" : "var(--muted)", fontSize: 13, cursor: commentInput.trim() ? "pointer" : "not-allowed" }}
                    >
                      追加
                    </button>
                  </div>
                )}
              </>
            ) : (
              <>
                {loadingRevisions ? <p style={{ fontSize: 13, color: "var(--muted)" }}>読み込み中…</p> : (
                  <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
                    {filteredRevisions.map((r) => (
                      <li key={r.id} style={{ marginBottom: 12, padding: 12, borderRadius: 8, border: "1px solid var(--border)" }}>
                        <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>{r.title || "無題"}</div>
                        <div style={{ fontSize: 12, color: "var(--muted)" }}>{r.updated_by_name} ・ {new Date(r.created_at).toLocaleString("ja-JP")}</div>
                        <div style={{ marginTop: 8, display: "flex", gap: 8, flexWrap: "wrap" }}>
                          <button type="button" onClick={() => setDiffRevisionId(r.id)} style={{ padding: "4px 10px", fontSize: 12, border: "1px solid var(--border)", borderRadius: 6, background: "var(--surface-2)", color: "var(--text)", cursor: "pointer" }}>差分</button>
                          {canEdit && (
                            <button type="button" onClick={() => setRestoreTargetId(r.id)} style={{ padding: "4px 10px", fontSize: 12, border: "1px solid var(--border)", borderRadius: 6, background: "var(--surface-2)", color: "var(--text)", cursor: "pointer" }}>この版に復元</button>
                          )}
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
                {diffRevisionId && (() => {
                  const rev = revisions.find((r) => r.id === diffRevisionId)
                  const oldJson = (rev?.body_json ?? null) as JSONContent | null
                  const newJson = (editor?.getJSON() ?? page?.content ?? null) as JSONContent | null
                  const oldText = getPlainTextFromJson(oldJson) || "(空)"
                  const newText = getPlainTextFromJson(newJson) || "(空)"
                  const changes = Diff.diffLines(oldText, newText)
                  return (
                    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", zIndex: 10001, display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }} onClick={() => setDiffRevisionId(null)}>
                      <div style={{ background: "var(--surface)", padding: 24, borderRadius: 12, maxWidth: 640, maxHeight: "80vh", overflow: "hidden", display: "flex", flexDirection: "column", border: "1px solid var(--border)" }} onClick={(e) => e.stopPropagation()}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                          <h3 style={{ margin: 0, fontSize: 16 }}>差分表示: {rev?.title || "無題"} · {rev ? new Date(rev.created_at).toLocaleString("ja-JP") : ""}</h3>
                          <button type="button" onClick={() => setDiffRevisionId(null)} style={{ padding: "4px 8px", border: "none", background: "transparent", color: "var(--muted)", cursor: "pointer", fontSize: 18 }} aria-label="閉じる">×</button>
                        </div>
                        <div style={{ flex: 1, overflow: "auto", fontFamily: "monospace", fontSize: 12, whiteSpace: "pre-wrap", wordBreak: "break-all", padding: 12, background: "var(--input-bg)", borderRadius: 8 }}>
                          {changes.map((part, i) => (
                            <span
                              key={i}
                              style={{
                                backgroundColor: part.added ? "rgba(34,197,94,0.3)" : part.removed ? "rgba(239,68,68,0.3)" : "transparent",
                                textDecoration: part.removed ? "line-through" : undefined,
                              }}
                            >
                              {part.value}
                            </span>
                          ))}
                        </div>
                        <p style={{ margin: "8px 0 0", fontSize: 11, color: "var(--muted)" }}>差分の追加・削除を表示</p>
                      </div>
                    </div>
                  )
                })()}
                {restoreTargetId && (
                  <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", zIndex: 10001, display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }} onClick={() => setRestoreTargetId(null)}>
                    <div style={{ background: "var(--surface)", padding: 24, borderRadius: 12, maxWidth: 400 }} onClick={(e) => e.stopPropagation()}>
                      <p style={{ marginBottom: 16 }}>この版に復元しますか？ 現在の内容は履歴に残ります。</p>
                      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                        <button type="button" onClick={() => setRestoreTargetId(null)} style={{ padding: "8px 16px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--surface-2)", cursor: "pointer" }}>キャンセル</button>
                        <button type="button" onClick={async () => {
                          const { data } = await supabase.auth.getSession()
                          const token = data.session?.access_token
                          if (!token || !restoreTargetId) return
                          const res = await fetch(`/api/pages/${id}/restore`, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ revision_id: restoreTargetId }) })
                          const json = await res.json().catch(() => null)
                          if (json?.ok) { setRestoreTargetId(null); setToastMessage("復元しました"); if (page) setPage({ ...page, title: json.title, content: json.content as PageRow["content"] }); if (editor) editor.commands.setContent(json.content ?? {}, { emitUpdate: false }); loadRevisions(); } else { setToastMessage("復元に失敗しました") }
                        }} style={{ padding: "8px 16px", borderRadius: 8, border: "none", background: "var(--primary)", color: "var(--primary-contrast)", cursor: "pointer" }}>復元する</button>
                      </div>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}



