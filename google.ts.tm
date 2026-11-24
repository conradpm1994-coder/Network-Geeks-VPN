import { GoogleSignin } from '@react-native-google-signin/google-signin';
import { GOOGLE_WEB_CLIENT_ID } from './config';

export async function googleIdToken(): Promise<string> {
  GoogleSignin.configure({ webClientId: GOOGLE_WEB_CLIENT_ID });
  await GoogleSignin.hasPlayServices();
  const r: any = await GoogleSignin.signIn();
  const t = r?.data?.idToken ?? r?.idToken; // shape differs between library versions
  if (!t) throw new Error('Google sign-in was cancelled.');
  return t;
}
