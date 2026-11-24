import { NativeModules } from 'react-native';
import { api } from './api';

// Implemented natively: see native/android (WireGuard). iOS needs a NetworkExtension, see README.
type Tunnel = { connect(config: string, name: string): Promise<void>; disconnect(): Promise<void>; isConnected(): Promise<boolean> };
const N: Tunnel | undefined = NativeModules.WGTunnel;
export const vpnAvailable = !!N;

// ASSUMPTION: the response shape of ResellPortal's /vpn endpoints is unconfirmed. Adjust here.
const pickConfig = (r: any): string | undefined => (typeof r === 'string' ? r : r?.config ?? r?.wireguard ?? r?.raw);
export type VpnServer = { id: string; label: string };
export async function listServers(): Promise<VpnServer[]> {
  const r = await api('/vpn/servers');
  const list: any[] = Array.isArray(r) ? r : r.servers ?? [];
  return list.map((s) => ({ id: String(s.id ?? s.name), label: String(s.name ?? s.city ?? s.id) }));
}
export async function connect(serverId: string) {
  if (!N) throw new Error('The VPN module isn’t installed in this build.');
  const cfg = pickConfig(await api('/vpn/config?protocol=wireguard&server=' + encodeURIComponent(serverId)));
  if (!cfg || !cfg.includes('[Interface]')) throw new Error('The server returned an unexpected VPN config.');
  await N.connect(cfg, 'vpn');
}
export const disconnect = () => N?.disconnect();
export const isConnected = () => N?.isConnected() ?? Promise.resolve(false);
