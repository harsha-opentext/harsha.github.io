// btoa(unescape(encodeURIComponent(str))) — handles multi-byte characters
export function encodeBase64(str: string): string {
  return btoa(unescape(encodeURIComponent(str)));
}

// decodeURIComponent(escape(atob(b64))) — handles multi-byte characters
export function decodeBase64(b64: string): string {
  return decodeURIComponent(escape(atob(b64.replace(/\s/g, ''))));
}
