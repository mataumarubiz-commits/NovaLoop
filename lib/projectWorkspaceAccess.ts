export function canAccessProjectsSurface(role: string | null | undefined) {
  return role === "owner" || role === "executive_assistant"
}

export function shouldLoadProjectWorkspace(params: {
  activeOrgId: string | null
  needsOnboarding: boolean
  requireAdminSurface?: boolean
  role: string | null | undefined
}) {
  const { activeOrgId, needsOnboarding, requireAdminSurface = false, role } = params
  if (!activeOrgId || needsOnboarding) return false
  if (!requireAdminSurface) return true
  return canAccessProjectsSurface(role)
}
