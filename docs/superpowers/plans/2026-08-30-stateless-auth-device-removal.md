# Stateless Auth and Device Removal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove all device/session storage, limits, revocation, and account blocking while issuing one stateless 30-day access token per login.

**Architecture:** Authentication becomes a signed-JWT boundary with no server-side session row. Auth routes issue `{ access, user, entitlement, isNew }`; middleware validates the JWT and exposes only its `sub`. Client logout is local-only, and old stored refresh/device fields are discarded during token-store migration.

**Tech Stack:** TypeScript, Fastify, Hono/Supabase Edge, jose JWT, Drizzle/Postgres, React, Vitest/PGlite.

## Global Constraints

- No payment, grant, entitlement, OTP-limit, or provider behavior changes.
- No live deployment, database migration application, or Supabase mutation.
- `backend/src` remains canonical; run `npm run sync:edge` after shared backend changes.
- Never hand-edit `supabase/functions/api/shared/`; only regenerate it.
- Existing account/vault isolation must remain intact.
- Access JWT lifetime is exactly 30 days; there is no refresh token or early revocation.

---

### Task 1: Stateless Token Service and Middleware

> **Atomic execution note:** Tasks 1 through 3 are one reviewable delivery. The new
> `AuthedUser = { id }` contract cannot typecheck while the old auth routes still
> read `deviceId`, and the stateless client cannot work while those routes still
> require device descriptors. Device/admin routes also consume the revoke services,
> so they must disappear in the same commit. One implementer must complete all three
> briefs, update `supabase/functions/api/deps.ts`, run `npm run sync:edge` to regenerate
> shared Edge sources, run every focused suite and both typechecks, then create one
> commit. Review the combined diff against all three task briefs before marking them
> complete. Generated files must never be edited by hand.

**Files:**
- Modify: `backend/src/services/tokens.ts`
- Modify: `backend/src/plugins/auth.ts`
- Modify: `backend/src/env.ts`
- Test: `backend/test/device-security.test.ts`
- Create: `backend/test/tokens.test.ts`

**Interfaces:**
- Produces: `issueAccessToken(env: Env, userId: string, now: Date): Promise<{ access: string }>`.
- Produces: `verifyAccessToken(env: Env, token: string): Promise<{ sub: string }>`.
- Produces: `AuthedUser = { id: string }` with no `deviceId` or phone lookup.

- [ ] **Step 1: Replace device-security assertions with failing stateless-auth assertions**

```ts
it("issues a 30-day token without a device claim", async () => {
  const { access } = await issueAccessToken(env, USER_ID, now);
  const payload = decodeJwt(access);
  expect(payload.sub).toBe(USER_ID);
  expect(payload).not.toHaveProperty("did");
  expect(Number(payload.exp) - Number(payload.iat)).toBe(30 * 86_400);
});

it("authenticates without reading users or devices", async () => {
  const access = await login();
  dbReads.mockClear();
  expect((await callProtected(access)).status).toBe(200);
  expect(dbReads).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run focused backend tests and confirm they fail against device-bound tokens**

Run: `cd backend; npx vitest run test/tokens.test.ts test/device-security.test.ts --maxWorkers=1`  
Expected: FAIL because tokens contain `did`, expire in one hour, and middleware reads device/user rows.

- [ ] **Step 3: Reduce `tokens.ts` to stateless issue/verify functions and set the default TTL to `2_592_000` seconds**

```ts
export interface AccessClaims { sub: string }
export async function issueAccessToken(env: Env, userId: string, now: Date) {
  return { access: await signAccessToken(env, { sub: userId }, now) };
}
```

Remove refresh hashing, random refresh generation, device descriptors, rotation, and revoke functions. Middleware must set `req.user = { id: claims.sub }` immediately after signature/expiry verification.

- [ ] **Step 4: Run focused tests and typecheck**

Run: `cd backend; npx vitest run test/tokens.test.ts test/device-security.test.ts --maxWorkers=1`  
Run: `cd backend; npm run typecheck`  
Expected: PASS.

- [ ] **Step 5: Commit the token boundary**

```powershell
git add -- backend/src/services/tokens.ts backend/src/plugins/auth.ts backend/src/env.ts backend/test/tokens.test.ts backend/test/device-security.test.ts
git commit -m "refactor: make authentication stateless"
```

### Task 2: Simplify Auth Routes and Client Token Storage

**Files:**
- Modify: `backend/src/routes/auth.ts`
- Modify: `supabase/functions/api/routes/auth.ts`
- Modify: `src/lib/api/auth.ts`
- Modify: `src/routes/auth.tsx`
- Delete: `src/lib/device-identity.ts`
- Delete: `src/lib/device-identity.test.ts`
- Test: `backend/test/auth.test.ts`
- Test: `backend/test/password-auth.test.ts`
- Test: `src/lib/api/auth-expiry.test.ts`
- Test: `src/lib/api/auth-owner.test.ts`
- Test: `src/routes/-auth.test.tsx`

**Interfaces:**
- Auth response: `{ access: string; user: { id: string; phone: string }; entitlement: ServerEntitlement; isNew: boolean }`.
- Client `Tokens`: `{ access; accessExpiresAt; lastServerConfirmedAt; lastEntitlementCheckedAt? }`.
- `logout(): Promise<void>` clears local token storage and performs no HTTP request.

- [ ] **Step 1: Update tests to reject refresh/device fields and device request metadata**

```ts
expect(login.body).toMatchObject({ access: expect.any(String), user: { id: expect.any(String) } });
expect(login.body).not.toHaveProperty("refresh");
expect(login.body).not.toHaveProperty("deviceId");
expect(requestBody).not.toHaveProperty("device");
```

Add a client migration test that seeds old `{ access, refresh, deviceId, ... }`, loads it, and verifies the rewritten storage contains only the supported fields.

- [ ] **Step 2: Run auth/client tests and confirm failure**

Run: `cd backend; npx vitest run test/auth.test.ts test/password-auth.test.ts --maxWorkers=1`  
Run: `npx vitest run src/lib/api/auth-expiry.test.ts src/lib/api/auth-owner.test.ts src/routes/-auth.test.tsx --maxWorkers=1`  
Expected: FAIL on old response shape, refresh behavior, and device descriptors.

- [ ] **Step 3: Replace `issueForDevice` with `issueAccessToken` in OTP/password routes**

Remove `/auth/token/refresh` and `/auth/logout`, blocked-user branches, password-reset/password-change revoke calls, device body schemas, and descriptor helpers from Node and Hono route files.

- [ ] **Step 4: Simplify client auth storage and requests**

```ts
export interface Tokens {
  access: string;
  accessExpiresAt: number;
  lastServerConfirmedAt: number;
  lastEntitlementCheckedAt?: number;
}

export async function logout(): Promise<void> {
  clearTokens();
}
```

`authedRequest` sends the valid stored token once. A 401 clears the token and returns the error; it never calls refresh. Login requests contain credentials only.

- [ ] **Step 5: Run focused tests and both typechecks**

Run: `cd backend; npx vitest run test/auth.test.ts test/password-auth.test.ts --maxWorkers=1`  
Run: `npx vitest run src/lib/api/auth-expiry.test.ts src/lib/api/auth-owner.test.ts src/routes/-auth.test.tsx --maxWorkers=1`  
Run: `cd backend; npm run typecheck`  
Run: `npx tsc --noEmit`  
Expected: PASS.

- [ ] **Step 6: Commit route/client auth simplification**

```powershell
git add -- backend/src/routes/auth.ts supabase/functions/api/routes/auth.ts src/lib/api/auth.ts src/routes/auth.tsx backend/test/auth.test.ts backend/test/password-auth.test.ts src/lib/api/auth-expiry.test.ts src/lib/api/auth-owner.test.ts src/routes/-auth.test.tsx
git add -u -- src/lib/device-identity.ts src/lib/device-identity.test.ts
git commit -m "refactor: remove device-bound login sessions"
```

### Task 3: Remove Device and Blocking Surfaces

**Files:**
- Delete: `backend/src/routes/devices.ts`
- Delete: `supabase/functions/api/routes/devices.ts`
- Delete: `src/lib/api/devices.ts`
- Delete: `supabase/tests/devices.test.ts`
- Modify: `backend/src/app.ts`
- Modify: `supabase/functions/api/app.ts`
- Modify: `backend/src/services/admin.ts`
- Modify: `backend/src/routes/admin.ts`
- Modify: `supabase/functions/api/routes/admin.ts`
- Modify: `backend/src/lib/admin-page.ts`
- Modify: `backend/src/routes/admin-panel.ts`
- Modify: `supabase/functions/api/routes/admin-panel.ts`
- Modify: `src/routes/settings.tsx`
- Modify: `src/state/app.tsx`
- Test: `supabase/tests/admin.test.ts`
- Test: `src/state/app-sync.test.tsx`

**Interfaces:**
- Admin user detail contains user, entitlement, payments, and grants; it contains no devices or blocked flag.
- No `/v1/devices*` or `/admin/users/:id/block` route is registered.

- [ ] **Step 1: Write failing absence tests**

```ts
expect((await h.call("GET", "/v1/devices", { headers: auth(access) })).status).toBe(404);
expect((await h.admin("POST", `/admin/users/${user.id}/block`, { blocked: true })).status).toBe(404);
expect(detail).not.toHaveProperty("devices");
expect(detail.user).not.toHaveProperty("blocked");
```

Update AppProvider tests to assert there is no `pingDevice` mock or timer-driven auth request.

- [ ] **Step 2: Run admin/app tests and confirm failure**

Run: `npx vitest run -c vitest.edge.config.ts supabase/tests/admin.test.ts supabase/tests/devices.test.ts --maxWorkers=1`  
Run: `npx vitest run src/state/app-sync.test.tsx --maxWorkers=1`  
Expected: FAIL while routes, UI, and ping behavior still exist.

- [ ] **Step 3: Delete device routes/client and remove all registrations/imports**

Remove the Settings device-management card, admin device table, block toggle/button, `adminSetBlocked`, and device data joins. Keep account credential, subscription, payment, and grant administration unchanged.

- [ ] **Step 4: Remove session polling from `AppProvider` without creating a boot-sync gap**

Delete `pingDevice`, `checkSessionRef`, the one-minute interval, and device-revocation error handling. Keep boot, online, and foreground meaningful by calling the existing `syncAccount(owner, true)` directly; keep `sessionGate` only for local token/offline-expiry UX. Do not add a replacement interval. The later sync plan will move these lifecycle calls into the dedicated scheduler, but this commit must remain runnable and type-correct by itself.

- [ ] **Step 5: Run focused tests and commit**

Run: `npx vitest run -c vitest.edge.config.ts supabase/tests/admin.test.ts --maxWorkers=1`  
Run: `npx vitest run src/state/app-sync.test.tsx --maxWorkers=1`  
Expected: PASS.

```powershell
git add -u -- backend/src/routes/devices.ts supabase/functions/api/routes/devices.ts src/lib/api/devices.ts supabase/tests/devices.test.ts
git add -- backend/src/app.ts supabase/functions/api/app.ts backend/src/services/admin.ts backend/src/routes/admin.ts supabase/functions/api/routes/admin.ts backend/src/lib/admin-page.ts backend/src/routes/admin-panel.ts supabase/functions/api/routes/admin-panel.ts src/routes/settings.tsx src/state/app.tsx supabase/tests/admin.test.ts src/state/app-sync.test.tsx
git commit -m "refactor: remove device and account blocking"
```

### Task 4: Remove Device Schema and Generate a Reviewed Migration

**Files:**
- Modify: `backend/src/db/schema.ts`
- Modify: `backend/src/db/ddl.ts`
- Modify: `scripts/gen-setup-sql.mjs`
- Modify: `supabase/setup.sql`
- Create: `supabase/migrations/20260830090000_remove_device_sessions.sql`
- Modify: `supabase/tests/quota.test.ts`
- Create: `supabase/tests/schema.test.ts`

**Interfaces:**
- Runtime schema exports no `devices` or `deviceSecurityEvents` table and no user blocking/device-limit columns.
- Migration is source-only and is never executed in this task.

- [ ] **Step 1: Add failing schema/quota assertions**

```ts
expect(tableNames).not.toContain("devices");
expect(tableNames).not.toContain("device_security_events");
expect(userColumns).not.toContain("blocked");
expect(permanentTables).not.toContain("devices");
```

- [ ] **Step 2: Run schema/quota tests and confirm failure**

Run: `npx vitest run -c vitest.edge.config.ts supabase/tests/schema.test.ts supabase/tests/quota.test.ts --maxWorkers=1`  
Expected: FAIL while obsolete schema remains.

- [ ] **Step 3: Remove runtime DDL and add a destructive migration artifact**

```sql
drop table if exists device_security_events;
drop table if exists devices;
alter table users
  drop constraint if exists users_max_active_devices_valid,
  drop column if exists blocked,
  drop column if exists max_active_devices,
  drop column if exists security_locked_at,
  drop column if exists security_lock_reason,
  drop column if exists device_switch_reset_at;
select cron.unschedule(jobid) from cron.job where jobname = 'routino-devices-purge';
```

Keep the migration unapplied. Regenerate `supabase/setup.sql` through its generator rather than editing generated fragments inconsistently.

- [ ] **Step 4: Run schema/quota tests and typechecks**

Run: `npx vitest run -c vitest.edge.config.ts supabase/tests/schema.test.ts supabase/tests/quota.test.ts --maxWorkers=1`  
Run: `cd backend; npm run typecheck`  
Expected: PASS.

- [ ] **Step 5: Commit schema source and migration**

```powershell
git add -- backend/src/db/schema.ts backend/src/db/ddl.ts scripts/gen-setup-sql.mjs supabase/setup.sql supabase/migrations/20260830090000_remove_device_sessions.sql supabase/tests/quota.test.ts supabase/tests/schema.test.ts
git commit -m "chore: retire device session schema"
```

### Task 5: Edge Parity and Auth Regression Gate

**Files:**
- Regenerate: `supabase/functions/api/shared/`
- Modify: `docs-fa/01-FRONTEND.md`
- Modify: `docs-fa/02-BACKEND.md`
- Modify: `docs-fa/03-FRONT-BACK-CONNECTIONS.md`
- Modify: `docs-fa/CODEBASE_GUIDE.md`

**Interfaces:**
- Node and Edge use the same stateless token/schema/services.
- Documentation states the 30-day non-revocable token trade-off explicitly.

- [ ] **Step 1: Regenerate Edge shared sources**

Run: `npm run sync:edge`  
Expected: generated shared token/schema/admin files match `backend/src`.

- [ ] **Step 2: Update all auth/device documentation claims**

Document: unlimited untracked devices, no refresh/device/block routes, 30-day access expiry, local-only logout, and no live migration/deploy performed.

- [ ] **Step 3: Run auth regression suite**

Run: `cd backend; npm test -- --maxWorkers=1`  
Run: `npm run test:edge -- --maxWorkers=1`  
Run: `npx vitest run src/lib/api/auth-expiry.test.ts src/lib/api/auth-owner.test.ts src/routes/-auth.test.tsx src/state/app-sync.test.tsx --maxWorkers=1`  
Run: `npm run lint`  
Run: `npm run build`  
Expected: all pass.

- [ ] **Step 4: Commit parity and documentation**

```powershell
git add -- supabase/functions/api/shared docs-fa/01-FRONTEND.md docs-fa/02-BACKEND.md docs-fa/03-FRONT-BACK-CONNECTIONS.md docs-fa/CODEBASE_GUIDE.md
git commit -m "docs: align stateless authentication contract"
```
