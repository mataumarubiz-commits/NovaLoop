"use client"

import { useEffect, useState } from "react"
import { DndContext, PointerSensor, useSensor, useSensors, closestCenter, DragEndEvent } from "@dnd-kit/core"
import { SortableContext, verticalListSortingStrategy, useSortable, arrayMove } from "@dnd-kit/sortable"
import { CSS } from "@dnd-kit/utilities"
import { supabase } from "@/lib/supabase"
import { useAuthOrg } from "@/hooks/useAuthOrg"

type OrgRole = {
  id: string
  key: string
  name: string
  is_system: boolean
  permissions: Record<string, boolean> | null
  sort_order: number
}

const PERMISSION_KEYS = [
  "billing_access",
  "contents_write",
  "pages_write",
  "members_manage",
  "payouts_manage",
] as const

type PermissionKey = (typeof PERMISSION_KEYS)[number]

function SortableRow({
  role,
  disabled,
  onToggle,
}: {
  role: OrgRole
  disabled: boolean
  onToggle: (id: string, key: PermissionKey, value: boolean) => void
}) {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id: role.id })
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
  }
  const perms = role.permissions ?? {}

  return (
    <div
      ref={setNodeRef}
      style={{
        ...style,
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "10px 12px",
        borderBottom: "1px solid var(--border)",
        background: "var(--surface)",
      }}
    >
      <button
        type="button"
        {...attributes}
        {...listeners}
        disabled={disabled}
        style={{
          width: 24,
          height: 24,
          borderRadius: 999,
          border: "1px solid var(--border)",
          background: "var(--surface-2)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          cursor: disabled ? "default" : "grab",
          fontSize: 14,
          color: "var(--muted)",
          flexShrink: 0,
        }}
        aria-label="並び替えハンドル"
      >
        ⋮⋮
      </button>
      <div style={{ minWidth: 140 }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: "var(--text)" }}>{role.name}</div>
        <div style={{ fontSize: 11, color: "var(--muted)" }}>
          {role.is_system ? `システムロール (${role.key})` : `カスタムロール (${role.key})`}
        </div>
      </div>
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: 6,
          fontSize: 11,
        }}
      >
        {PERMISSION_KEYS.map((k) => {
          const checked = !!perms[k]
          const label =
            k === "billing_access"
              ? "請求"
              : k === "contents_write"
              ? "制作編集"
              : k === "pages_write"
              ? "Pages編集"
              : k === "members_manage"
              ? "メンバー管理"
              : "外注支払"
          const systemLocked = role.is_system && (role.key === "owner" || role.key === "executive_assistant")
          const toggleDisabled = disabled || systemLocked
          return (
            <button
              key={k}
              type="button"
              onClick={() => !toggleDisabled && onToggle(role.id, k, !checked)}
              style={{
                padding: "4px 8px",
                borderRadius: 999,
                border: "1px solid var(--chip-border)",
                background: checked ? "var(--primary)" : "var(--chip-bg)",
                color: checked ? "var(--primary-contrast)" : "var(--chip-text)",
                opacity: toggleDisabled ? 0.5 : 1,
                cursor: toggleDisabled ? "not-allowed" : "pointer",
                whiteSpace: "nowrap",
              }}
            >
              {label}
            </button>
          )
        })}
      </div>
    </div>
  )
}

export default function RolesSettingsPage() {
  const { activeOrgId, role, loading: authLoading, needsOnboarding } = useAuthOrg({ redirectToOnboarding: true })
  const [roles, setRoles] = useState<OrgRole[]>([])
  const [loading, setLoading] = useState(true)
  const [savingOrder, setSavingOrder] = useState(false)
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState("")
  const [newKey, setNewKey] = useState("")
  const [error, setError] = useState<string | null>(null)

  const canEdit = role === "owner" || role === "executive_assistant"

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 8 },
    })
  )

  useEffect(() => {
    let active = true
    const load = async () => {
      if (!activeOrgId || authLoading || needsOnboarding) {
        setLoading(false)
        return
      }
      setError(null)
      const { data, error: fetchError } = await supabase
        .from("org_roles")
        .select("id, key, name, is_system, permissions, sort_order")
        .eq("org_id", activeOrgId)
        .order("sort_order", { ascending: true })

      if (!active) return
      if (fetchError) {
        setError("ロールの取得に失敗しました。")
        setRoles([])
      } else {
        setRoles(
          (data ?? []).map((r) => ({
            id: r.id as string,
            key: r.key as string,
            name: r.name as string,
            is_system: !!r.is_system,
            permissions: (r.permissions as Record<string, boolean> | null) ?? {},
            sort_order: (r.sort_order as number) ?? 0,
          }))
        )
      }
      setLoading(false)
    }
    load()
    return () => {
      active = false
    }
  }, [activeOrgId, authLoading, needsOnboarding])

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event
    if (!over || active.id === over.id) return
    setRoles((prev) => {
      const oldIndex = prev.findIndex((r) => r.id === active.id)
      const newIndex = prev.findIndex((r) => r.id === over.id)
      if (oldIndex === -1 || newIndex === -1) return prev
      const next = arrayMove(prev, oldIndex, newIndex)
      void saveOrder(next)
      return next
    })
  }

  const saveOrder = async (ordered: OrgRole[]) => {
    if (!canEdit || !activeOrgId) return
    setSavingOrder(true)
    try {
      const updates = ordered.map((r, idx) => ({ id: r.id, sort_order: idx }))
      const { error: upsertError } = await supabase.from("org_roles").upsert(updates, { onConflict: "id" })
      if (upsertError) {
        setError("並び順の保存に失敗しました。")
      }
    } finally {
      setSavingOrder(false)
    }
  }

  const handleTogglePermission = async (id: string, key: PermissionKey, value: boolean) => {
    if (!canEdit || !activeOrgId) return
    setRoles((prev) =>
      prev.map((r) =>
        r.id === id
          ? {
              ...r,
              permissions: {
                ...(r.permissions ?? {}),
                [key]: value,
              },
            }
          : r
      )
    )
    const target = roles.find((r) => r.id === id)
    const basePerms = target?.permissions ?? {}
    const nextPerms = { ...basePerms, [key]: value }
    const { error: updateError } = await supabase
      .from("org_roles")
      .update({ permissions: nextPerms })
      .eq("id", id)
    if (updateError) {
      setError("権限の更新に失敗しました。")
    }
  }

  const handleCreateRole = async () => {
    if (!canEdit || !activeOrgId) return
    const name = newName.trim()
    const key = newKey.trim() || name.toLowerCase().replace(/\s+/g, "_")
    if (!name || !key) {
      setError("ロール名とキーを入力してください。")
      return
    }
    setCreating(true)
    setError(null)
    try {
      const { data, error: insertError } = await supabase
        .from("org_roles")
        .insert({
          org_id: activeOrgId,
          key,
          name,
          is_system: false,
          permissions: {},
          sort_order: roles.length,
        })
        .select("id, key, name, is_system, permissions, sort_order")
        .maybeSingle()
      if (insertError || !data) {
        setError("ロールの作成に失敗しました。")
        return
      }
      setRoles((prev) => [
        ...prev,
        {
          id: data.id as string,
          key: data.key as string,
          name: data.name as string,
          is_system: !!data.is_system,
          permissions: (data.permissions as Record<string, boolean> | null) ?? {},
          sort_order: (data.sort_order as number) ?? prev.length,
        },
      ])
      setNewName("")
      setNewKey("")
    } finally {
      setCreating(false)
    }
  }

  if (authLoading) {
    return (
      <div style={{ padding: "32px 40px", minHeight: "100vh", background: "var(--bg-grad)" }}>
        <p style={{ color: "var(--muted)" }}>読み込み中…</p>
      </div>
    )
  }

  if (!activeOrgId) {
    return (
      <div style={{ padding: "32px 40px", minHeight: "100vh", background: "var(--bg-grad)" }}>
        <p style={{ color: "var(--muted)" }}>ワークスペースを選択してください。</p>
      </div>
    )
  }

  return (
    <div style={{ padding: "32px 40px", minHeight: "100vh", background: "var(--bg-grad)" }}>
      <h1 style={{ fontSize: 24, fontWeight: 700, color: "var(--text)", marginBottom: 4 }}>ロール設定</h1>
      <p style={{ fontSize: 13, color: "var(--muted)", marginBottom: 20 }}>
        このワークスペース内のロールと権限を管理します。カスタムロールの権限は当面 UI 上のみに反映され、RLS
        は従来どおり owner / executive_assistant ベースです。
      </p>
      {!canEdit && (
        <p style={{ fontSize: 12, color: "var(--muted)", marginBottom: 12 }}>
          ロールの編集は owner / executive_assistant のみ可能です（閲覧は全メンバー可）。
        </p>
      )}
      {error && (
        <div
          style={{
            marginBottom: 16,
            padding: 10,
            borderRadius: 8,
            background: "#fef2f2",
            color: "#b91c1c",
            fontSize: 13,
          }}
        >
          {error}
        </div>
      )}

      <div
        style={{
          marginBottom: 20,
          padding: 12,
          borderRadius: 14,
          border: "1px solid var(--border)",
          background: "var(--surface)",
        }}
      >
        <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text)", marginBottom: 8 }}>
          新規ロールを作成
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
          <input
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="ロール名（例: ディレクター）"
            disabled={!canEdit}
            style={{
              flex: "1 1 160px",
              padding: "8px 10px",
              borderRadius: 10,
              border: "1px solid var(--input-border)",
              background: "var(--input-bg)",
              color: "var(--input-text)",
              fontSize: 13,
            }}
          />
          <input
            type="text"
            value={newKey}
            onChange={(e) => setNewKey(e.target.value)}
            placeholder="キー（任意: 英数字・_）"
            disabled={!canEdit}
            style={{
              flex: "0 0 160px",
              padding: "8px 10px",
              borderRadius: 10,
              border: "1px solid var(--input-border)",
              background: "var(--input-bg)",
              color: "var(--input-text)",
              fontSize: 13,
            }}
          />
          <button
            type="button"
            onClick={handleCreateRole}
            disabled={!canEdit || creating}
            style={{
              padding: "8px 14px",
              borderRadius: 999,
              border: "1px solid var(--button-primary-bg)",
              background: "var(--button-primary-bg)",
              color: "var(--primary-contrast)",
              fontSize: 13,
              cursor: !canEdit || creating ? "not-allowed" : "pointer",
            }}
          >
            {creating ? "作成中…" : "ロールを追加"}
          </button>
        </div>
      </div>

      <div
        style={{
          borderRadius: 16,
          border: "1px solid var(--border)",
          background: "var(--surface)",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            padding: "8px 12px",
            fontSize: 12,
            color: "var(--muted)",
            borderBottom: "1px solid var(--border)",
          }}
        >
          <span style={{ width: 24 }} />
          <span style={{ minWidth: 140 }}>ロール</span>
          <span>権限</span>
          {savingOrder && (
            <span style={{ marginLeft: "auto", fontSize: 11 }}>並び順を保存中…</span>
          )}
        </div>
        {loading ? (
          <p style={{ padding: 12, fontSize: 13, color: "var(--muted)" }}>読み込み中…</p>
        ) : roles.length === 0 ? (
          <p style={{ padding: 12, fontSize: 13, color: "var(--muted)" }}>
            まだロールがありません。新規ロールを作成してください。
          </p>
        ) : (
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <SortableContext items={roles.map((r) => r.id)} strategy={verticalListSortingStrategy}>
              {roles.map((r) => (
                <SortableRow
                  key={r.id}
                  role={r}
                  disabled={!canEdit}
                  onToggle={handleTogglePermission}
                />
              ))}
            </SortableContext>
          </DndContext>
        )}
      </div>
    </div>
  )
}

