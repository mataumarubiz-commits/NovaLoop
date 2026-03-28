import { NextRequest, NextResponse } from "next/server"
import { requirePlatformAdmin } from "@/lib/platformAuth"

type ProfileRow = {
  user_id: string
  full_name?: string | null
  company_name?: string | null
  google_email?: string | null
}

type UserProfileRow = {
  user_id: string
  display_name?: string | null
}

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
}

export async function GET(req: NextRequest) {
  const auth = await requirePlatformAdmin(req)
  if ("error" in auth) return auth.error

  const query = req.nextUrl.searchParams.get("q")?.trim() ?? ""
  const admin = auth.admin

  const matchedUserIds = new Set<string>()
  let candidateProfiles: ProfileRow[] = []
  let candidateUserProfiles: UserProfileRow[] = []

  if (query) {
    const profileQueries = await Promise.all([
      admin.from("creator_profiles").select("user_id, full_name, company_name, google_email").ilike("full_name", `%${query}%`).limit(20),
      admin.from("creator_profiles").select("user_id, full_name, company_name, google_email").ilike("company_name", `%${query}%`).limit(20),
      admin.from("creator_profiles").select("user_id, full_name, company_name, google_email").ilike("google_email", `%${query}%`).limit(20),
      admin.from("user_profiles").select("user_id, display_name").ilike("display_name", `%${query}%`).limit(20),
    ])

    for (const row of profileQueries[0].data ?? []) matchedUserIds.add(row.user_id)
    for (const row of profileQueries[1].data ?? []) matchedUserIds.add(row.user_id)
    for (const row of profileQueries[2].data ?? []) matchedUserIds.add(row.user_id)
    for (const row of profileQueries[3].data ?? []) matchedUserIds.add(row.user_id)
    if (isUuid(query)) matchedUserIds.add(query)

    candidateProfiles = [
      ...(profileQueries[0].data ?? []),
      ...(profileQueries[1].data ?? []),
      ...(profileQueries[2].data ?? []),
    ]
    candidateUserProfiles = profileQueries[3].data ?? []
  }

  let entitlementQuery = admin.from("creator_entitlements").select("*").order("updated_at", { ascending: false }).limit(50)
  if (query) {
    const ids = [...matchedUserIds]
    entitlementQuery = ids.length > 0 ? entitlementQuery.in("user_id", ids) : entitlementQuery.limit(0)
  }

  const { data: entitlements, error } = await entitlementQuery
  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
  }

  const entitlementUserIds = new Set<string>((entitlements ?? []).map((row) => String(row.user_id)))
  for (const row of candidateProfiles) entitlementUserIds.add(String(row.user_id))
  for (const row of candidateUserProfiles) entitlementUserIds.add(String(row.user_id))
  if (query && isUuid(query)) entitlementUserIds.add(query)

  const userIds = [...entitlementUserIds]

  const [profilesRes, userProfilesRes] = await Promise.all([
    userIds.length > 0
      ? admin.from("creator_profiles").select("user_id, full_name, company_name, google_email").in("user_id", userIds)
      : Promise.resolve({ data: [], error: null }),
    userIds.length > 0
      ? admin.from("user_profiles").select("user_id, display_name").in("user_id", userIds)
      : Promise.resolve({ data: [], error: null }),
  ])

  const creatorProfiles = new Map<string, ProfileRow>(
    (profilesRes.data ?? []).map((row: ProfileRow) => [String(row.user_id), row])
  )
  const userProfiles = new Map<string, UserProfileRow>(
    (userProfilesRes.data ?? []).map((row: UserProfileRow) => [String(row.user_id), row])
  )

  const rows = (entitlements ?? []).map((row) => {
    const userId = String(row.user_id)
    const creatorProfile = creatorProfiles.get(userId) ?? null
    const userProfile = userProfiles.get(userId) ?? null
    return {
      ...row,
      creator_profile: creatorProfile,
      user_profile: userProfile,
    }
  })

  const candidateIds = query ? [...matchedUserIds] : []
  const candidates = candidateIds.map((userId) => ({
    user_id: userId,
    creator_profile: creatorProfiles.get(userId) ?? null,
    user_profile: userProfiles.get(userId) ?? null,
    entitlement: rows.find((row) => String(row.user_id) === userId) ?? null,
  }))

  return NextResponse.json({ ok: true, entitlements: rows, candidates })
}
