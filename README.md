# White-label VPN mobile app (React Native / Expo dev client)

Native modules (VPN, Google, billing) mean Expo Go will not work. Use a dev client.

## Create the project and drop these files in
    npx create-expo-app@latest vpn-app --template blank-typescript
    cd vpn-app
    npx expo install expo-secure-store expo-dev-client
    npm i react-native-purchases @react-native-google-signin/google-signin
Copy `App.tsx`, `app.json`, `eas.json`, `src/`, `plugins/` and `native/` from this folder into the project (replace the generated App.tsx and app.json), then:
    npx expo prebuild
    npx expo run:android     # or run:ios

## Environment (.env, public values only)
    EXPO_PUBLIC_API_BASE=https://api.yourdomain.com
    EXPO_PUBLIC_RC_IOS=...            # RevenueCat public SDK keys
    EXPO_PUBLIC_RC_ANDROID=...
    EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID=...   # also add to server GOOGLE_CLIENT_IDS

## Store and billing setup
1. App Store Connect / Play Console: one weekly auto-renewing product at $1.99 with a 7-day free-trial introductory offer.
2. RevenueCat: attach the product, make it the current offering's weekly package, and set the webhook to
   `https://api.yourdomain.com/billing/webhook` with the Authorization header equal to the server's RC_WEBHOOK_AUTH.

## VPN tunnel
- Android: `plugins/withWGTunnel.js` (listed in app.json) copies `native/android/WGTunnelModule.kt` into the generated project, registers it in MainApplication and adds the WireGuard dependency on every `expo prebuild`. The Kotlin is untested. If the build complains about Java APIs, enable core library desugaring in android/app/build.gradle.
- iOS: needs a Packet Tunnel Provider (NetworkExtension) built with WireGuardKit, plus Apple's Network Extension
  entitlement for your App ID. Write a Swift module exposing the same three methods (connect, disconnect, isConnected).
- OpenVPN fallback (UDP, then TCP 443) is not included; the API offers it via `GET /vpn/config?protocol=openvpn&port_id=2`.

## White-labelling a new client
Branding (name, colors, logo, support contacts) comes from the server at runtime. Per client you still change the
app name, bundle ID/package, icon and splash in app.json, and create store listings and a RevenueCat project.

## Admin panel
Use `vpn-app-live.html` hosted on your own domain at `/#admin`. It is not part of the mobile app.
