import { el, clear } from './ui.mjs'
import { LEVEL_NAMES, fmtUsd, fmtToken, vaultNo } from './market-view.mjs'
import { vaultLink } from './ecosystem.mjs'

export const vaultArt = level => level ? `/assets/vaults/level-${level}.jpg` : '/seal.png'
const captions = ['A beginning. In reinforced steel.', 'More weight. Same disposition.', 'The middle of the schedule. Nothing moderate about the door.', 'A substantial entry in the register.', 'The last level. The rules still apply.']
export function notice(message) {
  const dialog = document.querySelector('dialog[open]')
  let n = dialog?.querySelector('.dialog-feedback')
  if (dialog && !n) { n = el('p', { class: 'dialog-feedback', role: 'status' }); dialog.querySelector('.detail-share')?.after(n) }
  n ||= document.querySelector('#share-status')
  if (!n) return
  n.hidden = false; n.textContent = ''; requestAnimationFrame(() => { n.textContent = message })
  clearTimeout(notice.timer); notice.timer = setTimeout(() => { n.textContent = '' }, 6000)
}
export async function shareLink(path, title) {
  const url = new URL(path, location.origin).href
  try {
    if (navigator.share) await navigator.share({ title, url })
    else { await navigator.clipboard.writeText(url); notice('Link copied. The register is open to everyone.') }
  } catch (e) { if (e.name !== 'AbortError') notice('Sharing is unavailable here. Copy the page address from your browser.') }
}

export function showcase(out, levels, selected = 5, onBrowse = () => {}) {
  const draw = level => {
    const restoreFocus = out.contains(document.activeElement)
    clear(out)
    const l = levels.find(x => x.level === level)
    if (!l) return
    const buttons = el('div', { class: 'specimen-selector', role: 'group', 'aria-label': 'Choose a vault design' })
    for (const item of levels) buttons.append(el('button', { type: 'button', 'aria-pressed': String(item.level === level), 'aria-label': `Inspect Level ${LEVEL_NAMES[item.level - 1]}`, onclick: () => draw(item.level) }, LEVEL_NAMES[item.level - 1]))
    out.append(el('div', { class: 'specimen-top' }, el('span', {}, 'THE FIVE LEVELS'), el('span', {}, 'DESIGN SPECIMEN')),
      el('div', { class: 'specimen-art' }, el('img', { src: vaultArt(level), width: 720, height: 720, alt: `Level ${LEVEL_NAMES[level - 1]} vault design`, fetchpriority: 'high' })),
      el('div', { class: 'specimen-caption' }, el('div', {}, el('span', { class: 'eyebrow' }, 'Member bank vault'), el('h2', {}, `Level ${LEVEL_NAMES[level - 1]}`)), el('div', { class: 'specimen-weight' }, `${((level + 1) / 2).toFixed(1)}×`, el('span', {}, 'base payout weight vs. Level I'))),
      el('p', { class: 'specimen-line' }, captions[level - 1]), buttons,
      el('div', { class: 'specimen-bottom' }, el('button', { class: 'text-action', type: 'button', onclick: () => onBrowse(level) }, `Inspect Level ${LEVEL_NAMES[level - 1]} vaults ↓`),
        el('button', { class: 'icon-action', type: 'button', 'aria-label': `Share Level ${LEVEL_NAMES[level - 1]}`, onclick: () => shareLink(`/market/?level=${level}`, `Central Bank of Bitcoin · Level ${LEVEL_NAMES[level - 1]}`) }, 'Share'), el('button', { class: 'icon-action', type: 'button', 'aria-label': 'Download design specimen', title: 'Download design specimen', onclick: async () => { try { await downloadSpecimen(level) } catch { notice('The specimen could not be downloaded. Please try again.') } } }, 'Save image')))
    if (restoreFocus) out.querySelector('.specimen-selector button[aria-pressed="true"]')?.focus({ preventScroll: true })
  }
  draw(selected)
}

// An export of the public register only. No wallet identity or private order data.
export async function downloadVaultCard(v, generatedAt) {
  const art = new Image(); art.src = vaultArt(v.level); await art.decode()
  const canvas = document.createElement('canvas'); canvas.width = 1200; canvas.height = 800
  const c = canvas.getContext('2d')
  c.fillStyle = '#f4f0e5'; c.fillRect(0, 0, 1200, 800)
  c.fillStyle = '#293c31'; c.fillRect(0, 0, 1200, 108)
  c.fillStyle = '#f4f0e5'; c.font = '24px Georgia'; c.fillText('CENTRAL BANK OF BITCOIN', 50, 65)
  c.font = '17px monospace'; c.fillText('THE PUBLIC REGISTER', 905, 64)
  c.drawImage(art, 40, 160, 490, 490)
  c.fillStyle = '#293c31'; c.font = '20px monospace'; c.fillText(`LEVEL ${LEVEL_NAMES[v.level - 1] || 'NOT DRAWN'} / ${v.status.toUpperCase()}`, 585, 194)
  c.font = '70px Georgia'; c.fillText(vaultNo(v.no), 580, 282)
  const retired = v.status === 'opened', missing = retired && (!v.opened || v.opened.coverage === 'unavailable'), bare = v.opened?.coverage === 'bare_burn'
  c.font = '18px monospace'; c.fillText(missing ? 'RELEASE RECORD UNAVAILABLE' : bare ? 'RETIRED OUTSIDE REDEMPTION' : retired ? 'RELEASED RESERVES AT OPENING' : 'ESTIMATED RESERVES HELD', 585, 342)
  c.font = '54px Georgia'; c.fillText(missing ? 'Unavailable' : bare ? 'No payout' : fmtUsd(retired ? v.opened?.value_at_open_usd : v.value_usd), 580, 410, 560)
  c.font = '21px Georgia'
  const amounts = missing || bare ? null : retired ? v.opened?.paid : v.reserves
  if (amounts) for (const [i, [symbol, decimals]] of [['cbBTC', 8], ['GARY', 9], ['GIRAFFISH', 6]].entries()) c.fillText(`${fmtToken(amounts[symbol], decimals, 8)} ${symbol === 'cbBTC' ? symbol : '$' + symbol}`, 585, 474 + i * 38, 540)
  c.font = '17px Georgia'; c.fillText('Estimated token value, not a sale price or investment return.', 585, 619, 550)
  if(Date.now()/1000-generatedAt>1800){c.fillStyle='#a84726';c.font='16px monospace';c.fillText('DELAYED RETURN',585,655);c.fillStyle='#293c31'}
  c.strokeStyle = '#b9b7a8'; c.beginPath(); c.moveTo(40, 685); c.lineTo(1160, 685); c.stroke()
  c.font = '22px Georgia'; c.fillText('It cannot print. So it stacks.', 45, 735)
  c.font = '15px monospace'; c.fillText(`OBSERVED ${new Date(generatedAt * 1000).toLocaleString('en-US', { timeZone: 'America/Chicago' })} Austin time`, 650, 729)
  c.font = '16px monospace'; c.fillText('centralbankofbitcoin.com/market', 45, 767)
  c.font = '11px monospace'; c.fillText(v.asset, 650, 759)
  const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'))
  if (!blob) throw new Error('The card could not be generated.')
  const url = URL.createObjectURL(blob), a = el('a', { href: url, download: `CBOB-vault-${v.no}.png` })
  document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 30000)
  notice('Vault card downloaded. Share its permanent link alongside the image.')
}
export const shareVault = v => shareLink(vaultLink(v.asset), `CBOB Vault ${vaultNo(v.no)}`)

export function weightIllustration(out) {
  const pool = el('input', { type: 'range', min: 1000, max: 100000, step: 1000, value: 20000, 'aria-label': 'Illustrative payout pool in satoshis' }), amount = el('output', { class: 'weight-amount' }), bars = el('div', { class: 'weight-bars' })
  const draw = () => {
    amount.textContent = `${Number(pool.value).toLocaleString('en-US')} sats`
    clear(bars)
    for (let level = 1; level <= 5; level++) {
      const sats = Math.floor(Number(pool.value) * (level + 1) / 20), fill = el('span', { class: 'weight-fill' }); fill.style.width = `${(level + 1) / 6 * 100}%`
      bars.append(el('div', { class: 'weight-row' }, el('span', {}, `Level ${LEVEL_NAMES[level - 1]}`), el('div', { class: 'weight-track' }, fill), el('strong', {}, `${sats.toLocaleString('en-US')} sats`)))
    }
  }
  pool.addEventListener('input', draw); draw()
  out.append(el('div', { class: 'weight-intro' }, el('span', { class: 'eyebrow' }, 'Illustration / not a live payout'), el('h3', {}, 'Same payout. Different weight.'), el('p', {}, 'Move the pool. Watch the five levels divide it.'), el('label', {}, 'Pool to divide', amount, pool)), bars,
    el('p', { class: 'sub weight-disclosure' }, 'Illustration: one earning vault at each level, no boosts. Base weights 2, 3, 4, 5 and 6, totaling 20. Actual payouts depend on all participating weight; no payout amount is promised.'))
}

async function downloadSpecimen(level) {
  const art = new Image(); art.src = vaultArt(level); await art.decode()
  const canvas = document.createElement('canvas'); canvas.width = 1200; canvas.height = 800
  const c = canvas.getContext('2d')
  c.fillStyle = '#f4f0e5'; c.fillRect(0,0,1200,800)
  c.fillStyle = '#293c31'; c.fillRect(0,0,1200,100)
  c.fillStyle = '#f4f0e5'; c.font = '23px Georgia'; c.fillText('CENTRAL BANK OF BITCOIN',45,62)
  c.font = '18px monospace'; c.fillText('THE FIVE LEVELS',956,61)
  c.drawImage(art,40,145,550,550)
  c.fillStyle = '#293c31'; c.font = '20px monospace'; c.fillText('MEMBER BANK VAULT',640,205)
  c.font = '90px Georgia'; c.fillText(`Level ${LEVEL_NAMES[level-1]}`,635,315)
  c.fillStyle = '#a84726'; c.font = 'italic 65px Georgia'; c.fillText(`${((level+1)/2).toFixed(1)}× weight`,635,425)
  c.fillStyle = '#293c31'; c.font = '23px Georgia'; c.fillText('Base payout weight against Level I.',640,485)
  c.font = '19px Georgia'; c.fillText('The level is assigned on chain. It cannot be chosen.',640,535,505)
  c.strokeStyle = '#a84726'; c.lineWidth=2;c.strokeRect(640,588,420,64);c.font='21px monospace';c.fillText('DESIGN SPECIMEN / NOT ISSUED',661,628)
  c.font = '24px Georgia';c.fillText('It cannot print. So it stacks.',45,754)
  c.font = '17px monospace';c.fillText('centralbankofbitcoin.com/market',805,754)
  const blob = await new Promise(resolve => canvas.toBlob(resolve,'image/png'));if(!blob)throw new Error('No image')
  const url=URL.createObjectURL(blob),a=el('a',{href:url,download:`CBOB-Level-${LEVEL_NAMES[level-1]}-specimen.png`});document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),30000)
  notice('Specimen downloaded. This design card does not represent ownership.')
}

/** A public balance sheet to take away. Never includes a signed-in identity. */
export async function downloadBankCard(index) {
  const art = new Image(); art.src = vaultArt(5); await art.decode()
  const canvas = document.createElement('canvas'); canvas.width=1200;canvas.height=800
  const c=canvas.getContext('2d');c.fillStyle='#f4f0e5';c.fillRect(0,0,1200,800)
  c.fillStyle='#293c31';c.fillRect(0,0,1200,105);c.fillStyle='#f4f0e5';c.font='24px Georgia';c.fillText('CENTRAL BANK OF BITCOIN',45,64);c.font='17px monospace';c.fillText('THE BANK / ON THE RECORD',875,64)
  c.drawImage(art,40,150,470,470);c.fillStyle='#293c31';c.font='16px monospace';c.fillText('LEVEL V DESIGN SPECIMEN / NOT AN ISSUED VAULT',40,650)
  c.font='20px monospace';c.fillText('HELD ACROSS ALL LIVE VAULTS',570,190)
  c.font=index.totals.value_usd===null?'42px Georgia':'80px Georgia';c.fillText(index.totals.value_usd===null?'Valuation unavailable':fmtUsd(index.totals.value_usd),565,290,590)
  c.font='20px Georgia';c.fillText('Estimated reserve value. Not a sale price.',570,340)
  if(Date.now()/1000-index.generated_at>1800){c.fillStyle='#a84726';c.font='18px monospace';c.fillText('DELAYED RETURN',570,377);c.fillStyle='#293c31'}
  for (const [i,[label,n]] of [['ISSUED',index.totals.minted],['LIVE',index.totals.live],['RETIRED',index.totals.opened]].entries()) {
    c.font='17px monospace';c.fillText(label,570+i*200,430);c.font='48px Georgia';c.fillText(Number(n).toLocaleString('en-US'),570+i*200,494,180)
  }
  c.font='italic 35px Georgia';c.fillStyle='#a84726';c.fillText('It cannot print. So it stacks.',570,590)
  c.strokeStyle='#b9b7a8';c.beginPath();c.moveTo(40,688);c.lineTo(1160,688);c.stroke();c.fillStyle='#293c31';c.font='18px monospace';c.fillText('centralbankofbitcoin.com/market',40,740)
  c.font='14px monospace';c.fillText(`OBSERVED ${new Date(index.generated_at*1000).toLocaleString('en-US', { timeZone: 'America/Chicago' })} Austin time`,700,738)
  const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));if(!blob)throw new Error('The Bank card could not be generated.')
  const url=URL.createObjectURL(blob),a=el('a',{href:url,download:'CBOB-Bank-on-the-record.png'});document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),30000)
  notice('Bank card downloaded. The observation time is printed on the card.')
}
