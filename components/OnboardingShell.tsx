"use client"

import Image from "next/image"
import StepIndicator from "./StepIndicator"
import PrimaryButton from "./PrimaryButton"

type OnboardingShellProps = {
  stepCurrent: number
  stepTotal: number
  title: string
  description: string
  onBack?: () => void
  onClose?: () => void
  children: React.ReactNode
  ctaLabel?: string
  ctaDisabled?: boolean
  ctaLoading?: boolean
  onCtaClick?: () => void
  ctaHint?: string
}

function OnboardingLogo() {
  return (
    <div className="onboarding-logo-wrap">
      {/* ライトモード: 紫グラデ＋薄ラベンダー背景のロゴ（そのまま表示） */}
      <Image
        src="/logo-light.png"
        alt=""
        width={48}
        height={48}
        className="onboarding-logo-light"
        style={{ borderRadius: 12, objectFit: "contain", display: "block" }}
        onError={(e) => {
          const target = e.currentTarget
          target.style.display = "none"
        }}
      />
      {/* ダークモード: 通常ロゴ */}
      <Image
        src="/logo.png"
        alt=""
        width={48}
        height={48}
        className="onboarding-logo-dark"
        style={{ borderRadius: 12, objectFit: "contain", display: "block" }}
        onError={(e) => {
          const target = e.currentTarget
          target.style.display = "none"
          const fallback = target.parentElement?.querySelector(".onboarding-logo-fallback") as HTMLElement | null
          if (fallback) fallback.style.display = "flex"
        }}
      />
      <div
        className="onboarding-logo-fallback"
        style={{
          display: "none",
          width: 48,
          height: 48,
          borderRadius: 12,
          background: "linear-gradient(135deg, #7c3aed 0%, #5b21b6 100%)",
          alignItems: "center",
          justifyContent: "center",
          color: "#fff",
          fontSize: 22,
          fontWeight: 700,
          boxShadow: "0 4px 14px rgba(124, 58, 237, 0.35)",
        }}
      >
        P
      </div>
    </div>
  )
}

export default function OnboardingShell({
  stepCurrent,
  stepTotal,
  title,
  description,
  onBack,
  onClose,
  children,
  ctaLabel,
  ctaDisabled,
  ctaLoading,
  onCtaClick,
  ctaHint,
}: OnboardingShellProps) {
  return (
    <div className="onboarding-page" style={{ position: "relative" }}>
      {(onBack || onClose) && (
        <button
          type="button"
          className="onboarding-close-btn"
          onClick={onBack ?? onClose}
          style={{
            position: "absolute",
            top: 24,
            left: 24,
            zIndex: 10,
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            padding: "8px 12px",
            fontSize: 14,
            fontWeight: 500,
            color: "var(--text)",
            background: "none",
            border: "none",
            cursor: "pointer",
          }}
        >
          {onBack ? "← 戻る" : "× 閉じる"}
        </button>
      )}
      <div className="onboarding-card">
        {/* 参考画像どおり: 上段にロゴ中央・ステップ数は右上 */}
        <div className="onboarding-card-header">
          <div style={{ width: 48, flexShrink: 0 }} aria-hidden />
          <OnboardingLogo />
          <p
            className="onboarding-step-num"
            style={{
              fontSize: 13,
              color: "var(--muted)",
              fontWeight: 500,
              width: 48,
              textAlign: "right",
              flexShrink: 0,
            }}
          >
            {stepCurrent}/{stepTotal}
          </p>
        </div>

        <h1
          style={{
            fontSize: "1.875rem",
            fontWeight: 700,
            color: "var(--text)",
            marginBottom: 10,
            lineHeight: 1.3,
            textAlign: "center",
          }}
        >
          {title}
        </h1>
        <p
          style={{
            fontSize: 15,
            color: "var(--muted)",
            lineHeight: 1.55,
            marginBottom: 28,
            textAlign: "center",
          }}
        >
          {description}
        </p>

        <div style={{ marginBottom: 28, textAlign: "center" }}>{children}</div>

        <StepIndicator current={stepCurrent} total={stepTotal} />

        {(ctaLabel ?? "").length > 0 && (
          <div style={{ marginTop: 28 }}>
            <PrimaryButton
              disabled={ctaDisabled}
              loading={ctaLoading}
              onClick={onCtaClick}
              hint={ctaHint}
              variant="onboarding"
            >
              {ctaLabel}
            </PrimaryButton>
          </div>
        )}
      </div>
    </div>
  )
}
