/** The soft page preview stays bounded; viewport tiles provide the sharp image. */
export function boundedPreviewScale(width: number, height: number, dpr: number): number {
  const density = Math.max(1, dpr);
  return Math.min(
    0.5,
    8192 / (Math.max(width, height) * density),
    Math.sqrt((8 * 1024 * 1024) / (width * height * density * density)),
  );
}
