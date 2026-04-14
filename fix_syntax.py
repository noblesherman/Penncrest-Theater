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

