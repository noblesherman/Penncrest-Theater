"""
Handoff note for Mr. Smith:
- File: `fix_syntax.py`
- What this is: One-off local maintenance script.
- What it does: Performs targeted repository text/code rewrites for quick maintenance tasks.
- Connections: Usually run manually against specific source files.
- Main content type: Scripted file-edit logic.
- Safe edits here: Guardrail notes and usage comments.
- Be careful with: Running blindly on the wrong file scope.
- Useful context: Some of these look like emergency fix scripts, so verify intent before reuse.
- Practical note: For simple copy/layout edits, this file is usually safe as long as you keep data contracts intact.
"""

import re

with open('src/pages/Booking.tsx', 'r') as f:
    text = f.read()

bad = """                </motion.section>
              )}
            )}

            {currentStep === 5 && ("""

good = """                </motion.section>
              )}

            {currentStep === 5 && ("""

text = text.replace(bad, good)

with open('src/pages/Booking.tsx', 'w') as f:
    f.write(text)

