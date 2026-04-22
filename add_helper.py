"""
Handoff note for Mr. Smith:
- File: `add_helper.py`
- What this is: One-off local maintenance script.
- What it does: Performs targeted repository text/code rewrites for quick maintenance tasks.
- Connections: Usually run manually against specific source files.
- Main content type: Scripted file-edit logic.
- Safe edits here: Guardrail notes and usage comments.
- Be careful with: Running blindly on the wrong file scope.
- Useful context: Some of these look like emergency fix scripts, so verify intent before reuse.
- Practical note: For simple copy/layout edits, this file is usually safe as long as you keep data contracts intact.
"""

with open('src/pages/Booking.tsx', 'r') as f:
    content = f.read()

helper = """
function getChildName(registrationForm: any, registrationPayload: any, index: number): string | null {
  if (!registrationForm || !registrationPayload || !registrationPayload.sections) return null;
  const sectionsData = registrationPayload.sections;
  for (const s of registrationForm.definition.sections) {
    if (s.hidden || s.type === 'single') continue;
    const nameF = s.fields.find((f: any) => f.label.toLowerCase().includes('first name') || f.label.toLowerCase().includes('camper name') || f.label.toLowerCase().includes('name'));
    if (nameF) {
      const records = (sectionsData[s.id] as any[]) || [];
      const r = records[index] || {};
      if (r[nameF.id] && String(r[nameF.id]).trim()) {
        return String(r[nameF.id]).trim().split(' ')[0];
      }
    }
  }
  return null;
}
"""

if 'function getChildName' not in content:
    # Insert near the top, after stringArrayEqual
    idx = content.find('function stringArrayEqual')
    content = content[:idx] + helper + '\n' + content[idx:]

    with open('src/pages/Booking.tsx', 'w') as f:
        f.write(content)
print("Done")
