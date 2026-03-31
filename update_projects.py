import sys

with open('app/projects/page.tsx', 'r', encoding='utf-8') as f:
    content = f.read()

target1 = """export default function ProjectsPage() {
  const { loading, error, canEdit, canViewFinance, orgId, month, clients, members, projectSummaries, refresh } = useProjectWorkspace()"""
replacement1 = """export default function ProjectsPage() {
  const { loading, error, canEdit, canViewFinance, orgId, month, clients, members, projectSummaries, contents, refresh } = useProjectWorkspace()"""

target2 = """  const avgHealth = filtered.length > 0 ? Math.round(totals.health / filtered.length) : 100"""
replacement2 = """  const avgHealth = filtered.length > 0 ? Math.round(totals.health / filtered.length) : 100

  const orphanContents = useMemo(() => contents.filter((c) => c.project_id === null && !['completed', 'cancelled', 'archive'].includes(c.status)), [contents])
  const orphanCount = orphanContents.length"""

target3 = """      {/* ── Filter bar (compact) ── */}
      <section style={{
        border: "1px solid var(--border)",
        borderRadius: 16,"""
replacement3 = """      {orphanCount > 0 && (
        <ProjectSection title="" description="">
          <div style={{
            padding: 16,
            borderRadius: 12,
            background: "rgba(254, 240, 138, 0.2)",
            border: "1px solid var(--warning-border, #fde68a)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            flexWrap: "wrap",
            gap: 12
          }}>
            <div>
              <div style={{ fontWeight: 700, color: "var(--warning-text, #854d0e)", fontSize: 14, marginBottom: 4 }}>
                未紐付けのコンテンツがあります
              </div>
              <div style={{ fontSize: 13, color: "var(--muted)" }}>
                制作シートで作成され、どの案件にも紐付いていないコンテンツが <strong>{orphanCount}件</strong> 存在します。売上や遅延の集計に含まれないため、案件への紐付けを推奨します。
              </div>
            </div>
            <Link
              href="/contents?filter=unlinked"
              style={{
                ...buttonPrimaryStyle,
                background: "var(--warning-text, #854d0e)",
                borderColor: "var(--warning-text, #854d0e)",
                textDecoration: "none",
                fontSize: 13,
                padding: "6px 12px"
              }}
            >
              制作シートで確認する &rarr;
            </Link>
          </div>
        </ProjectSection>
      )}

      {/* ── Filter bar (compact) ── */}
      <section style={{
        border: "1px solid var(--border)",
        borderRadius: 16,"""

if target1 in content and target2 in content and target3 in content:
    content = content.replace(target1, replacement1)
    content = content.replace(target2, replacement2)
    content = content.replace(target3, replacement3)
    with open('app/projects/page.tsx', 'w', encoding='utf-8') as f:
        f.write(content)
    print("Replaced projects properly")
else:
    print("Targets not found")
