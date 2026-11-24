import { Platform } from 'react-native';
import Purchases from 'react-native-purchases';
import { RC_KEY } from './config';

// The RevenueCat app user ID must equal our user id: the server matches webhooks on it.
export async function initBilling(userId: number) {
  if (await Purchases.isConfigured()) await Purchases.logIn(String(userId));
  else Purchases.configure({ apiKey: Platform.OS === 'ios' ? RC_KEY.ios : RC_KEY.android, appUserID: String(userId) });
}

// Configure the weekly product (with a 7-day free-trial intro offer) in App Store Connect / Play Console.
export async function startTrialOrSubscribe() {
  const offerings = await Purchases.getOfferings();
  const pkg = offerings.current?.weekly ?? offerings.current?.availablePackages[0];
  if (!pkg) throw new Error('No plan is available right now.');
  await Purchases.purchasePackage(pkg);
}
export const restorePurchases = () => Purchases.restorePurchases();
