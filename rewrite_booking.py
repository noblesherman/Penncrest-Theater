import re

with open('src/pages/Booking.tsx', 'r') as f:
    lines = f.readlines()

new_lines = []
in_step_1 = False
found_start = False
found_end = False

new_code = """              {seatSelectionEnabled ? (
                <div className="h-full min-h-0 flex flex-col xl:flex-row overflow-hidden">"""

end_code = """                </div>
              ) : (
                <div className="h-full flex items-center justify-center bg-stone-50 overflow-y-auto px-4 py-8">
                  <div className="w-full max-w-lg bg-white rounded-3xl shadow-xl border border-stone-100 p-8 flex flex-col text-center">
                    <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-red-50 text-red-700 mb-6">
                      <Ticket className="h-8 w-8" />
                    </div>
                    
                    <h2 className="text-3xl font-black text-stone-900 mb-2">General Admission</h2>
                    <p className="text-stone-500 mb-10">Select the number of tickets you'd like to reserve. Seating is on a first-come, first-served basis at the event.</p>
                    
                    <div className="bg-stone-50 rounded-2xl p-6 border border-stone-200 mb-8 flex flex-col items-center">
                      <div className="text-sm font-bold uppercase tracking-wider text-stone-500 mb-4">Tickets Needed</div>
                      
                      <div className="flex items-center justify-center gap-6">
                        <button
                          type="button"
                          onClick={() => setAutoSeatCount((count) => Math.max(0, count - 1))}
                          className="h-16 w-16 rounded-full border-2 border-stone-200 flex items-center justify-center text-3xl font-light text-stone-500 hover:border-red-600 hover:text-red-700 hover:bg-red-50 transition-all active:scale-95"
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
                          className="h-16 w-16 rounded-full border-2 border-stone-200 flex items-center justify-center text-3xl font-light text-stone-500 hover:border-red-600 hover:text-red-700 hover:bg-red-50 disabled:opacity-30 disabled:hover:border-stone-200 disabled:hover:bg-transparent disabled:hover:text-stone-500 transition-all active:scale-95"
                        >
                          +
                        </button>
                      </div>
                      <div className="mt-4 text-xs font-semibold text-stone-400">
                        {autoAssignableSeatIds.length - autoSeatCount} tickets remaining
                      </div>
                    </div>

                    <button
                      onClick={goToStepTwo}
                      disabled={!canContinueToTypes}
                      className="w-full bg-red-700 text-white rounded-2xl py-4 text-lg font-bold disabled:opacity-40 disabled:cursor-not-allowed hover:bg-red-800 transition-colors shadow-lg shadow-red-700/20 active:scale-[0.98] flex items-center justify-center gap-2"
                    >
                      Continue Checkout <ArrowRight className="w-5 h-5" />
                    </button>
                  </div>
                </div>
              )}"""

for i in range(len(lines)):
    line = lines[i]
    if line.strip() == '<motion.section' and lines[i+1].strip() == 'key="seat-map-step"':
        in_step_1 = True
    
    if in_step_1 and not found_start and line.strip() == '<div className="h-full min-h-0 flex flex-col xl:flex-row overflow-hidden">':
        new_lines.append(new_code + '\n')
        found_start = True
        continue
        
    if in_step_1 and found_start and not found_end and line.strip() == '</motion.section>':
        # the previous line is "</div>" and the one before also. So we find the </div> that closes the h-full flex row map.
        # it was at lines[i-1], lines[i-2], lines[i-3] approx.
        # we will walk backwards from `</motion.section>` to find the right `</div>` block to replace.
        # actually, I will pop the last 2 lines that were appended (the two `</div>`) and insert `end_code`.
        back_pop = 0
        while new_lines[-1].strip() == '</div>':
            new_lines.pop()
            back_pop += 1
            if back_pop == 2:
                break
        new_lines.append(end_code + '\n')
        new_lines.append(line)
        in_step_1 = False
        found_end = True
        continue
        
    new_lines.append(line)

with open('src/pages/Booking.tsx', 'w') as f:
    f.writelines(new_lines)
print('Done writing')

