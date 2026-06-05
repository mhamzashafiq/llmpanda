// Kiro (AWS CodeWhisperer) OAuth — AWS SSO OIDC device-code flow.
// Ported from 9router (MIT). Used to connect an AWS Builder ID / IDC account so
// LLM Panda can call Kiro's models on the user's behalf.
//
// ⚠️ Proxying another service's account may violate that service's ToS. This is
// opt-in and OFF by default; see the in-UI warning. Only OAuth here — the
// CodeWhisperer chat adapter (AWS EventStream) is built separately.

export const KIRO_CONFIG = {
  clientName: 'kiro-oauth-client',
  clientType: 'public',
  scopes: ['codewhisperer:completions', 'codewhisperer:analysis', 'codewhisperer:conversations'],
  grantTypes: ['urn:ietf:params:oauth:grant-type:device_code', 'refresh_token'],
  issuerUrl: 'https://identitycenter.amazonaws.com/ssoins-722374e8c3c8e6c6',
  startUrl: 'https://view.awsapps.com/start',
};

export interface KiroClient { clientId: string; clientSecret: string; clientSecretExpiresAt?: number }
export interface KiroDeviceAuth { deviceCode: string; userCode: string; verificationUri: string; verificationUriComplete: string; expiresIn: number; interval: number }
export interface KiroTokens { accessToken: string; refreshToken?: string; expiresIn?: number; tokenType?: string }
export type KiroPoll = { success: true; tokens: KiroTokens } | { success: false; error?: string; pending: boolean };

function oidc(region: string, path: string): string {
  return `https://oidc.${region}.amazonaws.com/${path}`;
}

export async function registerClient(region = 'us-east-1'): Promise<KiroClient> {
  const res = await fetch(oidc(region, 'client/register'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      clientName: KIRO_CONFIG.clientName,
      clientType: KIRO_CONFIG.clientType,
      scopes: KIRO_CONFIG.scopes,
      grantTypes: KIRO_CONFIG.grantTypes,
      issuerUrl: KIRO_CONFIG.issuerUrl,
    }),
  });
  if (!res.ok) throw new Error(`Kiro registerClient failed: ${await res.text().catch(() => res.statusText)}`);
  const d = await res.json() as any;
  return { clientId: d.clientId, clientSecret: d.clientSecret, clientSecretExpiresAt: d.clientSecretExpiresAt };
}

export async function startDeviceAuthorization(clientId: string, clientSecret: string, startUrl = KIRO_CONFIG.startUrl, region = 'us-east-1'): Promise<KiroDeviceAuth> {
  const res = await fetch(oidc(region, 'device_authorization'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ clientId, clientSecret, startUrl }),
  });
  if (!res.ok) throw new Error(`Kiro device_authorization failed: ${await res.text().catch(() => res.statusText)}`);
  const d = await res.json() as any;
  return {
    deviceCode: d.deviceCode, userCode: d.userCode,
    verificationUri: d.verificationUri, verificationUriComplete: d.verificationUriComplete,
    expiresIn: d.expiresIn, interval: d.interval || 5,
  };
}

export async function pollDeviceToken(clientId: string, clientSecret: string, deviceCode: string, region = 'us-east-1'): Promise<KiroPoll> {
  const res = await fetch(oidc(region, 'token'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ clientId, clientSecret, deviceCode, grantType: 'urn:ietf:params:oauth:grant-type:device_code' }),
  });
  const d = await res.json().catch(() => ({})) as any;
  if (!res.ok || d.error) {
    return { success: false, error: d.error, pending: d.error === 'authorization_pending' || d.error === 'slow_down' };
  }
  return { success: true, tokens: { accessToken: d.accessToken, refreshToken: d.refreshToken, expiresIn: d.expiresIn, tokenType: d.tokenType } };
}

export async function refreshKiroToken(clientId: string, clientSecret: string, refreshToken: string, region = 'us-east-1'): Promise<KiroTokens> {
  const res = await fetch(oidc(region, 'token'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ clientId, clientSecret, refreshToken, grantType: 'refresh_token' }),
  });
  if (!res.ok) throw new Error(`Kiro token refresh failed: ${await res.text().catch(() => res.statusText)}`);
  const d = await res.json() as any;
  return { accessToken: d.accessToken, refreshToken: d.refreshToken ?? refreshToken, expiresIn: d.expiresIn, tokenType: d.tokenType };
}
