import { ensureE2eApp } from './app.js';

export type ApiResult = {
  status: number;
  data: unknown;
  text: string;
};

export const SEED = {
  admin: {
    email: 'admin@local.dev',
    password: process.env.ADMIN_SEED_PASSWORD || 'Admin@123456',
  },
  ops: {
    email: 'ops@local.dev',
    password: process.env.OPS_SEED_PASSWORD || 'Ops@123456',
  },
  dealer: {
    email: 'dealer@local.dev',
    password: process.env.DEALER_SEED_PASSWORD || 'Dealer@123456',
  },
} as const;

function parseCookies(res: Response): string {
  const setCookie = res.headers.getSetCookie?.() ?? [];
  const raw = res.headers.get('set-cookie');
  if (setCookie.length) {
    return setCookie.map((c) => c.split(';')[0]).join('; ');
  }
  if (!raw) return '';
  return raw
    .split(',')
    .map((c) => c.split(';')[0].trim())
    .join('; ');
}

export async function signIn(
  email: string,
  password: string,
): Promise<string> {
  const { baseUrl, origin } = await ensureE2eApp();
  const res = await fetch(`${baseUrl}/api/auth/sign-in/email`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: origin },
    body: JSON.stringify({ email, password }),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`sign-in ${email}: ${res.status} ${text}`);
  }
  return parseCookies(res);
}

export async function api(
  path: string,
  cookie: string | null,
  init: RequestInit = {},
): Promise<ApiResult> {
  const { baseUrl, origin } = await ensureE2eApp();
  const headers: Record<string, string> = {
    Origin: origin,
    ...(init.headers as Record<string, string> | undefined),
  };
  if (cookie) headers.Cookie = cookie;
  if (init.body && !(init.body instanceof FormData)) {
    headers['Content-Type'] ??= 'application/json';
  }
  const res = await fetch(`${baseUrl}${path}`, { ...init, headers });
  const text = await res.text();
  let data: unknown = text;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    /* keep text */
  }
  return { status: res.status, data, text };
}

export async function authFetch(
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  const { baseUrl, origin } = await ensureE2eApp();
  const headers: Record<string, string> = {
    Origin: origin,
    ...(init.headers as Record<string, string> | undefined),
  };
  if (init.body && !(init.body instanceof FormData)) {
    headers['Content-Type'] ??= 'application/json';
  }
  return fetch(`${baseUrl}${path}`, { ...init, headers });
}
