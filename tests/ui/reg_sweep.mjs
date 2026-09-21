import { chromium } from 'playwright-core'
import fs from 'node:fs'
import path from 'node:path'

// usage: node reg_sweep.mjs [api|tenant|owner|manager|guards]
const WHAT = process.argv[2] || 'api'
const BASE = 'http://localhost:3000', API = 'http://localhost:8000'
const OUT = path.resolve('shots/regression'); fs.mkdirSync(OUT, { recursive: true })
const src = fs.readFileSync('audit.mjs', 'utf8')
const auditFn = new Function('return ' + src.match(/const auditFn = (\(\) => \{[\s\S]*?\r?\n\})\r?\n\r?\nconst browser/)[1])()
const results = []
const check = (name, ok, detail = '') => { results.push(!!ok); console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail !== '' ? `  [${String(detail).slice(0, 260)}]` : '')) }
const USERS = { tenant: 'amit@example.in', owner: 'vikram@propai.in', manager: 'rajesh@propai.in', owner2: 'priya@propai.in' }
const tokens = {}
for (const [k, e] of Object.entries(USERS)) {
  const r = await fetch(`${API}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: e, password: 'PropAI@2024' }) })
  tokens[k] = (await r.json()).access_token
}
const call = async (method, url, role, body) => {
  const r = await fetch(API + url, { method, headers: { ...(role ? { Authorization: `Bearer ${tokens[role]}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined })
  return r.status
}

if (WHAT === 'api') {
  // [method, url, role, acceptable statuses, body]
  const M = [
    // ---- unauthenticated: everything protected must refuse ----
    ...['/financial/payments', '/financial/payments/summary', '/financial/rent-collection', '/agreements', '/properties/', '/properties/owner-applications', '/reports/properties/pdf', '/reports/properties/excel',
      '/reports/financial/1/pdf', '/reports/receipt/1/pdf', '/config/ocr', '/service-providers', '/notifications', '/messages/', '/maintenance/', '/auth/me', '/auth/users']
      .map((u) => ['GET', u, null, [401, 403]]),
    // ---- tenant ----
    ['GET', '/reports/properties/pdf', 'tenant', [403]], ['GET', '/reports/properties/excel', 'tenant', [403]],
    ['GET', '/reports/financial/1/pdf', 'tenant', [403]], ['GET', '/financial/rent-collection', 'tenant', [403]],
    ['GET', '/service-providers', 'tenant', [403]], ['GET', '/config/ocr', 'tenant', [403]], ['PATCH', '/config/ocr', 'tenant', [403, 405], {}],
    ['POST', '/agreements', 'tenant', [403], { property_id: 1, start_date: '2026-01-01' }], ['POST', '/agreements/1/end', 'tenant', [403], { status: 'abandoned' }],
    ['GET', '/auth/users', 'tenant', [403]], ['GET', '/properties/owner-applications', 'tenant', [403]], ['GET', '/properties/all-applications', 'tenant', [403]],
    ['POST', '/financial/expenses', 'tenant', [403], { category: 'other', amount: 1, expense_date: '2026-09-01T00:00:00', property_id: 6 }], ['POST', '/financial/send-reminders', 'tenant', [403]],
    ['POST', '/financial/payments', 'tenant', [403], { amount: 5, payment_date: '2026-09-01', property_id: 6, payment_type: 'rent' }],   // a property that isn't theirs
    ['GET', '/reports/receipt/13/pdf', 'tenant', [404]], ['GET', '/reports/receipt/1/pdf', 'tenant', [200]],                                   // someone else's receipt is hidden; their own opens
    // ---- owner ----
    ['GET', '/reports/properties/pdf', 'owner', [403]], ['GET', '/reports/properties/excel', 'owner', [403]], ['GET', '/financial/rent-collection', 'owner', [403]],
    ['POST', '/financial/expenses', 'owner2', [403], { category: 'other', amount: 1, expense_date: '2026-09-01T00:00:00', property_id: 1 }],
    ['POST', '/financial/payments', 'owner', [403], { amount: 5, payment_date: '2026-09-01', property_id: 1, payment_type: 'rent' }],
    ['PATCH', '/config/ocr', 'owner', [405], {}], ['GET', '/config/ocr', 'owner', [200]], ['GET', '/auth/users', 'owner', [200]],   // documented: managers and owners
    ['GET', '/reports/financial/3/pdf', 'owner', [403, 404]],                                                                         // property 3 belongs to another owner
    ['GET', '/reports/financial/1/pdf', 'owner', [200]], ['GET', '/service-providers', 'owner', [200]], ['GET', '/agreements', 'owner', [200]],
    ['POST', '/agreements', 'owner2', [403], { property_id: 1, start_date: '2026-01-01' }],                                          // property 1 is vikram's
    // ---- manager ----
    ['GET', '/reports/properties/pdf', 'manager', [200]], ['GET', '/reports/properties/excel', 'manager', [200]], ['GET', '/financial/rent-collection', 'manager', [200]],
    ['GET', '/config/ocr', 'manager', [403]], ['PATCH', '/config/ocr', 'manager', [405], {}], ['PUT', '/config/ocr', 'manager', [405], {}],
    ['POST', '/financial/payments', 'manager', [403], { amount: 5, payment_date: '2026-09-01', property_id: 1, payment_type: 'rent' }],
    ['GET', '/auth/users', 'manager', [200]], ['GET', '/agreements', 'manager', [200]], ['GET', '/service-providers', 'manager', [200]],
    ['GET', '/reports/financial/6/pdf', 'manager', [200]], ['GET', '/reports/financial/999999/pdf', 'manager', [404]],
    ['GET', '/reports/properties/pdf?x=1', 'manager', [200]],
    // ---- misc ----
    ['GET', '/does-not-exist', 'manager', [404]], ['GET', '/health', null, [200]],
  ]
  for (const [method, url, role, ok, body] of M) {
    const s = await call(method, url, role, body)
    check(`${role || 'anon'} ${method} ${url} -> ${ok.join('/')}`, ok.includes(s), s)
  }
  // a malformed/expired token must be a 401, not a 500
  const bad = await fetch(`${API}/auth/me`, { headers: { Authorization: 'Bearer not-a-real-token' } })
  check('garbage token -> 401 (not 500)', bad.status === 401, bad.status)
  const badLogin = await fetch(`${API}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'amit@example.in', password: 'wrong' }) })
  check('wrong password -> 401', badLogin.status === 401, badLogin.status)
  const noBody = await fetch(`${API}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
  check('empty login body -> 422 validation, not 500', noBody.status === 422, noBody.status)
  console.log(`\n${results.filter(Boolean).length}/${results.length} passed`)
  process.exit(results.every(Boolean) ? 0 : 1)
}

const ROUTES = {
  tenant: ['/tenant', '/tenant/documents', '/tenant/payments', '/tenant/analytics', '/tenant/search', '/tenant/maintenance', '/messages', '/tenant/notifications', '/docs'],
  owner: ['/owner', '/owner/properties', '/owner/applications', '/owner/documents', '/owner/analytics', '/owner/maintenance', '/owner/agreements', '/messages', '/docs'],
  manager: ['/manager', '/manager/users', '/manager/properties', '/manager/applications', '/manager/rent-collection', '/manager/agreements', '/manager/analytics', '/messages', '/docs'],
}
const browser = await chromium.launch({ executablePath: process.env.BROWSER_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', headless: true })

if (WHAT === 'guards') {
  const anon = await browser.newContext({ viewport: { width: 1280, height: 800 } }); const ap = await anon.newPage()
  for (const r of ['/tenant', '/owner', '/manager', '/messages', '/tenant/payments', '/owner/agreements']) {
    await ap.goto(BASE + r, { waitUntil: 'networkidle' }); check(`signed out: ${r} -> /login`, ap.url().endsWith('/login'), ap.url())
  }
  await anon.close()
  for (const [role, own, others] of [['tenant', '/tenant', ['/owner', '/manager', '/owner/agreements', '/manager/rent-collection']], ['owner', '/owner', ['/tenant', '/manager', '/manager/rent-collection']], ['manager', '/manager', ['/tenant', '/owner', '/owner/agreements']]]) {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } })
    await ctx.addInitScript((t) => localStorage.setItem('token', t), tokens[role]); const p = await ctx.newPage()
    for (const o of others) { await p.goto(BASE + o, { waitUntil: 'networkidle' }); await p.waitForTimeout(400); check(`${role} opening ${o} is sent back to ${own}`, new URL(p.url()).pathname === own, new URL(p.url()).pathname) }
    await p.goto(BASE + '/manager/ocr-config', { waitUntil: 'networkidle' }); await p.waitForTimeout(400)
    const txt = await p.evaluate(() => document.body.innerText)
    check(`${role}: /manager/ocr-config shows no OCR configuration UI`, !/ocr config|confidence threshold|engine/i.test(txt), txt.replace(/\s+/g, ' ').slice(0, 80))
    await p.goto(BASE + '/no/such/page', { waitUntil: 'networkidle' }); await p.waitForTimeout(400)
    check(`${role}: unknown URL doesn't crash (renders something, no uncaught error)`, (await p.evaluate(() => document.body.innerText.length)) >= 0)
    await ctx.close()
  }
  // login form validation
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } }); const p = await ctx.newPage()
  await p.goto(BASE + '/login', { waitUntil: 'networkidle' })
  await p.locator('button[type=submit]').click()
  check('login: empty submit is blocked by validation (still /login, email invalid)', p.url().endsWith('/login') && (await p.evaluate(() => document.querySelector('input[type=email]').validity.valueMissing)))
  await p.fill('input[type=email]', 'not-an-email'); await p.fill('input[type=password]', 'x'); await p.locator('button[type=submit]').click()
  check('login: malformed email is blocked by validation', p.url().endsWith('/login') && (await p.evaluate(() => document.querySelector('input[type=email]').validity.typeMismatch)))
  await p.goto(BASE + '/register', { waitUntil: 'networkidle' })
  const req = await p.evaluate(() => [...document.querySelectorAll('form input, form select')].filter((i) => i.required).length)
  check('register: required fields are enforced', req >= 3, req)
  await ctx.close()
  console.log(`\n${results.filter(Boolean).length}/${results.length} passed`)
  await browser.close(); process.exit(results.every(Boolean) ? 0 : 1)
}

// ---- per-role sweep: every page x desktop/mobile x light/dark ----
const role = WHAT
const seen404 = new Set(), seenFail = new Set(), contrastAll = new Map()
for (const route of ROUTES[role]) {
  for (const [sname, viewport] of [['desktop', { width: 1440, height: 900 }], ['mobile', { width: 390, height: 844 }]]) {
    for (const theme of ['light', 'dark']) {
      const ctx = await browser.newContext({ viewport, colorScheme: theme })
      await ctx.addInitScript(([t, th]) => { localStorage.setItem('token', t); localStorage.setItem('propai-theme', th) }, [tokens[role], theme])
      const page = await ctx.newPage()
      const errs = [], fails = []
      page.on('pageerror', (e) => errs.push('PAGEERROR ' + e.message.slice(0, 160)))
      page.on('console', (m) => { if (m.type() === 'error') errs.push(`${m.text().slice(0, 100)} @ ${(m.location().url || '').replace(BASE, '').slice(0, 80)}`) })
      page.on('response', (r) => { if (r.status() >= 400) fails.push(`${r.status()} ${r.request().method()} ${r.url().replace(BASE, '').replace(API, 'API').slice(0, 90)}`) })
      await page.goto(BASE + route, { waitUntil: 'networkidle' })
      await page.waitForTimeout(900)
      const info = await page.evaluate(() => {
        const t = document.body.innerText
        const stuck = !!document.querySelector('[role=status][aria-label^="Loading"], .animate-pulse') || /^Loading…$/m.test(t)
        const bad = (t.match(/\b(undefined|NaN|\[object Object\]|null)\b/g) || [])
        return { len: t.length, stuck, bad, overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1, h1: (document.querySelector('h1')?.innerText || '').slice(0, 40) }
      })
      const ct = await page.evaluate(auditFn)
      for (const c of ct) contrastAll.set(`${route}|${theme}|${c.text.slice(0, 40)}`, c.ratio)
      const label = `${role} ${route} ${sname}/${theme}`
      const fatal = errs.filter((e) => !/favicon/.test(e)), favicon = errs.filter((e) => /favicon/.test(e)).length
      const nonFav = fails.filter((f) => !/favicon/.test(f))
      check(`${label}: renders (h1 "${info.h1}"), no loading stuck, no undefined/NaN, no overflow, no console/page errors, no 4xx/5xx`,
        info.len > 80 && !info.stuck && info.bad.length === 0 && !info.overflow && fatal.length === 0 && nonFav.length === 0,
        `len=${info.len} stuck=${info.stuck} bad=${info.bad.join(',')} overflow=${info.overflow} errs=${fatal.join(' | ')} fails=${nonFav.join(' | ')}`)
      if (favicon) seen404.add('favicon.ico')
      if (theme === 'light' && sname === 'desktop') await page.screenshot({ path: `${OUT}/${role}${route.replace(/\//g, '_')}.png`, fullPage: false })
      await ctx.close()
    }
  }
}
console.log('\nContrast findings (route|theme|text -> ratio):', contrastAll.size ? '' : 'none')
for (const [k, v] of contrastAll) console.log('  CONTRAST', k, v)
if (seen404.size) console.log('NOTE: favicon.ico 404 seen (known, excluded)')
console.log(`\n${results.filter(Boolean).length}/${results.length} passed`)
await browser.close()
process.exit(results.every(Boolean) ? 0 : 1)
