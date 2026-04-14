import re

with open('src/pages/Booking.tsx', 'r') as f:
    text = f.read()

start_tag = "{currentStep === 4 && registrationRequired && ("
end_tag = "</motion.section>"

start_idx = text.find(start_tag)
if start_idx == -1:
    print("Start not found")
    exit()

end_idx = text.find(end_tag, start_idx) + len(end_tag)

original_block = text[start_idx:end_idx]

# I need to craft the new block using the existing form params dynamically
new_block = """{currentStep === 4 && registrationRequired && (
              <motion.section
                key="questionnaire-step"
                initial={{ opacity: 0, x: 30 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -30 }}
                transition={{ duration: 0.25, ease: 'easeOut' }}
                className="h-full flex flex-col px-4 md:px-6 pb-6 pt-6"
              >
                <div className="flex-1 w-full min-h-0 flex flex-col rounded-2xl border border-stone-100 bg-white overflow-hidden shadow-sm max-w-6xl mx-auto">
                  <div className="shrink-0 p-5 md:p-6 border-b border-stone-100 bg-white">
                    <h2 className="text-2xl md:text-3xl font-bold text-stone-900" style={{ fontFamily: 'Georgia, serif' }}>
                      Event Questionnaire
                    </h2>
                    <p className="text-sm md:text-base text-stone-600 mt-2">
                      Complete this form to continue checkout.
                    </p>
                  </div>

                  <div className="flex-1 overflow-y-auto px-5 md:px-8 pb-8 relative min-h-0" id="registration-form-scroll-container">
                    {registrationForm ? (
                      <EventRegistrationCheckoutForm
                        form={registrationForm}
                        ticketQuantity={selectedSeatIds.length}
                        storageKey={`event-registration:${performanceId || 'event'}:${registrationForm.versionId}`}
                        checkoutCustomerName={customerName}
                        disabled={processing}
                        onValidityChange={({ valid, payload }) => {
                          setRegistrationValid(valid);
                          setRegistrationPayload(payload);
                        }}
                        onSubmit={() => setCurrentStep(5)}
                      />
                    ) : null}
                  </div>

                  <div className="shrink-0 p-5 md:p-6 border-t border-stone-100 bg-stone-50 flex flex-col gap-2 sm:flex-row sm:items-center justify-between">
                    <button
                      onClick={() => {
                        setStepError(null);
                        setCurrentStep(3);
                      }}
                      className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-stone-300 px-4 py-3 font-bold text-stone-700 hover:bg-white bg-transparent sm:w-auto transition-colors"
                    >
                      <ArrowLeft className="w-4 h-4" /> Back
                    </button>
                  </div>
                </div>
              </motion.section>
            )}"""

new_text = text[:start_idx] + new_block + text[end_idx:]

with open('src/pages/Booking.tsx', 'w') as f:
    f.write(new_text)
print("Replaced!")
