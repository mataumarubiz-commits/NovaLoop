"use client"

import { useEffect, useState, useCallback } from "react"
import { useRouter } from "next/navigation"
import { supabase } from "@/lib/supabase"
import { normalizeAppOrgRole } from "@/lib/orgRoles"

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

type AuthOrgSnapshot = Omit<AuthOrgState, "setActiveOrgId" | "refresh">

const AUTH_ORG_CACHE_TTL_MS = 60_000

const EMPTY_AUTH_ORG_SNAPSHOT: AuthOrgSnapshot = {
  user: null,
  profile: null,
  activeOrgId: null,
  role: null,
  memberships: [],
  loading: true,
  needsOnboarding: false,
}

let authOrgCache:
  | {
      snapshot: AuthOrgSnapshot
      cachedAt: number
    }
  | null = null

let authOrgInflightLoad: Promise<AuthOrgSnapshot> | null = null

const cloneSnapshot = (snapshot: AuthOrgSnapshot): AuthOrgSnapshot => ({
  user: snapshot.user ? { ...snapshot.user } : null,
  profile: snapshot.profile ? { ...snapshot.profile } : null,
  activeOrgId: snapshot.activeOrgId,
  role: snapshot.role,
  memberships: snapshot.memberships.map((membership) => ({ ...membership })),
  loading: snapshot.loading,
  needsOnboarding: snapshot.needsOnboarding,
})

const getCachedSnapshot = (options?: { allowStale?: boolean }) => {
  if (!authOrgCache) return null
  if (!options?.allowStale && Date.now() - authOrgCache.cachedAt > AUTH_ORG_CACHE_TTL_MS) {
    return null
  }
  return cloneSnapshot(authOrgCache.snapshot)
}

const setCachedSnapshot = (snapshot: AuthOrgSnapshot) => {
  authOrgCache = {
    snapshot: cloneSnapshot(snapshot),
    cachedAt: Date.now(),
  }
}

const normalizeMembership = (membership: OrgMembership): OrgMembership | null => {
  const role = normalizeAppOrgRole(membership.role)
  if (!role) return null
  return {
    ...membership,
    role,
  }
}

const normalizeMemberships = (memberships: OrgMembership[]) =>
  memberships
    .map((membership) => normalizeMembership(membership))
    .filter((membership): membership is OrgMembership => Boolean(membership))

async function fetchAuthOrgSnapshot(): Promise<AuthOrgSnapshot> {
  const fetchMyOrgs = async (
    accessToken?: string | null
  ): Promise<{ profile: { display_name: string; active_org_id: string | null }; orgs: OrgMembership[] } | null> => {
    const token = accessToken ?? (await supabase.auth.getSession()).data.session?.access_token
    if (!token) return null
    try {
      const res = await fetch("/api/auth/my-orgs", { headers: { Authorization: `Bearer ${token}` } })
      const json = await res.json().catch(() => null)
      if (!json?.ok || !Array.isArray(json.orgs)) return null
      const orgs = normalizeMemberships(json.orgs)
      return {
        profile: json.profile ?? { display_name: "", active_org_id: orgs[0]?.org_id ?? null },
        orgs,
      }
    } catch {
      return null
    }
  }

  const { data: sessionData } = await supabase.auth.getSession()
  const accessToken = sessionData.session?.access_token ?? null
  let u = sessionData.session?.user ?? null
  if (!u) {
    u = (await supabase.auth.getUser()).data.user
  }

  if (!u) {
    return {
      user: null,
      profile: null,
      activeOrgId: null,
      role: null,
      memberships: [],
      needsOnboarding: false,
      loading: false,
    }
  }

  const user = { id: u.id, email: u.email }
  const apiSnapshot = await fetchMyOrgs(accessToken)
  if (apiSnapshot) {
    const activeOrgId = apiSnapshot.profile?.active_org_id ?? apiSnapshot.orgs[0]?.org_id ?? null
    return {
      user,
      profile: apiSnapshot.profile ?? null,
      activeOrgId,
      role: apiSnapshot.orgs.find((org) => org.org_id === activeOrgId)?.role ?? apiSnapshot.orgs[0]?.role ?? null,
      memberships: apiSnapshot.orgs,
      needsOnboarding: apiSnapshot.orgs.length === 0,
      loading: false,
    }
  }

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
      await supabase.from("user_profiles").upsert(
        {
          user_id: u.id,
          display_name: u.email?.split("@")[0] ?? "User",
          active_org_id: firstRow.org_id,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "user_id" }
      )
      const { data: retry } = await supabase
        .from("user_profiles")
        .select("display_name, active_org_id")
        .eq("user_id", u.id)
        .maybeSingle()
      prof = retry as { display_name?: string; active_org_id?: string | null } | null
    }
  }

  if (!prof) {
    const fallback = await fetchMyOrgs(accessToken)
    if (fallback?.orgs && fallback.orgs.length > 0) {
      const activeOrgId = fallback.profile?.active_org_id ?? fallback.orgs[0].org_id
      return {
        user,
        profile: fallback.profile ?? { display_name: "", active_org_id: activeOrgId },
        activeOrgId,
        role:
          fallback.orgs.find((org) => org.org_id === activeOrgId)?.role ??
          fallback.orgs[0].role ??
          null,
        memberships: fallback.orgs,
        needsOnboarding: false,
        loading: false,
      }
    }

    return {
      user,
      profile: null,
      activeOrgId: null,
      role: null,
      memberships: [],
      needsOnboarding: true,
      loading: false,
    }
  }

  const profile = {
    display_name: prof.display_name ?? "",
    active_org_id: prof.active_org_id ?? null,
  }

  const { data: auListData } = await supabase
    .from("app_users")
    .select("org_id, role")
    .eq("user_id", u.id)

  let rows = (auListData ?? []) as { org_id: string; role: string }[]
  for (const delayMs of [400, 1000]) {
    if (rows.length > 0) break
    await new Promise((resolve) => setTimeout(resolve, delayMs))
    const retry = await supabase.from("app_users").select("org_id, role").eq("user_id", u.id)
    rows = (retry.data ?? []) as { org_id: string; role: string }[]
  }

  rows = rows.filter((row) => Boolean(normalizeAppOrgRole(row.role)))

  if (rows.length === 0) {
    const fallback = await fetchMyOrgs(accessToken)
    if (fallback?.orgs && fallback.orgs.length > 0) {
      const activeOrgId = fallback.profile?.active_org_id ?? fallback.orgs[0].org_id
      return {
        user,
        profile,
        activeOrgId,
        role:
          fallback.orgs.find((org) => org.org_id === activeOrgId)?.role ??
          fallback.orgs[0].role ??
          null,
        memberships: fallback.orgs,
        needsOnboarding: false,
        loading: false,
      }
    }

    return {
      user,
      profile,
      activeOrgId: null,
      role: null,
      memberships: [],
      needsOnboarding: true,
      loading: false,
    }
  }

  const orgIds = [...new Set(rows.map((row) => row.org_id))]
  const { data: orgs } = await supabase.from("organizations").select("id, name").in("id", orgIds)
  const orgMap = new Map<string, string>()
  ;(orgs ?? []).forEach((org) => orgMap.set((org as { id: string }).id, (org as { name: string }).name))
  const memberships: OrgMembership[] = rows.map((row) => ({
    org_id: row.org_id,
    org_name: orgMap.get(row.org_id),
    role: normalizeAppOrgRole(row.role) ?? "member",
  }))

  let activeOrgId = profile.active_org_id ?? null
  if (!activeOrgId && memberships.length > 0) {
    activeOrgId = memberships[0].org_id
    await supabase
      .from("user_profiles")
      .update({ active_org_id: activeOrgId, updated_at: new Date().toISOString() })
      .eq("user_id", u.id)
  }

  return {
    user,
    profile,
    activeOrgId,
    role: normalizeAppOrgRole(rows.find((row) => row.org_id === activeOrgId)?.role) ?? null,
    memberships,
    needsOnboarding: false,
    loading: false,
  }
}

async function loadSharedAuthOrgSnapshot(force = false) {
  const cached = !force ? getCachedSnapshot() : null
  if (cached) return cached

  if (!force && authOrgInflightLoad) {
    return cloneSnapshot(await authOrgInflightLoad)
  }

  const promise = fetchAuthOrgSnapshot()
  authOrgInflightLoad = promise
  try {
    const snapshot = await promise
    setCachedSnapshot(snapshot)
    return cloneSnapshot(snapshot)
  } finally {
    if (authOrgInflightLoad === promise) {
      authOrgInflightLoad = null
    }
  }
}

export function useAuthOrg(options?: { redirectToOnboarding?: boolean }): AuthOrgState {
  const router = useRouter()
  const [state, setState] = useState<AuthOrgSnapshot>(() => getCachedSnapshot({ allowStale: true }) ?? EMPTY_AUTH_ORG_SNAPSHOT)

  const load = useCallback(async (force = false) => {
    const nextState = await loadSharedAuthOrgSnapshot(force)
    setState(nextState)
  }, [])

  useEffect(() => {
    const shouldRefresh = !authOrgCache || Date.now() - authOrgCache.cachedAt > AUTH_ORG_CACHE_TTL_MS
    if (!shouldRefresh) return

    const timer = setTimeout(() => {
      void load()
    }, 0)

    return () => clearTimeout(timer)
  }, [load])

  useEffect(() => {
    if (options?.redirectToOnboarding && !state.loading && state.needsOnboarding) {
      router.push("/onboarding")
    }
  }, [options?.redirectToOnboarding, router, state.loading, state.needsOnboarding])

  const setActiveOrgId = useCallback(
    async (orgId: string) => {
      if (!state.user) return

      await supabase
        .from("user_profiles")
        .update({ active_org_id: orgId, updated_at: new Date().toISOString() })
        .eq("user_id", state.user.id)

      const membership = state.memberships.find((item) => item.org_id === orgId)
      const nextState: AuthOrgSnapshot = {
        ...state,
        profile: state.profile ? { ...state.profile, active_org_id: orgId } : { display_name: "", active_org_id: orgId },
        activeOrgId: orgId,
        role: membership?.role ?? null,
        loading: false,
      }

      setCachedSnapshot(nextState)
      setState(nextState)
      router.refresh()
    },
    [router, state]
  )

  const refresh = useCallback(async () => {
    await load(true)
  }, [load])

  return {
    ...state,
    setActiveOrgId,
    refresh,
  }
}
