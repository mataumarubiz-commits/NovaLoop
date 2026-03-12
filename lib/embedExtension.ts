/**
 * 埋め込みURL用 TipTap ノード。
 * YouTube / Loom / Google Drive・Docs をホワイトリストで iframe 表示。
 */
import { Node, mergeAttributes } from "@tiptap/core"

const EMBED_WHITELIST = [
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
]

function isWhitelisted(href: string): boolean {
  try {
    const host = new URL(href).hostname.toLowerCase()
    return EMBED_WHITELIST.some((w) => host === w || host.endsWith("." + w))
  } catch {
    return false
  }
}

function toEmbedUrl(url: string): string {
  try {
    const u = new URL(url)
    const host = u.hostname.toLowerCase()
    if (host.includes("youtube.com") && u.pathname === "/watch" && u.searchParams.get("v")) {
      return `https://www.youtube.com/embed/${u.searchParams.get("v")}`
    }
    if (host.includes("youtube.com") && u.pathname.startsWith("/embed/")) return url
    if (host.includes("loom.com") && u.pathname.startsWith("/share/")) {
      const id = u.pathname.split("/").pop() || ""
      return `https://www.loom.com/embed/${id}`
    }
    if (host.includes("loom.com") && u.pathname.startsWith("/embed/")) return url
    if (host.includes("drive.google.com") || host.includes("docs.google.com")) return url
    if (host.includes("figma.com")) {
      const match = url.match(/figma\.com\/(file|proto|board)\/([^/?]+)/)
      if (match) return `https://www.figma.com/embed?embed_host=share&url=${encodeURIComponent(url)}`
      return url
    }
    if (host.includes("miro.com")) {
      const boardMatch = url.match(/miro\.com\/app\/board\/([^/?]+)/)
      if (boardMatch) return `https://miro.com/app/live-embed/${boardMatch[1]}/`
      return url
    }
    if (host.includes("vimeo.com")) {
      const idMatch = url.match(/vimeo\.com\/(?:video\/)?(\d+)/)
      if (idMatch) return `https://player.vimeo.com/video/${idMatch[1]}`
      return url
    }
    if (host.includes("codepen.io")) {
      const penMatch = url.match(/codepen\.io\/([^/]+)\/(?:pen|full)\/([^/?]+)/)
      if (penMatch) return `https://codepen.io/${penMatch[1]}/embed/${penMatch[2]}`
      return url
    }
    return url
  } catch {
    return url
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
        parseHTML: (el) => (el as HTMLElement).getAttribute("data-embed-url"),
        renderHTML: (attrs) => (attrs.url ? { "data-embed-url": attrs.url } : {}),
      },
    }
  },

  parseHTML() {
    return [{ tag: 'div[data-embed-url]' }]
  },

  renderHTML({ node, HTMLAttributes }) {
    return ["div", mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, { "data-embed-url": node.attrs.url || "" })]
  },

  addNodeView() {
    return ({ node }) => {
      const dom = document.createElement("div")
      dom.className = "pages-embed-block"
      const url = node.attrs.url as string | null
      if (!url) {
        dom.textContent = "（埋め込みURLがありません）"
        return { dom }
      }
      if (isWhitelisted(url)) {
        const iframe = document.createElement("iframe")
        iframe.src = toEmbedUrl(url)
        iframe.title = "埋め込み"
        iframe.setAttribute("loading", "lazy")
        iframe.style.width = "100%"
        iframe.style.minHeight = "280px"
        iframe.style.border = "none"
        iframe.style.borderRadius = "8px"
        dom.appendChild(iframe)
      } else {
        const a = document.createElement("a")
        a.href = url
        a.target = "_blank"
        a.rel = "noopener noreferrer"
        a.textContent = url
        a.style.wordBreak = "break-all"
        dom.appendChild(a)
      }
      return { dom }
    }
  },
})
