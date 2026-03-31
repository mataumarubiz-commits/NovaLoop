import sys

with open('app/contents/page.tsx', 'r', encoding='utf-8') as f:
    content = f.read()

target = """                    <td style={tdTextStyle} title={row.projectName}>
                      {row.projectName}
                    </td>"""

replacement = """                    <td style={tdTextStyle} title={row.projectName}>
                      {row.projectId ? (
                        <Link
                          href={`/projects/${row.projectId}`}
                          className="hover-underline"
                          style={{ color: "var(--primary)", textDecoration: "none", fontWeight: 600 }}
                          onClick={(e) => e.stopPropagation()}
                        >
                          {row.projectName}
                        </Link>
                      ) : (
                        <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", lineHeight: 1 }}>
                          <span>{row.projectName}</span>
                          <span style={{ padding: "2px 6px", borderRadius: 6, background: "#fefce8", color: "#854d0e", border: "1px solid #fde68a", fontSize: 10, fontWeight: 700 }} title="案件に紐付いていません">未紐付け</span>
                        </div>
                      )}
                    </td>"""

if target in content:
    content = content.replace(target, replacement)
    with open('app/contents/page.tsx', 'w', encoding='utf-8') as f:
        f.write(content)
    print("Replaced successfully")
else:
    print("Target not found")
