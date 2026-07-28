# Web App Development Workspace

This workspace is used primarily to build, test, and publish web applications.

## Choose the target project first

- Treat each directory with its own `package.json` as a separate application.
- Determine the target application from the user's request and the files involved before running commands or editing code.
- Run install, development, build, lint, and test commands from that application's directory.
- Do not assume the workspace root is the target when the request names a subproject.

## Current applications

### Workspace root

- A small Vite application using `index.html`, `app.js`, and `style.css`.
- Commands: `npm run dev`, `npm run build`, and `npm run preview`.
- Generated output is written to `dist/`; do not edit it directly.

### `nihongo-dojo/`

- The main Japanese-learning web application.
- Stack: TypeScript, React 19, Next.js 16 API surface, Vite, and `vinext`.
- Primary application code lives under `nihongo-dojo/app/`.
- Commands:
  - `npm run dev` for local development.
  - `npm run lint` for static checks.
  - `npm run build` for a production build.
  - `npm test` for the build and rendered-HTML test.
- Learning progress is currently stored in browser `localStorage` under `nihongo-dojo-v1`. Preserve compatibility with existing saved progress or add an explicit migration when its shape changes.
- Cloudflare D1 and R2 are optional and currently disabled in `.openai/hosting.json`.
- The current build is configured for OpenAI Sites/Cloudflare tooling. Do not assume it is a standard Vercel-ready Next.js project; adapt and validate the build configuration if Vercel is requested.

### `codex-mission-control/`

- The production Codex Mission Control web application.
- Stack: standards-based JavaScript modules, CSS, Vite, and Node's built-in test runner.
- Core behavior lives behind `src/mission-orchestrator.js`; UI code must use that public seam rather than mutate stored events directly.
- Commands: `npm run dev`, `npm test`, and `npm run build`.
- Mission history is stored locally under `codex-mission-control-events-v1` and replayed into observable state.
- Browser writes use Web Locks to serialize the complete read, validation, and append operation across tabs.
- Keep this application separate from both the root Aura app and the throwaway prototypes under `.scratch/`.

## Implementation guidelines

- Follow the target application's existing framework, component, styling, and file-organization patterns.
- Keep user-facing interfaces responsive and usable on mobile and desktop.
- Preserve accessibility: semantic HTML, keyboard support, visible focus states, form labels, and sufficient color contrast.
- Prefer small, focused changes. Do not rewrite unrelated code or generated files.
- Never edit `node_modules/`, `dist/`, or `.next/` directly.
- Keep secrets out of source files. Use ignored environment files or the hosting provider's secret management.
- Preserve unrelated user changes in the working tree.

## Validation

- Run the narrowest relevant check while iterating, then run the target application's available lint, test, and production build commands before declaring implementation complete.
- For visual changes, inspect the affected page at representative desktop and mobile widths when browser tooling is available.
- Report any check that could not be run and the reason.
- Do not publish or deploy unless the user asks for it. When deployment is requested, use the hosting configuration belonging to the target application.
