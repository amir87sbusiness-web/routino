import { authedRequest } from "./auth";

export interface AccountDevice {
  id: string;
  name: string | null;
  platform: string | null;
  browser: string | null;
  os: string | null;
  firstSeenAt: string;
  lastSeenAt: string | null;
  revokedAt: string | null;
  revocationReason: string | null;
  current: boolean;
  active: boolean;
}

export interface DeviceOverview {
  maxActiveDevices: number;
  switchCount30d: number;
  securityLocked: boolean;
  devices: AccountDevice[];
}

export function fetchDevices(): Promise<DeviceOverview> {
  return authedRequest("/devices");
}

/** Lightweight session/device validation for the one-minute security cadence. */
export function pingDevice(): Promise<{ ok: true }> {
  return authedRequest("/devices/ping");
}

export function revokeDevice(id: string): Promise<{ ok: true }> {
  return authedRequest(`/devices/${encodeURIComponent(id)}/revoke`, { method: "POST" });
}
