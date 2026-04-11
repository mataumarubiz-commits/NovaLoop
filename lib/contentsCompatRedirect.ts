type LegacyContentsRedirectParams = {
  projectId?: string | null
  filter?: string | null
  due?: string | null
  highlight?: string | null
  create?: string | null
  newClient?: string | null
  highlightedProjectId?: string | null
}

export function buildProjectsHref(params: {
  projectId?: string | null
  focus?: string | null
  highlight?: string | null
  create?: string | null
  newClient?: string | null
}) {
  const { projectId, focus, highlight, create, newClient } = params
  if (projectId) {
    const url = new URL(`/projects/${projectId}`, "http://localhost")
    url.searchParams.set("tab", "contents")
    if (highlight) url.searchParams.set("highlight", highlight)
    return `${url.pathname}${url.search}`
  }

  const url = new URL("/projects", "http://localhost")
  if (focus) url.searchParams.set("focus", focus)
  if (highlight) url.searchParams.set("highlight", highlight)
  if (create === "1") url.searchParams.set("create", "1")
  if (newClient === "1") url.searchParams.set("newClient", "1")
  return `${url.pathname}${url.search}`
}

export function resolveLegacyContentsRedirect(params: LegacyContentsRedirectParams) {
  const { projectId, filter, due, highlight, create, newClient, highlightedProjectId } = params

  if (projectId) return buildProjectsHref({ projectId, highlight })
  if (filter === "unlinked") return buildProjectsHref({ focus: "unlinked", highlight })
  if (filter === "client_overdue") return buildProjectsHref({ focus: "client_overdue", highlight })
  if (filter === "editor_overdue") return buildProjectsHref({ focus: "editor_overdue", highlight })
  if (due === "today") return buildProjectsHref({ focus: "due_today", highlight })
  if (due === "tomorrow") return buildProjectsHref({ focus: "due_tomorrow", highlight })
  if (newClient === "1" || create === "1") return buildProjectsHref({ create, newClient })
  if (highlightedProjectId) return buildProjectsHref({ projectId: highlightedProjectId, highlight })
  if (highlight) return buildProjectsHref({ focus: "unlinked", highlight })
  return "/projects"
}
