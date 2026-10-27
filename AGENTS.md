# SOLAR CHESS — project rules for AI agents

Client-side browser chess platform with a cosmic ("solar") visual style.
Stack: pure TypeScript (Vanilla TS, no frontend frameworks), Web Workers,
Web Audio API, Stockfish (WASM).

## Language
- Reply to the user in Russian only.
- Code comments in English only.

## Project map
- `.architecture-graph.txt` in the repo root is the architecture map. Read it first.
- `.repomix-context.xml` is a large full-repo dump. Do not read it whole; use it only for targeted lookups.
- `src/storage/` — persistence (game history, settings)
- `src/ui/` — screens, modals, review panel, `styles.css`
- `src/audio/` — sound engine and themes (Classic, Cosmic)
- `src/tests/` — test suites
- TODO(user): add engine / workers / variants folders here.

## Hard rules
1. Never delete or replace existing tests. If one fails, update only the selector or expectation and explain the reason in the report.
2. Test names must be at most 100 characters.
3. Run tests ONLY via `npm test` (safe-test.mjs guard; use `--shard=1/2` and `--shard=2/2` if needed). Never run vitest directly.
4. No emojis in the UI. Use clean SVG icons only.
5. Do not bring back hiding of the clock panel or `#clock-mount`: the clock panel and mode selector are always visible.
6. Make targeted edits. Do not rewrite whole files.
7. Do not break the base chess rules in standard mode.
8. Modal and UI animations must be GPU-only: `transform` (scale/translate) and `opacity`.
9. All sound synthesis goes strictly through Web Audio API. In Node/JSDOM sound must be a safe no-op.

## Definition of done
- `npm run lint`, `npm run build` and `npm test` all pass.
- Final report in Russian: list of changed files, short summary of each change, and any test that had to be updated with the reason.
- Show full command output only for failures; for passing runs, give the summary lines.