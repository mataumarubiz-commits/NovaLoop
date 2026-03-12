/**
 * タイトルから slug を生成。重複時は suffix (-2, -3) で解決する。
 * 仕様: 英数字・ハイフンのみに正規化。空の場合は id の先頭8文字などにフォールバック可能。
 */
export function titleToSlug(title: string): string {
  const t = (title || "").trim()
  if (!t) return ""
  const normalized = t
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^\p{L}\p{N}-]/gu, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
  return normalized || ""
}

/**
 * 同一 org 内で使われている slug の一覧を受け取り、重複しない slug を返す。
 * base が空なら "page", 既に "manual" があれば "manual-2", "manual-2" もあれば "manual-3"。
 */
export function resolveSlugDuplicate(base: string, existingSlugs: string[]): string {
  const baseSlug = base || "page"
  const set = new Set(existingSlugs.map((s) => (s || "").toLowerCase()))
  if (!set.has(baseSlug)) return baseSlug
  let n = 2
  while (set.has(`${baseSlug}-${n}`)) n++
  return `${baseSlug}-${n}`
}
