import { nextTick, onBeforeUnmount, onMounted, watch } from 'vue'
import { pageUrl, readPageLocation, type PageLocation } from './page-history.ts'

type Page = {
  capture: () => PageLocation
  restore: (location: PageLocation) => Promise<void>
  busy: () => boolean
  allow?: (location: PageLocation) => boolean
}
const pages = new Map<symbol, Page>()
let restoring = false
let scheduled = false
let started = false
let pending: PageLocation | undefined
function capture(): PageLocation {
  return Object.assign({}, ...Array.from(pages.values(), page => page.capture()))
}
function sync() {
  if (!started || restoring || scheduled) return
  scheduled = true
  void nextTick(() => {
    scheduled = false
    if (restoring || Array.from(pages.values()).some(page => page.busy())) return
    const url = pageUrl(capture(), window.location.pathname)
    if (url !== window.location.pathname + window.location.search) window.history.pushState(null, '', url)
  })
}
async function restore(location: PageLocation) {
  pending = location
  if (restoring) return
  restoring = true
  try {
    while (pending) {
      // A back/forward click during a request waits for that request to settle.
      while (Array.from(pages.values()).some(page => page.busy())) await new Promise(resolve => setTimeout(resolve, 25))
      const target = pending
      pending = undefined
      if (Array.from(pages.values()).some(page => page.allow && !page.allow(target))) {
        window.history.pushState(null, '', pageUrl(capture(), window.location.pathname))
        continue
      }
      // Parent restoration mounts the workspace before its restoration is visited.
      for (const page of pages.values()) {
        await page.restore(target)
        await nextTick()
        if (pending) break
      }
    }
  } finally { restoring = false }
}
const pop = () => { void restore(readPageLocation(window.location.search)) }
export const isRestoringHistory = () => restoring
export function usePageHistory(page: Page, root = false) {
  const id = Symbol()
  pages.set(id, page)
  watch(() => JSON.stringify([page.capture(), page.busy()]), sync, { flush: 'post' })
  onMounted(() => {
    if (root) {
      started = true
      window.addEventListener('popstate', pop)
      void restore(readPageLocation(window.location.search))
    }
  })
  onBeforeUnmount(() => {
    pages.delete(id)
    if (root) { window.removeEventListener('popstate', pop); started = false }
  })
}
