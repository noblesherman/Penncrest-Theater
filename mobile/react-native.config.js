/*
Handoff note for Mr. Smith:
- File: `mobile/react-native.config.js`
- What this is: Mobile bootstrap/config entry file.
- What it does: Initializes app startup behavior and top-level wiring.
- Connections: Bridge between native runtime and JS app tree.
- Main content type: Startup/config orchestration.
- Safe edits here: Comments and carefully additive startup notes.
- Be careful with: Import order and startup side effects.
- Useful context: If app startup fails before first render, begin debugging here.
- Practical note: For simple copy/layout edits, this file is usually safe as long as you keep data contracts intact.
*/

module.exports = {
  dependencies: {
    '@stripe/stripe-react-native': {
      platforms: {
        android: null
      }
    }
  }
};
