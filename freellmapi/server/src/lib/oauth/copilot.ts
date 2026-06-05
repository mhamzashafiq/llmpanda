// GitHub Copilot OAuth — GitHub device-code flow, then exchange the GitHub token
// for a short-lived Copilot token. Ported from 9router (MIT). The chat itself is
// OpenAI-compatible (providers/copilot.ts) using the Copilot token.
//
// ⚠️ Proxies the user's GitHub Copilot subscription — opt-in, off the default
// route; see the in-UI ToS warning.

export const GITHUB_CONFIG = {
  clientId: 'Iv1.b507a08c87ecfe98',
  deviceCodeUrl: 'https://github.com/login/device/code',
  tokenUrl: 'https://github.com/login/oauth/access_token',
  copilotTokenUrl: 'https://api.github.com/copilot_internal/v2/token',
  scopes: 'read:user',
  apiVersion: '2022-11-28',
  userAgent: 'GitHubCopilotChat/0.26.7',
};

export interface DeviceCode { device_code: string; user_code: string; verification_uri: string; expires_in: number; interval: number }
export interface GithubTokens { access_token: string; refresh_token?: string; expires_in?: number }
export type CopilotPoll = { success: true; tokens: GithubTokens } | { success: false; error?: string; pending: boolean };

export async function requestDeviceCode(): Promise<DeviceCode> {
  const res = await fetch(GITHUB_CONFIG.deviceCodeUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams({ client_id: GITHUB_CONFIG.clientId, scope: GITHUB_CONFIG.scopes }),
  });
  if (!res.ok) throw new Error(`GitHub device code failed: ${await res.text().catch(() => res.statusText)}`);
  const d = await res.json() as any;
  return { device_code: d.device_code, user_code: d.user_code, verification_uri: d.verification_uri, expires_in: d.expires_in, interval: d.interval || 5 };
}

export async function pollToken(deviceCode: string): Promise<CopilotPoll> {
  const res = await fetch(GITHUB_CONFIG.tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams({ client_id: GITHUB_CONFIG.clientId, device_code: deviceCode, grant_type: 'urn:ietf:params:oauth:grant-type:device_code' }),
  });
  const d = await res.json().catch(() => ({})) as any;
  if (!res.ok || d.error || !d.access_token) {
    return { success: false, error: d.error, pending: d.error === 'authorization_pending' || d.error === 'slow_down' };
  }
  return { success: true, tokens: { access_token: d.access_token, refresh_token: d.refresh_token, expires_in: d.expires_in } };
}

// Exchange a GitHub access token for a Copilot token (token + expires_at epoch).
export async function exchangeCopilotToken(githubAccessToken: string): Promise<{ token: string; expiresAt: number }> {
  const res = await fetch(GITHUB_CONFIG.copilotTokenUrl, {
    headers: {
      Authorization: `token ${githubAccessToken}`,
      Accept: 'application/json',
      'X-GitHub-Api-Version': GITHUB_CONFIG.apiVersion,
      'User-Agent': GITHUB_CONFIG.userAgent,
    },
  });
  if (!res.ok) throw new Error(`Copilot token exchange failed: ${res.status} ${await res.text().catch(() => '')}`);
  const d = await res.json() as any;
  // expires_at may be seconds-epoch; normalize to ms.
  const exp = typeof d.expires_at === 'number' ? (d.expires_at < 1e12 ? d.expires_at * 1000 : d.expires_at) : Date.now() + 25 * 60 * 1000;
  return { token: d.token, expiresAt: exp };
}
