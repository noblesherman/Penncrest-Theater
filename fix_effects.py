"""
Handoff note for Mr. Smith:
- File: `fix_effects.py`
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

text = text.replace('''  useEffect(() => {
    if (currentStep === 4) return;
    if (!pendingStripePayment) return;
    setPendingStripePayment(null);
  }, [currentStep, pendingStripePayment]);

  useEffect(() => {
    if (currentStep === 4) return;
    if (!checkoutQueue) return;
    setCheckoutQueue(null);
  }, [checkoutQueue, currentStep]);''', '''  useEffect(() => {
    if (currentStep === 5) return;
    if (!pendingStripePayment) return;
    setPendingStripePayment(null);
  }, [currentStep, pendingStripePayment]);

  useEffect(() => {
    if (currentStep === 5) return;
    if (!checkoutQueue) return;
    setCheckoutQueue(null);
  }, [checkoutQueue, currentStep]);''')

with open('src/pages/Booking.tsx', 'w') as f:
    f.write(text)
print("Done")
