"use client"

import { useEffect } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import ChoiceCard from "@/components/ChoiceCard"
import OnboardingShell from "@/components/OnboardingShell"
import { PLATFORM_THANKS_PATH } from "@/lib/platformFlow"
import { useAuthOrg } from "@/hooks/useAuthOrg"

function JoinIcon() {
  return (
    <svg className="onboarding-choice-icon-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M9 12a4 4 0 1 0-4-4 4 4 0 0 0 4 4Z" />
      <path d="M2.5 20a6.5 6.5 0 0 1 9.8-5.58" />
      <path d="m15 12 6 6" />
      <path d="M18 12h3v3" />
    </svg>
  )
}

function CreateIcon() {
  return (
    <svg className="onboarding-choice-icon-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M4 20h16" />
      <path d="M6.5 20V7.5h11V20" />
      <path d="M9.5 11h1" />
      <path d="M13.5 11h1" />
      <path d="M9.5 14.5h1" />
      <path d="M13.5 14.5h1" />
      <path d="M10.5 20v-3h3v3" />
      <path d="M9 7.5V4h6v3.5" />
    </svg>
  )
}

export default function OnboardingPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { user, memberships, loading } = useAuthOrg()
  const isPostPurchaseFlow = searchParams.get("flow") === "post-purchase"
  const requestOrgHref = `/request-org?from=${isPostPurchaseFlow ? "post-purchase" : "onboarding"}`
  const joinRequestHref = `/join-request?from=${isPostPurchaseFlow ? "post-purchase" : "onboarding"}`

  useEffect(() => {
    if (loading) return
    if (!user) {
      router.replace("/")
      return
    }
    if (memberships.length > 1) {
      router.replace("/orgs")
      return
    }
    if (memberships.length === 1) {
      router.replace("/home")
    }
  }, [loading, memberships.length, router, user])

  if (loading) {
    return <div style={{ padding: 32, color: "var(--muted)" }}>読み込み中...</div>
  }

  const choices = isPostPurchaseFlow
    ? [
        {
          key: "create",
          icon: <CreateIcon />,
          title: "新しい組織を作成する",
          description: "最初に組織を作成して、そのまま利用開始まで進めます。",
          onClick: () => router.push(requestOrgHref),
        },
        {
          key: "join",
          icon: <JoinIcon />,
          title: "既存組織に参加する",
          description: "購入済みアカウントで既存組織に参加申請を送ります。",
          onClick: () => router.push(joinRequestHref),
        },
      ]
    : [
        {
          key: "join",
          icon: <JoinIcon />,
          title: "既存組織に参加する",
          description: "招待や owner の案内がある場合はこちらから参加申請を送ります。",
          onClick: () => router.push(joinRequestHref),
        },
        {
          key: "create",
          icon: <CreateIcon />,
          title: "新しい組織を作成する",
          description: "オーナーとして新しい組織を立ち上げる場合はこちらから進みます。",
          onClick: () => router.push(requestOrgHref),
        },
      ]

  return (
    <OnboardingShell
      stepCurrent={1}
      stepTotal={1}
      title={isPostPurchaseFlow ? "初回セットアップの進め方を選んでください" : "利用方法を選択してください"}
      description={
        isPostPurchaseFlow
          ? "購入は完了しています。まずは新しい組織を作成するか、既存組織に参加して利用を始めます。"
          : "既存組織への参加か、新しい組織の作成かを選んでください。Google アカウントのログイン後に続けて進められます。"
      }
      onClose={() => router.replace(isPostPurchaseFlow ? PLATFORM_THANKS_PATH : "/")}
    >
      {isPostPurchaseFlow ? (
        <div className="onboarding-confirm-card onboarding-confirm-card--success">
          <div className="onboarding-confirm-label">購入完了</div>
          <div className="onboarding-confirm-value">ライセンスの利用準備ができました</div>
          <p className="onboarding-confirm-note">次は利用する組織を決めるだけです。ここからセットアップを完了できます。</p>
        </div>
      ) : null}

      <div className="onboarding-choice-section">
        <div className="onboarding-choice-grid">
          {choices.map((choice) => (
            <ChoiceCard
              key={choice.key}
              icon={choice.icon}
              title={choice.title}
              description={choice.description}
              onClick={choice.onClick}
            />
          ))}
        </div>
      </div>
    </OnboardingShell>
  )
}
