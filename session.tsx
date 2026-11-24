import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { api, loadToken, setToken, Branding, User } from './api';
import { initBilling } from './billing';

const DEFAULT: Branding = { brand: 'Network Geeks', accent: '#0f766e', logo: '', trialDays: 7, price: 1.99, whatsapp: '+19715247533', supportEmail: 'conrad.pm1994@gmail.com' };
type Ctx = { user: User | null; brand: Branding; ready: boolean; signIn(r: { token: string; user: User }): Promise<void>; signOut(): Promise<void>; refresh(): Promise<User | null> };
const C = createContext<Ctx>(null as any);
export const useSession = () => useContext(C);

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [brand, setBrand] = useState<Branding>(DEFAULT);
  const [ready, setReady] = useState(false);

  const refresh = useCallback(async () => {
    try { const u = await api<User>('/me'); setUser(u); return u; } catch { return null; }
  }, []);
  const signIn: Ctx['signIn'] = async ({ token, user }) => { await setToken(token); setUser(user); await initBilling(user.id); };
  const signOut = async () => { await setToken(null); setUser(null); };

  useEffect(() => {
    (async () => {
      try { setBrand(await api<Branding>('/config')); } catch {}
      if (await loadToken()) { const u = await refresh(); if (u) await initBilling(u.id); else await setToken(null); }
      setReady(true);
    })();
  }, [refresh]);

  return <C.Provider value={{ user, brand, ready, signIn, signOut, refresh }}>{children}</C.Provider>;
}
