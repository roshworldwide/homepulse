import type { ImageInput } from "../models/types.js";

/**
 * Ring Partner API client (Developer Playground). Real calls; the Playground
 * hands out 30-minute tokens, so every call reports a clear error when the
 * token has expired instead of failing silently.
 */
export class RingClient {
  constructor(
    private base: string,
    private token: () => string,
  ) {}

  private async get(pathname: string): Promise<unknown> {
    const res = await fetch(new URL(pathname, this.base), { headers: { Authorization: `Bearer ${this.token()}`, Accept: "application/json" } });
    if (res.status === 401) throw new Error("Ring token expired or invalid (Playground tokens last 30 minutes)");
    if (!res.ok) throw new Error(`Ring API ${pathname} returned ${res.status}`);
    return res.json();
  }

  devices(): Promise<unknown> {
    return this.get("/v1/devices?include=status,capabilities");
  }

  history(deviceId: string): Promise<unknown> {
    return this.get(`/v1/history/devices/${encodeURIComponent(deviceId)}/events`);
  }

  configurations(deviceId: string): Promise<unknown> {
    return this.get(`/v1/devices/${encodeURIComponent(deviceId)}/configurations`);
  }

  /** True when video from this device cannot be read (end-to-end encryption or Throw Away the Key). */
  async videoUnavailable(deviceId: string): Promise<boolean> {
    try {
      const cfg = (await this.configurations(deviceId)) as Record<string, any>;
      const enc = cfg?.e2e_encryption ?? cfg?.data?.e2e_encryption ?? cfg?.configurations?.e2e_encryption;
      return enc?.enabled === true;
    } catch {
      return false;
    }
  }

  async snapshot(deviceId: string): Promise<ImageInput | { unavailable: string }> {
    if (await this.videoUnavailable(deviceId)) return { unavailable: "Video unavailable (end-to-end encrypted device)" };
    const res = await fetch(new URL(`/v1/devices/${encodeURIComponent(deviceId)}/media/image/download`, this.base), {
      method: "POST",
      headers: { Authorization: `Bearer ${this.token()}`, "Content-Type": "application/json", Accept: "image/jpeg, image/png" },
      body: JSON.stringify({}),
    });
    if (res.status === 401) return { unavailable: "Ring token expired (Playground tokens last 30 minutes)" };
    if (!res.ok) return { unavailable: `Ring snapshot returned ${res.status}` };
    const type = res.headers.get("content-type") ?? "";
    if (!/image\/(jpeg|png)/.test(type)) return { unavailable: `Ring snapshot returned ${type || "no image"}` };
    return { bytes: Buffer.from(await res.arrayBuffer()), mime: type.includes("png") ? "image/png" : "image/jpeg", name: `ring-${deviceId}.${type.includes("png") ? "png" : "jpg"}` };
  }
}
