"use client"

import { useEffect, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { ProjectSection, ProjectShell } from "@/components/project/ProjectShell"
import { supabase } from "@/lib/supabase"

function buildProjectsHref(params: {
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

export default function ContentsCompatPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [message, setMessage] = useState("案件画面へ移動しています。")

  useEffect(() => {
    let cancelled = false

    const run = async () => {
      const projectId = searchParams.get("projectId")
      const filter = searchParams.get("filter")
      const due = searchParams.get("due")
      const highlight = searchParams.get("highlight")
      const create = searchParams.get("create")
      const newClient = searchParams.get("newClient")

      if (projectId) {
        router.replace(buildProjectsHref({ projectId, highlight }))
        return
      }

      if (filter === "unlinked") {
        router.replace(buildProjectsHref({ focus: "unlinked", highlight }))
        return
      }
      if (filter === "client_overdue") {
        router.replace(buildProjectsHref({ focus: "client_overdue", highlight }))
        return
      }
      if (filter === "editor_overdue") {
        router.replace(buildProjectsHref({ focus: "editor_overdue", highlight }))
        return
      }
      if (due === "today") {
        router.replace(buildProjectsHref({ focus: "due_today", highlight }))
        return
      }
      if (due === "tomorrow") {
        router.replace(buildProjectsHref({ focus: "due_tomorrow", highlight }))
        return
      }
      if (newClient === "1" || create === "1") {
        router.replace(buildProjectsHref({ create, newClient }))
        return
      }

      if (highlight) {
        setMessage("対象明細の案件を確認しています。")
        const { data, error } = await supabase
          .from("contents")
          .select("id, project_id")
          .eq("id", highlight)
          .maybeSingle()

        if (cancelled) return

        if (!error && data?.project_id) {
          router.replace(buildProjectsHref({ projectId: data.project_id, highlight }))
          return
        }

        router.replace(buildProjectsHref({ focus: "unlinked", highlight }))
        return
      }

      router.replace("/projects")
    }

    void run()

    return () => {
      cancelled = true
    }
  }, [router, searchParams])

  return (
    <ProjectShell title="案件互換導線" description="旧コンテンツ画面から案件画面へ移動しています。">
      <ProjectSection title="移動中">{message}</ProjectSection>
    </ProjectShell>
  )
}
