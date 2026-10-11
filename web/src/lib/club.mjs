/** Same-origin Gary Club account bridge. No key or auth bearer reaches the browser. */
export let clubSession = null
export async function readClubSession() {
  const r = await fetch('/club/session?v=2', { credentials: 'same-origin', cache: 'no-store' })
  if (r.status === 401) { clubSession = null; return null }
  if (!r.ok) throw new Error('Gary Club account access is temporarily unavailable.')
  const data = await r.json()
  clubSession = data.signedIn === false ? null : data
  return clubSession
}
export async function clubRequest(action, body = {}) {
  if (!clubSession) await readClubSession()
  if (!clubSession) throw new Error('Sign in with your Gary Club account to continue.')
  const r = await fetch(`/club/${action}`, { method: 'POST', credentials: 'same-origin', cache: 'no-store',
    headers: { 'Content-Type': 'application/json', 'X-CBOB-CSRF': clubSession.csrf }, body: JSON.stringify(body) })
  const data = await r.json().catch(() => { throw new Error('The Bank could not return a readable response. Check your account record before repeating an action.') })
  if (!r.ok) throw new Error(data.error || 'This request could not be completed.')
  return data
}
export const signInLink = (next = '/account/', signup = false) => `/club/start?next=${encodeURIComponent(next)}${signup ? '&intent=signup' : ''}`
