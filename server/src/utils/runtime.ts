/** Cloudflare Workers（workerd）上で動作しているか */
export function isCloudflareWorkersRuntime(): boolean {
  return globalThis.navigator?.userAgent === 'Cloudflare-Workers';
}
