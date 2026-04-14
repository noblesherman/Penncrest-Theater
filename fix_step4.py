with open('src/pages/Booking.tsx', 'r') as f:
    content = f.read()

bad = """{currentStep === 4 && registrationRequired && (
              <motion.section
                key="questionnaire-step"
                initial={{ opacity: 0, x: 30 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -30 }}
                transition={{ duration: 0.25, ease: 'easeOut' }}
                className="h-full overflow-y-auto px-4 md:px-6 pb-10"
              >
                <div className="w-full pt-6 md:pt-8">
                  <div className="rounded-2xl border border-stone-100 bg-white p-5 md:p-6 h-fit">
                    <h2 className="text-2xl md:text-3xl font-bold text-stone-900" style={{ fontFamily: 'Georgia, serif' }}>
                      Event Questionnaire
                    </h2>
                    <p className="text-sm md:text-base text-stone-600 mt-2">
                      Complete this form to continue checkout.
                    </p>

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

                    <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:items-center justify-between border-t border-stone-100 pt-6">
                      <button
                        onClick={() => {
                          setStepError(null);
                          setCurrentStep(3);
                        }}
                        className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-stone-300 px-4 py-3 font-bold text-stone-700 hover:bg-stone-100 sm:w-auto"
                      >
                        <ArrowLeft className="w-4 h-4" /> Back
                      </button>
                      {/* EventRegistrationCheckoutForm has its own submit button */}
                    </div>
                  </div>
                </div>
              </motion.section>
            )}"""

good = """{currentStep === 4 && registrationRequired && (
              <motion.section
                key="questionnaire-step"
                initial={{ opacity: 0, x: 30 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -30 }}
                transition={{ duration: 0.25, ease: 'easeOut' }}
                className="h-full flex flex-col px-4 md:px-6 pb-6 pt-6"
              >
                <div className="flex-1 w-full min-h-0 flex flex-col rounded-2xl border border-stone-100 bg-white overflow-hidden shadow-sm">
                  <div className="shrink-0 p-5 md:p-6 border-b border-stone-100 bg-white">
                    <h2 className="text-2xl md:text-3xl font-bold text-stone-900" style={{ fontFamily: 'Georgia, serif' }}>
                      Event Questionnaire
                    </h2>
                    <p className="text-sm md:text-base text-stone-600 mt-2">
                      Complete this form to continue checkout.
                    </p>
                  </div>

                  <div className="flex-1 overflow-y-auto px-5 md:px-6 relative min-h-0 container relative" id="registration-form-scroll-container">
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
                    {/* EventRegistrationCheckoutForm has its own submit button which we might need to detach or we can leave it inside for now, but the outer is locked */}
                  </div>
                </div>
              </motion.section>
            )}"""

if bad in content:
    content = content.replace(bad, good)
    with open('src/pages/Booking.tsx', 'w') as f:
        f.write(content)
    print("Replaced!")
else:
    print("Not found")
