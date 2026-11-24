import * as SecureStore from 'expo-secure-store';
import { API_BASE } from './config';

let token: string | null = null;
export const loadToken = async () => (token = await SecureStore.getItemAsync('tok'));
export const setToken = async (t: string | null) => {
  token = t;
  if (t) await SecureStore.setItemAsync('tok', t);
  else await SecureStore.deleteItemAsync('tok');
};

export type Status = 'none' | 'trial' | 'active' | 'expired';
export type User = { id: number; email: string; status: Status; expiresAt: number };
export type Branding = { brand: string; accent: string; logo: string; trialDays: number; price: number; whatsapp: string; supportEmail: string };

export class ApiError extends Error {
  constructor(message: string, public status: number) { super(message); }
}

export async function api<T = any>(path: string, method = 'GET', body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(API_BASE + path, {
      method,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError('Can’t reach the server. Check your connection.', 0);
  }
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(json.error ?? 'Request failed.', res.status);
  return json as T;
}
