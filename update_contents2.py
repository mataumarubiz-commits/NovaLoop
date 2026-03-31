import sys

with open('app/contents/page.tsx', 'r', encoding='utf-8') as f:
    content = f.read()

target = """          <div style={{ maxHeight: "72vh", overflowX: "auto", overflowY: "auto" }}>
            <table style={tableStyle}>"""

replacement = """          {(() => {
            const projectIdsWithContents = new Set(rows.map(r => r.projectId).filter(Boolean))
            const emptyProjectsList = projects.filter(p => !projectIdsWithContents.has(p.id) && (!filterProjectId || p.id === filterProjectId))
            if (emptyProjectsList.length === 0) return null

            return (
              <div style={{ padding: "12px 16px", background: "rgba(240, 249, 255, 0.4)", border: "1px solid #bae6fd", borderRadius: 12, marginBottom: 16 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
                  <div style={{ fontWeight: 700, fontSize: 13, color: "#0369a1" }}>タスク未登録の案件があります</div>
                  <div style={{ fontSize: 12, color: "#0c4a6e" }}>これらの案件にはまだコンテンツが登録されていません。「追加」をクリックしてタスクを入力してください。</div>
                </div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", maxHeight: 90, overflowY: "auto" }}>
                  {emptyProjectsList.map(project => (
                    <div key={project.id} style={{ display: "inline-flex", alignItems: "center", gap: 6, background: "#e0f2fe", border: "1px solid #bae6fd", borderRadius: 8, padding: "4px 8px" }}>
                      <span style={{ fontSize: 13, fontWeight: 600, color: "#0369a1" }}>{project.name}</span>
                      <button
                        type="button"
                        onClick={() => {
                          setForm(p => ({ ...p, projectId: project.id, projectName: project.name }))
                          window.scrollTo({ top: 0, behavior: "smooth" })
                        }}
                        style={{ background: "transparent", border: "none", color: "#0284c7", fontSize: 11, fontWeight: 700, cursor: "pointer", padding: "2px 4px", borderRadius: 4 }}
                        onMouseEnter={e => (e.currentTarget.style.background = "rgba(2, 132, 199, 0.1)")}
                        onMouseLeave={e => (e.currentTarget.style.background = "transparent")}
                      >
                        + 追加
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )
          })()}

          <div style={{ maxHeight: "72vh", overflowX: "auto", overflowY: "auto" }}>
            <table style={tableStyle}>"""

if target in content:
    content = content.replace(target, replacement)
    with open('app/contents/page.tsx', 'w', encoding='utf-8') as f:
        f.write(content)
    print("Replaced successfully")
else:
    print("Target not found")
