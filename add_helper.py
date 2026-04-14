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
