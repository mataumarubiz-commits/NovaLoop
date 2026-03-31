"use client"

import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import { useEffect, useMemo, useState } from "react"
import { supabase } from "@/lib/supabase"

type AuthState = "checking" | "ready" | "signing_in"

type FeatureTone = "progress" | "close" | "playbook"
type PriorityTone = "success" | "alert" | "info"

function normalizeRedirectTarget(value: string | null) {
  if (!value || !value.startsWith("/")) return "/onboarding"
  if (value.startsWith("//")) return "/onboarding"
  return value
}

const NON_HOME_LOGIN_TARGET = "/onboarding"
const AUTH_FINISH_PATH = "/auth/finish"
const SHOW_LP_QUERY_VALUE = "1"
const INITIAL_AUTH_CHECK_TIMEOUT_MS = 1500

function getAuthRedirectOrigin() {
  const configured = process.env.NEXT_PUBLIC_APP_URL?.trim()
  if (configured) {
    return configured.replace(/\/$/, "")
  }

  if (typeof window === "undefined") return ""

  const url = new URL(window.location.href)
  if (url.hostname === "127.0.0.1" || url.hostname === "::1" || url.hostname === "[::1]") {
    url.hostname = "localhost"
  }
  if (url.hostname === "0.0.0.0") {
    url.hostname = "localhost"
  }

  return url.origin
}

function buildGoogleLoginStartErrorMessage(message?: string | null) {
  const detail = message?.trim()
  const checks =
    "NEXT_PUBLIC_APP_URL、Supabase Auth の Redirect URLs、" +
    "Google Cloud OAuth の Authorized redirect URI を確認してください。"

  if (!detail) {
    return `Google ログインの開始に失敗しました。${checks}`
  }

  return `Google ログインの開始に失敗しました。${checks} 詳細: ${detail}`
}

function FeaturePreview({ tone }: { tone: FeatureTone }) {
  if (tone === "progress") {
    return (
      <div className="feature-preview feature-preview-progress" aria-hidden="true">
        <svg viewBox="0 0 240 132" className="feature-preview-svg">
          <rect x="8" y="10" width="224" height="112" rx="20" fill="rgba(255,255,255,0.72)" />
          <rect x="24" y="24" width="192" height="24" rx="12" fill="rgba(255,255,255,0.88)" />
          <circle cx="38" cy="36" r="5" fill="rgba(239,68,68,0.75)" />
          <rect x="52" y="32" width="104" height="8" rx="4" fill="rgba(90,60,220,0.22)" />
          <rect x="170" y="30" width="30" height="12" rx="6" fill="rgba(239,68,68,0.16)" />
          <rect x="24" y="56" width="192" height="24" rx="12" fill="rgba(255,255,255,0.88)" />
          <circle cx="38" cy="68" r="5" fill="rgba(245,158,11,0.8)" />
          <rect x="52" y="64" width="118" height="8" rx="4" fill="rgba(90,60,220,0.2)" />
          <rect x="176" y="62" width="24" height="12" rx="6" fill="rgba(245,158,11,0.18)" />
          <rect x="24" y="88" width="192" height="24" rx="12" fill="rgba(255,255,255,0.88)" />
          <circle cx="38" cy="100" r="5" fill="rgba(34,197,94,0.8)" />
          <rect x="52" y="96" width="96" height="8" rx="4" fill="rgba(90,60,220,0.18)" />
          <rect x="172" y="94" width="30" height="12" rx="6" fill="rgba(34,197,94,0.18)" />
        </svg>
      </div>
    )
  }

  if (tone === "close") {
    return (
      <div className="feature-preview feature-preview-close" aria-hidden="true">
        <svg viewBox="0 0 240 132" className="feature-preview-svg">
          <rect x="8" y="10" width="224" height="112" rx="20" fill="rgba(255,255,255,0.72)" />
          <rect x="24" y="22" width="192" height="88" rx="18" fill="rgba(255,255,255,0.9)" />
          <rect x="166" y="28" width="40" height="16" rx="8" fill="rgba(34,197,94,0.18)" />
          <rect x="174" y="33" width="24" height="6" rx="3" fill="rgba(34,197,94,0.8)" />
          <rect x="40" y="34" width="60" height="8" rx="4" fill="rgba(90,60,220,0.18)" />
          <rect x="40" y="54" width="112" height="18" rx="9" fill="rgba(90,60,220,0.16)" />
          <rect x="54" y="59" width="84" height="8" rx="4" fill="rgba(90,60,220,0.32)" />
          <rect x="40" y="82" width="72" height="10" rx="5" fill="rgba(90,60,220,0.14)" />
          <rect x="148" y="80" width="54" height="14" rx="7" fill="rgba(90,60,220,0.12)" />
        </svg>
      </div>
    )
  }

  return (
    <div className="feature-preview feature-preview-playbook" aria-hidden="true">
      <svg viewBox="0 0 240 132" className="feature-preview-svg">
        <rect x="8" y="10" width="224" height="112" rx="20" fill="rgba(255,255,255,0.72)" />
        <rect x="24" y="24" width="192" height="24" rx="12" fill="rgba(255,255,255,0.9)" />
        <rect x="36" y="31" width="10" height="10" rx="2" fill="none" stroke="rgba(90,60,220,0.45)" strokeWidth="2" />
        <path d="M38.5 36l2 2 3.5-4" fill="none" stroke="rgba(90,60,220,0.7)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        <rect x="56" y="32" width="96" height="8" rx="4" fill="rgba(90,60,220,0.2)" />
        <rect x="24" y="56" width="192" height="24" rx="12" fill="rgba(255,255,255,0.9)" />
        <rect x="36" y="63" width="10" height="10" rx="2" fill="none" stroke="rgba(90,60,220,0.45)" strokeWidth="2" />
        <path d="M38.5 68l2 2 3.5-4" fill="none" stroke="rgba(90,60,220,0.7)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        <rect x="56" y="64" width="112" height="8" rx="4" fill="rgba(90,60,220,0.18)" />
        <rect x="24" y="88" width="192" height="24" rx="12" fill="rgba(255,255,255,0.9)" />
        <rect x="36" y="95" width="10" height="10" rx="2" fill="none" stroke="rgba(90,60,220,0.45)" strokeWidth="2" />
        <path d="M38.5 100l2 2 3.5-4" fill="none" stroke="rgba(90,60,220,0.7)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        <rect x="56" y="96" width="84" height="8" rx="4" fill="rgba(90,60,220,0.18)" />
      </svg>
    </div>
  )
}

function LoginButton({
  authState,
  onClick,
  variant,
  readyLabel,
}: {
  authState: AuthState
  onClick: () => void
  variant: "nav" | "hero" | "cta"
  readyLabel?: string
}) {
  const label =
    authState === "checking"
      ? "ログイン状態を確認中..."
      : authState === "signing_in"
        ? "Googleで接続中..."
        : readyLabel ?? "Googleで始める"

  return (
    <button
      type="button"
      className={`login-button login-button-${variant}`}
      onClick={onClick}
      disabled={authState !== "ready"}
    >
      {label}
    </button>
  )
}

function AppShot() {
  return (
    <div className="shot-wrap" aria-hidden="true">
      <div className="shot-card">
        <div className="shot-browser">
          <div className="shot-window">
            <span className="shot-dot" />
            <span className="shot-dot" />
            <span className="shot-dot" />
          </div>
          <div className="shot-url">
            <span className="shot-url-bar shot-url-bar-long" />
          </div>
        </div>

        <div className="shot-app">
          <aside className="shot-sidebar">
            <div className="shot-sidebar-brand">
              <span className="shot-brand-orb">N</span>
              <div className="shot-sidebar-brand-copy">
                <strong>NovaLoop</strong>
                <span>Operations</span>
              </div>
            </div>
            <div className="shot-sidebar-link shot-sidebar-link-active">Home</div>
            <div className="shot-sidebar-link">Contents</div>
            <div className="shot-sidebar-link">
              Billing
              <span className="shot-sidebar-count shot-sidebar-count-alert">未発行2</span>
            </div>
            <div className="shot-sidebar-link">
              Vendors
              <span className="shot-sidebar-count shot-sidebar-count-warn">確認1</span>
            </div>
            <div className="shot-sidebar-status">
              <p>今日のステータス</p>
              <span className="shot-sidebar-badge shot-sidebar-badge-warn">確認待ち 3件</span>
              <span className="shot-sidebar-badge shot-sidebar-badge-alert">締切今週 5件</span>
            </div>
          </aside>

          <div className="shot-home-main">
            <div className="shot-home-top">
              <div>
                <p className="shot-home-eyebrow">SNS Ops SaaS</p>
                <h3>ホーム</h3>
                <p className="shot-home-role">運用管理モード: 未処理・通知・締め管理</p>
              </div>
              <div className="shot-home-links">
                <span className="shot-home-link-chip">使い方を見る</span>
                <span className="shot-home-link-chip">通知センターへ</span>
              </div>
            </div>

            <section className="shot-home-kgi">
              <span className="shot-home-kgi-label">KGI</span>
              <strong className="shot-home-kgi-value">月末の締めを、属人化させない。</strong>
            </section>

            <section className="shot-home-alert">
              <div>
                <p className="shot-home-alert-label">危険: 優先対応が必要です</p>
                <strong className="shot-home-alert-value">緊急対応件数 4件</strong>
              </div>
              <span className="shot-home-alert-cta">今すぐ確認</span>
            </section>

            <section className="shot-home-actions">
              <div className="shot-home-action-card shot-home-action-card-danger">
                <span className="shot-home-action-label">納期遅れ対応</span>
                <strong className="shot-home-action-value">2件</strong>
                <span className="shot-home-action-note">先方提出の遅延案件</span>
              </div>
              <div className="shot-home-action-card shot-home-action-card-warn">
                <span className="shot-home-action-label">外注遅延対応</span>
                <strong className="shot-home-action-value">1件</strong>
                <span className="shot-home-action-note">編集者提出の遅延案件</span>
              </div>
              <div className="shot-home-action-card">
                <span className="shot-home-action-label">今日提出の確認</span>
                <strong className="shot-home-action-value">12件</strong>
                <span className="shot-home-action-note">本日提出予定の案件</span>
              </div>
              <div className="shot-home-action-card shot-home-action-card-info">
                <span className="shot-home-action-label">請求未処理</span>
                <strong className="shot-home-action-value">8件</strong>
                <span className="shot-home-action-note">請求対象の未処理案件</span>
              </div>
            </section>

            <div className="shot-home-lower">
              <section className="shot-home-panel">
                <div className="shot-home-panel-head">
                  <h4>通知サマリ</h4>
                  <span className="shot-home-panel-link">もっと見る</span>
                </div>
                <div className="shot-home-notification">
                  <span className="shot-home-notification-severity shot-home-notification-severity-danger">高</span>
                  <div className="shot-home-notification-copy">
                    <strong>先方提出が1件遅れています</strong>
                    <span>3分前</span>
                  </div>
                  <span className="shot-home-notification-action">対応</span>
                </div>
                <div className="shot-home-notification">
                  <span className="shot-home-notification-severity shot-home-notification-severity-warn">中</span>
                  <div className="shot-home-notification-copy">
                    <strong>外注未提出が1件あります</strong>
                    <span>12分前</span>
                  </div>
                  <span className="shot-home-notification-action">対応</span>
                </div>
                <div className="shot-home-notification">
                  <span className="shot-home-notification-severity">情</span>
                  <div className="shot-home-notification-copy">
                    <strong>請求下書き 8件が作成対象です</strong>
                    <span>26分前</span>
                  </div>
                  <span className="shot-home-notification-action">開く</span>
                </div>
              </section>

              <section className="shot-home-panel shot-home-panel-close">
                <div className="shot-home-panel-head">
                  <h4>締め状況</h4>
                  <span className="shot-home-progress-meta">8 / 10</span>
                </div>
                <div className="shot-home-progress">
                  <span className="shot-home-progress-label">請求生成状況</span>
                  <div className="shot-home-progress-track">
                    <span className="shot-home-progress-fill" />
                  </div>
                </div>
                <div className="shot-home-close-stats">
                  <div className="shot-home-close-stat">
                    <span>未処理の請求対象</span>
                    <strong>2件</strong>
                  </div>
                  <div className="shot-home-close-stat">
                    <span>未処理の支払い対象</span>
                    <strong>1件</strong>
                  </div>
                </div>
              </section>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
export default function GoogleLoginLanding() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [authState, setAuthState] = useState<AuthState>("checking")
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [viewerHasSession, setViewerHasSession] = useState(false)
  const reloginMessage = searchParams?.get("message") === "relogin"
  const showLp = searchParams?.get("showLp") === SHOW_LP_QUERY_VALUE
  const redirectTarget = useMemo(
    () => normalizeRedirectTarget(searchParams?.get("redirectTo") ?? null),
    [searchParams]
  )

  useEffect(() => {
    let active = true
    const timeoutId = setTimeout(() => {
      if (!active) return
      setAuthState((current) => (current === "checking" ? "ready" : current))
    }, INITIAL_AUTH_CHECK_TIMEOUT_MS)

    void supabase.auth
      .getSession()
      .then(({ data, error }) => {
        if (!active) return
        clearTimeout(timeoutId)
        if (error) {
          setAuthState("ready")
          setErrorMessage(null)
          return
        }
        if (data.session?.user) {
          setViewerHasSession(true)
          if (showLp) {
            setAuthState("ready")
            return
          }
          router.replace(redirectTarget)
          return
        }
        setAuthState("ready")
      })
      .catch(() => {
        if (!active) return
        clearTimeout(timeoutId)
        setAuthState("ready")
        setErrorMessage(null)
      })

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!active) return
      if (session?.user) {
        setViewerHasSession(true)
        if (showLp) {
          setAuthState("ready")
          return
        }
        router.replace(redirectTarget)
      } else {
        setViewerHasSession(false)
        setAuthState("ready")
      }
    })

    return () => {
      active = false
      clearTimeout(timeoutId)
      subscription.unsubscribe()
    }
  }, [redirectTarget, router, showLp])

  useEffect(() => {
    const elements = Array.from(document.querySelectorAll<HTMLElement>("[data-reveal]"))
    if (elements.length === 0) return

    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      elements.forEach((element) => element.classList.add("is-visible"))
      return
    }

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return
          entry.target.classList.add("is-visible")
          observer.unobserve(entry.target)
        })
      },
      { threshold: 0.18 }
    )

    elements.forEach((element) => observer.observe(element))
    return () => observer.disconnect()
  }, [])

  const login = async (target = redirectTarget) => {
    if (viewerHasSession) {
      router.push(target)
      return
    }
    if (authState === "signing_in") return
    setAuthState("signing_in")
    setErrorMessage(null)

    const origin = getAuthRedirectOrigin()
    const finishUrl = new URL(`${origin}${AUTH_FINISH_PATH}`)
    finishUrl.searchParams.set("next", target)
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: finishUrl.toString(),
      },
    })

    if (error) {
      setAuthState("ready")
      setErrorMessage(buildGoogleLoginStartErrorMessage(error.message))
    }
  }

  const features = [
    {
      tone: "progress" as const,
      heading: "Progress",
      title: "止まる前に気づく",
      body: "納期・確認待ち・担当の偏りが一画面に並び、今日動く案件が見える。",
      link: "案件は止まらない。見えているから。",
      tags: ["今日の優先順位", "遅れの早期発見"],
    },
    {
      tone: "close" as const,
      heading: "Close",
      title: "締めで漏れない",
      body: "請求書発行と外注処理が同じ月次フローに乗り、抜け漏れが残らない。",
      link: "請求も支払いも、締め前に止める。",
      tags: ["ワンタップ発行", "確認漏れ防止"],
    },
    {
      tone: "playbook" as const,
      heading: "Playbook",
      title: "確認が属人化しない",
      body: "LINE通知とPlaybookで確認手順が揃い、引き継いでも運用がぶれない。",
      link: "誰が見ても、同じ順番で締められる。",
      tags: ["LINE連携", "手順を固定"],
    },
  ]

  const heroHighlights: Array<{ tone: PriorityTone; label: string; body: string }> = [
    {
      tone: "success",
      label: "1タップで請求完了",
      body: "案件にひもづいて、請求書をそのまま発行。",
    },
    {
      tone: "alert",
      label: "抜け漏れゼロ運用",
      body: "請求漏れも外注支払い漏れも、締め前に止める。",
    },
    {
      tone: "info",
      label: "組織の動きをLINE通知で確認",
      body: "確認待ちや未処理を、LINEから取りこぼさない。",
    },
  ]

  const sellingPoints = [
    "管理ツールではなく、案件進行と請求をひとつの流れで回すための運用基盤",
  ]

  const footerQuickLinks = [
    { href: "/help/setup", label: "セットアップガイドを読む" },
    { href: "/help/first-week", label: "最初の1週間を確認する" },
    { href: "/help/org-roles", label: "権限設計の考え方を読む" },
  ]

  const footerColumns = [
    {
      heading: "Product",
      links: [
        { href: "/help/setup", label: "セットアップガイド" },
        { href: "/help/first-week", label: "最初の1週間" },
        { href: "/help/org-roles", label: "権限設計" },
      ],
    },
    {
      heading: "Operations",
      links: [
        { href: "/home", label: "ホームの見え方" },
        { href: "/billing", label: "請求の締めフロー" },
        { href: "/notifications", label: "LINE通知の運用" },
      ],
    },
    {
      heading: "Support",
      links: [
        { href: "/help/setup", label: "セットアップガイド" },
        { href: "/help/first-week", label: "立ち上がりチェック" },
        { href: "/help/org-roles", label: "ロール設計の基本" },
      ],
    },
  ]

  return (
    <>
      <div className="lp-root">
        <header className="nav-bar">
          <div className="nav-shell">
            <div className="nav-brand-block">
              <span className="nav-wordmark">NovaLoop</span>
              <span className="nav-tagline">制作進行と請求をつなぐ運用基盤</span>
            </div>
            <nav className="nav-links" aria-label="LP navigation">
              <a href="#operating-canvas">Operating Canvas</a>
              <Link href="/help/setup">セットアップ</Link>
              <a href="#contact-entry">Contact</a>
            </nav>
            <div className="nav-cta-shell">
              <button
                type="button"
                className="nav-cta-note"
                onClick={() => void login(NON_HOME_LOGIN_TARGET)}
              >
                無料登録30秒
              </button>
              <LoginButton
                authState={authState}
                onClick={() => void login(NON_HOME_LOGIN_TARGET)}
                variant="nav"
              />
            </div>
          </div>
        </header>

        <main>
          <section className="hero-section">
            <div className="section-shell hero-grid">
              <div className="hero-copy reveal" data-reveal>
                <p className="hero-eyebrow">制作会社・SNS運用代行向けの運用基盤</p>
                <h1>
                  締めの日、
                  <br className="hero-break" />
                  あなたの組織は
                  <br className="hero-break" />
                  <span className="hero-question-line">何に集中していますか？</span>
                  <span className="hero-display-line">
                    クリエイティブな思考だけに
                    <br className="hero-display-break" />
                    集中できる組織をつくる。
                  </span>
                </h1>
                <p className="hero-subcopy">
                  <span>請求・外注確認・月末の確認連絡。人間がやるべきでない仕事がある。</span>
                  <span className="hero-subcopy-emphasis">NovaLoopは、それを仕組みに変える。</span>
                </p>

                <div className="hero-actions">
                  <div className="hero-priority-group">
                    <p className="hero-priority-intro">導入後に変わること</p>
                    <div className="hero-priority-list">
                      {heroHighlights.map((item) => (
                        <div key={item.label} className={`hero-priority-item hero-priority-${item.tone}`}>
                          <span className="hero-priority-label">{item.label}</span>
                          <p>{item.body}</p>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="hero-cta-panel">
                    <div className="hero-cta-copy">
                      <strong>Googleで無料登録</strong>
                      <span>30秒でワークスペースを作成</span>
                    </div>
                    <LoginButton
                      authState={authState}
                      onClick={() => void login()}
                      variant="hero"
                      readyLabel="無料で始める（30秒）"
                    />
                  </div>
                </div>

                {reloginMessage ? (
                  <div className="alert alert-warn">
                    セッションが切れました。もう一度 Google でログインしてください。
                  </div>
                ) : null}

                {errorMessage ? <div className="alert alert-error">{errorMessage}</div> : null}
              </div>

              <div className="hero-visual reveal" data-reveal>
                <AppShot />
              </div>
            </div>
          </section>

          <section id="operating-canvas" className="features-section">
            <div className="section-shell">
              <div className="section-header reveal" data-reveal>
                <p className="section-subcopy">{sellingPoints[0]}</p>
                <p className="section-kicker">月次 / 日次 一体運用</p>
                <h2 className="section-display">NovaLoop Operating Canvas</h2>
              </div>

              <div className="feature-grid">
                {features.map((feature) => (
                  <article key={feature.heading} className="feature-card reveal" data-reveal>
                    <FeaturePreview tone={feature.tone} />
                    <p className="feature-kicker">{feature.heading}</p>
                    <h3>{feature.title}</h3>
                    <p>{feature.body}</p>
                    <div className="feature-meta">
                      {feature.tags.map((tag) => (
                        <span key={tag} className="feature-tag">
                          {tag}
                        </span>
                      ))}
                    </div>
                    <span className="feature-link">{feature.link}</span>
                  </article>
                ))}
              </div>
            </div>
          </section>

          <section id="contact-entry" className="cta-section">
            <div className="section-shell cta-shell reveal" data-reveal>
              <div className="cta-copy-block">
                <h2>
                  請求漏れと外注処理漏れを、
                  <br className="cta-break" />
                  今月で終わらせる。
                </h2>
                <p>案件と請求をつなぐ運用基盤を、今日から使い始める</p>
              </div>
              <LoginButton
                authState={authState}
                onClick={() => void login()}
                variant="cta"
                readyLabel="無料で始める（30秒）"
              />
              <div className="cta-secondary-grid">
                <button
                  type="button"
                  className="cta-secondary-card cta-secondary-card-contact"
                  onClick={() => void login(NON_HOME_LOGIN_TARGET)}
                >
                  <span className="cta-secondary-label">Contact</span>
                  <strong>導入相談をはじめる</strong>
                  <span>まずはログインして、課題整理から進める。</span>
                </button>
                <Link className="cta-secondary-card" href="/help/setup">
                  <span className="cta-secondary-label">Setup</span>
                  <strong>セットアップを確認する</strong>
                  <span>初期設定から運用開始までの全体像を確認。</span>
                </Link>
                <Link className="cta-secondary-card" href="/help/first-week">
                  <span className="cta-secondary-label">Week 1</span>
                  <strong>最初の1週間を確認</strong>
                  <span>立ち上がりで何を整えるかを先に掴む。</span>
                </Link>
                <Link className="cta-secondary-card" href="/help/org-roles">
                  <span className="cta-secondary-label">Roles</span>
                  <strong>権限設計を確認する</strong>
                  <span>誰が何を見るかを先に決めて運用を崩さない。</span>
                </Link>
              </div>
            </div>
          </section>
        </main>

        <footer className="footer">
          <div className="section-shell footer-top">
            <div className="footer-brand-column">
              <div className="footer-brand">NovaLoop</div>
              <p className="footer-description">
                案件進行・請求・通知をひとつの流れにまとめて、組織が本来向き合うべき判断と創造に時間を戻す。
              </p>
              <div className="footer-quick-links">
                {footerQuickLinks.map((item) => (
                  <a key={item.href + item.label} href={item.href}>
                    {item.label}
                  </a>
                ))}
              </div>
            </div>
            <div className="footer-nav-grid">
              {footerColumns.map((column) => (
                <section key={column.heading} className="footer-column">
                  <h4>{column.heading}</h4>
                  <div className="footer-link-list">
                    {column.links.map((link) => (
                      <a key={link.href + link.label} href={link.href}>
                        {link.label}
                      </a>
                    ))}
                  </div>
                </section>
              ))}
            </div>
          </div>
          <div className="section-shell footer-bottom">
            <div className="footer-meta">
              <p>© 2026 NovaLoop</p>
              <Link href="/help/setup">Docs</Link>
              <Link href="/help/org-roles">Role Design</Link>
            </div>
            <div className="footer-locale">
              <span className="footer-locale-active">JP</span>
              <span>EN</span>
            </div>
          </div>
        </footer>
      </div>

      <style jsx global>{`
        .lp-root {
          --primary: #8b5cf6;
          --primary-dark: #6d28d9;
          --primary-light: #ede9fe;
          --navy: #0b1120;
          --indigo: #1e1b4b;
          --teal: #134e4a;
          --success: #22c55e;
          --warning: #f59e0b;
          --info: #38bdf8;
          --background: #ffffff;
          --surface: #f5f3ff;
          --text-main: #1e1b4b;
          --text-sub: #6b7280;
          --accent: #a78bfa;
          background: var(--background);
          color: var(--text-main);
          font-family: "Inter", "Noto Sans JP", sans-serif;
        }

        .lp-root p {
          line-height: 1.9;
        }

        .section-shell,
        .nav-shell {
          width: min(1400px, calc(100% - 72px));
          margin: 0 auto;
        }

        /* LP改善: ヘッダーとヒーローの第一印象を強める */
        .nav-bar {
          position: sticky;
          top: 0;
          z-index: 20;
          background: rgba(250, 248, 255, 0.76);
          border-bottom: 1px solid rgba(139, 92, 246, 0.08);
          backdrop-filter: blur(12px);
        }

        .nav-shell,
        .shot-panel-head,
        .shot-row,
        .shot-links,
        .proof-strip {
          display: flex;
          align-items: center;
        }

        .nav-shell {
          justify-content: space-between;
          gap: 28px;
          padding: 13px 0;
        }

        .nav-brand-block {
          display: grid;
          gap: 3px;
          min-width: 0;
          flex-shrink: 0;
        }

        .nav-wordmark {
          color: var(--text-main);
          font-size: 0.98rem;
          font-weight: 700;
          letter-spacing: 0.08em;
          text-transform: uppercase;
        }

        .nav-tagline {
          color: var(--text-sub);
          font-size: 0.76rem;
          line-height: 1.45;
          letter-spacing: 0.01em;
          white-space: nowrap;
        }

        .nav-links {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 18px;
          min-width: 0;
          flex: 1;
        }

        .nav-links a {
          color: rgba(30, 27, 75, 0.76);
          text-decoration: none;
          font-size: 0.86rem;
          font-weight: 600;
          white-space: nowrap;
          transition: color 0.2s ease;
        }

        .nav-links a:hover {
          color: var(--primary-dark);
        }

        .nav-cta-shell {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 0;
          background: transparent;
          border: none;
        }

        .nav-cta-note,
        .login-button-nav {
          min-height: 42px;
          border-radius: 9999px;
          font-weight: 700;
          transition:
            transform 0.2s ease,
            background-color 0.2s ease,
            box-shadow 0.2s ease,
            border-color 0.2s ease;
        }

        .nav-cta-note {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          padding: 0 16px;
          border-radius: 9999px;
          background: rgba(255, 255, 255, 0.78);
          border: 1px solid rgba(139, 92, 246, 0.14);
          color: var(--primary-dark);
          font-size: 0.8rem;
          letter-spacing: 0.04em;
          white-space: nowrap;
          cursor: pointer;
          box-shadow: 0 8px 20px rgba(76, 29, 149, 0.06);
        }

        .nav-cta-note:hover {
          transform: translateY(-1px);
          background: rgba(255, 255, 255, 0.92);
          box-shadow: 0 12px 24px rgba(76, 29, 149, 0.09);
        }

        .nav-cta-note:focus-visible {
          outline: 2px solid rgba(109, 40, 217, 0.28);
          outline-offset: 2px;
        }

        /* LP改善: ライト基調に振り切りつつ紫の光だまりでブランド感を残す */
        .hero-section {
          position: relative;
          overflow: clip;
          isolation: isolate;
          background:
            radial-gradient(circle at 14% 22%, rgba(139, 92, 246, 0.18) 0%, transparent 30%),
            radial-gradient(circle at 88% 12%, rgba(167, 139, 250, 0.16) 0%, transparent 26%),
            radial-gradient(circle at 72% 78%, rgba(196, 181, 253, 0.22) 0%, transparent 30%),
            linear-gradient(180deg, #faf8ff 0%, #f4f0ff 56%, #ffffff 100%);
        }

        .hero-section::before,
        .hero-section::after {
          content: "";
          position: absolute;
          pointer-events: none;
        }

        .hero-section::before {
          inset: 0;
          background:
            linear-gradient(rgba(109, 40, 217, 0.05) 1px, transparent 1px),
            linear-gradient(90deg, rgba(109, 40, 217, 0.05) 1px, transparent 1px);
          background-size: 56px 56px;
          mask-image: linear-gradient(to bottom, rgba(0, 0, 0, 0.16), transparent 78%);
          opacity: 0.6;
        }

        .hero-section::after {
          right: -120px;
          bottom: -180px;
          width: min(44vw, 620px);
          height: min(44vw, 620px);
          border-radius: 9999px;
          background:
            radial-gradient(circle, rgba(139, 92, 246, 0.14) 0%, rgba(196, 181, 253, 0.12) 42%, transparent 72%),
            linear-gradient(180deg, rgba(255, 255, 255, 0.54), rgba(255, 255, 255, 0));
          filter: blur(16px);
        }

        .hero-grid {
          display: grid;
          grid-template-columns: minmax(0, 1.15fr) minmax(0, 0.85fr);
          gap: 48px;
          align-items: start;
          padding: 76px 0 108px;
          position: relative;
          z-index: 1;
        }

        .hero-copy {
          position: relative;
          isolation: isolate;
          max-width: 620px;
        }

        .hero-copy::before {
          content: "";
          position: absolute;
          width: 600px;
          height: 600px;
          background: radial-gradient(circle, rgba(139, 92, 246, 0.14) 0%, transparent 70%);
          top: -100px;
          left: -200px;
          pointer-events: none;
          z-index: -1;
        }

        .lp-root h1,
        .lp-root h2,
        .lp-root h3 {
          margin: 0;
          color: var(--text-main);
          text-wrap: balance;
        }

        .hero-copy h1 {
          color: var(--text-main);
          font-family: var(--font-noto-serif-jp), var(--font-noto-sans-jp), serif;
        }

        .lp-root h1 {
          font-size: clamp(2.5rem, 5vw, 4rem);
          line-height: 1.14;
          font-weight: 700;
          letter-spacing: -0.03em;
          max-width: none;
          white-space: normal;
          word-break: keep-all;
          overflow-wrap: break-word;
        }

        .hero-question-line {
          display: inline;
          white-space: nowrap;
        }

        .hero-eyebrow {
          margin: 0 0 18px;
          color: var(--primary-dark);
          font-size: 0.82rem;
          font-weight: 700;
          letter-spacing: 0.12em;
          text-transform: uppercase;
        }

        .hero-display-line {
          display: block;
          margin-top: 16px;
          max-width: none;
          color: #4338ca;
          font-size: clamp(1.7rem, 3vw, 2.35rem);
          line-height: 1.24;
          text-wrap: pretty;
        }

        .hero-display-break {
          display: block;
        }

        .hero-break {
          display: block;
        }

        .hero-subcopy {
          margin: 26px 0 0;
          display: grid;
          gap: 12px;
          color: var(--text-sub);
          font-size: 1.125rem;
          max-width: 36rem;
          text-wrap: pretty;
        }

        .hero-subcopy-emphasis {
          display: inline-flex;
          width: fit-content;
          align-items: center;
          padding: 8px 14px;
          border-radius: 9999px;
          background: linear-gradient(135deg, rgba(124, 58, 237, 0.12), rgba(139, 92, 246, 0.18));
          color: var(--primary-dark);
          font-size: 0.98rem;
          font-weight: 700;
          letter-spacing: 0.01em;
          box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.5);
        }

        /* LP改善: 主訴求の次に比較材料を見せ、最後にCTAへ流す */
        .hero-priority-list {
          display: grid;
          gap: 10px;
          max-width: 44rem;
        }

        .hero-priority-group {
          display: grid;
          gap: 12px;
        }

        .hero-priority-intro {
          margin: 0;
          color: var(--text-main);
          font-size: 0.82rem;
          font-weight: 700;
          letter-spacing: 0.08em;
          text-transform: uppercase;
        }

        .hero-priority-item {
          display: grid;
          grid-template-columns: auto minmax(0, 1fr);
          gap: 10px;
          align-items: center;
          padding: 10px 12px;
          border-radius: 16px;
          border: 1px solid rgba(139, 92, 246, 0.12);
          background: rgba(255, 255, 255, 0.78);
          backdrop-filter: blur(12px);
          box-shadow:
            0 18px 32px rgba(91, 33, 182, 0.08),
            inset 0 1px 0 rgba(255, 255, 255, 0.7);
          transition: background 0.2s ease, border-color 0.2s ease;
        }

        .hero-priority-item:hover {
          background: rgba(255, 255, 255, 0.92);
          border-color: rgba(109, 40, 217, 0.34);
        }

        .hero-priority-label {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          color: var(--text-main);
          font-size: 0.76rem;
          font-weight: 800;
          letter-spacing: 0.03em;
          white-space: nowrap;
        }

        .hero-priority-label::before {
          content: "";
          width: 8px;
          height: 8px;
          border-radius: 9999px;
          background: var(--priority-color);
          box-shadow: 0 0 0 4px color-mix(in srgb, var(--priority-color) 22%, transparent);
        }

        .hero-priority-item p {
          margin: 0;
          color: var(--text-sub);
          font-size: 0.84rem;
          font-weight: 600;
          line-height: 1.55;
        }

        .hero-priority-success {
          --priority-color: var(--success);
        }

        .hero-priority-alert {
          --priority-color: var(--warning);
        }

        .hero-priority-info {
          --priority-color: var(--info);
        }

        /* LP改善: CTA周辺テキストを1行に削減して登録導線を明確化 */
        .hero-actions {
          margin-top: 28px;
          display: grid;
          justify-items: start;
          gap: 18px;
        }

        .feature-card p,
        .shot-mini-card p,
        .footer-bottom p {
          margin: 0;
          color: var(--text-sub);
          line-height: 1.8;
        }

        .hero-cta-panel {
          width: min(100%, 36rem);
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 18px;
          padding: 16px 18px;
          border-radius: 20px;
          background: #ffffff;
          border: 1px solid rgba(139, 92, 246, 0.14);
          box-shadow: 0 18px 38px rgba(91, 33, 182, 0.08);
        }

        .hero-cta-copy {
          display: grid;
          gap: 4px;
          min-width: 0;
        }

        .hero-cta-copy strong {
          color: var(--text-main);
          font-size: 1rem;
          line-height: 1.4;
        }

        .hero-cta-copy span {
          color: var(--text-sub);
          font-size: 0.9rem;
          line-height: 1.5;
        }

        .login-button {
          border: none;
          border-radius: 9999px;
          cursor: pointer;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          font-family: inherit;
          font-weight: 700;
          letter-spacing: 0.01em;
          white-space: nowrap;
          transition:
            transform 0.18s ease,
            box-shadow 0.18s ease,
            background 0.18s ease,
            color 0.18s ease,
            opacity 0.18s ease;
        }

        .login-button:hover:not(:disabled) {
          transform: translateY(-2px);
        }

        .login-button:disabled {
          opacity: 0.86;
          cursor: wait;
        }

        /* LP改善: 操作色は紫に固定し、CTA を背景から明確に分離する */
        .login-button-nav {
          padding: 0 20px;
          background: linear-gradient(135deg, #8b5cf6 0%, #6d28d9 100%);
          color: #ffffff;
          font-size: 0.9rem;
          box-shadow: 0 14px 28px rgba(109, 40, 217, 0.22);
        }

        .login-button-nav:hover:not(:disabled) {
          background: linear-gradient(135deg, #7c3aed 0%, #5b21b6 100%);
          box-shadow: 0 18px 34px rgba(109, 40, 217, 0.28);
        }

        .login-button-cta {
          min-height: 56px;
          min-width: 280px;
          padding: 0 40px;
          background: linear-gradient(135deg, #8b5cf6 0%, #7c3aed 48%, #6d28d9 100%);
          color: #ffffff;
          font-size: 1rem;
          box-shadow: 0 20px 42px rgba(109, 40, 217, 0.24);
        }

        .login-button-cta:hover:not(:disabled) {
          background: linear-gradient(135deg, #7c3aed 0%, #6d28d9 54%, #5b21b6 100%);
          box-shadow: 0 24px 48px rgba(109, 40, 217, 0.28);
        }

        /* LP改善: ヒーローCTAを一番強い操作色に固定する */
        .login-button-hero {
          min-height: 56px;
          width: auto;
          min-width: 0;
          flex-shrink: 0;
          padding: 0 40px;
          background: linear-gradient(135deg, #8b5cf6 0%, #6d28d9 100%);
          color: #ffffff;
          font-size: 0.98rem;
          box-shadow:
            0 22px 44px rgba(109, 40, 217, 0.24),
            inset 0 0 0 1px rgba(255, 255, 255, 0.16);
        }

        .login-button-hero:hover:not(:disabled) {
          background: linear-gradient(135deg, #7c3aed 0%, #5b21b6 100%);
          box-shadow:
            0 24px 44px rgba(109, 40, 217, 0.28),
            inset 0 0 0 1px rgba(255, 255, 255, 0.2);
        }

        .hero-visual {
          position: relative;
          display: flex;
          justify-content: flex-end;
          align-items: center;
          min-height: 100%;
          padding-left: 0;
          padding-top: 12px;
          opacity: 0.94;
        }

        .hero-visual::before {
          content: none;
        }

        .shot-wrap {
          position: relative;
          width: 100%;
          max-width: 590px;
          padding: 0;
          z-index: 1;
        }

        .shot-card {
          width: 100%;
          margin-left: auto;
          transform: perspective(1300px) rotateY(-5deg) rotateX(2.5deg) rotate(-0.6deg);
          border-radius: 24px;
          background: #ffffff;
          border: 1px solid rgba(139, 92, 246, 0.1);
          box-shadow:
            0 24px 46px rgba(91, 33, 182, 0.08),
            0 6px 18px rgba(15, 23, 42, 0.04);
          overflow: hidden;
          filter: saturate(0.88) contrast(0.96);
        }

        .shot-browser {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          padding: 14px 16px;
          margin-bottom: 0;
          background: linear-gradient(180deg, #f8f6ff 0%, #f3efff 100%);
          border-bottom: 1px solid rgba(139, 92, 246, 0.12);
        }

        .shot-window {
          display: flex;
          align-items: center;
          gap: 8px;
        }

        .shot-dot {
          width: 10px;
          height: 10px;
          border-radius: 9999px;
          background: rgba(139, 92, 246, 0.28);
        }

        .shot-url {
          flex: 1;
          display: flex;
          justify-content: flex-end;
        }

        .shot-app {
          display: grid;
          grid-template-columns: 132px minmax(0, 1fr);
          gap: 12px;
          align-items: stretch;
          padding: 12px;
        }

        .shot-sidebar {
          border-radius: 18px;
          background: linear-gradient(180deg, #f6f1ff 0%, #efe7ff 100%);
          padding: 12px 10px;
          border: 1px solid #ede9fe;
          overflow: hidden;
        }

        .shot-sidebar-brand {
          display: flex;
          align-items: center;
          gap: 10px;
          margin-bottom: 14px;
        }

        .shot-sidebar-brand-copy {
          display: grid;
          gap: 3px;
          min-width: 0;
        }

        .shot-sidebar-brand-copy strong {
          color: var(--text-main);
          font-size: 0.82rem;
          line-height: 1.3;
        }

        .shot-sidebar-brand-copy span {
          color: var(--text-sub);
          font-size: 0.72rem;
          line-height: 1.3;
        }

        .shot-sidebar-link {
          min-height: 34px;
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 8px;
          border-radius: 10px;
          padding: 0 10px;
          color: var(--text-sub);
          font-size: 0.78rem;
          font-weight: 600;
          white-space: nowrap;
        }

        .shot-sidebar-link + .shot-sidebar-link {
          margin-top: 8px;
        }

        .shot-sidebar-link-active {
          background: #ffffff;
          color: var(--primary-dark);
          box-shadow: 0 8px 18px rgba(139, 92, 246, 0.14);
        }

        .shot-sidebar-count {
          flex-shrink: 0;
          display: inline-flex;
          align-items: center;
          min-height: 18px;
          padding: 0 6px;
          border-radius: 9999px;
          font-size: 0.58rem;
          font-weight: 700;
        }

        .shot-sidebar-count-alert {
          background: rgba(239, 68, 68, 0.12);
          color: var(--error-text);
        }

        .shot-sidebar-count-warn {
          background: rgba(245, 158, 11, 0.14);
          color: var(--warning-text);
        }

        .shot-sidebar-status {
          margin-top: 16px;
          display: grid;
          gap: 8px;
          padding-top: 14px;
          border-top: 1px solid rgba(139, 92, 246, 0.12);
        }

        .shot-sidebar-status p {
          margin: 0;
          color: var(--text-main);
          font-size: 0.68rem;
          font-weight: 700;
          white-space: nowrap;
        }

        .shot-sidebar-badge {
          display: inline-flex;
          align-items: center;
          width: fit-content;
          min-height: 24px;
          padding: 0 10px;
          border-radius: 9999px;
          font-size: 0.68rem;
          font-weight: 700;
        }

        .shot-sidebar-badge-warn {
          background: rgba(245, 158, 11, 0.12);
          color: var(--warning-text);
        }

        .shot-sidebar-badge-alert {
          background: rgba(239, 68, 68, 0.1);
          color: var(--error-text);
        }

        .shot-main {
          display: grid;
          gap: 10px;
        }

        .shot-main-header {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 16px;
        }

        .shot-main-kicker {
          margin: 0 0 4px;
          color: var(--primary-dark);
          font-size: 0.7rem;
          font-weight: 700;
          letter-spacing: 0.08em;
          text-transform: uppercase;
        }

        .shot-main h3,
        .shot-panel-head h4 {
          margin: 0;
          color: var(--text-main);
          font-size: 0.94rem;
          line-height: 1.4;
          font-weight: 700;
        }

        .shot-main-chip {
          flex-shrink: 0;
          display: inline-flex;
          align-items: center;
          min-height: 26px;
          padding: 0 10px;
          border-radius: 9999px;
          background: rgba(139, 92, 246, 0.08);
          color: var(--primary-dark);
          font-size: 0.68rem;
          font-weight: 700;
        }

        .shot-home-main {
          display: grid;
          gap: 10px;
        }

        .shot-home-top {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 12px;
        }

        .shot-home-eyebrow {
          margin: 0 0 4px;
          color: var(--primary-dark);
          font-size: 0.68rem;
          font-weight: 700;
          letter-spacing: 0.08em;
          text-transform: uppercase;
        }

        .shot-home-top h3,
        .shot-home-panel-head h4 {
          margin: 0;
          color: var(--text-main);
          font-size: 0.98rem;
          line-height: 1.25;
          font-weight: 700;
        }

        .shot-home-role {
          margin: 4px 0 0;
          color: var(--text-sub);
          font-size: 0.68rem;
          line-height: 1.45;
        }

        .shot-home-links {
          display: flex;
          gap: 6px;
          flex-wrap: wrap;
          justify-content: flex-end;
        }

        .shot-home-link-chip {
          display: inline-flex;
          align-items: center;
          min-height: 24px;
          padding: 0 10px;
          border-radius: 9999px;
          background: rgba(139, 92, 246, 0.08);
          color: var(--primary-dark);
          font-size: 0.66rem;
          font-weight: 700;
          white-space: nowrap;
        }

        .shot-home-kgi,
        .shot-home-panel {
          border: 1px solid rgba(139, 92, 246, 0.12);
          border-radius: 16px;
          background: #fcfbff;
          box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.7);
        }

        .shot-home-kgi {
          display: grid;
          gap: 4px;
          padding: 11px 12px;
        }

        .shot-home-kgi-label,
        .shot-home-progress-label,
        .shot-home-close-stat span {
          color: var(--text-sub);
          font-size: 0.68rem;
          font-weight: 700;
        }

        .shot-home-kgi-value {
          color: var(--text-main);
          font-size: 0.9rem;
          line-height: 1.35;
          font-weight: 700;
        }

        .shot-home-alert {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          padding: 12px 14px;
          border-radius: 16px;
          border: 1px solid #fecdd3;
          background: linear-gradient(180deg, #fff4f6 0%, #fff8f8 100%);
        }

        .shot-home-alert-label {
          margin: 0 0 4px;
          color: #9f1239;
          font-size: 0.68rem;
          font-weight: 700;
        }

        .shot-home-alert-value {
          color: #7f1d1d;
          font-size: 0.88rem;
          line-height: 1.3;
          font-weight: 800;
        }

        .shot-home-alert-cta {
          flex-shrink: 0;
          display: inline-flex;
          align-items: center;
          min-height: 28px;
          padding: 0 12px;
          border-radius: 9999px;
          background: #ffffff;
          border: 1px solid rgba(244, 114, 182, 0.18);
          color: #9f1239;
          font-size: 0.66rem;
          font-weight: 700;
        }

        .shot-home-actions {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 8px;
        }

        .shot-home-action-card {
          display: grid;
          gap: 4px;
          padding: 10px 11px;
          border-radius: 14px;
          border: 1px solid rgba(139, 92, 246, 0.1);
          background: #f8f6ff;
        }

        .shot-home-action-card-danger {
          background: #fff3f4;
          border-color: #fecdd3;
        }

        .shot-home-action-card-warn {
          background: #fff9ef;
          border-color: rgba(245, 158, 11, 0.2);
        }

        .shot-home-action-card-info {
          background: #f5f3ff;
          border-color: rgba(139, 92, 246, 0.18);
        }

        .shot-home-action-label {
          color: var(--text-sub);
          font-size: 0.66rem;
          font-weight: 700;
        }

        .shot-home-action-value {
          color: var(--text-main);
          font-size: 1.08rem;
          line-height: 1.1;
          font-weight: 800;
        }

        .shot-home-action-note {
          color: var(--text-sub);
          font-size: 0.64rem;
          line-height: 1.45;
        }

        .shot-home-lower {
          display: grid;
          grid-template-columns: minmax(0, 1.14fr) minmax(0, 0.86fr);
          gap: 8px;
        }

        .shot-home-panel {
          padding: 12px;
        }

        .shot-home-panel-head {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 10px;
          margin-bottom: 10px;
        }

        .shot-home-panel-link,
        .shot-home-progress-meta,
        .shot-home-notification-action {
          color: var(--primary-dark);
          font-size: 0.66rem;
          font-weight: 700;
        }

        .shot-home-notification {
          display: grid;
          grid-template-columns: auto minmax(0, 1fr) auto;
          gap: 8px;
          align-items: center;
          padding: 8px 0;
          border-top: 1px solid rgba(139, 92, 246, 0.08);
        }

        .shot-home-notification:first-of-type {
          border-top: none;
          padding-top: 0;
        }

        .shot-home-notification-severity {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 22px;
          height: 22px;
          border-radius: 9999px;
          background: rgba(56, 189, 248, 0.14);
          color: #0369a1;
          font-size: 0.64rem;
          font-weight: 800;
        }

        .shot-home-notification-severity-danger {
          background: rgba(239, 68, 68, 0.14);
          color: var(--error-text);
        }

        .shot-home-notification-severity-warn {
          background: rgba(245, 158, 11, 0.18);
          color: var(--warning-text);
        }

        .shot-home-notification-copy {
          min-width: 0;
          display: grid;
          gap: 2px;
        }

        .shot-home-notification-copy strong {
          color: var(--text-main);
          font-size: 0.72rem;
          line-height: 1.35;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .shot-home-notification-copy span {
          color: var(--text-sub);
          font-size: 0.62rem;
        }

        .shot-home-progress {
          display: grid;
          gap: 8px;
        }

        .shot-home-progress-track {
          height: 8px;
          border-radius: 9999px;
          background: #ede9fe;
          overflow: hidden;
        }

        .shot-home-progress-fill {
          display: block;
          width: 80%;
          height: 100%;
          border-radius: inherit;
          background: linear-gradient(90deg, #8b5cf6 0%, #6d28d9 100%);
        }

        .shot-home-close-stats {
          display: grid;
          gap: 8px;
          margin-top: 10px;
        }

        .shot-home-close-stat {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 10px;
          min-height: 36px;
          padding: 0 10px;
          border-radius: 12px;
          background: #ffffff;
          border: 1px solid rgba(139, 92, 246, 0.1);
        }

        .shot-home-close-stat strong {
          color: var(--text-main);
          font-size: 0.88rem;
          font-weight: 800;
        }

        /* LP改善: モック内テキストを廃し抽象UIでアプリ感を出す */
        .shot-line,
        .shot-pill,
        .shot-chip,
        .shot-brand-orb {
          display: block;
          flex-shrink: 0;
        }

        .shot-line {
          height: 10px;
          border-radius: 9999px;
          background: linear-gradient(90deg, rgba(139, 92, 246, 0.24), rgba(139, 92, 246, 0.1));
        }

        .shot-url-bar {
          height: 12px;
          border-radius: 9999px;
          background: rgba(139, 92, 246, 0.14);
        }

        .shot-url-bar-long {
          width: 148px;
        }

        .shot-brand-orb {
          width: 28px;
          height: 28px;
          border-radius: 10px;
          background: linear-gradient(135deg, #8b5cf6 0%, #6d28d9 100%);
          box-shadow: 0 10px 22px rgba(124, 58, 237, 0.2);
          display: grid;
          place-items: center;
          color: #ffffff;
          font-size: 0.8rem;
          font-weight: 800;
        }

        .shot-brand-stack {
          display: grid;
          gap: 6px;
          flex: 1;
        }

        .shot-line-brand {
          width: 74px;
          height: 9px;
        }

        .shot-line-brand-short {
          width: 52px;
          opacity: 0.72;
        }

        .shot-line-sidebar {
          width: 100%;
          height: 9px;
        }

        .shot-line-sidebar-active {
          background: linear-gradient(90deg, rgba(124, 58, 237, 0.86), rgba(124, 58, 237, 0.36));
        }

        .shot-line-sidebar-mid {
          width: 78%;
        }

        .shot-line-sidebar-short {
          width: 64%;
        }

        .shot-kpis {
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          gap: 10px;
        }

        .shot-kpi-card,
        .shot-panel {
          border: 1px solid #ede9fe;
          border-radius: 14px;
          background: #fafaff;
        }

        .shot-kpi-card {
          padding: 12px;
          display: grid;
          gap: 6px;
        }

        .shot-kpi-label {
          color: var(--text-sub);
          font-size: 0.72rem;
          font-weight: 700;
        }

        .shot-kpi-value {
          color: var(--text-main);
          font-size: 1.3rem;
          line-height: 1.1;
          font-weight: 800;
        }

        .shot-kpi-note {
          color: var(--text-sub);
          font-size: 0.72rem;
          font-weight: 600;
        }

        .shot-kpi-card-warn {
          background: #fff9f0;
          border-color: rgba(245, 158, 11, 0.18);
        }

        .shot-kpi-card-info {
          background: #f5f3ff;
          border-color: rgba(139, 92, 246, 0.18);
        }

        .shot-line-kpi-label {
          width: 56%;
        }

        .shot-line-kpi-value {
          width: 42%;
          height: 18px;
          background: linear-gradient(90deg, rgba(30, 27, 75, 0.86), rgba(124, 58, 237, 0.42));
        }

        .shot-line-kpi-value-short {
          width: 26%;
        }

        .shot-line-kpi-value-mid {
          width: 34%;
        }

        .shot-line-kpi-meta {
          width: 68%;
          height: 9px;
        }

        .shot-line-kpi-meta-short {
          width: 48%;
        }

        .shot-grid {
          display: grid;
          grid-template-columns: minmax(0, 1.1fr) minmax(210px, 0.9fr);
          gap: 10px;
          align-items: stretch;
        }

        .shot-stack {
          display: grid;
          gap: 10px;
        }

        .shot-panel {
          padding: 12px;
          overflow: hidden;
        }

        .shot-panel-head {
          align-items: flex-start;
          justify-content: space-between;
          gap: 10px;
          margin-bottom: 12px;
        }

        .shot-panel-kicker {
          margin: 0 0 4px;
          color: var(--text-sub);
          font-size: 0.7rem;
          font-weight: 700;
          letter-spacing: 0.08em;
          text-transform: uppercase;
        }

        .shot-badge {
          flex-shrink: 0;
          display: inline-flex;
          align-items: center;
          min-height: 24px;
          padding: 0 10px;
          border-radius: 9999px;
          background: rgba(139, 92, 246, 0.08);
          color: var(--primary-dark);
          font-size: 0.68rem;
          font-weight: 700;
        }

        .shot-badge-success {
          background: rgba(34, 197, 94, 0.12);
          color: #15803d;
        }

        .shot-badge-info {
          background: rgba(56, 189, 248, 0.12);
          color: #0369a1;
        }

        .shot-line-head {
          width: 96px;
        }

        .shot-line-head-short {
          width: 62px;
        }

        .shot-line-head-mid {
          width: 84px;
        }

        .shot-row {
          justify-content: space-between;
          gap: 12px;
          padding: 10px 0;
          border-top: 1px solid rgba(139, 92, 246, 0.12);
        }

        .shot-row:first-of-type {
          border-top: none;
          padding-top: 0;
        }

        .shot-row-main {
          min-width: 0;
          display: grid;
          gap: 4px;
        }

        .shot-row-title {
          display: block;
          color: var(--text-main);
          font-size: 0.78rem;
          line-height: 1.4;
          font-weight: 700;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .shot-row-meta {
          display: block;
          color: var(--text-sub);
          font-size: 0.68rem;
          line-height: 1.5;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .shot-row-pill {
          flex-shrink: 0;
          display: inline-flex;
          align-items: center;
          min-height: 24px;
          padding: 0 10px;
          border-radius: 9999px;
          font-size: 0.66rem;
          font-weight: 700;
        }

        .shot-row-pill-warn {
          background: rgba(245, 158, 11, 0.12);
          color: var(--warning-text);
        }

        .shot-row-pill-info {
          background: rgba(56, 189, 248, 0.12);
          color: #0369a1;
        }

        .shot-row-pill-alert {
          background: rgba(239, 68, 68, 0.12);
          color: var(--error-text);
        }

        .shot-line-row-title {
          width: 74%;
        }

        .shot-line-row-title-mid {
          width: 66%;
        }

        .shot-line-row-title-short {
          width: 58%;
        }

        .shot-line-row-meta {
          width: 92%;
          height: 8px;
          opacity: 0.84;
        }

        .shot-line-row-meta-short {
          width: 76%;
        }

        .shot-mini-card {
          padding: 11px 12px;
          border-radius: 12px;
          background: #ffffff;
          border: 1px solid rgba(139, 92, 246, 0.12);
          display: grid;
          gap: 4px;
        }

        .shot-mini-card + .shot-mini-card {
          margin-top: 8px;
        }

        .shot-mini-label {
          color: var(--text-sub);
          font-size: 0.72rem;
          font-weight: 700;
        }

        .shot-mini-value {
          color: var(--text-main);
          font-size: 1rem;
          line-height: 1.2;
          font-weight: 800;
        }

        .shot-mini-note {
          color: var(--text-sub);
          font-size: 0.68rem;
          line-height: 1.5;
        }

        .shot-line-mini {
          width: 74%;
        }

        .shot-line-mini-mid {
          width: 68%;
        }

        .shot-line-mini-short {
          width: 52%;
        }

        .shot-line-mini-value {
          width: 44%;
          height: 14px;
          background: linear-gradient(90deg, rgba(30, 27, 75, 0.84), rgba(124, 58, 237, 0.36));
        }

        .shot-line-mini-value-short {
          width: 34%;
        }

        .shot-line-mini-value-mid {
          width: 40%;
        }

        .shot-links {
          gap: 8px;
          flex-wrap: wrap;
        }

        .shot-pill {
          min-width: 74px;
          height: 30px;
          border-radius: 9999px;
          background: #ffffff;
          border: 1px solid rgba(139, 92, 246, 0.1);
        }

        .shot-pill-mid {
          min-width: 92px;
        }

        .shot-pill-short {
          min-width: 58px;
        }

        .shot-chip {
          width: 74px;
          height: 28px;
          border-radius: 9999px;
          background: rgba(139, 92, 246, 0.14);
        }

        .shot-chip-soft {
          background: rgba(139, 92, 246, 0.12);
        }

        .shot-chip-short {
          width: 52px;
        }

        .shot-chip-mid {
          width: 66px;
        }

        .shot-chip-warn {
          background: rgba(245, 158, 11, 0.18);
        }

        .shot-chip-danger {
          background: rgba(239, 68, 68, 0.18);
        }

        .shot-playbook-list {
          display: grid;
          gap: 8px;
        }

        .shot-playbook-item {
          display: inline-flex;
          align-items: center;
          min-height: 32px;
          padding: 0 12px;
          border-radius: 10px;
          background: #ffffff;
          border: 1px solid rgba(139, 92, 246, 0.12);
          color: var(--text-main);
          font-size: 0.72rem;
          font-weight: 600;
        }

        .features-section {
          background: linear-gradient(180deg, #f8f6ff 0%, #f4f1ff 42%, #ffffff 100%);
          padding: 82px 0 96px;
        }

        .section-header {
          text-align: center;
          margin-bottom: 32px;
          max-width: 820px;
          margin-left: auto;
          margin-right: auto;
        }

        .section-subcopy {
          margin: 0 0 14px;
          color: var(--text-sub);
          font-size: 0.96rem;
          font-weight: 600;
          line-height: 1.7;
        }

        .section-display {
          font-family: var(--font-dm-serif-display), var(--font-inter), serif;
          letter-spacing: -0.02em;
          font-weight: 400;
        }

        .section-kicker {
          margin: 0 0 10px;
          color: var(--primary);
          font-size: 0.84rem;
          font-weight: 700;
          letter-spacing: 0.16em;
          text-transform: uppercase;
        }

        .lp-root h2 {
          font-size: clamp(1.75rem, 3vw, 2.5rem);
          line-height: 1.15;
          font-weight: 700;
        }

        .feature-grid {
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          gap: 22px;
        }

        .feature-card {
          background: rgba(255, 255, 255, 0.94);
          border: 1px solid rgba(124, 58, 237, 0.12);
          border-radius: 18px;
          padding: 28px;
          backdrop-filter: blur(12px);
          box-shadow:
            0 18px 36px rgba(91, 33, 182, 0.06),
            inset 0 1px 0 rgba(255, 255, 255, 0.72);
          transition:
            border-color 0.2s ease,
            transform 0.2s ease,
            box-shadow 0.2s ease;
        }

        .feature-card:hover {
          border-color: rgba(124, 58, 237, 0.24);
          transform: translateY(-4px);
          box-shadow:
            0 22px 40px rgba(76, 29, 149, 0.08),
            inset 0 1px 0 rgba(255, 255, 255, 0.76);
        }

        .shot-playbook-list {
          display: grid;
          gap: 8px;
        }

        .shot-playbook-item {
          display: inline-flex;
          align-items: center;
          min-height: 32px;
          padding: 0 12px;
          border-radius: 10px;
          background: #ffffff;
          border: 1px solid rgba(139, 92, 246, 0.12);
          color: var(--text-main);
          font-size: 0.72rem;
          font-weight: 600;
        }

        .feature-link {
          display: inline-block;
          margin-top: 16px;
          color: var(--primary-dark);
          font-size: 0.95rem;
          font-weight: 700;
          line-height: 1.6;
        }

        .feature-meta {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
          margin-top: 16px;
        }

        .feature-tag {
          display: inline-flex;
          align-items: center;
          min-height: 26px;
          padding: 0 10px;
          border-radius: 9999px;
          background: rgba(139, 92, 246, 0.08);
          color: var(--primary-dark);
          font-size: 0.72rem;
          font-weight: 700;
        }

        /* LP改善: Hero モックと同じトーンのミニUIプレビューに統一する */
        .feature-preview {
          min-height: 120px;
          padding: 11px;
          border-radius: 16px;
          border: 1px solid rgba(124, 58, 237, 0.1);
          background: linear-gradient(180deg, #faf9ff 0%, #f3f0ff 100%);
          margin-bottom: 18px;
          overflow: hidden;
          box-shadow:
            inset 0 1px 0 rgba(255, 255, 255, 0.72),
            0 10px 20px rgba(124, 58, 237, 0.03);
        }

        .feature-preview-svg {
          width: 100%;
          height: auto;
          display: block;
        }

        .feature-kicker {
          margin: 0 0 8px;
          color: var(--primary);
          font-size: 0.78rem;
          font-weight: 700;
          letter-spacing: 0.14em;
          text-transform: uppercase;
        }

        .feature-card h3 {
          font-size: 1.2rem;
          line-height: 1.45;
          font-weight: 700;
          margin-bottom: 10px;
        }

        .cta-section {
          position: relative;
          overflow: clip;
          background: linear-gradient(180deg, #f7f4ff 0%, #ede9fe 100%);
          padding: 120px 0;
        }

        .cta-section::before {
          content: "";
          position: absolute;
          inset: 0;
          background:
            linear-gradient(rgba(109, 40, 217, 0.05) 1px, transparent 1px),
            linear-gradient(90deg, rgba(109, 40, 217, 0.05) 1px, transparent 1px);
          background-size: 52px 52px;
          mask-image: linear-gradient(to bottom, rgba(0, 0, 0, 0.16), transparent 90%);
          opacity: 0.65;
          pointer-events: none;
        }

        .cta-shell {
          display: grid;
          justify-items: center;
          gap: 20px;
          text-align: center;
          position: relative;
          z-index: 1;
        }

        .cta-copy-block {
          display: grid;
          gap: 10px;
          max-width: 760px;
        }

        .cta-copy-block p {
          margin: 0;
          color: var(--text-sub);
          font-size: 0.96rem;
          line-height: 1.6;
        }

        .cta-shell h2 {
          color: var(--text-main);
          max-width: none;
          font-size: clamp(2rem, 4vw, 3.5rem);
          font-family: var(--font-noto-serif-jp), var(--font-noto-sans-jp), serif;
        }

        .cta-shell .login-button-cta {
          margin-top: 18px;
          justify-self: center;
        }

        .cta-secondary-grid {
          width: 100%;
          display: grid;
          grid-template-columns: repeat(4, minmax(0, 1fr));
          gap: 12px;
        }

        .cta-secondary-card {
          appearance: none;
          display: grid;
          gap: 8px;
          align-content: start;
          width: 100%;
          min-height: 148px;
          padding: 18px 18px 16px;
          border-radius: 20px;
          border: 1px solid rgba(124, 58, 237, 0.12);
          background: rgba(255, 255, 255, 0.78);
          color: inherit;
          font-family: inherit;
          box-shadow:
            0 14px 30px rgba(91, 33, 182, 0.06),
            inset 0 1px 0 rgba(255, 255, 255, 0.7);
          text-align: left;
          text-decoration: none;
          cursor: pointer;
          transition:
            transform 0.2s ease,
            border-color 0.2s ease,
            box-shadow 0.2s ease,
            background-color 0.2s ease;
        }

        .cta-secondary-card:hover {
          transform: translateY(-3px);
          border-color: rgba(124, 58, 237, 0.22);
          box-shadow:
            0 18px 34px rgba(91, 33, 182, 0.08),
            inset 0 1px 0 rgba(255, 255, 255, 0.76);
        }

        .cta-secondary-card-contact {
          border-color: rgba(109, 40, 217, 0.18);
          background: linear-gradient(180deg, rgba(255, 255, 255, 0.9), rgba(244, 240, 255, 0.92));
        }

        .cta-secondary-label {
          color: var(--primary-dark);
          font-size: 0.74rem;
          font-weight: 700;
          letter-spacing: 0.12em;
          text-transform: uppercase;
        }

        .cta-secondary-card strong {
          color: var(--text-main);
          font-size: 1.02rem;
          line-height: 1.35;
        }

        .cta-secondary-card span:last-child {
          color: var(--text-sub);
          font-size: 0.86rem;
          line-height: 1.65;
        }

        .footer {
          background: #fdfcff;
          color: var(--text-main);
          border-top: 1px solid rgba(139, 92, 246, 0.12);
          padding-top: 42px;
        }

        .footer-top {
          display: grid;
          grid-template-columns: minmax(420px, 1.08fr) minmax(0, 1.12fr);
          gap: 80px;
          align-items: start;
          padding-bottom: 36px;
        }

        .footer-brand-column {
          display: grid;
          gap: 16px;
        }

        .footer-brand {
          font-size: 1.32rem;
          font-weight: 700;
          letter-spacing: 0.04em;
          text-transform: uppercase;
        }

        .footer-description {
          margin: 0;
          max-width: 42ch;
          color: var(--text-sub);
          font-size: 0.97rem;
          line-height: 1.95;
          text-wrap: pretty;
        }

        .footer-quick-links,
        .footer-link-list {
          display: grid;
          gap: 10px;
        }

        .footer-quick-links a,
        .footer-link-list a,
        .footer-meta a {
          color: var(--primary-dark);
          text-decoration: none;
          font-size: 0.96rem;
          font-weight: 600;
          line-height: 1.7;
        }

        .footer-nav-grid {
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          gap: 30px;
        }

        .footer-column {
          display: grid;
          gap: 14px;
          align-content: start;
        }

        .footer-column h4 {
          margin: 0;
          color: var(--text-main);
          font-size: 0.92rem;
          font-weight: 700;
          letter-spacing: 0.08em;
          text-transform: uppercase;
        }

        .footer-bottom {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 20px;
          padding: 22px 0 30px;
          border-top: 1px solid rgba(139, 92, 246, 0.08);
        }

        .footer-meta {
          display: flex;
          align-items: center;
          gap: 18px;
          flex-wrap: wrap;
        }

        .footer-bottom p,
        .footer-locale span {
          color: var(--text-sub);
          font-size: 0.86rem;
        }

        .footer-locale {
          display: flex;
          align-items: center;
          gap: 12px;
        }

        .footer-locale-active {
          color: var(--primary-dark) !important;
          font-weight: 700;
        }

        .reveal {
          opacity: 0;
          transform: translateY(24px);
          transition:
            opacity 0.6s ease,
            transform 0.6s ease;
        }

        .reveal.is-visible {
          opacity: 1;
          transform: translateY(0);
        }

        @media (max-width: 768px) {
          .section-shell,
          .nav-shell {
            width: min(100% - 24px, 1400px);
          }

          .nav-shell {
            padding: 14px 0;
          }

          .nav-wordmark {
            font-size: 0.94rem;
          }

          .nav-tagline,
          .nav-links {
            display: none;
          }

          .nav-cta-shell {
            gap: 6px;
          }

          .nav-cta-note {
            padding: 0 12px;
            font-size: 0.74rem;
          }

          .login-button-nav {
            min-height: 42px;
            padding: 0 16px;
            font-size: 0.88rem;
          }

          .hero-grid {
            grid-template-columns: 1fr;
            gap: 30px;
            padding: 56px 0 64px;
          }

          .lp-root h1 {
            width: auto;
            max-width: 100%;
            white-space: normal;
          }

          .hero-question-line {
            white-space: normal;
          }

          .hero-display-line {
            max-width: none;
          }

          .hero-display-break {
            display: block;
          }

          .hero-actions {
            justify-items: stretch;
          }

          .hero-cta-panel {
            width: 100%;
            flex-direction: column;
            align-items: stretch;
          }

          .hero-priority-item {
            grid-template-columns: 1fr;
            gap: 8px;
          }

          .login-button-hero {
            width: 100%;
            min-width: 0;
          }

          .hero-visual {
            justify-content: center;
          }

          .hero-visual::before {
            inset: 24px 0 12px 18px;
          }

          .login-button-hero,
          .login-button-cta {
            width: 100%;
          }

          .shot-card {
            transform: none;
          }

          .shot-wrap {
            max-width: 100%;
          }

          .shot-app {
            grid-template-columns: 1fr;
          }

          .shot-sidebar {
            display: none;
          }

          .shot-home-top,
          .shot-home-panel-head {
            flex-direction: column;
            align-items: flex-start;
          }

          .shot-home-links {
            flex-direction: column;
            align-items: flex-start;
            justify-content: flex-start;
          }

          .shot-home-actions,
          .shot-home-lower {
            grid-template-columns: 1fr;
          }

          .shot-kpis,
          .shot-grid,
          .feature-grid {
            grid-template-columns: 1fr;
          }

          .proof-strip {
            border-radius: 24px;
            padding: 16px 18px;
          }

          .features-section,
          .cta-section {
            padding: 64px 0;
          }

          .cta-shell {
            grid-template-columns: 1fr;
            text-align: center;
            justify-items: center;
          }

          .cta-secondary-grid {
            grid-template-columns: 1fr;
          }

          .footer-top {
            grid-template-columns: 1fr;
            gap: 32px;
          }

          .footer-nav-grid {
            grid-template-columns: 1fr;
            gap: 22px;
          }

          .footer-bottom {
            flex-direction: column;
            align-items: flex-start;
          }
        }
      `}</style>
    </>
  )
}
