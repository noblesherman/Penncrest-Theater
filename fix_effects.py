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
