import type { AppOrgRole } from "@/lib/orgRoles"

export const ORG_PERMISSION_KEYS = [
  "billing_access",
  "contents_write",
  "pages_write",
  "members_manage",
  "payouts_manage",
] as const

export type OrgPermissionKey = (typeof ORG_PERMISSION_KEYS)[number]

export type OrgPermissions = Record<OrgPermissionKey, boolean>

const EMPTY_PERMISSIONS: OrgPermissions = {
  billing_access: false,
  contents_write: false,
  pages_write: false,
  members_manage: false,
  payouts_manage: false,
}

const ADMIN_PERMISSIONS: OrgPermissions = {
  billing_access: true,
  contents_write: true,
  pages_write: true,
  members_manage: true,
  payouts_manage: true,
}

export function emptyOrgPermissions(): OrgPermissions {
  return { ...EMPTY_PERMISSIONS }
}

export function buildOrgPermissions(
  role: AppOrgRole | null | undefined,
  raw: Record<string, unknown> | null | undefined
): OrgPermissions {
  if (role === "owner" || role === "executive_assistant") {
    return { ...ADMIN_PERMISSIONS }
  }

  const next = emptyOrgPermissions()
  for (const key of ORG_PERMISSION_KEYS) {
    next[key] = raw?.[key] === true
  }
  return next
}

export function hasOrgPermission(
  role: AppOrgRole | null | undefined,
  permissions: OrgPermissions | null | undefined,
  key: OrgPermissionKey
) {
  if (role === "owner" || role === "executive_assistant") return true
  return permissions?.[key] === true
}
