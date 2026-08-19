import { useDatabase } from "./dexie";

const REGISTRY_KEY = "routino:vaults:v1";
export const LEGACY_VAULT_ID = "legacy";

interface VaultRegistry {
  activeVaultId: string;
  ownerVaults: Record<string, string>;
  vaultOwners: Record<string, string>;
}

export interface VaultSwitchResult {
  vaultId: string;
  changed: boolean;
  claimedCurrent: boolean;
}

function emptyRegistry(): VaultRegistry {
  return {
    activeVaultId: LEGACY_VAULT_ID,
    ownerVaults: {},
    vaultOwners: {},
  };
}

function readRegistry(): VaultRegistry {
  try {
    const raw = localStorage.getItem(REGISTRY_KEY);
    if (!raw) return emptyRegistry();
    const parsed = JSON.parse(raw) as Partial<VaultRegistry>;
    return {
      activeVaultId: parsed.activeVaultId || LEGACY_VAULT_ID,
      ownerVaults: parsed.ownerVaults ?? {},
      vaultOwners: parsed.vaultOwners ?? {},
    };
  } catch {
    return emptyRegistry();
  }
}

function writeRegistry(registry: VaultRegistry): void {
  localStorage.setItem(REGISTRY_KEY, JSON.stringify(registry));
}

function newVaultId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function databaseNameForVault(vaultId: string): string {
  return vaultId === LEGACY_VAULT_ID ? "routino" : `routino:vault:${vaultId}`;
}

export function getActiveVaultId(): string {
  return readRegistry().activeVaultId;
}

export async function activateVault(vaultId: string): Promise<void> {
  const registry = readRegistry();
  registry.activeVaultId = vaultId;
  writeRegistry(registry);
  await useDatabase(databaseNameForVault(vaultId));
}

export async function activateStoredVault(): Promise<void> {
  await useDatabase(databaseNameForVault(getActiveVaultId()));
}

/**
 * Selects the private local database assigned to one server user id.
 *
 * The first account claims the legacy database in place so existing installs
 * keep all of their data. A different account receives a new database; a later
 * login reopens the exact database previously assigned to that account.
 */
export async function switchOwnerVault(ownerId: string): Promise<VaultSwitchResult> {
  const registry = readRegistry();
  const previous = registry.activeVaultId;
  const known = registry.ownerVaults[ownerId];
  let vaultId = known;
  let claimedCurrent = false;

  if (!vaultId) {
    const currentOwner = registry.vaultOwners[previous];
    if (!currentOwner) {
      vaultId = previous;
      claimedCurrent = true;
    } else {
      vaultId = newVaultId();
    }
    registry.ownerVaults[ownerId] = vaultId;
    registry.vaultOwners[vaultId] = ownerId;
  }

  registry.activeVaultId = vaultId;
  writeRegistry(registry);
  await useDatabase(databaseNameForVault(vaultId));
  return { vaultId, changed: vaultId !== previous, claimedCurrent };
}
