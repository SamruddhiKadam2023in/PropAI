// Browser tests: Account page (profile + change password) and Manager activate / deactivate. Normal or test mode.
import { chromium } from 'playwright-core'
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync, spawnSync } from 'node:child_process'

const BASE = process.env.BASE || 'http://localhost:3000', API = process.env.API || 'http://localhost:8000'
const BROWSER = process.env.BROWSER_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const OUT = path.resolve('shots/account'); fs.mkdirSync(OUT, { recursive: true })
const src = fs.readFileSync('audit.mjs', 'utf8')
const auditFn = new Function('return ' + src.match(/const auditFn = (\(\) => \{[\s\S]*?\r?\n\})\r?\n\r?\nconst browser/)[1])()
const results = []
const check = (name, ok, detail = '') => { results.push(!!ok); console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail !== '' ? `  [${String(detail).slice(0, 200)}]` : '')) }
const pg = (sql) => execFileSync('docker', ['exec', '-i', 'property_postgres', 'psql', '-U', 'postgres', '-d', 'property_management', '-At'], { encoding: 'utf8', input: sql }).trim()
const rd = (...a) => spawnSync('docker', ['exec', 'property_redis', 'redis-cli', ...a], { encoding: 'utf8' }).stdout.trim()
const post = async (url, body, tok) => { const r = await fetch(API + url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(tok ? { Authorization: `Bearer ${tok}` } : {}) }, body: JSON.stringify(body) }); return { status: r.status, body: await r.json().catch(() => null) } }

const PW = 'AcctUi-Pass-1', NEW = 'AcctUi-Pass-2'
const E = { ten: 'acctui_ten@example.com', dev: 'acctui_dev@example.com', mgr2: 'acctui_mgr2@example.com' }
const BASEU = pg('select count(*) from users')
const browser = await chromium.launch({ executablePath: BROWSER, headless: true })
const sessions = []
async function session({ theme = 'light', viewport = { width: 1440, height: 1000 } } = {}) {
  const ctx = await browser.newContext({ viewport, colorScheme: theme })
  await ctx.addInitScript((t) => { if (!sessionStorage.getItem('seeded')) { localStorage.setItem('propai-theme', t); sessionStorage.setItem('seeded', '1') } }, theme)
  const page = await ctx.newPage()
  const log = { errs: [], failed: [] }
  page.on('pageerror', (e) => log.errs.push(e.message.slice(0, 200)))
  page.on('console', (m) => { if (m.type() === 'error') log.errs.push(m.text().slice(0, 100) + ' @ ' + (m.location().url || '').replace(BASE, '')) })
  page.on('response', (r) => { if (r.status() >= 500) log.failed.push(`${r.status()} ${new URL(r.url()).pathname}`) })
  const s = { ctx, page, log }; sessions.push(s); return s
}
const toastText = async (p) => (await p.locator('[role=status]').allInnerTexts()).join(' | ')
const overflow = (p) => p.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1)
const ls = (p, k) => p.evaluate((key) => localStorage.getItem(key), k)
const signIn = async (p, email, pw, expect) => {
  await p.goto(`${BASE}/login`, { waitUntil: 'networkidle' })
  await p.fill('input[type=email]', email); await p.fill('input[type=password]', pw)
  const [resp] = await Promise.all([p.waitForResponse((r) => r.url().includes('/auth/login')), p.locator('button[type=submit]').click()])
  if (expect) await p.waitForURL(`**${expect}`, { timeout: 15000 })
  return resp.status()
}

try {
  const mgrTok = (await post('/auth/login', { email: 'rajesh@propai.in', password: 'PropAI@2024' })).body.access_token
  for (const [k, role] of [['ten', 'tenant'], ['dev', 'tenant'], ['mgr2', 'manager']]) {
    const r = await post('/auth/users', { email: E[k], full_name: `Acct ${k}`, password: PW, role }, mgrTok)
    if (r.status !== 201) throw new Error(`setup failed for ${k}: ${r.status}`)
  }

  console.log('\n══ A. Profile ══')
  const A = await session()
  await signIn(A.page, E.ten, PW, '/tenant')
  const link = A.page.getByTestId('account-link')
  check('A1 the sidebar user card is a link labelled "Account settings"', (await link.count()) === 1 && (await link.getAttribute('aria-label')) === 'Account settings')
  await link.click(); await A.page.waitForURL('**/account')
  check('A2 it opens /account (inside the normal layout, sidebar still there)', (await A.page.getByRole('heading', { name: 'Account', exact: true }).count()) === 1 && (await A.page.getByRole('link', { name: 'Payments' }).count()) === 1)
  check('A3 email and role are shown but read-only', (await A.page.getByTestId('ac-email').inputValue()) === E.ten && (await A.page.getByTestId('ac-email').getAttribute('readonly')) !== null && (await A.page.getByTestId('ac-role').inputValue()) === 'Tenant')
  check('A4 "Save profile" is disabled until something changes', await A.page.getByTestId('save-profile').isDisabled())
  await A.page.getByTestId('ac-name').fill('   '); await A.page.getByTestId('save-profile').click()
  check('A5 a blank name is stopped in the form', /Enter your name/.test(await A.page.getByTestId('profile-error').innerText()))
  await A.page.getByTestId('ac-name').fill('Acct Renamed'); await A.page.getByTestId('ac-phone').fill('call me'); await A.page.getByTestId('save-profile').click()
  check('A6 an invalid phone is stopped in the form (nothing saved)', /valid phone/.test(await A.page.getByTestId('profile-error').innerText()) && pg(`select full_name from users where email='${E.ten}'`) === 'Acct ten')
  await A.page.getByTestId('ac-phone').fill('+91 98765 43210'); await A.page.getByTestId('save-profile').click()
  await A.page.waitForFunction(() => document.body.innerText.includes('Profile saved'))
  check('A7 valid changes save with a confirmation; the sidebar shows the new name at once', /Profile saved/.test(await toastText(A.page)) && /Acct Renamed/.test(await A.page.getByTestId('account-link').innerText()))
  check('A8 saved in the database', pg(`select full_name||'|'||phone from users where email='${E.ten}'`) === 'Acct Renamed|+91 98765 43210')
  await A.page.reload({ waitUntil: 'networkidle' })
  check('A9 still there after a reload', (await A.page.getByTestId('ac-name').inputValue()) === 'Acct Renamed' && (await A.page.getByTestId('ac-phone').inputValue()) === '+91 98765 43210')
  await A.page.getByTestId('ac-phone').fill(''); await A.page.getByTestId('save-profile').click()
  await A.page.waitForFunction(() => document.body.innerText.includes('Profile saved'))
  check('A10 an emptied phone is cleared (null in the database)', pg(`select coalesce(phone,'NULL') from users where email='${E.ten}'`) === 'NULL')
  await A.page.screenshot({ path: `${OUT}/account.png`, fullPage: true })

  console.log('\n══ B. Change password ══')
  const OTHER = await session(); await signIn(OTHER.page, E.ten, PW, '/tenant')
  const otherRefresh = await ls(OTHER.page, 'refresh_token')
  const fill = async (c, n, k) => { await A.page.getByTestId('ac-current').fill(c); await A.page.getByTestId('ac-new').fill(n); await A.page.getByTestId('ac-confirm').fill(k) }
  await A.page.getByTestId('save-password').click()
  check('B1 an empty current password is stopped in the form', /current password/.test(await A.page.getByTestId('password-error').innerText()))
  await fill(PW, 'short', 'short'); await A.page.getByTestId('save-password').click()
  check('B2 a new password under 8 characters is stopped in the form', /at least 8/.test(await A.page.getByTestId('password-error').innerText()))
  await fill(PW, PW, PW); await A.page.getByTestId('save-password').click()
  check('B3 a new password equal to the current one is stopped in the form', /different from your current/.test(await A.page.getByTestId('password-error').innerText()))
  await fill(PW, NEW, NEW + 'x'); await A.page.getByTestId('save-password').click()
  check("B4 mismatching confirmation is stopped in the form", /don't match/.test(await A.page.getByTestId('password-error').innerText()))
  await A.page.getByRole('button', { name: 'Show passwords' }).click()
  check('B5 the show/hide toggle reveals the fields', (await A.page.getByTestId('ac-new').getAttribute('type')) === 'text')
  await A.page.getByRole('button', { name: 'Hide passwords' }).click()
  await fill('not-my-password', NEW, NEW); await A.page.getByTestId('save-password').click()
  await A.page.getByText(/current password is incorrect/).waitFor({ timeout: 8000 })
  check('B6 a wrong current password shows the server message and does NOT log you out', A.page.url().endsWith('/account') && (await ls(A.page, 'token')) !== null)
  await fill(PW, NEW, NEW); await A.page.getByTestId('save-password').click()
  await A.page.waitForFunction(() => document.body.innerText.includes('other devices were signed out'))
  check('B7 success: confirmation shown, fields cleared, still signed in on /account', A.page.url().endsWith('/account') && (await A.page.getByTestId('ac-current').inputValue()) === '' && (await ls(A.page, 'refresh_token')) !== null)
  const S1 = await session(); check('B8 the OLD password is now refused', (await signIn(S1.page, E.ten, PW)) === 401)
  const S2 = await session(); check('B9 the NEW password signs in', (await signIn(S2.page, E.ten, NEW, '/tenant')) === 200)
  check('B10 the other device was signed out: its refresh token is revoked (401)', (await post('/auth/refresh', { refresh_token: otherRefresh })).status === 401)
  const stillWorks = await A.page.evaluate(async () => { const r = await fetch('http://localhost:8000/auth/me', { headers: { Authorization: `Bearer ${localStorage.getItem('token')}` } }); return r.status })
  check("B11 this device's new session works", stillWorks === 200)
  await A.page.getByRole('link', { name: 'Payments' }).click(); await A.page.getByRole('heading', { name: 'Payments', exact: true }).waitFor({ timeout: 15000 })
  check('B12 and the app keeps working (navigate to Payments)', A.page.url().endsWith('/tenant/payments'))

  console.log('\n══ C. Manager: deactivate / reactivate ══')
  const DEV = await session(); await signIn(DEV.page, E.dev, PW, '/tenant')
  const M = await session()
  await M.page.goto(`${BASE}/login`, { waitUntil: 'networkidle' })
  await M.page.getByText('rajesh@propai.in').click(); await M.page.locator('button[type=submit]').click()
  await M.page.waitForURL('**/manager', { timeout: 15000 })
  await M.page.getByRole('link', { name: 'Users & Roles' }).click()
  await M.page.getByTestId('user-row').first().waitFor({ timeout: 15000 })
  const row = (email) => M.page.locator(`[data-testid=user-row][data-email="${email}"]`)
  check('C1 the manager sees their own row marked "You" with no action button', /You/.test(await row('rajesh@propai.in').innerText()) && (await row('rajesh@propai.in').getByTestId('toggle-user').count()) === 0)
  check('C2 other users have a "Deactivate" button', (await row(E.dev).getByTestId('toggle-user').innerText()) === 'Deactivate')
  await row(E.dev).getByTestId('toggle-user').click()
  check('C3 a confirmation explains what will happen', /signed out immediately/.test(await M.page.getByTestId('toggle-explainer').innerText()))
  await M.page.getByRole('button', { name: 'Cancel' }).click(); await M.page.waitForTimeout(300)
  check('C4 Cancel changes nothing', pg(`select is_active from users where email='${E.dev}'`) === 't')
  await row(E.dev).getByTestId('toggle-user').click(); await M.page.getByTestId('confirm-toggle').click()
  await M.page.getByTestId('confirm-toggle').waitFor({ state: 'detached', timeout: 15000 }); await M.page.waitForTimeout(600)
  check('C5 confirming deactivates: row turns Inactive with a "Reactivate" button', (await row(E.dev).getAttribute('data-active')) === 'false' && (await row(E.dev).getByTestId('toggle-user').innerText()) === 'Reactivate' && /Inactive/.test(await row(E.dev).innerText()))
  await DEV.page.goto(`${BASE}/tenant/payments`, { waitUntil: 'networkidle' }); await DEV.page.waitForTimeout(800)
  check('C6 the deactivated person (already signed in elsewhere) is sent back to /login on their next action', new URL(DEV.page.url()).pathname === '/login' && (await ls(DEV.page, 'token')) === null, DEV.page.url())
  const DEV2 = await session()
  await signIn(DEV2.page, E.dev, PW)
  await DEV2.page.waitForFunction(() => document.body.innerText.includes('deactivated'))
  check('C7 signing in again says the account is deactivated', /Account is deactivated/.test(await toastText(DEV2.page)) && new URL(DEV2.page.url()).pathname === '/login')
  await row(E.dev).getByTestId('toggle-user').click()
  check('C8 the Reactivate dialog says they can sign in again', /sign in again/.test(await M.page.getByTestId('toggle-explainer').innerText()))
  await M.page.getByTestId('confirm-toggle').click(); await M.page.getByTestId('confirm-toggle').waitFor({ state: 'detached', timeout: 15000 }); await M.page.waitForTimeout(600)
  const DEV3 = await session()
  check('C9 after reactivation the person can sign in again', (await signIn(DEV3.page, E.dev, PW, '/tenant')) === 200 && (await row(E.dev).getAttribute('data-active')) === 'true')
  await M.page.screenshot({ path: `${OUT}/users.png`, fullPage: true })

  console.log('\n══ D. Look, themes, phones ══')
  for (const [sname, viewport] of [['desktop', { width: 1440, height: 900 }], ['tablet', { width: 820, height: 1100 }], ['mobile', { width: 390, height: 844 }], ['small', { width: 320, height: 640 }]]) {
    for (const theme of ['light', 'dark']) {
      const S = await session({ theme, viewport })
      await signIn(S.page, E.ten, NEW, '/tenant')
      await S.page.goto(`${BASE}/account`, { waitUntil: 'networkidle' }); await S.page.getByTestId('ac-name').waitFor()
      const f = await S.page.evaluate(auditFn), ovf = await overflow(S.page)
      check(`D ${sname}/${theme} account page: no overflow, WCAG contrast clean`, !ovf && f.length === 0, f.length ? JSON.stringify(f.slice(0, 2)) : `ovf=${ovf}`)
    }
  }
  const errs = sessions.flatMap((s) => s.log.errs).filter((e) => !/favicon|status of (400|401|403|429)/.test(e))
  check('E no uncaught errors / unexpected console errors (deliberate 4xx and the favicon excluded)', errs.length === 0, errs.slice(0, 3).join(' | '))
  check('E no 5xx responses', sessions.flatMap((s) => s.log.failed).length === 0)
} catch (err) {
  check('script completed without throwing', false, String(err.message).split('\n')[0])
} finally {
  for (const s of sessions) await s.ctx.close().catch(() => {})
  await browser.close()
  pg("delete from users where email like 'acctui\\_%'")
  for (const pat of ['login_fail:acctui*', 'rt*']) { if (pat === 'rt*') continue; const ks = rd('--scan', '--pattern', pat).split('\n').filter(Boolean); if (ks.length) rd('del', ...ks) }
  check('CLEANUP: user count back to baseline', pg('select count(*) from users') === BASEU)
  console.log(`\n${results.filter(Boolean).length}/${results.length} passed`)
  process.exit(results.every(Boolean) ? 0 : 1)
}
