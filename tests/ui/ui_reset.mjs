// Browser tests: "Forgot password?" flow. Needs the backend in TEST MODE (codes in the log) - run through tests/run_all.py.
import { chromium } from 'playwright-core'
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync, spawnSync } from 'node:child_process'

const BASE = process.env.BASE || 'http://localhost:3000', API = process.env.API || 'http://localhost:8000'
const BROWSER = process.env.BROWSER_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const OUT = path.resolve('shots/reset'); fs.mkdirSync(OUT, { recursive: true })
const src = fs.readFileSync('audit.mjs', 'utf8')
const auditFn = new Function('return ' + src.match(/const auditFn = (\(\) => \{[\s\S]*?\r?\n\})\r?\n\r?\nconst browser/)[1])()
const results = []
const check = (name, ok, detail = '') => { results.push(!!ok); console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail !== '' ? `  [${String(detail).slice(0, 200)}]` : '')) }
const pg = (sql) => execFileSync('docker', ['exec', '-i', 'property_postgres', 'psql', '-U', 'postgres', '-d', 'property_management', '-At'], { encoding: 'utf8', input: sql }).trim()
const rd = (...a) => spawnSync('docker', ['exec', 'property_redis', 'redis-cli', ...a], { encoding: 'utf8' }).stdout.trim()
const codeFor = (email) => {
  const p = spawnSync('docker', ['logs', 'property_backend', '--since', '3m'], { encoding: 'utf8', maxBuffer: 512 * 1024 * 1024 })
  const m = [...(p.stdout + p.stderr).matchAll(new RegExp(`password reset code for ${email.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} is (\\d{6})`, 'g'))]
  return m.length ? m[m.length - 1][1] : null
}
const post = async (url, body, tok) => { const r = await fetch(API + url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(tok ? { Authorization: `Bearer ${tok}` } : {}) }, body: JSON.stringify(body) }); return { status: r.status, body: await r.json().catch(() => null) } }

const OLD = 'OldPass-12345', NEW = 'NewPass-67890'
const EMAIL = 'resetui_user@example.com'
const BASEU = pg('select count(*) from users')
const browser = await chromium.launch({ executablePath: BROWSER, headless: true })
const sessions = []
async function session({ theme = 'light', viewport = { width: 1280, height: 900 }, clock = false } = {}) {
  const ctx = await browser.newContext({ viewport, colorScheme: theme })
  await ctx.addInitScript((t) => { if (!sessionStorage.getItem('seeded')) { localStorage.setItem('propai-theme', t); sessionStorage.setItem('seeded', '1') } }, theme)
  const page = await ctx.newPage()
  const log = { errs: [], failed: [] }
  page.on('pageerror', (e) => log.errs.push(e.message.slice(0, 200)))
  page.on('console', (m) => { if (m.type() === 'error') log.errs.push(m.text().slice(0, 100) + ' @ ' + (m.location().url || '').replace(BASE, '')) })
  page.on('response', (r) => { if (r.status() >= 500) log.failed.push(`${r.status()} ${new URL(r.url()).pathname}`) })
  if (clock) await page.clock.install()
  const s = { ctx, page, log }; sessions.push(s); return s
}
const toastText = async (p) => (await p.locator('[role=status]').allInnerTexts()).join(' | ')
const overflow = (p) => p.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1)
const signIn = async (p, email, pw) => {
  await p.goto(`${BASE}/login`, { waitUntil: 'networkidle' })
  await p.fill('input[type=email]', email); await p.fill('input[type=password]', pw)
  const [resp] = await Promise.all([p.waitForResponse((r) => r.url().includes('/auth/login')), p.locator('button[type=submit]').click()])
  return resp.status()
}

try {
  const mgrTok = (await post('/auth/login', { email: 'rajesh@propai.in', password: 'PropAI@2024' })).body.access_token
  const made = await post('/auth/users', { email: EMAIL, full_name: 'Reset Ui', password: OLD, role: 'tenant' }, mgrTok)
  check('setup: a verified test account exists', made.status === 201, made.status)

  console.log('\n══ A. Getting there and asking for a code ══')
  const A = await session()
  await A.page.goto(`${BASE}/login`, { waitUntil: 'networkidle' })
  check('A1 the Login page has a "Forgot password?" link', (await A.page.getByTestId('forgot-link').count()) === 1)
  await A.page.getByTestId('forgot-link').click()
  await A.page.waitForURL('**/forgot-password')
  check('A2 it opens the forgot-password page (no session needed)', /Forgot your password/.test(await A.page.locator('h1').innerText()))
  await A.page.getByTestId('fp-send').click()
  check('A3 an empty / invalid email is stopped in the form', /valid email/.test(await A.page.getByTestId('fp-error').innerText()))
  await A.page.getByTestId('fp-email').fill('nobody-here-123@example.com'); await A.page.getByTestId('fp-send').click()
  await A.page.getByTestId('fp-intro').waitFor()
  const unknownIntro = (await A.page.getByTestId('fp-intro').innerText()).replace(/nobody-here-123@example.com/, 'X')
  check('A4 an UNKNOWN address goes to the same second step with the same wording (no account enumeration)', /If an account exists for X, we've sent it a 6-digit code/.test(unknownIntro), unknownIntro.slice(0, 90))
  await A.page.goto(`${BASE}/forgot-password`, { waitUntil: 'networkidle' })
  await A.page.getByTestId('fp-email').fill(EMAIL); await A.page.getByTestId('fp-send').click()
  await A.page.getByTestId('fp-intro').waitFor()
  check('A5 the real address gets the identical screen', (await A.page.getByTestId('fp-intro').innerText()).includes('If an account exists for'))
  check('A6 the resend link is disabled with a countdown', (await A.page.getByTestId('fp-resend').isDisabled()) && /Resend code in \d+s/.test(await A.page.getByTestId('fp-resend').innerText()))
  await A.page.screenshot({ path: `${OUT}/step2.png`, fullPage: true })

  console.log('\n══ B. Entering the code and a new password ══')
  await new Promise((r) => setTimeout(r, 600))
  const code = codeFor(EMAIL)
  check('B0 a reset code was issued for the real account only', !!code && !codeFor('nobody-here-123@example.com'))
  await A.page.getByTestId('fp-submit').click()
  check('B1 an empty code is stopped in the form', /6-digit code/.test(await A.page.getByTestId('fp-error').innerText()))
  await A.page.getByTestId('fp-code').fill(code); await A.page.getByTestId('fp-new').fill('short'); await A.page.getByTestId('fp-confirm').fill('short')
  await A.page.getByTestId('fp-submit').click()
  check('B2 a password under 8 characters is stopped in the form', /at least 8/.test(await A.page.getByTestId('fp-error').innerText()))
  await A.page.getByTestId('fp-new').fill(NEW); await A.page.getByTestId('fp-confirm').fill(NEW + 'x'); await A.page.getByTestId('fp-submit').click()
  check("B3 mismatching passwords are stopped in the form", /don't match/.test(await A.page.getByTestId('fp-error').innerText()))
  const wrong = code === '000000' ? '111111' : '000000'
  await A.page.getByTestId('fp-code').fill(wrong); await A.page.getByTestId('fp-confirm').fill(NEW); await A.page.getByTestId('fp-submit').click()
  await A.page.getByText(/attempts? left/).waitFor({ timeout: 8000 })
  check('B4 a wrong code shows the server message with attempts left, and clears the field', /4 attempts left/.test(await A.page.getByTestId('fp-error').innerText()) && (await A.page.getByTestId('fp-code').inputValue()) === '')
  check('B5 the password was NOT changed by the failed attempt', (await signIn((await session()).page, EMAIL, OLD)) === 200)
  await A.page.getByTestId('fp-code').fill(code)
  await A.page.getByTestId('fp-submit').click()
  await A.page.waitForURL('**/login', { timeout: 15000 })
  check('B6 the right code + a valid password updates it and returns to Sign in with a confirmation', /Password updated/.test(await toastText(A.page)), (await toastText(A.page)).slice(0, 80))

  console.log('\n══ C. Old password dead, new password works, sessions cleared ══')
  const C1 = await session(); check('C1 the OLD password is now refused (401)', (await signIn(C1.page, EMAIL, OLD)) === 401)
  const C2 = await session(); const st = await signIn(C2.page, EMAIL, NEW)
  await C2.page.waitForURL('**/tenant', { timeout: 15000 })
  check('C2 the NEW password signs in and lands on the tenant dashboard', st === 200 && C2.page.url().endsWith('/tenant'))
  const rtBefore = await C2.page.evaluate(() => localStorage.getItem('refresh_token'))
  // a second reset kills existing sessions
  await A.page.goto(`${BASE}/forgot-password`, { waitUntil: 'networkidle' })
  rd('del', `pwreset_cd:${EMAIL}`)
  await A.page.getByTestId('fp-email').fill(EMAIL); await A.page.getByTestId('fp-send').click(); await A.page.getByTestId('fp-intro').waitFor()
  await new Promise((r) => setTimeout(r, 600))
  await A.page.getByTestId('fp-code').fill(codeFor(EMAIL)); await A.page.getByTestId('fp-new').fill('Third-Pass-999'); await A.page.getByTestId('fp-confirm').fill('Third-Pass-999')
  await A.page.getByTestId('fp-submit').click(); await A.page.waitForURL('**/login')
  check('C3 resetting again signs out the other browser: its refresh token is revoked (401)', (await post('/auth/refresh', { refresh_token: rtBefore })).status === 401)

  console.log('\n══ D. Resend countdown (fake clock) ══')
  const D = await session({ clock: true })
  await D.page.goto(`${BASE}/forgot-password`, { waitUntil: 'networkidle' })
  rd('del', `pwreset_cd:${EMAIL}`, `pwreset_sent:${EMAIL}`)
  await D.page.getByTestId('fp-email').fill(EMAIL); await D.page.getByTestId('fp-send').click(); await D.page.getByTestId('fp-intro').waitFor()
  await D.page.clock.runFor(30000)
  check('D1 after 30 s it still counts down', /Resend code in (2\d|30)s/.test(await D.page.getByTestId('fp-resend').innerText()))
  await D.page.clock.runFor(31000)
  check('D2 after 60 s "Resend code" is enabled', !(await D.page.getByTestId('fp-resend').isDisabled()))
  rd('del', `pwreset_cd:${EMAIL}`)
  await D.page.getByTestId('fp-resend').click(); await D.page.waitForTimeout(700)
  check('D3 resending restarts the countdown and confirms', /Resend code in \d+s/.test(await D.page.getByTestId('fp-resend').innerText()) && /new code is on its way/.test(await toastText(D.page)))
  const E = await session()
  await E.page.goto(`${BASE}/forgot-password`, { waitUntil: 'networkidle' })
  await E.page.getByTestId('fp-email').fill(EMAIL); await E.page.getByTestId('fp-send').click(); await E.page.waitForTimeout(700)
  check('D4 asking again inside the cooldown shows the server message, not a crash', /wait \d+ seconds/.test(await E.page.getByTestId('fp-error').innerText()))

  console.log('\n══ E. Look, themes, phones ══')
  for (const [sname, viewport] of [['desktop', { width: 1440, height: 900 }], ['mobile', { width: 390, height: 844 }], ['small', { width: 320, height: 640 }]]) {
    for (const theme of ['light', 'dark']) {
      const S = await session({ theme, viewport })
      await S.page.goto(`${BASE}/forgot-password`, { waitUntil: 'networkidle' })
      const f = await S.page.evaluate(auditFn); const ovf = await overflow(S.page)
      const btn = await S.page.getByTestId('fp-send').boundingBox()
      check(`E ${sname}/${theme} step 1: no overflow, button inside viewport, WCAG contrast clean`, !ovf && btn && btn.x >= 0 && btn.x + btn.width <= viewport.width && f.length === 0, f.length ? JSON.stringify(f.slice(0, 2)) : `ovf=${ovf}`)
      rd('del', 'pwreset_cd:nobody-here-123@example.com', 'pwreset_sent:nobody-here-123@example.com')
      await S.page.getByTestId('fp-email').fill('nobody-here-123@example.com'); await S.page.getByTestId('fp-send').click(); await S.page.getByTestId('fp-intro').waitFor()
      const f2 = await S.page.evaluate(auditFn); const ovf2 = await overflow(S.page)
      check(`E ${sname}/${theme} step 2: no overflow, WCAG contrast clean`, !ovf2 && f2.length === 0, f2.length ? JSON.stringify(f2.slice(0, 2)) : `ovf=${ovf2}`)
    }
  }
  const errs = sessions.flatMap((s) => s.log.errs).filter((e) => !/favicon|status of (400|401|403|422|429)/.test(e))
  check('F no uncaught errors / unexpected console errors (deliberate 4xx and the favicon excluded)', errs.length === 0, errs.slice(0, 3).join(' | '))
  check('F no 5xx responses', sessions.flatMap((s) => s.log.failed).length === 0)
} catch (err) {
  check('script completed without throwing', false, String(err.message).split('\n')[0])
} finally {
  for (const s of sessions) await s.ctx.close().catch(() => {})
  await browser.close()
  pg("delete from users where email like 'resetui\\_%'")
  for (const pat of ['pwreset*resetui*', 'pwreset*nobody-here*', 'login_fail:resetui*', 'otp*resetui*']) { const ks = rd('--scan', '--pattern', pat).split('\n').filter(Boolean); if (ks.length) rd('del', ...ks) }
  check('CLEANUP: user count back to baseline', pg('select count(*) from users') === BASEU)
  console.log(`\n${results.filter(Boolean).length}/${results.length} passed`)
  process.exit(results.every(Boolean) ? 0 : 1)
}
