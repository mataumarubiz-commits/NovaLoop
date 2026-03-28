"use client"

import Image from "next/image"
import StepIndicator from "./StepIndicator"
import PrimaryButton from "./PrimaryButton"

type OnboardingShellProps = {
  stepCurrent: number
  stepTotal: number
  title: string
  description: React.ReactNode
  onBack?: () => void
  onClose?: () => void
  children: React.ReactNode
  ctaLabel?: string
  ctaDisabled?: boolean
  ctaLoading?: boolean
  onCtaClick?: () => void
  ctaHint?: string
  footerText?: string
}

function OnboardingLogo() {
  return (
    <div className="onboarding-logo-wrap">
      <Image
        src="/logo-light.png"
        alt=""
        width={40}
        height={40}
        className="onboarding-logo-light"
        style={{ borderRadius: 12, objectFit: "contain", display: "block" }}
        onError={(event) => {
          const target = event.currentTarget
          target.style.display = "none"
        }}
      />
      <Image
        src="/logo.png"
        alt=""
        width={40}
        height={40}
        className="onboarding-logo-dark"
        style={{ borderRadius: 12, objectFit: "contain", display: "block" }}
        onError={(event) => {
          const target = event.currentTarget
          target.style.display = "none"
          const fallback = target.parentElement?.querySelector(".onboarding-logo-fallback") as HTMLElement | null
          if (fallback) fallback.style.display = "flex"
        }}
      />
      <div className="onboarding-logo-fallback">N</div>
    </div>
  )
}

export default function OnboardingShell({
  stepCurrent,
  stepTotal,
  title,
  description,
  onBack,
  children,
  ctaLabel,
  ctaDisabled,
  ctaLoading,
  onCtaClick,
  ctaHint,
  onClose,
  footerText,
}: OnboardingShellProps) {
  return (
    <div className="onboarding-page">
      {onClose ? (
        <button type="button" className="onboarding-close-btn" onClick={onClose}>
          閉じる
        </button>
      ) : null}

      <div className="onboarding-stage">
        <section className="onboarding-card" aria-label="Onboarding form">
          <div className="onboarding-card-header">
            <div className="onboarding-card-side">
              {onBack ? (
                <button type="button" className="onboarding-back-btn" onClick={onBack}>
                  ← 戻る
                </button>
              ) : (
                <span className="onboarding-header-spacer" aria-hidden="true" />
              )}
            </div>
            <div className="onboarding-card-center">
              <OnboardingLogo />
            </div>
            <p className="onboarding-step-num">
              {stepCurrent}/{stepTotal}
            </p>
          </div>

          <h1 className="onboarding-title">{title}</h1>
          <p className="onboarding-description">{description}</p>

          <div className="onboarding-body">{children}</div>

          {footerText ? <p className="onboarding-footer-note">{footerText}</p> : null}

          {(ctaLabel ?? "").length > 0 ? (
            <div className="onboarding-actions">
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
          ) : null}

          <StepIndicator current={stepCurrent} total={stepTotal} />
        </section>
      </div>
    </div>
  )
}
