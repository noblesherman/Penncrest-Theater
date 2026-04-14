import re

with open('src/pages/Booking.tsx', 'r') as f:
    content = f.read()

# Find the start of {currentStep === 4 && (
start_idx = content.find('{currentStep === 4 && (')
if start_idx == -1:
    print("Could not find currentStep === 4")
    exit(1)

# Find the end of it safely by looking for the AnimatePresence closure
end_idx = content.find('</AnimatePresence>', start_idx)
if end_idx == -1:
    print("Could not find AnimatePresence")
    exit(1)

# The content to inject
new_content = """{currentStep === 4 && registrationRequired && (
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
          )}

          {currentStep === 5 && (
             <motion.section
              key="checkout-step"
              initial={{ opacity: 0, x: 30 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -30 }}
              transition={{ duration: 0.25, ease: 'easeOut' }}
              className="h-full overflow-y-auto px-4 md:px-6 pb-10"
            >
              <div className="max-w-6xl mx-auto pt-6 md:pt-8 grid grid-cols-1 lg:grid-cols-[1.1fr_0.9fr] gap-6">
                <div className="rounded-2xl border border-stone-100 bg-white p-5 md:p-6 h-fit">
                  {checkoutQueue ? (
                    <>
                      <div className="inline-flex items-center gap-2 rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-semibold uppercase tracking-[0.14em] text-amber-800">
                        <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-amber-500" />
                        Checkout Queue
                      </div>
                      <h2 className="mt-4 text-2xl md:text-3xl font-bold text-stone-900" style={{ fontFamily: 'Georgia, serif' }}>
                        You're in line
                      </h2>
                      <p className="text-sm md:text-base text-stone-600 mt-2">
                        Keep this page open while we prepare your payment session.
                      </p>

                      <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
                        <div className="rounded-xl border border-stone-200 bg-stone-50 p-4">
                          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-stone-500">Position</p>
                          <p className="mt-1 text-3xl font-black text-stone-900">{checkoutQueue.position}</p>
                        </div>
                        <div className="rounded-xl border border-stone-200 bg-stone-50 p-4">
                          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-stone-500">Est. Wait</p>
                          <p className="mt-1 text-2xl font-black text-stone-900">{formatWaitEstimate(checkoutQueue.estimatedWaitSeconds)}</p>
                        </div>
                        <div className="rounded-xl border border-stone-200 bg-stone-50 p-4">
                          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-stone-500">Refresh</p>
                          <p className="mt-1 text-2xl font-black text-stone-900">{Math.ceil(checkoutQueue.refreshAfterMs / 1000)}s</p>
                        </div>
                      </div>

                      <p className="mt-5 text-sm text-stone-600">
                        If your hold expires or checkout cannot be prepared, you’ll be returned to seat selection automatically.
                      </p>
                    </>
                  ) : (
                    <>
                      <h2 className="text-2xl md:text-3xl font-bold text-stone-900" style={{ fontFamily: 'Georgia, serif' }}>
                        Checkout
                      </h2>
                      <p className="text-sm md:text-base text-stone-600 mt-2">
                        Everything looks good. Continue to payment to finish checkout.
                      </p>

                      <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:items-center">
                        <button
                          onClick={() => {
                            setStepError(null);
                            resetPendingPayment();
                            setCheckoutQueue(null);
                            setCurrentStep(registrationRequired ? 4 : 3);
                          }}
                          className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-stone-300 px-4 py-3 font-bold text-stone-700 hover:bg-stone-100 sm:w-auto"
                        >
                          <ArrowLeft className="w-4 h-4" /> Back
                        </button>
                        {!pendingStripePayment && (
                          <button
                            onClick={handleCheckout}
                            disabled={processing || !canSubmitCheckout}
                            className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-red-700 px-5 py-3 font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50 hover:bg-red-800 transition-colors sm:w-auto"
                          >
                            <CreditCard className="w-4 h-4" />
                            {processing ? 'Processing...' : 'Checkout'}
                          </button>
                        )}
                      </div>

                      {pendingStripePayment && stripePromise && stripeElementsOptions && (
                        <div className="mt-5 rounded-2xl border border-red-100 bg-red-50 p-4">
                          <p className="text-sm font-semibold text-red-900">
                            Payment form ready. Complete payment below to finish checkout.
                          </p>
                          <Elements stripe={stripePromise} options={stripeElementsOptions}>
                            <InlineStripePaymentForm
                              disabled={processing}
                              onError={(message) => setStepError(message || null)}
                              onSuccess={finalizeEmbeddedPayment}
                            />
                          </Elements>
                        </div>
                      )}
                      {pendingStripePayment && (!stripePromise || !stripeElementsOptions) && (
                        <div className="mt-5 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                          Unable to initialize Stripe payment form. Please check Stripe configuration and try again.
                        </div>
                      )}
                    </>
                  )}
                </div>

                <div className="rounded-2xl border border-stone-100 bg-white p-5 md:p-6 h-fit">
                  <div className="flex items-center justify-between mb-4">
                    <div className="inline-flex items-center gap-2 text-stone-900 font-bold" style={{ fontFamily: 'Georgia, serif' }}>
                      <Ticket className="w-4 h-4" /> Order Summary
                    </div>
                    <div className="text-sm text-stone-500 font-semibold">
                      {selectedSeats.length} {seatSelectionEnabled ? 'seats' : 'tickets'}
                    </div>
                  </div>

                  <div className="space-y-3 max-h-[380px] overflow-y-auto pr-1">
                    {selectedSeatsWithPricing.map((item, index) => (
                      <div key={item.seat.id} className="rounded-xl border border-stone-200 bg-stone-50 p-3">
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <div className="font-bold text-stone-900">
                              {seatSelectionEnabled
                                ? `${item.seat.sectionName} Row ${item.seat.row} Seat ${item.seat.number}`
                                : `General Admission Ticket ${index + 1}`}
                            </div>
                            <div className="text-xs text-stone-500">{item.optionLabel}</div>
                            
                            {/* IF registration tracking exists for this item, display the child's name! */}
                            {registrationPayload && registrationPayload.entries && registrationPayload.entries[index] && registrationPayload.entries[index].sections ? (
                               <div className="text-xs font-semibold text-stone-700 mt-0.5">
                                  {Object.values(registrationPayload.entries[index].sections).flatMap(s => s.fields || []).find(f => f.key.toLowerCase().includes('name'))?.value || ''}
                               </div>
                            ) : null}
                          </div>
                          <div className="font-bold text-stone-900">${(item.unitPrice / 100).toFixed(2)}</div>
                        </div>
                      </div>
                    ))}
                  </div>

                  <div className="mt-5 border-t border-stone-200 pt-4 flex items-end justify-between">
                    <div className="text-sm text-stone-500">Total</div>
                    <div className="text-3xl font-bold text-stone-900">${(totalAmount / 100).toFixed(2)}</div>
                  </div>
                </div>
              </div>
            </motion.section>
          )}

          """

# Combine
final_content = content[:start_idx] + new_content + content[end_idx:]

with open('src/pages/Booking.tsx', 'w') as f:
    f.write(final_content)

print("Done")
