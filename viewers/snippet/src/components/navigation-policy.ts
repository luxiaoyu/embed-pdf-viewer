export function isSafePreviewUri(uri: string): boolean {
  try {
    const protocol = new URL(uri).protocol;
    return protocol === 'http:' || protocol === 'https:';
  } catch {
    return false;
  }
}
