import test from "node:test"
import assert from "node:assert/strict"

const redirectModuleUrl = new URL("../lib/contentsCompatRedirect.ts", import.meta.url).href
const { buildProjectsHref, resolveLegacyContentsRedirect } = await import(redirectModuleUrl)

test("buildProjectsHref prefers a project detail contents tab when projectId exists", () => {
  assert.equal(
    buildProjectsHref({ projectId: "p1", highlight: "c1" }),
    "/projects/p1?tab=contents&highlight=c1"
  )
})

test("resolveLegacyContentsRedirect maps legacy filters and quick actions into projects routes", () => {
  assert.equal(
    resolveLegacyContentsRedirect({ filter: "client_overdue", highlight: "c1" }),
    "/projects?focus=client_overdue&highlight=c1"
  )
  assert.equal(resolveLegacyContentsRedirect({ due: "tomorrow" }), "/projects?focus=due_tomorrow")
  assert.equal(
    resolveLegacyContentsRedirect({ create: "1", newClient: "1" }),
    "/projects?create=1&newClient=1"
  )
})

test("resolveLegacyContentsRedirect falls back to resolved highlight project and then unlinked rescue", () => {
  assert.equal(
    resolveLegacyContentsRedirect({ highlight: "c1", highlightedProjectId: "p2" }),
    "/projects/p2?tab=contents&highlight=c1"
  )
  assert.equal(resolveLegacyContentsRedirect({ highlight: "c1" }), "/projects?focus=unlinked&highlight=c1")
  assert.equal(resolveLegacyContentsRedirect({}), "/projects")
})
