# Working on HeartQuarters

Instructions for any AI (or person) changing this code.

1. Read `ARCHITECTURE.md` first. Its rules win over your own preferences.
   Then read **Current Focus and Decisions** at the top of `BACKLOG.md`.
   Use it to pick up the active work across AI sessions, and update it when
   John changes the goal, makes a decision, or moves on to a new step.
2. The owner (John) is learning TypeScript, Node, React and Git while building
   this. With every change, explain in plain language what it does, which part
   it touches (`server/` = engine, `web/` = screens), and what to try by hand.
3. Small changes, one thing at a time, each committed on its own.
4. The app reads `D:\Google Drive\HeartMind`. Never delete, move or overwrite
   anything there without John's explicit OK. Test against copies.
5. One AI builds at a time; other AIs review.
6. Before finishing: `npm run typecheck`, `npm test` and `npm run build` must pass.
7. New logic comes with tests (`*.test.ts` next to the code, using fake folders
   from `server/testing.ts`, never the real Drive). Security checks
   (`safeResolve`, `server/security.ts`) must stay covered.
   A path built inside a checked folder (for example a file inside a version)
   is checked again right before it's used: `readable`/`readText` to read,
   `writable`, `writeFile`, `makeFolder`, `moveFile`, `copyNewFile` to change
   anything (`server/safe-files.ts`). They refuse shortcuts and junctions.
8. Every request that *does* something (POST etc.) goes through `postJson` in
   `web/src/api.ts`, which adds the `X-HeartQuarters` header the server requires.
   Files from Drive are served sandboxed; HTML from documents is cleaned with
   DOMPurify before display.

## John's interface preferences

- Use Title Case for interface labels, buttons and section headings, for example
  “Reference Photo” and “Generate an Expression With ChatGPT.” Ordinary
  explanatory sentences can use normal sentence case.
- Make screens compact: little wasted vertical space, small gaps between rows and sections.
- Use the big triangle (▶ / ▼) to open and close collapsible areas.
