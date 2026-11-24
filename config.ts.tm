// Set these in .env (Expo reads EXPO_PUBLIC_* at build time). No secrets belong here.
export const API_BASE = process.env.EXPO_PUBLIC_API_BASE ?? 'https://api.yourdomain.com';
export const RC_KEY = {
  ios: process.env.EXPO_PUBLIC_RC_IOS ?? '',
  android: process.env.EXPO_PUBLIC_RC_ANDROID ?? '',
};
// The Google *web* client ID: the ID token's audience. Also list it in the server's GOOGLE_CLIENT_IDS.
export const GOOGLE_WEB_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID ?? '';
