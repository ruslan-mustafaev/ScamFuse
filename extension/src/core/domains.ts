// Host helpers. Pure functions.

/** Host of an address without "www.", or "" for non-web addresses. */
export function hostOf(url: string | undefined | null): string {
  if (!url) return '';
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return '';
    return parsed.hostname.toLowerCase().replace(/^www\./, '').replace(/\.$/, '');
  } catch {
    return '';
  }
}

/** True when host equals one of the domains or is a subdomain of it. */
export function hostMatches(host: string, domains: readonly string[]): boolean {
  if (!host) return false;
  return domains.some((domain) => host === domain || host.endsWith(`.${domain}`));
}

/**
 * Makes a host safe to put into a chat message: messengers turn "evil.com" into a link,
 * "evil[.]com" stays plain text.
 */
export function defang(host: string): string {
  return host.replace(/\./g, '[.]');
}
