import Link from "next/link"
import { notFound } from "next/navigation"
import type { CSSProperties } from "react"
import HelpArticleTracker from "@/components/help/HelpArticleTracker"
import { HELP_ARTICLES, getCategoryLabel } from "@/lib/helpCenter"

type Props = {
  params: Promise<{ slug: string }>
}

export function generateStaticParams() {
  return HELP_ARTICLES.map((article) => ({ slug: article.slug }))
}

export default async function HelpArticlePage({ params }: Props) {
  const { slug } = await params
  const article = HELP_ARTICLES.find((item) => item.slug === slug)
  if (!article) notFound()

  const related = HELP_ARTICLES.filter((item) => item.category === article.category && item.id !== article.id)
    .sort((a, b) => a.order - b.order)
    .slice(0, 3)

  return (
    <div style={pageStyle}>
      <HelpArticleTracker slug={article.slug} />
      <div style={wrapStyle}>
        <div style={columnStyle}>
          <Link href="/help" style={backLinkStyle}>
            ヘルプ一覧に戻る
          </Link>

          <header style={cardStyle}>
            <div style={metaStyle}>
              <span style={chipStyle}>{getCategoryLabel(article.category)}</span>
              <span style={{ ...chipStyle, ...chipMutedStyle }}>ガイド</span>
            </div>
            <h1 style={heroTitleStyle}>
              <span style={iconStyle}>{article.icon}</span>
              {article.title}
            </h1>
            <p style={heroDescriptionStyle}>{article.description}</p>
          </header>

          {article.highlights?.length ? (
            <section style={cardStyle}>
              <div style={sectionHeadStyle}>
                <div>
                  <p style={sectionKickerStyle}>要点</p>
                  <h2 style={sectionTitleStyle}>最初に押さえるポイント</h2>
                </div>
              </div>
              <div style={highlightGridStyle}>
                {article.highlights.map((item) => (
                  <div key={item} style={highlightCardStyle}>
                    <span style={highlightDotStyle} />
                    <p style={highlightTextStyle}>{item}</p>
                  </div>
                ))}
              </div>
            </section>
          ) : null}

          {article.sections.map((section) => (
            <section key={section.heading} style={cardStyle}>
              <div style={sectionHeadStyle}>
                <div>
                  <p style={sectionKickerStyle}>詳細</p>
                  <h2 style={sectionTitleStyle}>{section.heading}</h2>
                </div>
              </div>
              <div style={bodyStyle}>
                {section.body.map((paragraph) => (
                  <p key={paragraph} style={bodyTextStyle}>
                    {paragraph}
                  </p>
                ))}
              </div>
            </section>
          ))}
        </div>

        <aside style={columnStyle}>
          <section style={cardStyle}>
            <div style={sectionHeadStyle}>
              <div>
                <p style={sectionKickerStyle}>関連記事</p>
                <h2 style={sectionTitleStyle}>あわせて読む</h2>
              </div>
            </div>
            {related.length === 0 ? (
              <p style={bodyTextStyle}>このカテゴリの関連記事はまだありません。</p>
            ) : (
              <div style={listStyle}>
                {related.map((item) => (
                  <Link key={item.id} href={item.href} style={relatedLinkStyle}>
                    <span style={{ ...iconStyle, ...smallIconStyle }}>{item.icon}</span>
                    <span>
                      <strong style={relatedTitleStyle}>{item.title}</strong>
                      <small style={relatedDescriptionStyle}>{item.description}</small>
                    </span>
                  </Link>
                ))}
              </div>
            )}
          </section>

          <section style={cardStyle}>
            <div style={sectionHeadStyle}>
              <div>
                <p style={sectionKickerStyle}>関連画面</p>
                <h2 style={sectionTitleStyle}>画面を開く</h2>
              </div>
            </div>
            <div style={listStyle}>
              <Link href="/help" style={quickLinkStyle}>
                ヘルプ一覧
              </Link>
              <Link href="/pages" style={quickLinkStyle}>
                Pages を開く
              </Link>
              <Link href="/contents" style={quickLinkStyle}>
                Contents を開く
              </Link>
              <Link href="/billing" style={quickLinkStyle}>
                Billing を開く
              </Link>
            </div>
          </section>
        </aside>
      </div>
    </div>
  )
}

const pageStyle: CSSProperties = {
  minHeight: "100%",
  background:
    "radial-gradient(circle at top left, rgba(168, 85, 247, 0.16), transparent 24%), radial-gradient(circle at top right, rgba(196, 181, 253, 0.28), transparent 22%), linear-gradient(180deg, #fcf7ff 0%, #f7f2ff 38%, #ffffff 100%)",
  padding: "28px 16px 48px",
}

const wrapStyle: CSSProperties = {
  maxWidth: 1180,
  margin: "0 auto",
  display: "grid",
  gridTemplateColumns: "minmax(0, 1fr) 300px",
  gap: 18,
  alignItems: "start",
}

const columnStyle: CSSProperties = { display: "grid", gap: 16 }
const backLinkStyle: CSSProperties = { display: "inline-flex", width: "fit-content", color: "#6d28d9", textDecoration: "none", fontSize: 14, fontWeight: 600 }
const cardStyle: CSSProperties = { border: "1px solid rgba(167, 139, 250, 0.22)", background: "rgba(255, 255, 255, 0.92)", boxShadow: "0 18px 48px rgba(76, 29, 149, 0.08)", backdropFilter: "blur(10px)", borderRadius: 24, padding: 24 }
const metaStyle: CSSProperties = { display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 12 }
const chipStyle: CSSProperties = { display: "inline-flex", alignItems: "center", borderRadius: 999, padding: "6px 10px", background: "rgba(124, 58, 237, 0.1)", color: "#6d28d9", fontSize: 12, fontWeight: 700 }
const chipMutedStyle: CSSProperties = { background: "#f5f3ff", color: "#5b4b73" }
const heroTitleStyle: CSSProperties = { margin: "0 0 12px", color: "#27113d", fontSize: "clamp(30px, 4vw, 40px)", lineHeight: 1.1, display: "flex", gap: 12, alignItems: "center" }
const heroDescriptionStyle: CSSProperties = { margin: 0, color: "#5b4b73", lineHeight: 1.8, fontSize: 15 }
const iconStyle: CSSProperties = { width: 38, height: 38, display: "inline-flex", alignItems: "center", justifyContent: "center", borderRadius: 12, background: "rgba(124, 58, 237, 0.1)", color: "#6d28d9", fontSize: 16, fontWeight: 700, flexShrink: 0 }
const smallIconStyle: CSSProperties = { width: 30, height: 30, borderRadius: 10, fontSize: 13 }
const sectionHeadStyle: CSSProperties = { marginBottom: 14 }
const sectionKickerStyle: CSSProperties = { margin: "0 0 8px", fontSize: 11, fontWeight: 700, letterSpacing: "0.08em", color: "#7c3aed", textTransform: "uppercase" }
const sectionTitleStyle: CSSProperties = { margin: 0, color: "#27113d", fontSize: 22 }
const highlightGridStyle: CSSProperties = { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12 }
const highlightCardStyle: CSSProperties = { padding: 16, display: "flex", gap: 10, alignItems: "flex-start", borderRadius: 18, border: "1px solid rgba(167, 139, 250, 0.18)", background: "linear-gradient(180deg, #ffffff 0%, #faf6ff 100%)" }
const highlightDotStyle: CSSProperties = { width: 10, height: 10, borderRadius: 999, background: "#7c3aed", marginTop: 6, flexShrink: 0 }
const highlightTextStyle: CSSProperties = { margin: 0, color: "#47315f", lineHeight: 1.7, fontSize: 14 }
const bodyStyle: CSSProperties = { display: "grid", gap: 12 }
const bodyTextStyle: CSSProperties = { margin: 0, color: "#5b4b73", lineHeight: 1.85, fontSize: 14 }
const listStyle: CSSProperties = { display: "grid", gap: 10 }
const relatedLinkStyle: CSSProperties = { display: "grid", gridTemplateColumns: "auto 1fr", gap: 12, alignItems: "center", padding: "14px 16px", textDecoration: "none", color: "inherit", borderRadius: 18, border: "1px solid rgba(167, 139, 250, 0.18)", background: "linear-gradient(180deg, #ffffff 0%, #faf6ff 100%)" }
const relatedTitleStyle: CSSProperties = { display: "block", color: "#27113d", fontSize: 14, marginBottom: 4 }
const relatedDescriptionStyle: CSSProperties = { display: "block", color: "#7b6d90", fontSize: 12, lineHeight: 1.6 }
const quickLinkStyle: CSSProperties = { display: "grid", gridTemplateColumns: "1fr", gap: 12, alignItems: "center", padding: "14px 16px", textDecoration: "none", color: "#3b2a53", fontWeight: 600, borderRadius: 18, border: "1px solid rgba(167, 139, 250, 0.18)", background: "linear-gradient(180deg, #ffffff 0%, #faf6ff 100%)" }
