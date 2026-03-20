"use client"

import { useEffect, useState } from "react"
import Image from "next/image"
import { useRouter } from "next/navigation"
import { useAuthOrg } from "@/hooks/useAuthOrg"

function roleLabel(role: string) {
  if (role === "owner") return "オーナー"
  if (role === "executive_assistant") return "秘書"
  if (role === "pm") return "PM"
  if (role === "director") return "ディレクター"
  if (role === "worker") return "メンバー"
  return role
}

function OrgChooserLoading() {
  return (
    <div className="org-chooser-loading" aria-live="polite">
      <div className="org-chooser-mark-wrap">
        <Image
          src="/logo.png"
          alt=""
          width={40}
          height={40}
          className="org-chooser-mark"
          onError={(event) => {
            event.currentTarget.style.display = "none"
            const fallback = event.currentTarget.parentElement?.querySelector(".org-chooser-mark-fallback") as HTMLElement | null
            if (fallback) fallback.style.display = "flex"
          }}
        />
        <div className="org-chooser-mark-fallback">N</div>
      </div>
      <div className="onboarding-spinner" aria-hidden="true" />
      <p className="org-chooser-loading-copy">組織情報を確認しています</p>
    </div>
  )
}

export default function OrgsPage() {
  const router = useRouter()
  const { user, profile, activeOrgId, memberships, loading, needsOnboarding, setActiveOrgId } = useAuthOrg()
  const [selectingOrgId, setSelectingOrgId] = useState<string | null>(null)

  useEffect(() => {
    if (loading) return

    if (!user) {
      router.replace("/")
      return
    }

    if (needsOnboarding || memberships.length === 0) {
      router.replace("/onboarding")
      return
    }

    if (memberships.length === 1) {
      const membership = memberships[0]

      const redirectToHome = async () => {
        if (activeOrgId !== membership.org_id) {
          await setActiveOrgId(membership.org_id)
        }
        router.replace("/home")
      }

      void redirectToHome()
    }
  }, [activeOrgId, loading, memberships, needsOnboarding, router, setActiveOrgId, user])

  const handleSelectOrg = async (orgId: string) => {
    setSelectingOrgId(orgId)
    await setActiveOrgId(orgId)
    router.push("/home")
  }

  if (loading || !user || needsOnboarding || memberships.length <= 1) {
    return (
      <div className="org-chooser-page">
        <div className="org-chooser-shell">
          <OrgChooserLoading />
        </div>
      </div>
    )
  }

  const displayName = profile?.display_name?.trim() || user.email?.split("@")[0] || "あなた"

  return (
    <div className="org-chooser-page">
      <div className="org-chooser-shell">
        <div className="org-chooser-brand">
          <Image
            src="/logo.png"
            alt=""
            width={36}
            height={36}
            className="org-chooser-brand-mark"
            onError={(event) => {
              event.currentTarget.style.display = "none"
              const fallback = event.currentTarget.parentElement?.querySelector(".org-chooser-brand-fallback") as HTMLElement | null
              if (fallback) fallback.style.display = "flex"
            }}
          />
          <div className="org-chooser-brand-fallback">N</div>
        </div>

        <header className="org-chooser-header">
          <h1 className="org-chooser-title">組織を選択</h1>
          <p className="org-chooser-description">続行する組織を選んでください</p>
        </header>

        <div className="org-chooser-list" role="list" aria-label="所属組織一覧">
          {memberships.map((membership) => {
            const selected = selectingOrgId === membership.org_id
            const orgName = membership.org_name?.trim() || "ワークスペース"

            return (
              <button
                key={membership.org_id}
                type="button"
                className={selected ? "org-chooser-card is-busy" : "org-chooser-card"}
                onClick={() => void handleSelectOrg(membership.org_id)}
                disabled={Boolean(selectingOrgId)}
              >
                <div className="org-chooser-card-head">
                  <span className="org-chooser-card-name">{orgName}</span>
                  <span className="org-chooser-role">{roleLabel(membership.role)}</span>
                </div>
                <div className="org-chooser-card-meta">
                  <span>{displayName}</span>
                  {activeOrgId === membership.org_id ? <span>現在の組織</span> : null}
                </div>
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}
