export function resolveCacheBlockSize(
  isServerSide: boolean,
  requestedSize: number | undefined,
  pageSize: number,
): number | undefined {
  if (!isServerSide) return undefined;
  return requestedSize ?? pageSize;
}
