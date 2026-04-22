/*
Handoff note for Mr. Smith:
- File: `mobile/index.ts`
- What this is: Mobile bootstrap/config entry file.
- What it does: Initializes app startup behavior and top-level wiring.
- Connections: Bridge between native runtime and JS app tree.
- Main content type: Startup/config orchestration.
- Safe edits here: Comments and carefully additive startup notes.
- Be careful with: Import order and startup side effects.
- Useful context: If app startup fails before first render, begin debugging here.
- Practical note: For simple copy/layout edits, this file is usually safe as long as you keep data contracts intact.
*/

import 'react-native-gesture-handler';
import { registerRootComponent } from 'expo';

import App from './App';

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately
registerRootComponent(App);
