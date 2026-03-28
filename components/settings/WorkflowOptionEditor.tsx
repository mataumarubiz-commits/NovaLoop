"use client"

import type { CSSProperties } from "react"
import type { ContentWorkflowOption } from "@/lib/contentWorkflow"

type WorkflowOptionEditorProps = {
  title: string
  description: string
  options: ContentWorkflowOption[]
  onChange: (next: ContentWorkflowOption[]) => void
}

const sectionStyle: CSSProperties = {
  border: "1px solid var(--border)",
  borderRadius: 14,
  padding: 16,
  background: "var(--surface-2)",
}

const rowStyle: CSSProperties = {
  display: "grid",
  gap: 10,
  gridTemplateColumns: "minmax(0, 1fr) auto",
  alignItems: "center",
  padding: "12px 0",
  borderBottom: "1px solid rgba(148, 163, 184, 0.18)",
}

export default function WorkflowOptionEditor({
  title,
  description,
  options,
  onChange,
}: WorkflowOptionEditorProps) {
  const updateOption = (index: number, patch: Partial<ContentWorkflowOption>) => {
    onChange(options.map((option, optionIndex) => (optionIndex === index ? { ...option, ...patch } : option)))
  }

  const moveOption = (index: number, direction: -1 | 1) => {
    const nextIndex = index + direction
    if (nextIndex < 0 || nextIndex >= options.length) return
    const next = [...options]
    const [current] = next.splice(index, 1)
    next.splice(nextIndex, 0, current)
    onChange(next)
  }

  return (
    <section style={sectionStyle}>
      <div style={{ display: "grid", gap: 4, marginBottom: 8 }}>
        <h3 style={{ margin: 0, fontSize: 16, color: "var(--text)" }}>{title}</h3>
        <p style={{ margin: 0, color: "var(--muted)", fontSize: 13, lineHeight: 1.6 }}>{description}</p>
      </div>

      <div style={{ display: "grid", gap: 0 }}>
        {options.map((option, index) => (
          <div key={option.value} style={{ ...rowStyle, borderBottom: index === options.length - 1 ? "none" : rowStyle.borderBottom }}>
            <div style={{ display: "grid", gap: 8 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <span
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    padding: "4px 8px",
                    borderRadius: 999,
                    background: "rgba(15,23,42,0.06)",
                    color: "var(--muted)",
                    fontSize: 12,
                    fontWeight: 700,
                  }}
                >
                  {option.value}
                </span>
                <label style={{ display: "inline-flex", alignItems: "center", gap: 6, color: "var(--text)", fontSize: 13 }}>
                  <input
                    type="checkbox"
                    checked={option.enabled !== false}
                    onChange={(event) => updateOption(index, { enabled: event.target.checked })}
                  />
                  一覧に表示
                </label>
              </div>
              <input
                value={option.label}
                onChange={(event) => updateOption(index, { label: event.target.value })}
                placeholder="表示名"
                style={{
                  padding: "10px 12px",
                  borderRadius: 10,
                  border: "1px solid var(--border)",
                  background: "var(--input-bg)",
                  color: "var(--input-text)",
                }}
              />
            </div>

            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <button
                type="button"
                onClick={() => moveOption(index, -1)}
                disabled={index === 0}
                style={buttonStyle(index === 0)}
              >
                ↑
              </button>
              <button
                type="button"
                onClick={() => moveOption(index, 1)}
                disabled={index === options.length - 1}
                style={buttonStyle(index === options.length - 1)}
              >
                ↓
              </button>
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}

function buttonStyle(disabled: boolean): CSSProperties {
  return {
    width: 36,
    height: 36,
    borderRadius: 10,
    border: "1px solid var(--border)",
    background: disabled ? "var(--surface)" : "var(--input-bg)",
    color: disabled ? "var(--muted)" : "var(--text)",
    cursor: disabled ? "not-allowed" : "pointer",
    fontWeight: 700,
  }
}
