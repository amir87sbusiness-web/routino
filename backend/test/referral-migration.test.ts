import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

let db: PGlite;

const BASE_MIGRATION = new URL(
  "../../supabase/migrations/20260926134618_referral_program.sql",
  import.meta.url,
);
const USER_CODE_INDEX_MIGRATION = new URL(
  "../../supabase/migrations/20260926180358_referral_users_code_index.sql",
  import.meta.url,
);
const GRANT_KEY_INDEX_MIGRATION = new URL(
  "../../supabase/migrations/20260926180400_referral_grant_key_index.sql",
  import.meta.url,
);

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    create role anon;
    create role authenticated;
    create table users (
      id uuid primary key default gen_random_uuid(),
      phone text not null unique,
      created_at timestamptz not null default now()
    );
    create table payments (id uuid primary key default gen_random_uuid());
    create table grants (
      id uuid primary key default gen_random_uuid(),
      user_id uuid not null references users(id) on delete cascade,
      source text not null
    );
    create table constraint_name_decoy (
      marker boolean constraint users_referral_code_format check (marker)
    );
  `);
  const baseMigration = readFileSync(BASE_MIGRATION, "utf8");
  await db.exec(baseMigration);
  await db.exec(baseMigration);
  for (const migrationUrl of [USER_CODE_INDEX_MIGRATION, GRANT_KEY_INDEX_MIGRATION]) {
    const migration = readFileSync(migrationUrl, "utf8");
    await db.exec(migration.replace(/create unique index concurrently/gi, "create unique index"));
  }
});

afterAll(async () => {
  await db?.close();
});

describe("referral_program migration", () => {
  it("upgrades an existing schema without backfilling user codes", async () => {
    const inserted = await db.query<{ referral_code: string | null }>(`
      insert into users (phone) values ('989120001001') returning referral_code
    `);
    expect(inserted.rows).toEqual([{ referral_code: null }]);
    await expect(
      db.exec(`update users set referral_code = 'ABC123' where phone = '989120001001'`),
    ).rejects.toThrow();
  });

  it("creates exactly one rollout boundary", async () => {
    const policy = await db.query<{ key: string; started_at: Date }>(
      `select key, started_at from referral_program_policy`,
    );
    expect(policy.rows).toHaveLength(1);
    expect(policy.rows[0]!.key).toBe("referral_v1");
  });

  it("locks both new tables behind RLS with no public policies", async () => {
    const tables = await db.query<{ relname: string; relrowsecurity: boolean }>(`
      select relname, relrowsecurity
        from pg_class
       where relname in ('referral_program_policy', 'referrals')
       order by relname
    `);
    expect(tables.rows).toEqual([
      { relname: "referral_program_policy", relrowsecurity: true },
      { relname: "referrals", relrowsecurity: true },
    ]);
    const policies = await db.query(`
      select policyname from pg_policies
       where tablename in ('referral_program_policy', 'referrals')
    `);
    expect(policies.rows).toHaveLength(0);

    const publicPrivileges = await db.query<{ privilege_type: string }>(`
      select acl.privilege_type
        from pg_class c
        cross join lateral aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) acl
       where c.oid = 'referrals'::regclass
         and acl.grantee = 0
    `);
    expect(publicPrivileges.rows).toHaveLength(0);
    for (const role of ["anon", "authenticated"]) {
      const privileges = await db.query<{ can_read: boolean; can_write: boolean }>(`
        select has_table_privilege('${role}', 'referrals', 'SELECT') as can_read,
               has_table_privilege('${role}', 'referrals', 'INSERT,UPDATE,DELETE') as can_write
      `);
      expect(privileges.rows).toEqual([{ can_read: false, can_write: false }]);
    }
  });

  it("isolates each concurrent unique index in its own non-transactional migration", () => {
    const base = readFileSync(BASE_MIGRATION, "utf8").toLowerCase();
    expect(base).not.toContain("create unique index concurrently");
    expect(base).not.toContain("pg-delta: transaction=false");

    const expectedStatements = [
      [USER_CODE_INDEX_MIGRATION, "create unique index concurrently users_referral_code_unique"],
      [GRANT_KEY_INDEX_MIGRATION, "create unique index concurrently grants_idempotency_key_unique"],
    ] as const;
    for (const [migrationUrl, statement] of expectedStatements) {
      const migration = readFileSync(migrationUrl, "utf8").toLowerCase();
      expect(migration.startsWith("-- pg-delta: transaction=false")).toBe(true);
      expect(migration).toContain(statement);
      expect(migration).not.toContain("if not exists");
      expect(migration).not.toMatch(/\bbegin\s*;/);
      expect(migration).not.toMatch(/\bcommit\s*;/);
      expect(migration.match(/create unique index concurrently/g)).toHaveLength(1);
    }
  });

  it("pins the delete trigger to fully-qualified public objects", async () => {
    const [fn] = (
      await db.query<{ proconfig: string[] | null; definition: string }>(`
        select p.proconfig, pg_get_functiondef(p.oid) as definition
          from pg_proc p
         where p.proname = 'routino_prepare_referrals_for_user_delete'
      `)
    ).rows;
    expect(fn?.proconfig).toContain('search_path=""');
    expect(fn?.definition).toContain("delete from public.referrals");

    const [publicPrivilege] = (
      await db.query<{ can_execute: boolean }>(`
        select exists (
          select 1
            from pg_proc p
            cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) acl
           where p.proname = 'routino_prepare_referrals_for_user_delete'
             and acl.grantee = 0
             and acl.privilege_type = 'EXECUTE'
        ) as can_execute
      `)
    ).rows;
    expect(publicPrivilege?.can_execute).toBe(false);
    for (const role of ["anon", "authenticated"]) {
      const [privilege] = (
        await db.query<{ can_execute: boolean }>(`
          select has_function_privilege(
            '${role}', 'public.routino_prepare_referrals_for_user_delete()', 'EXECUTE'
          ) as can_execute
        `)
      ).rows;
      expect(privilege?.can_execute).toBe(false);
    }
  });
});
