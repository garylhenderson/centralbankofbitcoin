/**
 * DOM helpers. Every piece of chain data is inserted as TEXT (textContent),
 * never as HTML: a vault's name and picture link are chosen by whoever minted
 * it (SPEC item 57), so they are untrusted input.
 */
export const $ = sel => document.querySelector(sel)

export function el(tag, attrs = {}, ...kids) {
  const e = document.createElement(tag)
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === null || v === undefined || v === false) continue
    if (k === 'class') e.className = v
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v)
    else e.setAttribute(k, v === true ? '' : String(v))
  }
  // House rule for anything a holder reads: no em dash. Text from the shared
  // Bank modules (alarm details, coverage reasons) is rewritten on the way in.
  for (const c of kids.flat()) if (c !== null && c !== undefined && c !== false)
    e.append(c instanceof Node ? c : document.createTextNode(String(c).replace(/\s*\u2014\s*/g, ': ')))
  return e
}

export const clear = n => { while (n.firstChild) n.removeChild(n.firstChild); return n }

/** A full address, wrapped to fit a phone, with a copy button. */
export function addr(a, label = 'Copy') {
  const s = String(a)
  const b = el('button', { class: 'copy', type: 'button', onclick: async () => {
    try { await navigator.clipboard.writeText(s); b.textContent = 'Copied' } catch { b.textContent = 'Select and copy' }
    setTimeout(() => { b.textContent = label }, 1600)
  } }, label)
  return el('span', { class: 'addr' }, el('code', {}, s), b)
}

export const box = (kind, ...kids) => el('div', { class: `box ${kind}`, role: kind === 'refuse' ? 'alert' : null }, ...kids)

export function amount(raw, decimals) {
  const n = BigInt(raw)
  if (decimals === undefined || decimals === null) return `${n} (base units)`
  const d = BigInt(decimals), s = 10n ** d
  const whole = n / s, frac = (n % s).toString().padStart(Number(d), '0').replace(/0+$/, '')
  return `${whole.toLocaleString('en-US')}${frac ? '.' + frac : ''}`
}

export const LEVELS = ['I', 'II', 'III', 'IV', 'V']

/** A button that disables itself while its action runs and shows any error. */
export function action(label, run, { kind = 'primary', out } = {}) {
  const b = el('button', { class: `btn ${kind}`, type: 'button' }, label)
  b.addEventListener('click', async () => {
    b.disabled = true
    try { await run(b) } catch (e) {
      const msg = String(e?.message || e).replace(/\s*\u2014\s*/g, ': ')
      ;(out || b.parentElement).append(box('refuse', msg, e?.link ? el('p', {}, el('a', { class: 'btn', href: e.link }, 'Open this page in Phantom')) : null))
    } finally { b.disabled = false }
  })
  return b
}

export const getParam = k => { try { return new URL(location.href).searchParams.get(k) } catch { return null } }
