import test from "node:test"
import assert from "node:assert/strict"

const projectsBoardModuleUrl = new URL("../lib/projectsBoard.ts", import.meta.url).href
const { resolveProjectsWorkspaceQueryState } = await import(projectsBoardModuleUrl)

test("query-driven projects focus states map to the expected workspace view", () => {
  assert.deepEqual(resolveProjectsWorkspaceQueryState("client_overdue"), {
    quickFilter: "overdue",
    advancedOpen: false,
  })
  assert.deepEqual(resolveProjectsWorkspaceQueryState("editor_overdue"), {
    quickFilter: "vendor",
    advancedOpen: false,
  })
  assert.deepEqual(resolveProjectsWorkspaceQueryState("due_today"), {
    quickFilter: "today",
    advancedOpen: false,
  })
  assert.deepEqual(resolveProjectsWorkspaceQueryState("due_tomorrow"), {
    quickFilter: "tomorrow",
    advancedOpen: false,
  })
  assert.deepEqual(resolveProjectsWorkspaceQueryState("unlinked"), {
    quickFilter: "all",
    advancedOpen: true,
  })
})

test("plain projects navigation clears borrowed query state", () => {
  assert.deepEqual(resolveProjectsWorkspaceQueryState(null), {
    quickFilter: "all",
    advancedOpen: false,
  })
  assert.deepEqual(resolveProjectsWorkspaceQueryState("unknown"), {
    quickFilter: "all",
    advancedOpen: false,
  })
})
