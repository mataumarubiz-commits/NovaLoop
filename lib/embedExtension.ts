/**
 * TipTap block embed node.
 * External providers are normalized to embed URLs when possible.
 * Same-origin `/pages/[id]` links are rewritten to the chromeless embed route.
 */
import { Node, mergeAttributes } from "@tiptap/core"

const EMBED_TRANSFORM_HOSTS = [
  "youtube.com",
  "www.youtube.com",
  "youtube-nocookie.com",
  "www.youtube-nocookie.com",
  "loom.com",
  "www.loom.com",
  "drive.google.com",
  "docs.google.com",
  "figma.com",
  "www.figma.com",
  "miro.com",
  "www.miro.com",
  "vimeo.com",
  "www.vimeo.com",
  "codepen.io",
  "www.codepen.io",
] as const

function getBaseOrigin() {
  return typeof window !== "undefined" ? window.location.origin : "https://example.com"
}

function toAbsoluteUrl(href: string): URL | null {
  try {
    return new URL(href, getBaseOrigin())
  } catch {
    return null
  }
}

function isHttpUrl(href: string) {
  const url = toAbsoluteUrl(href)
  return Boolean(url && (url.protocol === "http:" || url.protocol === "https:"))
}

function hostUsesTransform(href: string) {
  const url = toAbsoluteUrl(href)
  if (!url) return false
  const host = url.hostname.toLowerCase()
  return EMBED_TRANSFORM_HOSTS.some((allowed) => host === allowed || host.endsWith(`.${allowed}`))
}

function sameOriginPageMeta(url: URL): { id: string; isEmbedRoute: boolean } | null {
  if (typeof window === "undefined") return null
  if (url.origin !== window.location.origin) return null

  const match = url.pathname.match(/^\/pages\/([^/]+)(\/embed)?\/?$/)
  if (!match) return null

  return {
    id: match[1],
    isEmbedRoute: Boolean(match[2]),
  }
}

function insideFrame() {
  if (typeof window === "undefined") return false
  try {
    return window.self !== window.top
  } catch {
    return true
  }
}

function toEmbedUrl(rawUrl: string): string {
  const url = toAbsoluteUrl(rawUrl)
  if (!url) return rawUrl

  const pageMeta = sameOriginPageMeta(url)
  if (pageMeta && !insideFrame()) {
    const embedUrl = new URL(url.toString())
    embedUrl.pathname = `/pages/${pageMeta.id}/embed`
    embedUrl.search = ""
    return embedUrl.toString()
  }

  const host = url.hostname.toLowerCase()

  if (host.includes("youtube.com") && url.pathname === "/watch" && url.searchParams.get("v")) {
    return `https://www.youtube.com/embed/${url.searchParams.get("v")}`
  }
  if (host.includes("youtube.com") && url.pathname.startsWith("/embed/")) return url.toString()
  if (host.includes("loom.com") && url.pathname.startsWith("/share/")) {
    const id = url.pathname.split("/").pop() || ""
    return `https://www.loom.com/embed/${id}`
  }
  if (host.includes("loom.com") && url.pathname.startsWith("/embed/")) return url.toString()
  if (host.includes("drive.google.com") || host.includes("docs.google.com")) return url.toString()
  if (host.includes("figma.com")) {
    const match = url.toString().match(/figma\.com\/(file|proto|board)\/([^/?]+)/)
    if (match) return `https://www.figma.com/embed?embed_host=share&url=${encodeURIComponent(url.toString())}`
    return url.toString()
  }
  if (host.includes("miro.com")) {
    const boardMatch = url.toString().match(/miro\.com\/app\/board\/([^/?]+)/)
    if (boardMatch) return `https://miro.com/app/live-embed/${boardMatch[1]}/`
    return url.toString()
  }
  if (host.includes("vimeo.com")) {
    const idMatch = url.toString().match(/vimeo\.com\/(?:video\/)?(\d+)/)
    if (idMatch) return `https://player.vimeo.com/video/${idMatch[1]}`
    return url.toString()
  }
  if (host.includes("codepen.io")) {
    const penMatch = url.toString().match(/codepen\.io\/([^/]+)\/(?:pen|full)\/([^/?]+)/)
    if (penMatch) return `https://codepen.io/${penMatch[1]}/embed/${penMatch[2]}`
    return url.toString()
  }

  return url.toString()
}

function renderLinkCard(dom: HTMLDivElement, href: string, message: string) {
  dom.className = "pages-embed-block pages-embed-block--link"

  const label = document.createElement("div")
  label.textContent = message
  label.className = "pages-embed-link-card__label"

  const anchor = document.createElement("a")
  anchor.href = href
  anchor.target = "_blank"
  anchor.rel = "noopener noreferrer"
  anchor.textContent = href
  anchor.className = "pages-embed-link-card__anchor"

  dom.append(label, anchor)
}

function syncIframeHeight(iframe: HTMLIFrameElement) {
  try {
    const doc = iframe.contentDocument
    if (!doc) return
    const nextHeight = Math.max(720, doc.body?.scrollHeight ?? 0, doc.documentElement?.scrollHeight ?? 0)
    iframe.style.height = `${Math.min(nextHeight + 4, 2200)}px`
  } catch {
    // Cross-origin iframes cannot be inspected; keep default height.
  }
}

export const Embed = Node.create({
  name: "embed",

  group: "block",
  atom: true,

  addOptions() {
    return {
      HTMLAttributes: {},
    }
  },

  addAttributes() {
    return {
      url: {
        default: null,
        parseHTML: (element) => (element as HTMLElement).getAttribute("data-embed-url"),
        renderHTML: (attributes) => (attributes.url ? { "data-embed-url": attributes.url } : {}),
      },
    }
  },

  parseHTML() {
    return [{ tag: "div[data-embed-url]" }]
  },

  renderHTML({ node, HTMLAttributes }) {
    return ["div", mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, { "data-embed-url": node.attrs.url || "" })]
  },

  addNodeView() {
    return ({ node }) => {
      const dom = document.createElement("div")
      const rawUrl = typeof node.attrs.url === "string" ? node.attrs.url.trim() : ""

      if (!rawUrl) {
        dom.className = "pages-embed-block pages-embed-block--link"
        dom.textContent = "埋め込み URL が空です。"
        return { dom }
      }

      if (!isHttpUrl(rawUrl)) {
        renderLinkCard(dom, rawUrl, "HTTP / HTTPS の URL を貼り付けてください。")
        return { dom }
      }

      const absoluteUrl = toAbsoluteUrl(rawUrl)
      if (!absoluteUrl) {
        renderLinkCard(dom, rawUrl, "URL を解釈できませんでした。")
        return { dom }
      }

      const pageMeta = sameOriginPageMeta(absoluteUrl)
      if (pageMeta && insideFrame()) {
        renderLinkCard(dom, absoluteUrl.toString(), "埋め込みの中ではページを再帰表示せず、元の URL を開きます。")
        return { dom }
      }

      const iframe = document.createElement("iframe")
      iframe.src = toEmbedUrl(rawUrl)
      iframe.title = "埋め込みプレビュー"
      iframe.setAttribute("loading", "lazy")
      iframe.setAttribute("allowfullscreen", "true")
      iframe.setAttribute("referrerpolicy", "strict-origin-when-cross-origin")
      iframe.style.width = "100%"
      iframe.style.height = pageMeta ? "78vh" : "min(72vh, 920px)"
      iframe.style.minHeight = pageMeta ? "720px" : "560px"
      iframe.style.border = "none"
      iframe.style.borderRadius = "22px"
      iframe.style.background = "#ffffff"
      iframe.style.display = "block"

      let resizeObserver: ResizeObserver | null = null

      iframe.addEventListener("load", () => {
        syncIframeHeight(iframe)
        try {
          const doc = iframe.contentDocument
          if (!doc || typeof ResizeObserver === "undefined") return
          resizeObserver = new ResizeObserver(() => syncIframeHeight(iframe))
          if (doc.body) resizeObserver.observe(doc.body)
          if (doc.documentElement) resizeObserver.observe(doc.documentElement)
        } catch {
          // Cross-origin iframes do not expose their document.
        }
      })

      dom.className =
        pageMeta || !hostUsesTransform(rawUrl)
          ? "pages-embed-block pages-embed-block--bleed"
          : "pages-embed-block"
      dom.appendChild(iframe)

      return {
        dom,
        destroy() {
          resizeObserver?.disconnect()
        },
      }
    }
  },
})
