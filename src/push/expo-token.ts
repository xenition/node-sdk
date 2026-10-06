/**
 * Is this an Expo push token — the kind `getExpoPushTokenAsync()` returns?
 *
 * Its own file, with no imports, because both the server routers and the
 * device helper in `@xenition/sdk/mobile` need it, and the mobile entry must
 * not pull the HTTP client into a phone's bundle.
 */
export function isExpoPushToken(token: string): boolean {
  return /^Expo(nent)?PushToken\[[^\]]+\]$/.test(token);
}
