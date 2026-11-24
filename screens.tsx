import React, { useEffect, useState } from 'react';
import { View, Text, TextInput, Pressable, ScrollView, Image, Linking, Alert, StyleSheet, ActivityIndicator } from 'react-native';
import { api, ApiError, User } from './api';
import { useSession } from './session';
import { googleIdToken } from './google';
import { startTrialOrSubscribe, restorePurchases } from './billing';
import * as vpn from './vpn';

// ---------- shared bits ----------
const useBusy = () => {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const run = async (f: () => Promise<void>) => {
    setBusy(true); setError('');
    try { await f(); } catch (e: any) { setError(e instanceof ApiError || e instanceof Error ? e.message : 'Something went wrong.'); }
    setBusy(false);
  };
  return { busy, error, run };
};
export function Btn({ title, onPress, alt, busy }: { title: string; onPress(): void; alt?: boolean; busy?: boolean }) {
  const { brand } = useSession();
  return (
    <Pressable accessibilityRole="button" disabled={busy} onPress={onPress}
      style={[s.btn, alt ? { borderWidth: 1, borderColor: '#9bb' } : { backgroundColor: brand.accent }]}>
      {busy ? <ActivityIndicator color={alt ? '#333' : '#fff'} /> : <Text style={[s.btnT, alt && { color: '#123' }]}>{title}</Text>}
    </Pressable>
  );
}
const Head = () => {
  const { brand } = useSession();
  return (
    <View style={s.head}>
      {brand.logo ? <Image source={{ uri: brand.logo }} style={s.logo} /> : <View style={[s.logo, { backgroundColor: brand.accent }]} />}
      <Text style={s.brandT}>{brand.brand}</Text>
    </View>
  );
};
const Err = ({ t }: { t: string }) => (t ? <Text style={s.err} accessibilityRole="alert">{t}</Text> : null);

// ---------- auth ----------
export function Welcome({ onOtp }: { onOtp(email: string): void }) {
  const { brand, signIn } = useSession();
  const [email, setEmail] = useState(''); const [pw, setPw] = useState('');
  const { busy, error, run } = useBusy();
  return (
    <ScrollView contentContainerStyle={s.pad}>
      <Head />
      <Text style={s.h1}>Private by default.</Text>
      <Text style={s.mu}>Free for {brand.trialDays} days, then ${brand.price.toFixed(2)} per week. Cancel anytime in your store settings.</Text>
      <Err t={error} />
      <Btn alt title="Continue with Google" busy={busy} onPress={() => run(async () => signIn(await api('/auth/google', 'POST', { idToken: await googleIdToken() })))} />
      <TextInput style={s.in} placeholder="Email" autoCapitalize="none" keyboardType="email-address" autoComplete="email" value={email} onChangeText={setEmail} />
      <TextInput style={s.in} placeholder="Password (8+ characters)" secureTextEntry value={pw} onChangeText={setPw} />
      <Btn title="Create account" busy={busy} onPress={() => run(async () => { await api('/auth/email/start', 'POST', { email, password: pw }); onOtp(email.trim().toLowerCase()); })} />
      <Btn alt title="I already have an account" busy={busy} onPress={() => run(async () => signIn(await api('/auth/login', 'POST', { email, password: pw })))} />
    </ScrollView>
  );
}
export function Otp({ email, onBack }: { email: string; onBack(): void }) {
  const { signIn } = useSession();
  const [code, setCode] = useState(''); const { busy, error, run } = useBusy();
  return (
    <ScrollView contentContainerStyle={s.pad}>
      <Head /><Text style={s.h1}>Enter your code</Text>
      <Text style={s.mu}>We sent a 6-digit code to {email}.</Text><Err t={error} />
      <TextInput style={s.in} placeholder="6-digit code" keyboardType="number-pad" maxLength={6} textContentType="oneTimeCode" value={code} onChangeText={setCode} />
      <Btn title="Verify and continue" busy={busy} onPress={() => run(async () => signIn(await api('/auth/email/verify', 'POST', { email, code })))} />
      <Btn alt title="Back" onPress={onBack} />
    </ScrollView>
  );
}

// ---------- paywall (mandatory trial: no way past this without a store trial) ----------
export function Paywall() {
  const { brand, user, refresh, signOut } = useSession();
  const { busy, error, run } = useBusy();
  const expired = user?.status === 'expired';
  const poll = async () => { // the server learns about the purchase from the RevenueCat webhook
    for (let i = 0; i < 10; i++) { const u = await refresh(); if (u && (u.status === 'trial' || u.status === 'active')) return; await new Promise((r) => setTimeout(r, 1500)); }
    throw new Error('Purchase received. Activation is taking longer than usual; reopen the app in a minute.');
  };
  return (
    <ScrollView contentContainerStyle={s.pad}>
      <Head /><Text style={s.h1}>{expired ? 'Your subscription has ended' : 'Start your free trial'}</Text>
      <View style={s.card}>
        <Text style={s.h1}>${brand.price.toFixed(2)}<Text style={s.mu}> / week</Text></Text>
        <Text style={s.mu}>{brand.trialDays}-day free trial first, then billed weekly until you cancel. Unlimited bandwidth, all locations.</Text>
        <Err t={error} />
        <Btn busy={busy} title={expired ? 'Subscribe' : 'Start free trial'} onPress={() => run(async () => { await startTrialOrSubscribe(); await poll(); })} />
        <Btn alt title="Restore purchases" onPress={() => run(async () => { await restorePurchases(); await poll(); })} />
      </View>
      <Btn alt title="Sign out" onPress={signOut} />
    </ScrollView>
  );
}

// ---------- home / connect ----------
export function Home() {
  const { user, brand } = useSession();
  const [servers, setServers] = useState<vpn.VpnServer[]>([]); const [sel, setSel] = useState('');
  const [on, setOn] = useState(false); const { busy, error, run } = useBusy();
  useEffect(() => { vpn.listServers().then((l) => { setServers(l); setSel(l[0]?.id ?? ''); }).catch(() => {}); vpn.isConnected().then(setOn); }, []);
  const left = user ? Math.max(0, Math.ceil((user.expiresAt - Date.now()) / 864e5)) : 0;
  return (
    <ScrollView contentContainerStyle={s.pad}>
      <Head />
      <Text style={s.mu}>{user?.status === 'trial' ? `${left} trial days left` : 'Subscribed'} · {on ? 'Connected' : 'Not connected'}</Text>
      <Pressable accessibilityRole="button" accessibilityState={{ selected: on }} disabled={busy || !sel}
        onPress={() => run(async () => { if (on) { await vpn.disconnect(); setOn(false); } else { await vpn.connect(sel); setOn(true); } })}
        style={[s.big, on && { borderColor: brand.accent }]}>
        {busy ? <ActivityIndicator /> : <Text style={[s.bigT, on && { color: brand.accent }]}>{on ? 'Disconnect' : 'Connect'}</Text>}
      </Pressable>
      <Err t={error} />
      {servers.map((x) => (
        <Pressable key={x.id} onPress={() => !on && setSel(x.id)} style={[s.row, sel === x.id && { borderColor: brand.accent }]}>
          <Text>{x.label}</Text>
        </Pressable>
      ))}
    </ScrollView>
  );
}

// ---------- support ----------
export function Support() {
  const { brand } = useSession();
  const [cat, setCat] = useState('Connection problem'); const [subject, setSubject] = useState(''); const [message, setMessage] = useState('');
  const [sent, setSent] = useState(false); const { busy, error, run } = useBusy();
  const wa = brand.whatsapp.replace(/\D/g, '');
  return (
    <ScrollView contentContainerStyle={s.pad}>
      <Head /><Text style={s.h1}>Support</Text>
      <Btn alt title={`Chat on WhatsApp ${brand.whatsapp}`} onPress={() => Linking.openURL(`https://wa.me/${wa}`)} />
      <Btn alt title={`Email ${brand.supportEmail}`} onPress={() => Linking.openURL(`mailto:${brand.supportEmail}`)} />
      <View style={s.card}>
        <Text style={s.h3}>Open a ticket</Text>
        <View style={s.chips}>{['Connection problem', 'Billing', 'Account', 'Other'].map((c) => (
          <Pressable key={c} onPress={() => setCat(c)} style={[s.chip, cat === c && { backgroundColor: brand.accent }]}><Text style={cat === c && { color: '#fff' }}>{c}</Text></Pressable>
        ))}</View>
        <TextInput style={s.in} placeholder="Subject" value={subject} onChangeText={setSubject} />
        <TextInput style={[s.in, { height: 110 }]} placeholder="Message" multiline value={message} onChangeText={setMessage} />
        <Err t={error} />{sent && <Text style={s.mu}>Ticket sent. We’ll reply by email.</Text>}
        <Btn busy={busy} title="Send ticket" onPress={() => run(async () => { await api('/tickets', 'POST', { cat, subject, message }); setSent(true); setSubject(''); setMessage(''); })} />
      </View>
    </ScrollView>
  );
}

// ---------- account ----------
export function Account() {
  const { user, signOut } = useSession(); const { error, run } = useBusy();
  const del = () => Alert.alert('Delete account?', 'This removes your account and VPN access. It can’t be undone.', [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Delete', style: 'destructive', onPress: () => run(async () => { await api('/me', 'DELETE'); await signOut(); }) },
  ]);
  return (
    <ScrollView contentContainerStyle={s.pad}>
      <Head /><Text style={s.h1}>Account</Text><Text>{user?.email}</Text><Err t={error} />
      <Btn alt title="Sign out" onPress={signOut} /><Btn alt title="Delete account" onPress={del} />
    </ScrollView>
  );
}

const s = StyleSheet.create({
  pad: { padding: 20, paddingTop: 56, gap: 10 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 8 },
  logo: { width: 36, height: 36, borderRadius: 9 }, brandT: { fontSize: 18, fontWeight: '700' },
  h1: { fontSize: 28, fontWeight: '700' }, h3: { fontSize: 17, fontWeight: '700' }, mu: { color: '#5b6f6a' },
  in: { borderWidth: 1, borderColor: '#cfdad6', borderRadius: 10, padding: 12, backgroundColor: '#fff' },
  btn: { borderRadius: 12, padding: 14, alignItems: 'center' }, btnT: { color: '#fff', fontWeight: '700' },
  card: { borderWidth: 1, borderColor: '#d5e0dc', borderRadius: 16, padding: 16, gap: 10, backgroundColor: '#fff' },
  err: { color: '#b42318' },
  big: { width: 170, height: 170, borderRadius: 85, borderWidth: 8, borderColor: '#d5e0dc', alignSelf: 'center', alignItems: 'center', justifyContent: 'center', marginVertical: 20 },
  bigT: { fontSize: 20, fontWeight: '700' },
  row: { padding: 14, borderWidth: 1, borderColor: '#d5e0dc', borderRadius: 12, backgroundColor: '#fff' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 }, chip: { borderWidth: 1, borderColor: '#cfdad6', borderRadius: 99, paddingHorizontal: 10, paddingVertical: 6 },
});
