/*

SPDX-FileCopyrightText: © 2023 Dai Foundation <www.daifoundation.org>

SPDX-License-Identifier: AGPL-3.0-or-later

*/

export type UpstashCredentials = { url: string; token: string };

/**
 * Explicit REST credentials win. Without them, an Upstash TCP URL
 * (`rediss://default:<token>@<db>.upstash.io:6379`) is enough: the REST
 * endpoint is https on the same host and the default user's password is its
 * REST token, so existing deployments keep working with REDIS_URL alone.
 */
export function resolveUpstashCredentials({
  restUrl,
  restToken,
  redisUrl
}: {
  restUrl?: string;
  restToken?: string;
  redisUrl?: string;
}): UpstashCredentials | null {
  if (restUrl && restToken) return { url: restUrl, token: restToken };
  if (!redisUrl) return null;
  let parsed: URL;
  try {
    parsed = new URL(redisUrl);
  } catch {
    return null;
  }
  if (!/^rediss?:$/.test(parsed.protocol) || !parsed.hostname.endsWith('.upstash.io') || !parsed.password) {
    return null;
  }
  return { url: `https://${parsed.hostname}`, token: decodeURIComponent(parsed.password) };
}
