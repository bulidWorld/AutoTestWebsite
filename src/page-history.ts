export type PageLocation = Record<string, string>
export function readPageLocation(search: string): PageLocation {
  return Object.fromEntries(new URLSearchParams(search))
}
export function pageUrl(location: PageLocation, pathname = '/'): string {
  const query = new URLSearchParams(Object.entries(location).filter(([, value]) => value !== ''))
  return pathname + (query.size ? `?${query}` : '')
}
export function pageId(value?: string): number | undefined {
  if (!value || !/^[1-9]\d*$/.test(value)) return
  const id = Number(value)
  return Number.isSafeInteger(id) ? id : undefined
}
