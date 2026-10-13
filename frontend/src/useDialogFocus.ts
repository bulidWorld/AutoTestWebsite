import { nextTick, onBeforeUnmount, onMounted, watch } from 'vue'

/** Keep keyboard focus inside a visible dialog and return it to its trigger. */
export function useDialogFocus(open: () => boolean) {
  let trigger: HTMLElement | null = null
  const dialog = () => Array.from(document.querySelectorAll<HTMLElement>('.overlay [role="dialog"]')).at(-1)
  const controls = (root: HTMLElement) => Array.from(root.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), summary, [tabindex="0"]')).filter(el => el.getClientRects().length > 0)
  watch(open, async value => {
    if (value) {
      if (!trigger) rememberTrigger()
      await nextTick()
      const root = dialog()
      if (root) {
        root.tabIndex = -1
        const initial = root.querySelector<HTMLElement>('[autofocus], input:not(:disabled), select:not(:disabled)')
        ;(initial || controls(root)[0] || root).focus()
      }
    } else {
      const previous = trigger; trigger = null
      await nextTick()
      if (!open() && previous?.isConnected) previous.focus()
    }
  })
  function rememberTrigger() { trigger = document.activeElement instanceof HTMLElement && document.activeElement !== document.body ? document.activeElement : null }
  function trap(event: KeyboardEvent) {
    if (!open() || event.key !== 'Tab') return
    const root = dialog()
    if (!root) return
    const items = controls(root), first = items[0], last = items.at(-1)
    if (!first) { event.preventDefault(); root.focus(); return }
    if (event.shiftKey && (document.activeElement === first || !root.contains(document.activeElement))) { event.preventDefault(); last?.focus() }
    else if (!event.shiftKey && (document.activeElement === last || !root.contains(document.activeElement))) { event.preventDefault(); first.focus() }
  }
  onMounted(() => document.addEventListener('keydown', trap))
  onBeforeUnmount(() => document.removeEventListener('keydown', trap))
  return rememberTrigger
}
