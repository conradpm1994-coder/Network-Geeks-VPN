import React, { useState } from 'react';
import { View, Pressable, Text, ActivityIndicator } from 'react-native';
import { SessionProvider, useSession } from './src/session';
import { Welcome, Otp, Paywall, Home, Support, Account } from './src/screens';

type Tab = 'Connect' | 'Support' | 'Account';

function Root() {
  const { user, ready, brand } = useSession();
  const [otpEmail, setOtpEmail] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('Connect');

  if (!ready) return <View style={{ flex: 1, justifyContent: 'center' }}><ActivityIndicator /></View>;
  if (!user) return otpEmail ? <Otp email={otpEmail} onBack={() => setOtpEmail(null)} /> : <Welcome onOtp={setOtpEmail} />;
  // Mandatory trial: nobody reaches the app without an active trial or subscription.
  if (user.status === 'none' || user.status === 'expired') return <Paywall />;

  const Screen = { Connect: Home, Support, Account }[tab];
  return (
    <View style={{ flex: 1 }}>
      <View style={{ flex: 1 }}><Screen /></View>
      <View style={{ flexDirection: 'row', gap: 6, padding: 10, paddingBottom: 24 }}>
        {(['Connect', 'Support', 'Account'] as Tab[]).map((t) => (
          <Pressable key={t} accessibilityRole="tab" onPress={() => setTab(t)}
            style={{ flex: 1, padding: 12, borderRadius: 12, borderWidth: 1, alignItems: 'center', borderColor: tab === t ? brand.accent : '#d5e0dc' }}>
            <Text style={{ color: tab === t ? brand.accent : '#123' }}>{t}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}
export default function App() { return <SessionProvider><Root /></SessionProvider>; }
