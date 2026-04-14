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

