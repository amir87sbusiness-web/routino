# Routino

Persian/English habit-tracker PWA + Capacitor mobile app with a Fastify backend (OTP auth, subscriptions, ZarinPal payments). User is a non-programmer — explain in plain Persian.

**Do NOT re-analyze the repo.** Full Persian docs live in `docs-fa/`. Read ONLY the guide matching the task:

| Task touches… | Read first |
|---|---|
| Anything / unsure — overall map, change recipes, test flags | `docs-fa/CODEBASE_GUIDE.md` (§10 = condensed English architecture) |
| Frontend (`src/`): pages, UI, local data, logic | `docs-fa/01-FRONTEND.md` |
| Backend (`backend/`): API, DB, payments, SMS, admin | `docs-fa/02-BACKEND.md` |
| Both sides / API contracts / env vars / deep links | `docs-fa/03-FRONT-BACK-CONNECTIONS.md` |
| Deploy / mobile build | `docs-fa/DEPLOY-SUPABASE-EDGE.md` (backend=edge fn; frontend=CF Pages) / `docs-fa/MOBILE_SETUP.md` |

Then open only the source files the guide points to. If a change makes a guide stale, update it in the same session.

Hard rules:
- `src/lib/phone.ts` must stay byte-identical to `backend/src/lib/phone.ts` (parity test enforces).
- High-risk: `src/lib/db/*` (local persistence) and `backend/src/services/payment-flow.ts` (money path).
- Generated — never hand-edit: `src/routeTree.gen.ts`, `www/`, `dist/`, `supabase/functions/api/shared/` (regenerate with `npm run sync:edge`; parity test enforces).
- Backend logic edits go in `backend/src/`, then `npm run sync:edge` + `npm run test:edge` (edge fn ships the copies).
- Run: `npm run dev` (web :5173) + `cd backend && npm run dev` (API :3000; OTP codes print to its terminal). Admin panel: `:3000/admin`.
