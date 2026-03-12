/**
 * 選択範囲コメント用：該当範囲をエディタ内でハイライト表示する TipTap 拡張。
 * コメントクリック時に setMeta(commentHighlightPluginKey, { from, to }) で範囲を渡す。
 */
import { Extension } from "@tiptap/core"
import { Plugin, PluginKey } from "@tiptap/pm/state"
import { Decoration, DecorationSet } from "@tiptap/pm/view"

export const commentHighlightPluginKey = new PluginKey<{ from: number; to: number } | null>("commentHighlight")

export const CommentHighlightExtension = Extension.create({
  name: "commentHighlight",

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: commentHighlightPluginKey,
        state: {
          init() {
            return null as { from: number; to: number } | null
          },
          apply(tr, value) {
            const meta = tr.getMeta(commentHighlightPluginKey)
            if (meta !== undefined) return meta
            if (value && tr.docChanged) {
              const from = tr.mapping.map(value.from)
              const to = tr.mapping.map(value.to)
              return from < to ? { from, to } : null
            }
            return value
          },
        },
        props: {
          decorations(state) {
            const range = commentHighlightPluginKey.getState(state)
            if (!range || range.from >= range.to) return null
            const { doc } = state
            const safeFrom = Math.max(0, Math.min(range.from, doc.content.size))
            const safeTo = Math.max(safeFrom, Math.min(range.to, doc.content.size))
            if (safeFrom >= safeTo) return null
            return DecorationSet.create(doc, [
              Decoration.inline(safeFrom, safeTo, { class: "pages-comment-highlight" }),
            ])
          },
        },
      }),
    ]
  },
})
