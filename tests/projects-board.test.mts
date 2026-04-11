import test from "node:test"
import assert from "node:assert/strict"

const projectWorkspaceAccessModuleUrl = new URL("../lib/projectWorkspaceAccess.ts", import.meta.url).href

const { canAccessProjectsSurface, shouldLoadProjectWorkspace } = await import(projectWorkspaceAccessModuleUrl)

test("canAccessProjectsSurface allows only owner and executive_assistant", () => {
  assert.equal(canAccessProjectsSurface("owner"), true)
  assert.equal(canAccessProjectsSurface("executive_assistant"), true)
  assert.equal(canAccessProjectsSurface("pm"), false)
  assert.equal(canAccessProjectsSurface("member"), false)
  assert.equal(canAccessProjectsSurface(null), false)
})

test("shouldLoadProjectWorkspace blocks admin-only surfaces for non-admin roles", () => {
  assert.equal(
    shouldLoadProjectWorkspace({
      activeOrgId: "org-1",
      needsOnboarding: false,
      requireAdminSurface: true,
      role: "member",
    }),
    false
  )
  assert.equal(
    shouldLoadProjectWorkspace({
      activeOrgId: "org-1",
      needsOnboarding: false,
      requireAdminSurface: true,
      role: "owner",
    }),
    true
  )
  assert.equal(
    shouldLoadProjectWorkspace({
      activeOrgId: null,
      needsOnboarding: false,
      requireAdminSurface: false,
      role: "owner",
    }),
    false
  )
})
