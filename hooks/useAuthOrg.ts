"use client"

import { useEffect, useState, useCallback } from "react"
import { useRouter } from "next/navigation"
import { supabase } from "@/lib/supabase"

export type OrgMembership = {
  org_id: string
  org_name?: string
  role: string
}

export type AuthOrgState = {
  user: { id: string; email?: string } | null
  profile: { display_name: string; active_org_id: string | null } | null
  activeOrgId: string | null
  role: string | null
  memberships: OrgMembership[]
  loading: boolean
  needsOnboarding: boolean
  setActiveOrgId: (orgId: string) => Promise<void>
  refresh: () => Promise<void>
}

export function useAuthOrg(options?: { redirectToOnboarding?: boolean }): AuthOrgState {
  const router = useRouter()
  const [user, setUser] = useState<{ id: string; email?: string } | null>(null)
  const [profile, setProfile] = useState<{ display_name: string; active_org_id: string | null } | null>(null)
  const [activeOrgId, setActiveOrgIdState] = useState<string | null>(null)
  const [role, setRole] = useState<string | null>(null)
  const [memberships, setMemberships] = useState<OrgMembership[]>([])
  const [loading, setLoading] = useState(true)
  const [needsOnboarding, setNeedsOnboarding] = useState(false)

  const load = useCallback(async () => {
    const fetchMyOrgs = async (): Promise<{ profile: { display_name: string; active_org_id: string | null }; orgs: OrgMembership[] } | null> => {
      const { data } = await supabase.auth.getSession()
      const token = data.session?.access_token
      if (!token) return null
      try {
        const res = await fetch("/api/auth/my-orgs", { headers: { Authorization: `Bearer ${token}` } })
        const json = await res.json().catch(() => null)
        if (!json?.ok || !Array.isArray(json.orgs)) return null
        return {
          profile: json.profile ?? { display_name: "", active_org_id: json.orgs?.[0]?.org_id ?? null },
          orgs: json.orgs,
        }
      } catch {
        return null
      }
    }

    // ログイン直後はセッション復元が遅れることがあるので getSession も試す
    let u = (await supabase.auth.getUser()).data.user
    if (!u) {
      const { data: sessionData } = await supabase.auth.getSession()
      u = sessionData?.session?.user ?? null
    }
    if (!u) {
      setUser(null)
      setProfile(null)
      setActiveOrgIdState(null)
      setRole(null)
      setMemberships([])
      setNeedsOnboarding(false)
      setLoading(false)
      return
    }
    setUser({ id: u.id, email: u.email })

    const { data: profileData, error: profileError } = await supabase
      .from("user_profiles")
      .select("display_name, active_org_id")
      .eq("user_id", u.id)
      .maybeSingle()
    if (profileError) {
      console.warn("[useAuthOrg] user_profiles select error (RLS/table?):", profileError.message)
    }
    let prof = profileData as { display_name?: string; active_org_id?: string | null } | null
    if (!prof) {
      const { data: auListFirst } = await supabase.from("app_users").select("org_id").eq("user_id", u.id).limit(1)
      const firstRow = (auListFirst ?? [])[0] as { org_id?: string } | undefined
      if (firstRow?.org_id) {
        await supabase.from("user_profiles").upsert({
          user_id: u.id,
          display_name: u.email?.split("@")[0] ?? "User",
          active_org_id: firstRow.org_id,
          updated_at: new Date().toISOString(),
        }, { onConflict: "user_id" })
        const { data: retry } = await supabase.from("user_profiles").select("display_name, active_org_id").eq("user_id", u.id).maybeSingle()
        prof = retry as { display_name?: string; active_org_id?: string | null } | null
      }
    }
    if (!prof) {
      const fallback = await fetchMyOrgs()
      if (fallback?.orgs && fallback.orgs.length > 0) {
        setProfile(fallback.profile ?? { display_name: "", active_org_id: fallback.orgs[0].org_id })
        setMemberships(fallback.orgs)
        setActiveOrgIdState(fallback.profile?.active_org_id ?? fallback.orgs[0].org_id)
        setRole(fallback.orgs.find((o) => o.org_id === (fallback.profile?.active_org_id ?? fallback.orgs[0].org_id))?.role ?? fallback.orgs[0].role ?? null)
        setNeedsOnboarding(false)
        setLoading(false)
        return
      }
      setProfile(null)
      setActiveOrgIdState(null)
      setRole(null)
      setMemberships([])
      setNeedsOnboarding(true)
      setLoading(false)
      return
    }
    setProfile({ display_name: prof.display_name ?? "", active_org_id: prof.active_org_id ?? null })

    const { data: auListData } = await supabase
      .from("app_users")
      .select("org_id, role")
      .eq("user_id", u.id)
    let rows = (auListData ?? []) as { org_id: string; role: string }[]
    for (const delayMs of [400, 1000]) {
      if (rows.length > 0) break
      await new Promise((r) => setTimeout(r, delayMs))
      const retry = await supabase.from("app_users").select("org_id, role").eq("user_id", u.id)
      rows = (retry.data ?? []) as { org_id: string; role: string }[]
    }
    if (rows.length === 0) {
      const fallback = await fetchMyOrgs()
      if (fallback?.orgs && fallback.orgs.length > 0) {
        setMemberships(fallback.orgs)
        setActiveOrgIdState(fallback.profile?.active_org_id ?? fallback.orgs[0].org_id)
        setRole(fallback.orgs.find((o) => o.org_id === (fallback.profile?.active_org_id ?? fallback.orgs[0].org_id))?.role ?? fallback.orgs[0].role ?? null)
        setNeedsOnboarding(false)
        setLoading(false)
        return
      }
      setMemberships([])
      setActiveOrgIdState(null)
      setRole(null)
      setNeedsOnboarding(true)
      setLoading(false)
      return
    }

    const orgIds = [...new Set(rows.map((r) => r.org_id))]
    const { data: orgs } = await supabase.from("organizations").select("id, name").in("id", orgIds)
    const orgMap = new Map<string, string>()
    ;(orgs ?? []).forEach((o) => orgMap.set((o as { id: string }).id, (o as { name: string }).name))
    const mems: OrgMembership[] = rows.map((r) => ({ org_id: r.org_id, org_name: orgMap.get(r.org_id), role: r.role }))
    setMemberships(mems)

    let activeId = prof.active_org_id ?? null
    if (!activeId && mems.length > 0) {
      activeId = mems[0].org_id
      await supabase
        .from("user_profiles")
        .update({ active_org_id: activeId, updated_at: new Date().toISOString() })
        .eq("user_id", u.id)
    }
    setActiveOrgIdState(activeId)
    setNeedsOnboarding(false)

    const current = rows.find((r) => r.org_id === activeId)
    setRole(current?.role ?? null)
    setLoading(false)
  }, [])

  useEffect(() => {
    const timer = setTimeout(() => {
      void load()
    }, 0)
    return () => clearTimeout(timer)
  }, [load])

  useEffect(() => {
    if (options?.redirectToOnboarding && !loading && needsOnboarding) {
      router.push("/onboarding")
    }
  }, [loading, needsOnboarding, options?.redirectToOnboarding, router])

  const setActiveOrgId = useCallback(
    async (orgId: string) => {
      if (!user) return
      await supabase
        .from("user_profiles")
        .update({ active_org_id: orgId, updated_at: new Date().toISOString() })
        .eq("user_id", user.id)
      setActiveOrgIdState(orgId)
      const m = memberships.find((x) => x.org_id === orgId)
      setRole(m?.role ?? null)
      router.refresh()
    },
    [user, memberships, router]
  )

  return {
    user,
    profile,
    activeOrgId,
    role,
    memberships,
    loading,
    needsOnboarding,
    setActiveOrgId,
    refresh: load,
  }
}
