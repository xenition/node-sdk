import * as sdk from '../../index';

/** What apps import from '@xenition/sdk' itself — a helper only in the module index is invisible to them. */
describe('billing exports on the package entry', () => {
  it.each(['storeOffer', 'classifyPurchaseChange', 'evaluateEntitlement', 'verifyJwsX5c', 'verifyPubSubToken', 'parseCertificate', 'APPLE_ROOT_CA_G3_SHA256', 'handleAppleNotification', 'handleGoogleNotification', 'AppleStore', 'GoogleStore', 'BillingClient'])(
    '%s',
    (name) => {
      expect((sdk as Record<string, unknown>)[name]).toBeDefined();
    },
  );
});
