import test from "node:test"
import assert from "node:assert/strict"

const workspaceAccessModuleUrl = new URL("../lib/projectWorkspaceAccess.ts", import.meta.url).href

const { canAccessProjectsSurface, shouldLoadProjectWorkspace } = await import(workspaceAccessModuleUrl)

test("project workspace admin surface blocks non-admin users before loading", () => {
  assert.equal(canAccessProjectsSurface("owner"), true)
  assert.equal(canAccessProjectsSurface("executive_assistant"), true)
  assert.equal(canAccessProjectsSurface("member"), false)

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
})
