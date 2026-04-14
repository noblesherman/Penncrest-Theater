import re

with open('src/pages/Booking.tsx', 'r') as f:
    text = f.read()

start_str = """              className="h-full"
            >
              <div className="h-full min-h-0 flex flex-col xl:flex-row overflow-hidden">"""

replacement_start = """              className="h-full"
            >
              {seatSelectionEnabled ? (
                <div className="h-full min-h-0 flex flex-col xl:flex-row overflow-hidden">"""

end_pattern = """                  </div>
                </div>
              </div>
            </motion.section>"""

# Find exact sections
pos = text.find(start_str)
pos_end = text.find(end_pattern, pos)

replacement_end = """                  </div>
                </div>
              </div>
              ) : (
                <div className="h-full flex items-center justify-center bg-stone-50 overflow-y-auto px-4 py-8 relative">
                  <div className="w-full max-w-lg bg-white rounded-3xl shadow-xl border border-stone-100 p-8 flex flex-col text-center">
                    <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-red-50 text-red-700 shadow-sm border border-red-100 mb-6">
                      <svg className="h-7 w-7" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M2 9a3 3 0 0 1 0 6v2a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-2a3 3 0 0 1 0-6V7a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2Z"></path><path d="M13 5v2"></path><path d="M13 17v2"></path><path d="M13 11v2"></path></svg>
                    </div>
                    
                    <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-red-700 mb-2">General Admission</p>
                    <h2 className="text-3xl font-black text-stone-900 mb-3" style={{ fontFamily: 'Georgia, serif' }}>Choose Your Tickets</h2>
                    <p className="text-stone-500 mb-8 text-sm">Select the number of tickets you'd like to reserve. Seating is assigned upon entry.</p>
                    
                    <div className="bg-stone-50 rounded-2xl p-6 border border-stone-200 mb-8 flex flex-col items-center">
                      <div className="text-xs font-bold uppercase tracking-[0.14em] text-stone-500 mb-4">Tickets Needed</div>
                      
                      <div className="flex items-center justify-center gap-6">
                        <button
                          type="button"
                          onClick={() => setAutoSeatCount((count) => Math.max(0, count - 1))}
                          className="h-14 w-14 rounded-full border-2 border-stone-200 bg-white flex items-center justify-center text-3xl font-light text-stone-500 hover:border-stone-300 hover:bg-stone-50 transition-all active:scale-95"
                        >
                          -
                        </button>
                        
                        <div className="w-24 text-center">
                          <input
                            type="number"
                            min="0"
                            max={autoAssignableSeatIds.length}
                            value={autoSeatCount || ''}
                            onChange={(event) => {
                              const next = Math.max(0, Number(event.target.value) || 0);
                              setAutoSeatCount(Math.min(next, autoAssignableSeatIds.length));
                            }}
                            onBlur={(event) => {
                              if (!event.target.value) setAutoSeatCount(0);
                            }}
                            className="w-full text-5xl font-black text-stone-900 text-center bg-transparent outline-none focus:ring-0 p-0"
                          />
                        </div>
                        
                        <button
                          type="button"
                          onClick={() => setAutoSeatCount((count) => Math.min(autoAssignableSeatIds.length, count + 1))}
                          disabled={autoSeatCount >= autoAssignableSeatIds.length}
                          className="h-14 w-14 rounded-full border-2 border-stone-200 bg-white flex items-center justify-center text-3xl font-light text-stone-500 hover:border-stone-300 hover:bg-stone-50 disabled:opacity-30 disabled:hover:border-stone-200 disabled:hover:bg-white disabled:hover:text-stone-500 transition-all active:scale-95"
                        >
                          +
                        </button>
                      </div>
                      <div className="mt-5 text-xs font-semibold text-stone-400 bg-white px-3 py-1.5 rounded-full border border-stone-200 shadow-sm">
                        {autoAssignableSeatIds.length - autoSeatCount} tickets remaining
                      </div>
                    </div>

                    <button
                      onClick={goToStepTwo}
                      disabled={!canContinueToTypes}
                      className="w-full bg-red-700 text-white rounded-xl py-4 text-base font-bold disabled:opacity-50 disabled:cursor-not-allowed hover:bg-red-800 transition-colors active:scale-[0.98] flex items-center justify-center gap-2"
                    >
                      Continue Checkout <ArrowRight className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              )}
            </motion.section>"""

new_text = text[:pos] + replacement_start + text[pos+len(start_str):]
pos_end = new_text.find(end_pattern, pos)
new_text = new_text[:pos_end] + replacement_end + new_text[pos_end+len(end_pattern):]

with open('src/pages/Booking.tsx', 'w') as f:
    f.write(new_text)

