import type { BioTimePaginatedResponse } from "./types";
import {
  loadToken,
  saveToken,
  getCredentials,
  getBaseUrl,
  authenticate,
  refreshToken,
  markConnected,
  markDisconnected,
} from "./auth";

const REQUEST_TIMEOUT_MS = 15_000;

export class BioTimeClient {
  private baseUrl: string;
  private token: string | null;

  constructor(baseUrl: string, token: string | null) {
    this.baseUrl = baseUrl;
    this.token = token;
  }

  /** Low-level fetch with timeout via AbortController. */
  private async fetchWithTimeout(
    url: string,
    init?: RequestInit,
  ): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      return await fetch(url, { ...init, signal: controller.signal });
    } finally {
      clearTimeout(timeout);
    }
  }

  /**
   * Main request method with auth headers and automatic retry on 401.
   * Flow: try request → 401 → try refresh → 401 → try full re-auth → retry once.
   */
  async request<T>(
    path: string,
    options?: { params?: Record<string, string>; method?: string; body?: unknown },
  ): Promise<T> {
    if (!this.token) {
      await this.reAuthenticate();
    }

    const buildUrl = () => {
      const url = new URL(path, this.baseUrl);
      if (options?.params) {
        for (const [k, v] of Object.entries(options.params)) {
          url.searchParams.set(k, v);
        }
      }
      return url.toString();
    };

    const buildInit = (): RequestInit => ({
      method: options?.method ?? "GET",
      headers: {
        Authorization: `JWT ${this.token}`,
        ...(options?.body ? { "Content-Type": "application/json" } : {}),
      },
      ...(options?.body ? { body: JSON.stringify(options.body) } : {}),
    });

    let res = await this.fetchWithTimeout(buildUrl(), buildInit());

    if (res.status === 401) {
      // Try token refresh first
      try {
        const newToken = await refreshToken(this.baseUrl, this.token!);
        this.token = newToken;
        await saveToken(newToken);
      } catch {
        // Refresh failed — full re-auth
        await this.reAuthenticate();
      }

      res = await this.fetchWithTimeout(buildUrl(), buildInit());
    }

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(
        `BioTime API error: ${res.status} ${res.statusText} (${path}) — ${body}`,
      );
    }

    return res.json() as Promise<T>;
  }

  /** Full re-authentication using stored credentials. */
  private async reAuthenticate(): Promise<void> {
    const creds = await getCredentials();
    const newToken = await authenticate(creds.url, creds.username, creds.password);
    this.token = newToken;
    await saveToken(newToken);
  }

  /** Fetch all pages of a paginated BioTime endpoint. */
  async fetchAllPages<T>(
    path: string,
    params?: Record<string, string>,
  ): Promise<T[]> {
    const all: T[] = [];
    let page = 1;
    let hasMore = true;

    while (hasMore) {
      const data = await this.request<BioTimePaginatedResponse<T>>(path, {
        params: { page_size: "100", ...params, page: String(page) },
      });

      if (!data || !Array.isArray(data.data)) {
        throw new Error(
          `BioTime API returned unexpected response for ${path} (page ${page}): ${JSON.stringify(data).slice(0, 200)}`,
        );
      }

      all.push(...data.data);
      hasMore = data.next !== null;
      page++;
    }

    return all;
  }
}

/**
 * Factory: create a BioTimeClient from settings/env.
 * Loads saved token from DB; if missing, authenticates fresh.
 */
export async function getBioTimeClient(): Promise<BioTimeClient> {
  try {
    const baseUrl = await getBaseUrl();
    let token = await loadToken();

    if (!token) {
      const creds = await getCredentials();
      token = await authenticate(creds.url, creds.username, creds.password);
      await saveToken(token);
    }

    await markConnected();
    return new BioTimeClient(baseUrl, token);
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unknown connection error";
    await markDisconnected(msg);
    throw error;
  }
}
