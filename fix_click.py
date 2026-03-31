import sys

with open('app/contents/page.tsx', 'r', encoding='utf-8') as f:
    content = f.read()

target = """                        onClick={() => {
                          setForm(p => ({ ...p, projectId: project.id, projectName: project.name }))
                          window.scrollTo({ top: 0, behavior: "smooth" })
                        }}"""

replacement = """                        onClick={() => {
                          openGuidedAdd()
                          setGuidedStep(3)
                          setGuidedForm(prev => ({
                            ...prev,
                            clientId: project.clientId,
                            projectId: project.id,
                            projectName: project.name,
                            showAdvanced: true
                          }))
                          window.scrollTo({ top: 0, behavior: "smooth" })
                        }}"""

if target in content:
    content = content.replace(target, replacement)
    with open('app/contents/page.tsx', 'w', encoding='utf-8') as f:
        f.write(content)
    print("Fixed onClick successfully")
else:
    print("Target not found")
