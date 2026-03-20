"use client"

import { useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import { supabase } from "@/lib/supabase"

function normalizeNextTarget(value: string | null) {
  if (!value || !value.startsWith("/")) return "/onboarding"
  if (value.startsWith("//")) return "/onboarding"
  return value
}

export default function AuthFinishPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const nextTarget = useMemo(() => normalizeNextTarget(searchParams?.get("next") ?? null), [searchParams])
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let active = true
    let timeoutId: ReturnType<typeof setTimeout> | undefined

    const completeAuth = async () => {
      const { data: sessionData } = await supabase.auth.getSession()
      if (!active) return

      if (sessionData.session?.user) {
        router.replace(nextTarget)
        return
      }

      const { data: userData } = await supabase.auth.getUser()
      if (!active) return

      if (userData.user) {
        router.replace(nextTarget)
        return
      }

      timeoutId = setTimeout(() => {
        if (!active) return
        setFailed(true)
      }, 8000)
    }

    void completeAuth()

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!active) return
      if (!session?.user) return
      if (timeoutId) clearTimeout(timeoutId)
      router.replace(nextTarget)
    })

    return () => {
      active = false
      if (timeoutId) clearTimeout(timeoutId)
      subscription.unsubscribe()
    }
  }, [nextTarget, router])

  return (
    <div className="auth-finish-page">
      <div className="auth-finish-card" aria-live="polite">
        <div className="auth-finish-mark">N</div>
        <div className="onboarding-spinner" aria-hidden="true" />
        <h1 className="auth-finish-title">認証を完了しています</h1>
        <p className="auth-finish-description">
          {failed ? "認証の反映に時間がかかっています。もう一度ログインしてください。" : "安全にログイン状態を確定しています。"}
        </p>
        {failed ? (
          <Link className="auth-finish-link" href="/">
            ログイン画面へ戻る
          </Link>
        ) : null}
      </div>
    </div>
  )
}
