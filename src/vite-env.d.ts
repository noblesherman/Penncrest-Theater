/// <reference types="vite/client" />
/*
Handoff note for Mr. Smith:
- File: `src/vite-env.d.ts`
- What this is: Vite ambient typing stub.
- What it does: Brings Vite client typings into TypeScript compile context.
- Connections: Read by TS tooling during web builds.
- Main content type: Type config only.
- Safe edits here: Additive type declarations.
- Be careful with: Directive placement and declaration shape in this parser-sensitive file.
- Useful context: If global Vite types disappear, check this file first.
- Practical note: For simple copy/layout edits, this file is usually safe as long as you keep data contracts intact.
*/

