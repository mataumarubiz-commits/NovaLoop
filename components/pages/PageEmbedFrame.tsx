"use client"

import Link from "next/link"
import { useEffect, useMemo, useState } from "react"
import { EditorContent, useEditor, type Editor, type JSONContent } from "@tiptap/react"
import StarterKit from "@tiptap/starter-kit"
import LinkExtension from "@tiptap/extension-link"
import Image from "@tiptap/extension-image"
import HorizontalRule from "@tiptap/extension-horizontal-rule"
import TaskList from "@tiptap/extension-task-list"
import TaskItem from "@tiptap/extension-task-item"
import { Embed } from "@/lib/embedExtension"
import { titleToSlug } from "@/lib/slug"
import { supabase } from "@/lib/supabase"

type PageFrameRow = {
  id: string
  title: string
  content: JSONContent
  cover_path?: string | null
}

function sanitizeJsonContent(node: unknown): JSONContent {
  const fallbackDoc: JSONContent = { type: "doc", content: [{ type: "paragraph" }] }
  if (!node || typeof node !== "object") return fallbackDoc
  const root = node as JSONContent

  const walk = (value: unknown): JSONContent | null => {
    if (!value || typeof value !== "object") return null
    const raw = value as JSONContent
    if (typeof raw.type !== "string" || raw.type.length === 0) return null
    const next: JSONContent = { type: raw.type }
    if (raw.attrs && typeof raw.attrs === "object") next.attrs = raw.attrs
    if (typeof raw.text === "string") next.text = raw.text
    if (Array.isArray(raw.content)) {
      const children = raw.content.map((child) => walk(child)).filter((child): child is JSONContent => child != null)
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

function hasLeadHeading(content: JSONContent | null | undefined) {
  const blocks = Array.isArray(content?.content) ? content.content : []
  const firstBlock = blocks.find((block) => block && typeof block === "object")
  return firstBlock?.type === "heading"
}

function assignAnchors(editor: Editor) {
  try {
    const dom = editor.view.dom
    const headings = dom.querySelectorAll("h1, h2, h3")
    headings.forEach((element, index) => {
      const text = (element.textContent || "").trim()
      ;(element as HTMLElement).id = titleToSlug(text) || `heading-${index}`
    })

    const blocks = dom.querySelectorAll(".ProseMirror > *")
    blocks.forEach((element, index) => {
      ;(element as HTMLElement).id = `block-${index}`
    })

    const hash = typeof window !== "undefined" ? window.location.hash : ""
    if (!hash) return
    dom.querySelector(hash)?.scrollIntoView({ behavior: "smooth", block: "start" })
  } catch {
    // Ignore best-effort anchor syncing.
  }
}

export default function PageEmbedFrame({ pageId }: { pageId: string }) {
  const [status, setStatus] = useState<"loading" | "ready" | "logged_out" | "error">("loading")
  const [page, setPage] = useState<PageFrameRow | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const loginHref = useMemo(() => `/?redirectTo=${encodeURIComponent(`/pages/${pageId}/embed`)}`, [pageId])

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        link: false,
        horizontalRule: false,
      }),
      LinkExtension.configure({
        openOnClick: true,
        autolink: true,
        linkOnPaste: true,
        HTMLAttributes: { rel: "noopener noreferrer" },
      }),
      Image.configure({ HTMLAttributes: { class: "max-w-full h-auto rounded-lg" } }),
      HorizontalRule.configure({ HTMLAttributes: { class: "pages-editor-hr" } }),
      TaskList,
      TaskItem.configure({ nested: true }),
      Embed,
    ],
    content: sanitizeJsonContent(page?.content),
    editable: false,
    immediatelyRender: false,
  })

  useEffect(() => {
    if (!editor || !page) return
    editor.commands.setContent(sanitizeJsonContent(page.content), { emitUpdate: false })

    const frame = window.requestAnimationFrame(() => assignAnchors(editor))
    return () => window.cancelAnimationFrame(frame)
  }, [editor, page])

  useEffect(() => {
    if (!editor) return

    const syncAnchors = () => assignAnchors(editor)
    syncAnchors()

    editor.on("update", syncAnchors)
    window.addEventListener("hashchange", syncAnchors)

    return () => {
      editor.off("update", syncAnchors)
      window.removeEventListener("hashchange", syncAnchors)
    }
  }, [editor])

  useEffect(() => {
    let active = true

    void (async () => {
      try {
        const { data } = await supabase.auth.getSession()
        const token = data.session?.access_token
        if (!active) return
        if (!token) {
          setStatus("logged_out")
          return
        }

        const response = await fetch(`/api/pages/${pageId}`, {
          headers: { Authorization: `Bearer ${token}` },
        })
        const json = (await response.json().catch(() => null)) as
          | { ok?: boolean; page?: PageFrameRow; message?: string }
          | null

        if (!active) return
        if (!response.ok || !json?.ok || !json.page) {
          setStatus("error")
          setErrorMessage(json?.message ?? "ページを表示できませんでした。")
          return
        }

        setPage(json.page)
        setStatus("ready")
      } catch {
        if (!active) return
        setStatus("error")
        setErrorMessage("ページの読み込みに失敗しました。")
      }
    })()

    return () => {
      active = false
    }
  }, [pageId])

  const showTitle = page
    ? page.title.trim() !== "" && page.title.trim() !== "無題" && !hasLeadHeading(page.content)
    : false

  if (status === "loading") {
    return (
      <div style={frameLoadingStyle}>
        <div style={loadingCardStyle}>読み込み中...</div>
      </div>
    )
  }

  if (status === "logged_out") {
    return (
      <div style={frameLoadingStyle}>
        <div style={messageCardStyle}>
          <h1 style={{ margin: 0, fontSize: 22, color: "#0f172a" }}>ログインが必要です</h1>
          <p style={{ margin: 0, fontSize: 14, lineHeight: 1.8, color: "#475569" }}>
            この埋め込み表示は NovaLoop のワークスペース内ページです。ログイン後に同じページへ戻ります。
          </p>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <Link href={loginHref} target="_top" style={primaryLinkStyle}>
              Google でログイン
            </Link>
            <Link href={`/pages/${pageId}`} target="_top" style={secondaryLinkStyle}>
              元のページを開く
            </Link>
          </div>
        </div>
      </div>
    )
  }

  if (status === "error" || !page) {
    return (
      <div style={frameLoadingStyle}>
        <div style={messageCardStyle}>
          <h1 style={{ margin: 0, fontSize: 22, color: "#0f172a" }}>ページを表示できませんでした</h1>
          <p style={{ margin: 0, fontSize: 14, lineHeight: 1.8, color: "#475569" }}>
            {errorMessage ?? "しばらくしてから再度お試しください。"}
          </p>
          <Link href={`/pages/${pageId}`} target="_top" style={secondaryLinkStyle}>
            元のページを開く
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div style={frameStyle}>
      {page.cover_path ? (
        <div
          style={{
            width: "100%",
            minHeight: "clamp(220px, 32vh, 380px)",
            backgroundImage: `linear-gradient(180deg, rgba(15, 23, 42, 0.08), rgba(15, 23, 42, 0.02)), url(/api/page-assets?path=${encodeURIComponent(page.cover_path)})`,
            backgroundPosition: "center",
            backgroundSize: "cover",
            borderBottom: "1px solid rgba(15, 23, 42, 0.06)",
          }}
        />
      ) : null}

      <div style={contentShellStyle}>
        {showTitle ? <h1 style={titleStyle}>{page.title}</h1> : null}

        <div className="PageEmbedFrameEditor">
          <EditorContent editor={editor} />
        </div>
      </div>

      <style jsx global>{`
        .PageEmbedFrameEditor .ProseMirror {
          outline: none;
          min-height: 320px;
          color: #0f172a;
          font-size: 16px;
          line-height: 1.85;
        }
        .PageEmbedFrameEditor .ProseMirror > * {
          max-width: 100%;
        }
        .PageEmbedFrameEditor .ProseMirror img {
          max-width: 100%;
          height: auto;
          border-radius: 20px;
          display: block;
        }
        .PageEmbedFrameEditor .ProseMirror a {
          color: #0f766e;
          text-decoration: underline;
          text-decoration-thickness: 2px;
          text-underline-offset: 3px;
          font-weight: 600;
        }
        .PageEmbedFrameEditor .ProseMirror h1,
        .PageEmbedFrameEditor .ProseMirror h2,
        .PageEmbedFrameEditor .ProseMirror h3 {
          color: #0f172a;
          line-height: 1.15;
          letter-spacing: -0.04em;
          scroll-margin-top: 24px;
        }
        .PageEmbedFrameEditor .ProseMirror h1 {
          font-size: clamp(38px, 5vw, 72px);
          margin: 0 0 0.6em;
        }
        .PageEmbedFrameEditor .ProseMirror h2 {
          font-size: clamp(28px, 3.4vw, 48px);
          margin: 1.1em 0 0.5em;
        }
        .PageEmbedFrameEditor .ProseMirror h3 {
          font-size: clamp(22px, 2.6vw, 32px);
          margin: 1em 0 0.45em;
        }
        .PageEmbedFrameEditor .ProseMirror p {
          margin: 0.55em 0;
        }
        .PageEmbedFrameEditor .ProseMirror blockquote {
          margin: 1em 0;
          padding: 18px 22px;
          border-left: 4px solid #0f766e;
          background: #f0fdfa;
          border-radius: 20px;
        }
        .PageEmbedFrameEditor .ProseMirror ul,
        .PageEmbedFrameEditor .ProseMirror ol {
          margin: 0.8em 0;
          padding-left: 1.5rem;
        }
        .PageEmbedFrameEditor .ProseMirror li {
          margin: 0.3em 0;
        }
        .PageEmbedFrameEditor .ProseMirror pre {
          margin: 1em 0;
          padding: 18px 20px;
          border-radius: 18px;
          border: 1px solid rgba(15, 23, 42, 0.08);
          background: #f8fafc;
          overflow-x: auto;
        }
        .PageEmbedFrameEditor .ProseMirror code {
          font-family: "Courier New", Courier, monospace;
          font-size: 0.92em;
        }
        .PageEmbedFrameEditor .ProseMirror hr,
        .PageEmbedFrameEditor .ProseMirror .pages-editor-hr {
          border: none;
          border-top: 1px solid rgba(15, 23, 42, 0.12);
          margin: 1.4em 0;
        }
        .PageEmbedFrameEditor .ProseMirror ul[data-type="taskList"] {
          list-style: none;
          padding-left: 0;
        }
        .PageEmbedFrameEditor .ProseMirror li[data-type="taskItem"] {
          display: flex;
          align-items: flex-start;
          gap: 10px;
        }
        .PageEmbedFrameEditor .ProseMirror li[data-type="taskItem"] > label {
          flex-shrink: 0;
        }
        .PageEmbedFrameEditor .ProseMirror .pages-embed-block {
          margin: 1.2em 0;
        }
        .PageEmbedFrameEditor .ProseMirror .pages-embed-block iframe {
          display: block;
          width: 100%;
          max-width: 100%;
          box-shadow: 0 28px 48px rgba(15, 23, 42, 0.1);
        }
        .PageEmbedFrameEditor .ProseMirror .pages-embed-block--bleed {
          position: relative;
          left: 50%;
          transform: translateX(-50%);
          width: min(calc(100vw - 96px), calc(100% + 220px));
          max-width: calc(100vw - 96px);
        }
        .PageEmbedFrameEditor .ProseMirror .pages-embed-block--link {
          display: grid;
          gap: 8px;
          padding: 18px 20px;
          border-radius: 22px;
          border: 1px solid rgba(15, 23, 42, 0.08);
          background: linear-gradient(180deg, rgba(248, 250, 252, 0.96), rgba(255, 247, 237, 0.96));
        }
        .PageEmbedFrameEditor .ProseMirror .pages-embed-link-card__label {
          font-size: 12px;
          font-weight: 700;
          letter-spacing: 0.04em;
          color: #64748b;
        }
        .PageEmbedFrameEditor .ProseMirror .pages-embed-link-card__anchor {
          word-break: break-all;
          color: #0f172a;
          text-decoration: none;
          font-weight: 600;
        }
        @media (max-width: 900px) {
          .PageEmbedFrameEditor .ProseMirror .pages-embed-block--bleed {
            width: calc(100% + 24px);
            max-width: calc(100vw - 32px);
          }
        }
      `}</style>
    </div>
  )
}

const frameStyle = {
  minHeight: "100dvh",
  background: "#ffffff",
  color: "#0f172a",
}

const contentShellStyle = {
  width: "100%",
  maxWidth: 1480,
  margin: "0 auto",
  padding: "32px clamp(20px, 4vw, 48px) 64px",
  boxSizing: "border-box" as const,
}

const titleStyle = {
  margin: "0 0 28px",
  fontSize: "clamp(34px, 4vw, 60px)",
  lineHeight: 1.05,
  color: "#0f172a",
  letterSpacing: "-0.05em",
  fontFamily: "Georgia, 'Times New Roman', serif",
}

const frameLoadingStyle = {
  minHeight: "100dvh",
  background: "linear-gradient(165deg, #f8fafc 0%, #fff7ed 55%, #ecfeff 100%)",
  display: "grid",
  placeItems: "center" as const,
  padding: 24,
}

const loadingCardStyle = {
  padding: "18px 24px",
  borderRadius: 18,
  border: "1px solid rgba(15, 23, 42, 0.08)",
  background: "rgba(255,255,255,0.92)",
  color: "#475569",
  boxShadow: "0 24px 48px rgba(15, 23, 42, 0.12)",
}

const messageCardStyle = {
  width: "min(520px, 100%)",
  padding: "28px 24px",
  borderRadius: 28,
  border: "1px solid rgba(15, 23, 42, 0.08)",
  background: "rgba(255,255,255,0.94)",
  boxShadow: "0 28px 56px rgba(15, 23, 42, 0.14)",
  display: "grid",
  gap: 14,
}

const primaryLinkStyle = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  padding: "12px 18px",
  borderRadius: 16,
  border: "none",
  background: "linear-gradient(135deg, #0f172a 0%, #155e75 100%)",
  color: "#ffffff",
  textDecoration: "none",
  fontWeight: 700,
}

const secondaryLinkStyle = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  padding: "12px 18px",
  borderRadius: 16,
  border: "1px solid rgba(15, 23, 42, 0.12)",
  background: "#ffffff",
  color: "#0f172a",
  textDecoration: "none",
  fontWeight: 600,
}
