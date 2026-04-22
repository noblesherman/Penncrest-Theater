/*
Handoff note for Mr. Smith:
- File: `src/main.tsx`
- What this is: Web bootstrap entrypoint.
- What it does: Mounts React into the DOM and initializes top-level providers.
- Connections: Bridges Vite runtime to `App.tsx` and global styling.
- Main content type: Startup wiring.
- Safe edits here: Provider docs and startup-level comments.
- Be careful with: Mount/provider order changes that can break app initialization.
- Useful context: If the app fails before routes render, start debugging here.
- Practical note: For simple copy/layout edits, this file is usually safe as long as you keep data contracts intact.
*/

import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
