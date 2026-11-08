# b3

b3 is a personal fork of [T3 Code](https://github.com/pingdotgg/t3code). It adds two spaces next to Code:

- **Chat.** An everyday assistant on any provider and model, with persistent memory.
- **Learn.** A tutor with a knowledge map, in-thread quizzes and spaced review.

Code stays upstream T3 Code: no memory, no new tools, no new UI inside Code threads.

## How it fits on upstream

| Piece | Where |
|---|---|
| Wire contracts | `packages/contracts/src/universal.ts` |
| Pure Learn engine (FSRS, grading, DAG, transit layout) | `packages/universal-learn` |
| Pure memory logic (gates, fusion, profile, extraction text) | `packages/universal-memory` |
| Learn widget (MCP App document) | `packages/universal-widgets` |
| Server services, MCP tools, RPC handlers | `apps/server/src/universal/**` |
| Client atoms shared by web and mobile | `packages/client-runtime/src/state/universal.ts` |
| Web | `apps/web/src/universal/**`, plus `_chat.learn.tsx` and `_chat.settings.*` routes |
| Mobile | `apps/mobile/src/universal/**` |

- **Spaces** are managed projects with fixed ids per environment: `t3u-space-chat`, `t3u-space-learn`, and the hidden `t3u-space-memory`.
- **Fork data** lives in `<T3 home>/userdata/universal.sqlite`, next to upstream's `statev2.sqlite`. It is opened with `node:sqlite` plus the `sqlite-vector` extension.
- **Background work** (memory extraction, the daily review) runs as ordinary T3 scheduled tasks on the model you pick.

## Seams
Every upstream file b3 edits is listed in `.universal/seams.json`. Each edit carries a `universal-seam:<id>` comment.

`node scripts/universal-seams.ts` fails when an upstream file changes outside that list. Run it after every upstream merge.

## Syncing upstream
- `main` mirrors upstream; `universal/main` is the product branch.
- Merge `origin/main` into `universal/main`. Never rebase.
- After the merge:
  1. Regenerate `apps/web/src/routeTree.gen.ts`, using the Vite dev server or the TanStack generator.
  2. Take upstream's lockfile, then run `pnpm install`.
  3. Run `node scripts/universal-seams.ts` and `vp run check:changed`.
- Enable `git config rerere.enabled true` so repeated seam conflicts resolve themselves.
