"""
Handoff note for Mr. Smith:
- File: `fix_render.py`
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
    text = f.read()

bad = """{/* IF registration tracking exists for this item, display the child's name! */}
                            {registrationPayload && registrationPayload.entries && registrationPayload.entries[index] && registrationPayload.entries[index].sections ? (
                               <div className="text-xs font-semibold text-stone-700 mt-0.5">
                                  {Object.values(registrationPayload.entries[index].sections).flatMap(s => s.fields || []).find(f => f.key.toLowerCase().includes('name'))?.value || ''}
                               </div>
                            ) : null}"""

good = """{getChildName(registrationForm, registrationPayload, index) ? (
                              <div className="text-xs font-semibold text-blue-700 mt-0.5">
                                • {getChildName(registrationForm, registrationPayload, index)}
                              </div>
                            ) : null}"""

if bad in text:
    text = text.replace(bad, good)
    with open('src/pages/Booking.tsx', 'w') as f:
        f.write(text)
    print("Replaced!")
else:
    print("Not found")
