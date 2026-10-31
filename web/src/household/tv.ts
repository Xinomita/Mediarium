import { closestColumn, directionalIndex, type Direction } from './tvNavigation'

declare global {
  interface Window {
    tvRemote?: (key: string) => 'input' | undefined
    tvBack?: () => boolean
  }
}

// The native app and browser preview run exactly the same TV interface.
const requested = new URLSearchParams(location.search).get('tv')
let remembered = false
try {
  if (requested !== null) sessionStorage.setItem('mediarium-tv-preview', requested === '1' ? '1' : '0')
  remembered = sessionStorage.getItem('mediarium-tv-preview') === '1'
} catch { /* Preview also works when browser storage is unavailable. */ }
const enabled = /MediariumTV\//.test(navigator.userAgent) || requested === '1' || remembered
if (enabled) {
  document.documentElement.dataset.tv = 'true'
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install, { once: true })
  else install()
}

function install() {
  const selector = 'a[href],button,input:not([type=hidden]),select,textarea,summary,[tabindex]:not([tabindex="-1"])'
  const rowSelector = '[data-tv-row],.hh-rail'
  const isControl = (e: Element): e is HTMLElement => e instanceof HTMLElement
  const visible = (e: HTMLElement) => !e.matches(':disabled,[aria-hidden=true]') && !e.closest('[inert]') &&
    e.getClientRects().length > 0 && getComputedStyle(e).visibility !== 'hidden' &&
    !e.matches('.hh-brand,.hh-skip,.hh-rail-track')
  const scope = () => document.querySelector<HTMLDialogElement>('dialog[open]') || document
  const controls = (root: ParentNode = scope()) => Array.from(root.querySelectorAll(selector)).filter(isControl).filter(visible)
  const cards = (root: ParentNode) => Array.from(root.querySelectorAll<HTMLElement>('[data-tv-card],.hh-title-card')).filter(visible)
  const route = () => location.pathname.endsWith('/search') ? location.pathname : location.pathname + location.search.replace(/([?&])tv=[01]&?/, '$1').replace(/[?&]$/, '')
  const memory = new Map<string, { key: string; row: string; href: string; y: number; rows: [string, number][] }>()
  const rememberedRow = new Map<string, string>()
  let lastRoute = route()
  let contentInitialized = false
  let lastContent: HTMLElement | null = null
  let lastDialog: HTMLDialogElement | null = null
  let dialogReturn: HTMLElement | null = null
  let scheduled = false
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)')
  const animations = new Map<Window | HTMLElement, { frame: number; x: number; y: number }>()

  function moveScroll(target: Window | HTMLElement, x: number, y: number, instant = false) {
    const running = animations.get(target)
    if (running && Math.abs(running.x - x) < 1 && Math.abs(running.y - y) < 1) return
    if (running) cancelAnimationFrame(running.frame)
    const fromX = target === window ? scrollX : (target as HTMLElement).scrollLeft
    const fromY = target === window ? scrollY : (target as HTMLElement).scrollTop
    const apply = (px: number, py: number) => target.scrollTo({ left: px, top: py, behavior: 'instant' })
    if (instant || reducedMotion.matches || Math.abs(x - fromX) + Math.abs(y - fromY) < 2) {
      animations.delete(target); apply(x, y); return
    }
    const start = performance.now()
    const record = { frame: 0, x, y }
    const tick = (time: number) => {
      const t = Math.min(1, (time - start) / 160)
      const eased = 1 - Math.pow(1 - t, 3)
      apply(fromX + (x - fromX) * eased, fromY + (y - fromY) * eased)
      if (t < 1) record.frame = requestAnimationFrame(tick)
      else animations.delete(target)
    }
    record.frame = requestAnimationFrame(tick)
    animations.set(target, record)
  }

  function saveFocus(e: HTMLElement) {
    if (e.closest('.hh-header,dialog')) return
    lastContent = e
    const row = e.closest<HTMLElement>(rowSelector)
    if (row && e.dataset.tvCard) rememberedRow.set(row.dataset.tvRow || row.getAttribute('aria-label') || '', e.dataset.tvCard)
    memory.set(lastRoute, {
      key: e.dataset.tvCard || '', row: row?.dataset.tvRow || '', href: e.getAttribute('href') || '', y: scrollY,
      rows: memory.get(lastRoute)?.rows || [],
    })
  }

  function reveal(e: HTMLElement, instant = false) {
    if (e.closest('.hh-header')) return
    const track = e.closest<HTMLElement>('.hh-rail-track,.hh-cast-track,.hh-trailer-options,.hh-feature-picker')
    if (track) {
      const r = e.getBoundingClientRect(), p = track.getBoundingClientRect()
      const pad = Math.max(12, e.offsetWidth * .06)
      let x = animations.get(track)?.x ?? track.scrollLeft
      if (r.left < p.left + pad) x = track.scrollLeft + r.left - p.left - pad
      else if (r.right > Math.min(p.right, innerWidth) - pad) x = track.scrollLeft + r.right - Math.min(p.right, innerWidth) + pad
      moveScroll(track, Math.max(0, Math.min(x, track.scrollWidth - track.clientWidth)), 0, instant)
    }
    const dialog = e.closest<HTMLDialogElement>('dialog')
    if (dialog) {
      const r = e.getBoundingClientRect(), p = dialog.getBoundingClientRect()
      if (r.top < p.top + 12 || r.bottom > p.bottom - 12) e.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: instant ? 'instant' : 'smooth' })
      return
    }
    const row = e.closest<HTMLElement>(rowSelector)
    const r = (row || e).getBoundingClientRect()
    const margin = Math.max(24, innerHeight * .06)
    let y = scrollY
    if (row && row.matches('.hh-hero')) y = 0
    else if (row && r.height < innerHeight - margin * 2) {
      if (r.top < margin || r.bottom > innerHeight - margin) y += r.top - margin
    } else {
      const card = e.getBoundingClientRect()
      if (card.top < margin) y += card.top - margin
      else if (card.bottom > innerHeight - margin) y += card.bottom - innerHeight + margin
    }
    moveScroll(window, 0, Math.max(0, Math.min(y, document.documentElement.scrollHeight - innerHeight)), instant)
  }

  function focus(e: HTMLElement | undefined | null, instant = false) {
    if (!e || !visible(e)) return
    e.focus({ preventScroll: true })
    reveal(e, instant)
  }

  function primary(root: ParentNode = document): HTMLElement | undefined {
    const preferred = root.querySelector<HTMLElement>('.hh-discovery-hero .hh-feature-open') || root.querySelector<HTMLElement>('.hh-detail-hero .hh-primary,.hh-detail-hero .hh-actions > button,.hh-primary')
    if (preferred && visible(preferred)) return preferred
    const list = controls(root)
    return list.find(e => e.matches('input:not([type=checkbox]):not([type=range])')) || cards(root)[0] || list.find(e => !e.closest('.hh-header')) || list[0]
  }

  function ensure() {
    const nextRoute = route()
    const changed = nextRoute !== lastRoute
    if (changed) {
      lastRoute = nextRoute
      contentInitialized = false
      // React's route layout effect resets scroll. Restore after its DOM has committed.
      if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
      lastContent = null
    }
    const dialog = document.querySelector<HTMLDialogElement>('dialog[open]')
    if (dialog !== lastDialog) {
      if (dialog) {
        dialogReturn = lastContent
        lastDialog = dialog
        focus(dialog.querySelector<HTMLElement>('[data-tv-primary]') || primary(dialog))
      } else {
        lastDialog = null
        if (dialogReturn?.isConnected) { focus(dialogReturn); dialogReturn = null; return }
      }
    }
    if (!dialog && !contentInitialized) {
      if (document.querySelector('.hh-loading')) return
      const initial = primary(document.querySelector('main') || document)
      if (!initial || initial.closest('.hh-header')) return
      const saved = memory.get(lastRoute)
      if (!saved) { focus(initial, true); contentInitialized = true; return }
      contentInitialized = true
    }
    const active = document.activeElement
    if (!changed && active instanceof HTMLElement && active !== document.body && active.isConnected && active.matches(selector) && visible(active) && (!dialog || dialog.contains(active))) return
    if (dialog) { focus(primary(dialog)); return }
    const saved = memory.get(lastRoute)
    if (saved) {
      const candidate = controls().find(e => saved.key ? e.dataset.tvCard === saved.key && (!saved.row || e.closest<HTMLElement>(rowSelector)?.dataset.tvRow === saved.row) : e.getAttribute('href') === saved.href)
      if (candidate) {
        for (const [name, x] of saved.rows) {
          const row = Array.from(document.querySelectorAll<HTMLElement>(rowSelector)).find(r => r.dataset.tvRow === name)
          const track = row?.querySelector<HTMLElement>('.hh-rail-track')
          if (track) moveScroll(track, x, 0, true)
        }
        moveScroll(window, 0, saved.y, true)
        focus(candidate, true); return
      }
    }
    // Wait through asynchronous discovery loading instead of grabbing the brand/nav.
    if (document.querySelector('.hh-loading')) return
    focus(primary(), true)
  }

  function headerControls(header: Element) {
    const menu = header.querySelector('details[open] .hh-account-menu')
    if (menu) return controls(menu)
    return [header.querySelector<HTMLElement>('.hh-account summary'), header.querySelector<HTMLElement>('.hh-nav-actions > a[href$="/search"]'), ...Array.from(header.querySelectorAll<HTMLElement>('.hh-nav > a')), header.querySelector<HTMLElement>('.hh-nav-actions > a[href$="/downloads"]')].filter((e): e is HTMLElement => !!e && visible(e))
  }
  function sidebar() {
    const header = document.querySelector('.hh-header')
    if (!header) return
    const list = headerControls(header)
    focus(list.find(e => e.matches('.hh-nav a.active')) || list[0])
  }

  function directional(key: Direction, active: HTMLElement) {
    const dialog = active.closest('dialog[open]')
    const header = active.closest('.hh-header')
    if (header && !dialog) {
      const list = headerControls(header)
      if (key === 'right') { focus(lastContent?.isConnected ? lastContent : primary(document.querySelector('main') || document)); return }
      if (key === 'left') return
      const index = list.indexOf(active)
      focus(list[Math.max(0, Math.min(list.length - 1, index + (key === 'up' ? -1 : 1)))])
      return
    }
    const row = active.closest<HTMLElement>(rowSelector)
    const track = active.closest<HTMLElement>('.hh-rail-track,.hh-cast-track,.hh-trailer-options,.hh-feature-picker')
    if (track && active.matches('[data-tv-card],.hh-title-card,.hh-cast-member')) {
      if (key === 'left' || key === 'right') {
        const sibling = key === 'left' ? active.previousElementSibling : active.nextElementSibling
        const target = sibling instanceof HTMLElement ? sibling : null
        if (target) focus(target)
        else if (key === 'left') sidebar()
        return
      }
    }
    if (row?.matches('.hh-hero')) {
      if (key === 'down' && row.matches('.hh-discovery-hero') && active.closest('.hh-actions')) { const choice = row.querySelector<HTMLElement>('.hh-feature-choice[aria-current=true]'); if (choice) { focus(choice); return } }
      if (key === 'down' && active.matches('.hh-feature-title,.hh-detail-back')) { focus(controls(row.querySelector('.hh-actions') || row)[0]); return }
      if (key === 'up' && active.closest('.hh-actions')) { const back = row.querySelector<HTMLElement>('.hh-detail-back'); if (back) focus(back); else sidebar(); return }
    }
    if (row?.dataset.tvRow === 'featured-titles' && key === 'up') { focus(primary(row.closest('.hh-discovery-hero') || document)); return }
    // Explicit vertical content rows never compete with a fixed header or logo.
    if (!dialog && row && (key === 'up' || key === 'down') && !row.classList.contains('hh-rail-expanded') && !active.closest('.hh-shelf-grid')) {
      const rows = Array.from(document.querySelectorAll<HTMLElement>(rowSelector)).filter(visible)
      let index = rows.indexOf(row) + (key === 'up' ? -1 : 1)
      while (index >= 0 && index < rows.length) {
        const target = rows[index]
        const rowCards = cards(target)
        if (rowCards.length) {
          const old = rememberedRow.get(target.dataset.tvRow || target.getAttribute('aria-label') || '')
          const restored = rowCards.find(c => c.dataset.tvCard === old)
          const rect = active.getBoundingClientRect()
          focus(restored || rowCards[closestColumn(rect.left + rect.width / 2, rowCards.map(c => c.getBoundingClientRect()), innerWidth)])
          return
        }
        // Toolbar filters remain reachable laterally; don't stop vertical shelf browsing on them.
        if (!target.classList.contains('hh-discovery-toolbar')) { const next = primary(target); if (next) { focus(next); return } }
        index += key === 'up' ? -1 : 1
      }
      if (key === 'up') sidebar()
      return
    }
    const origin = active.getBoundingClientRect()
    const candidates = controls(dialog || document.querySelector('main') || document).filter(e => {
      if (e === active || e.closest('.hh-header')) return false
      if (key === 'left' || key === 'right') { const r = e.getBoundingClientRect(); return Math.min(r.bottom, origin.bottom) > Math.max(r.top, origin.top) }
      return true
    })
    const i = directionalIndex(active.getBoundingClientRect(), candidates.map(e => e.getBoundingClientRect()), key)
    if (i >= 0) focus(candidates[i])
    else if (!dialog && key === 'left') sidebar()
  }

  window.tvRemote = key => {
    const video = document.querySelector<HTMLVideoElement>('dialog[open] video')
    if (['playpause', 'play', 'pause'].includes(key)) {
      if (document.querySelector('dialog.hh-trailer-dialog[open]')) { document.dispatchEvent(new CustomEvent('mediarium-trailer-media', { detail: key })); return }
      if (video) {
        if (key === 'pause' || (key === 'playpause' && !video.paused)) video.pause()
        else void video.play().catch(() => undefined)
      }
      return
    }
    const player = document.querySelector<HTMLDialogElement>('dialog.hh-player[open]')
    if (player) {
      const hidden = player.dataset.controlsVisible === 'false'
      document.dispatchEvent(new Event('tv-activity'))
      if (hidden) { requestAnimationFrame(() => focus(player.querySelector<HTMLElement>('[data-tv-primary]'))); return }
    }
    if (!(document.activeElement instanceof HTMLElement) || !document.activeElement.matches(selector) || document.activeElement === document.body || route() !== lastRoute || !contentInitialized) ensure()
    const active = document.activeElement
    if (!(active instanceof HTMLElement)) return
    if (key === 'enter') {
      if (active.matches('input:not([type=range]):not([type=checkbox]):not([type=radio]),textarea')) { active.focus(); return 'input' }
      active.click(); return
    }
    if (!['up', 'down', 'left', 'right'].includes(key)) return
    if (active instanceof HTMLInputElement && active.type === 'range' && (key === 'left' || key === 'right')) {
      const next = Math.max(Number(active.min) || 0, Math.min(Number(active.max) || 100, Number(active.value) + (key === 'left' ? -10 : 10)))
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(active, String(next))
      active.dispatchEvent(new Event('input', { bubbles: true }))
      active.dispatchEvent(new Event('change', { bubbles: true }))
      active.dispatchEvent(new KeyboardEvent('keyup', { key: key === 'left' ? 'ArrowLeft' : 'ArrowRight', bubbles: true }))
      return
    }
    if (active instanceof HTMLSelectElement && (key === 'left' || key === 'right')) {
      active.selectedIndex = Math.max(0, Math.min(active.options.length - 1, active.selectedIndex + (key === 'left' ? -1 : 1)))
      active.dispatchEvent(new Event('change', { bubbles: true })); return
    }
    directional(key as Direction, active)
  }
  window.tvBack = () => {
    const dialog = document.querySelector<HTMLDialogElement>('dialog[open]')
    if (dialog) { dialog.dispatchEvent(new Event('cancel', { cancelable: true })); return true }
    const menu = document.querySelector<HTMLDetailsElement>('details[open]')
    if (menu) { menu.open = false; focus(menu.querySelector('summary')); return true }
    if (document.activeElement?.closest('.hh-header') && lastContent?.isConnected) { focus(lastContent); return true }
    if (location.pathname !== '/watch' || new URLSearchParams(location.search).has('kind')) {
      document.dispatchEvent(new Event('tv-navigate-back')); return true
    }
    return false
  }
  const keys: Record<string, string> = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right', Enter: 'enter', MediaPlayPause: 'playpause' }
  document.addEventListener('keydown', event => {
    if (event.altKey || event.ctrlKey || event.metaKey) return
    const active = document.activeElement
    const textInput = active?.matches('input:not([type=range]):not([type=checkbox]):not([type=radio]),textarea')
    if (textInput && ['ArrowLeft', 'ArrowRight', 'Enter', ' '].includes(event.key)) return
    if (event.key === 'Escape' || event.key === 'BrowserBack') {
      event.preventDefault()
      if (!window.tvBack?.()) history.back()
      return
    }
    const key = keys[event.key]
    if (key) { event.preventDefault(); window.tvRemote?.(key) }
  })
  document.addEventListener('click', event => { if (event.target instanceof Element) { const card = event.target.closest<HTMLElement>('[data-tv-card]'); if (card) { saveFocus(card); const saved = memory.get(lastRoute); if (saved) saved.rows = Array.from(document.querySelectorAll<HTMLElement>('.hh-rail-track')).map(t => [t.closest<HTMLElement>(rowSelector)?.dataset.tvRow || '', t.scrollLeft]); } } }, true)
  document.addEventListener('focusin', event => {
    if (event.target instanceof HTMLElement && visible(event.target)) {
      document.querySelector('[data-tv-focused]')?.removeAttribute('data-tv-focused')
      event.target.dataset.tvFocused = 'true'
      saveFocus(event.target)
    }
  })
  function schedule() {
    if (scheduled || document.hidden) return
    scheduled = true
    requestAnimationFrame(() => { scheduled = false; if (!contentInitialized || route() !== lastRoute || document.querySelector('dialog[open]') !== lastDialog || document.activeElement === document.body || !document.activeElement?.isConnected) ensure() })
  }
  new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['open', 'disabled', 'data-controls-visible'] })
  addEventListener('popstate', schedule)
  document.addEventListener('visibilitychange', () => { if (!document.hidden) schedule() })
  ensure()
}
