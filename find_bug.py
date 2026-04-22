"""
Handoff note for Mr. Smith:
- File: `find_bug.py`
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

# simple parser ignoring JSX properties
stack = []
for m in re.finditer(r'<(div\b[^>]*\/?>|</div\b[^>]*>)', text):
    tag = m.group(0)
    if tag.endswith('/>'):
        pass # self-closing
    elif tag.startswith('</div'):
        if stack:
            # check the top
            stack.pop()
        else:
            print("EXTRA closing div at", m.start())
    elif tag.startswith('<div'):
        stack.append(m)

print("UNCLOSED divs:")
for m in stack:
    # get context around m
    context = text[m.start():m.start()+80].replace('\n', ' ')
    print("line", text.count('\n', 0, m.start()) + 1, ":", context)

