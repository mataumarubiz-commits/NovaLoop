"use client"

import Link from "next/link"
import { useMemo, useState } from "react"
import { HELP_ARTICLES, HELP_CATEGORIES, type HelpArticle } from "@/lib/helpCenter"

const QUICK_LINKS = [
  { href: "/home", label: "Home", description: "今日の優先対応、締め状況、通知を確認します。" },
  { href: "/pages", label: "Pages", description: "社内マニュアル、運用ルール、手順書を整備します。" },
  { href: "/contents", label: "Contents", description: "案件進行、納期、単価、請求対象を管理します。" },
  { href: "/billing", label: "Billing", description: "月次請求、請求依頼、PDF 出力を進めます。" },
  { href: "/notifications", label: "Notifications", description: "未読通知と対応待ちタスクを確認します。" },
] as const

export default function HelpCenterPage() {
  const [query, setQuery] = useState("")
  const normalizedQuery = query.trim().toLowerCase()

  const filteredArticles = useMemo(() => {
    if (!normalizedQuery) return HELP_ARTICLES
    return HELP_ARTICLES.filter((article) => {
      const category = HELP_CATEGORIES.find((item) => item.id === article.category)
      const haystack = [article.title, article.description, category?.label, ...(article.highlights ?? [])]
        .join(" ")
        .toLowerCase()
      return haystack.includes(normalizedQuery)
    })
  }, [normalizedQuery])

  const recommended = useMemo(
    () =>
      filteredArticles
        .filter((article) => typeof article.recommended_order === "number")
        .sort((a, b) => (a.recommended_order ?? 99) - (b.recommended_order ?? 99))
        .slice(0, 3),
    [filteredArticles]
  )

  const grouped = useMemo(() => {
    const byCategory = new Map<string, HelpArticle[]>()
    for (const category of HELP_CATEGORIES) byCategory.set(category.id, [])
    for (const article of filteredArticles) byCategory.get(article.category)?.push(article)
    for (const [key, list] of byCategory.entries()) {
      byCategory.set(key, [...list].sort((a, b) => a.order - b.order || a.title.localeCompare(b.title, "ja")))
    }
    return byCategory
  }, [filteredArticles])

  const sortedCategories = useMemo(() => [...HELP_CATEGORIES].sort((a, b) => a.order - b.order), [])

  return (
    <div className="help-page">
      <div className="help-wrap">
        <aside className="help-side">
          <div className="help-side-card">
            <p className="help-side-label">Help Center</p>
            <h2 className="help-side-heading">カテゴリから探す</h2>
            <nav className="help-category-nav" aria-label="ヘルプカテゴリ">
              {sortedCategories.map((category) => {
                const count = grouped.get(category.id)?.length ?? 0
                return (
                  <a key={category.id} href={`#section-${category.id}`} className={`help-category-link ${count === 0 ? "is-muted" : ""}`}>
                    <div>
                      <strong>{category.label}</strong>
                      <span>{category.description}</span>
                    </div>
                    <span className="help-count">{count}</span>
                  </a>
                )
              })}
            </nav>
          </div>

          <div className="help-side-card">
            <p className="help-side-label">おすすめ</p>
            <h2 className="help-side-heading">最初に見る 3 記事</h2>
            {recommended.length === 0 ? (
              <div className="help-empty compact">検索条件に一致するおすすめ記事はありません。</div>
            ) : (
              <div className="help-steps">
                {recommended.map((article) => (
                  <Link key={article.id} href={article.href} className="help-step-link">
                    <span className="help-step-badge">{article.recommended_order}</span>
                    <span>{article.title}</span>
                  </Link>
                ))}
              </div>
            )}
          </div>

          <div className="help-side-card">
            <p className="help-side-label">主要画面</p>
            <div className="help-quick-links">
              {QUICK_LINKS.map((item) => (
                <Link key={item.href} href={item.href} className="help-quick-link">
                  <strong>{item.label}</strong>
                  <span>{item.description}</span>
                </Link>
              ))}
            </div>
          </div>
        </aside>

        <main className="help-main">
          <header className="help-hero">
            <div className="help-hero-copy">
              <p className="help-overline">使い方ページ / ヘルプセンター</p>
              <h1>迷ったら、ここを見れば進められます</h1>
              <p className="help-sub">
                Nova loop の日次運用、案件進行、請求、外注支払い、マニュアル運用を横断して確認できます。
                <br />
                Pages に載せる社内手順の叩き台としても、そのまま使える構成にしています。
              </p>
            </div>
            <div className="help-hero-panel">
              <label className="help-search-label" htmlFor="help-search">
                キーワード検索
              </label>
              <input
                id="help-search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="請求、通知、外注、マニュアル など"
                aria-label="ヘルプ記事を検索"
                className="help-search"
              />
              <p className="help-search-meta">
                {normalizedQuery ? `${filteredArticles.length} 件の記事が見つかりました` : "タイトル、カテゴリ、要点から検索できます"}
              </p>
            </div>
          </header>

          <section className="help-recommended">
            <div className="help-section-head">
              <div>
                <p className="help-section-kicker">導入直後に見る順番</p>
                <h2>まず読む 3 記事</h2>
                <p className="help-section-copy">
                  初期設定、初週の運用、Pages のマニュアル整備から始めると、Nova loop の運用が安定します。
                </p>
              </div>
              <span>おすすめ 3 件</span>
            </div>
            {recommended.length === 0 ? (
              <div className="help-empty">検索条件に一致するおすすめ記事はありません。</div>
            ) : (
              <div className="help-recommended-grid">
                {recommended.map((article) => (
                  <Link key={article.id} href={article.href} className="help-recommended-card">
                    <div className="help-step">{article.recommended_order}</div>
                    <div className="help-recommended-copy">
                      <p className="help-recommended-title">{article.title}</p>
                      <p className="help-recommended-desc">{article.description}</p>
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </section>

          {sortedCategories.map((category) => {
            const items = grouped.get(category.id) ?? []
            return (
              <section key={category.id} id={`section-${category.id}`} className="help-section">
                <div className="help-section-head">
                  <div>
                    <p className="help-section-kicker">{category.description}</p>
                    <h2>{category.label}</h2>
                  </div>
                  <span>{items.length} 件</span>
                </div>
                {items.length === 0 ? (
                  <div className="help-empty">このカテゴリにはまだ記事がありません。</div>
                ) : (
                  <div className="help-grid">
                    {items.map((article) => (
                      <Link key={article.id} href={article.href} className="help-card">
                        <p className="help-card-title">
                          <span className="help-icon">{article.icon}</span>
                          {article.title}
                        </p>
                        <p className="help-card-desc">{article.description}</p>
                      </Link>
                    ))}
                  </div>
                )}
              </section>
            )
          })}
        </main>
      </div>
      <style jsx>{`
        .help-page {
          min-height: 100%;
          background:
            radial-gradient(circle at top left, rgba(168, 85, 247, 0.16), transparent 24%),
            radial-gradient(circle at top right, rgba(196, 181, 253, 0.28), transparent 22%),
            linear-gradient(180deg, #fcf7ff 0%, #f7f2ff 38%, #ffffff 100%);
          padding: 28px 18px 48px;
        }
        .help-wrap { max-width: 1240px; margin: 0 auto; display: grid; grid-template-columns: 290px minmax(0, 1fr); gap: 24px; align-items: start; }
        .help-side { position: sticky; top: 16px; display: grid; gap: 12px; }
        .help-side-card, .help-hero, .help-recommended, .help-section { border: 1px solid rgba(167, 139, 250, 0.22); background: rgba(255, 255, 255, 0.9); box-shadow: 0 18px 48px rgba(76, 29, 149, 0.08); backdrop-filter: blur(10px); }
        .help-side-card { border-radius: 20px; padding: 16px; }
        .help-side-label, .help-overline, .help-section-kicker { margin: 0 0 8px; font-size: 11px; font-weight: 700; letter-spacing: 0.08em; color: #7c3aed; text-transform: uppercase; }
        .help-side-heading, .help-section-head h2 { margin: 0; color: #27113d; }
        .help-side-heading { font-size: 18px; line-height: 1.35; margin-bottom: 12px; }
        .help-category-nav, .help-steps, .help-main, .help-quick-links { display: grid; gap: 10px; }
        .help-category-link, .help-step-link, .help-quick-link { text-decoration: none; color: inherit; border-radius: 14px; border: 1px solid transparent; background: linear-gradient(180deg, #fcfbff 0%, #f5efff 100%); padding: 12px; transition: transform .15s ease, border-color .15s ease, background .15s ease; }
        .help-category-link { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 10px; align-items: center; }
        .help-quick-link strong, .help-category-link strong { display: block; color: #27113d; font-size: 14px; margin-bottom: 4px; }
        .help-category-link span:last-child, .help-category-link div span, .help-quick-link span { color: #5b4b73; font-size: 12px; line-height: 1.5; }
        .help-category-link:hover, .help-step-link:hover, .help-card:hover, .help-recommended-card:hover, .help-quick-link:hover { transform: translateY(-1px); border-color: rgba(139, 92, 246, .32); background: #fff; }
        .help-category-link.is-muted { opacity: .52; }
        .help-count, .help-step-badge { min-width: 28px; height: 28px; display: inline-flex; align-items: center; justify-content: center; border-radius: 999px; background: rgba(124,58,237,.1); color: #6d28d9; font-size: 12px; font-weight: 700; flex-shrink: 0; }
        .help-step-link { display: grid; grid-template-columns: auto 1fr; gap: 10px; align-items: center; font-size: 13px; color: #3b2a53; }
        .help-main { gap: 18px; }
        .help-hero, .help-recommended, .help-section { border-radius: 26px; padding: 24px; }
        .help-hero { display: grid; grid-template-columns: minmax(0, 1.3fr) minmax(280px, 0.8fr); gap: 18px; align-items: end; }
        .help-hero-copy h1 { margin: 0 0 12px; font-size: clamp(30px, 4vw, 42px); line-height: 1.08; color: #27113d; }
        .help-sub { margin: 0; color: #5b4b73; font-size: 14px; line-height: 1.8; }
        .help-hero-panel { border-radius: 20px; background: linear-gradient(180deg, #fbf7ff 0%, #f2eaff 100%); border: 1px solid rgba(167,139,250,.25); padding: 16px; }
        .help-search-label { display: block; margin-bottom: 8px; color: #47315f; font-size: 13px; font-weight: 600; }
        .help-search { width: 100%; border-radius: 14px; border: 1px solid rgba(167,139,250,.35); background: #fff; padding: 14px 16px; font-size: 15px; color: #27113d; }
        .help-search-meta { margin: 8px 0 0; color: #7c3aed; font-size: 13px; }
        .help-section-head { display: flex; justify-content: space-between; gap: 12px; align-items: flex-start; margin-bottom: 16px; }
        .help-section-head span { color: #7b6d90; font-size: 13px; white-space: nowrap; padding-top: 6px; }
        .help-section-copy { margin: 8px 0 0; color: #5b4b73; font-size: 13px; line-height: 1.7; max-width: 680px; }
        .help-recommended-grid, .help-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 12px; }
        .help-recommended-card, .help-card { display: grid; grid-template-columns: auto 1fr; gap: 12px; border-radius: 18px; border: 1px solid rgba(167,139,250,.18); background: linear-gradient(180deg, #ffffff 0%, #faf6ff 100%); padding: 16px; text-decoration: none; color: inherit; transition: transform .16s ease, border-color .16s ease, box-shadow .16s ease; }
        .help-recommended-card { gap: 14px; padding: 18px 18px 16px; align-items: start; }
        .help-step, .help-icon { width: 34px; height: 34px; border-radius: 12px; display: inline-flex; align-items: center; justify-content: center; background: rgba(124,58,237,.1); color: #6d28d9; font-size: 14px; font-weight: 700; flex-shrink: 0; }
        .help-recommended-card .help-step { width: 30px; height: 30px; border-radius: 10px; font-size: 13px; margin-top: 2px; }
        .help-recommended-copy { min-width: 0; }
        .help-recommended-title { margin: 0 0 6px; color: #27113d; font-size: 16px; line-height: 1.45; font-weight: 700; }
        .help-recommended-desc { margin: 0; color: #5b4b73; font-size: 13px; line-height: 1.65; }
        .help-card-title { margin: 0 0 8px; font-size: 15px; color: #27113d; display: flex; gap: 10px; align-items: center; }
        .help-card-desc { margin: 0; color: #5b4b73; font-size: 13px; line-height: 1.7; }
        .help-empty { border-radius: 18px; background: #fbf7ff; border: 1px dashed rgba(167,139,250,.42); padding: 18px; color: #5b4b73; font-size: 14px; }
        .help-empty.compact { padding: 14px; font-size: 13px; }
        @media (max-width: 980px) {
          .help-wrap, .help-hero { grid-template-columns: 1fr; }
          .help-side { position: static; }
        }
      `}</style>
    </div>
  )
}
