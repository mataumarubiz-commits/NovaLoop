"use client"

import { useEffect } from "react"
import { useRouter } from "next/navigation"
import ChoiceCard from "@/components/ChoiceCard"
import OnboardingShell from "@/components/OnboardingShell"
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
  const { user, memberships, loading } = useAuthOrg()

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

  return (
    <OnboardingShell
      stepCurrent={1}
      stepTotal={1}
      title="利用方法を選択してください"
      description="既存組織への参加は無料です。新しい組織を作るには、Googleアカウント単位の作成ライセンスが必要です。"
      onClose={() => router.replace("/")}
    >
      <div className="onboarding-choice-section">
        <div className="onboarding-choice-grid">
          <ChoiceCard
            icon={<JoinIcon />}
            title="既存組織に参加する"
            description="招待または承認済みの既存組織に参加します。メンバー・エグゼクティブアシスタントは無料です。"
            onClick={() => router.push("/join-request")}
          />
          <ChoiceCard
            icon={<CreateIcon />}
            title="新しい組織を作る"
            description="支払済みのご本人だけが新しい組織を作成し、初回オーナーになります。"
            onClick={() => router.push("/request-org")}
          />
        </div>
      </div>
    </OnboardingShell>
  )
}
