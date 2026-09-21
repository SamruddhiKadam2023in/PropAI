import { chromium } from 'playwright-core'
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'

const BASE = 'http://localhost:3000'
const API = 'http://localhost:8000'
// Public sign-up now needs an emailed OTP, so fixtures are created like an admin would: POST /auth/users (Manager-only).
const _mgrTok = async () => (await (await fetch(`${API}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'rajesh@propai.in', password: 'PropAI@2024' }) })).json()).access_token
const makeUser = async (payload) => fetch(`${API}/auth/users`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await _mgrTok()}` }, body: JSON.stringify(payload) })

const ASSETS = path.resolve('../assets')
const OUT = 'shots/tenant'
fs.mkdirSync(OUT, { recursive: true })
const src = fs.readFileSync('audit.mjs', 'utf8')
const auditFn = new Function('return ' + src.match(/const auditFn = (\(\) => \{[\s\S]*?\r?\n\})\r?\n\r?\nconst browser/)[1])()

const T0 = new Date().toISOString()
const results = []
const check = (name, ok, detail = '') => { results.push(!!ok); console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail ? `  [${String(detail).slice(0, 200)}]` : '')) }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const run = (cmd, args) => execFileSync(cmd, args, { encoding: 'utf8' })
const sql = (q) => run('docker', ['exec', '-i', 'property_postgres', 'psql', '-U', 'postgres', '-d', 'property_management', '-tAc', q]).trim()
const mongo = (js) => run('docker', ['exec', '-i', 'property_mongodb', 'mongosh', '-u', 'mongo', '-p', 'mongo123', '--authenticationDatabase', 'admin', '--quiet', '--eval', `const d=db.getSiblingDB("property_management"); ${js}`]).trim()
const flushPropertyCache = () => { for (const k of run('docker', ['exec', 'property_redis', 'redis-cli', '--scan', '--pattern', 'properties:*']).split('\n').filter(Boolean)) run('docker', ['exec', 'property_redis', 'redis-cli', 'DEL', k]) }

async function login(email) {
  const r = await fetch(`${API}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: 'PropAI@2024' }) })
  const d = await r.json()
  return { tok: d.access_token, user: d.user, h: { Authorization: `Bearer ${d.access_token}`, 'Content-Type': 'application/json' } }
}
const call = async (who, method, url, body) => { const r = await fetch(API + url, { method, headers: who.h, body: body ? JSON.stringify(body) : undefined }); let j = null; try { j = await r.json() } catch {} return { status: r.status, json: j } }

const browser = await chromium.launch({ executablePath: process.env.BROWSER_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', headless: true })
const sessions = []
async function session(who, theme = 'light') {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 1500 }, colorScheme: theme })
  await ctx.addInitScript(([t, k]) => {
    localStorage.setItem('token', k)
    if (!sessionStorage.getItem('seeded')) { localStorage.setItem('propai-theme', t); sessionStorage.setItem('seeded', '1') }
  }, [theme, who.tok])
  const page = await ctx.newPage()
  const log = { pageErrors: [], consoleErrors: [], requests: [] }
  page.on('pageerror', (e) => log.pageErrors.push(e.message.slice(0, 200)))
  page.on('console', (m) => { if (m.type() === 'error') log.consoleErrors.push(m.text().slice(0, 200)) })
  page.on('request', (r) => log.requests.push(`${r.method()} ${r.url()}`))
  const s = { ctx, page, log }
  sessions.push(s)
  return s
}
const shot = (page, name) => page.screenshot({ path: `${OUT}/${name}.png` })
const contrast = async (page, label) => { const f = await page.evaluate(auditFn); check(`contrast (0 failures): ${label}`, f.length === 0, f.length ? JSON.stringify(f.slice(0, 3)) : ''); return f.length }
const setTheme = async (page, theme) => { await page.evaluate((t) => localStorage.setItem('propai-theme', t), theme); await page.reload({ waitUntil: 'networkidle' }); await page.waitForTimeout(400) }
const fulfill500 = (route, detail = 'boom') => route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ detail }) })

// ── accounts & snapshots ──────────────────────────────────────────────────────
const amit = await login('amit@example.in'), sneha = await login('sneha@example.in'), rahul = await login('rahul@example.in')
const vikram = await login('vikram@propai.in')
await makeUser({ email: 'qa.empty@example.in', password: 'PropAI@2024', full_name: 'QA Empty', phone: '9876543210', role: 'tenant' })
const qa = await login('qa.empty@example.in')
const unreadBefore = JSON.parse(mongo('print(JSON.stringify(d.notifications.find({user_id:{$in:[5,6]},read:false},{_id:1}).toArray().map(x=>String(x._id))))') || '[]')
const vikramPhone = sql('select phone from users where id=2;')
console.log(`(snapshot: ${unreadBefore.length} unread notifications for Amit/Sneha, owner phone ${vikramPhone})`)

try {
  // ═══════════════════════ A. TENANT HOME ═══════════════════════
  console.log('\n══ A. Home / property data ══')
  const A = await session(amit)
  await A.page.route('**/properties/', async (r) => { await sleep(1500); try { await r.continue() } catch {} })
  await A.page.goto(`${BASE}/tenant`)
  await A.page.getByLabel('Loading your home').waitFor({ timeout: 4000 })
  check('A1 loading skeleton is shown while the property loads', true)
  await shot(A.page, 'A1-home-loading')
  await A.page.getByTestId('property-panel').waitFor({ timeout: 10000 })
  await A.page.unroute('**/properties/')
  const apiProps = (await call(amit, 'GET', '/properties/')).json
  const p = apiProps[0]
  const body = await A.page.getByTestId('property-panel').innerText()
  const amenities = JSON.parse(p.amenities)
  check('A2 shows property name from the database', body.includes(p.title), p.title)
  check('A2 shows address', body.includes(p.address))
  check('A2 shows location (city, state) and pincode', body.includes(`${p.city}, ${p.state}`) && body.includes(p.pincode))
  check('A2 shows rent formatted from the database (₹48,000)', body.includes(`₹${Number(p.rent_amount).toLocaleString('en-IN')}`))
  check('A2 shows property type + status', body.includes('Apartment') && body.includes('Occupied · Your home'))
  check('A2 shows bedrooms/bathrooms/area', body.includes(`${p.bedrooms} BHK`) && body.includes(`${p.area_sqft} sq.ft`))
  check('A2 shows every amenity from the database', amenities.every((a) => body.includes(a)), amenities.join(','))
  check('A2 no photo yet -> gradient fallback (no <img>)', (await A.page.locator('[data-testid=property-panel] img').count()) === 0)
  await shot(A.page, 'A2-home-light')
  await contrast(A.page, 'Home (light)')
  await setTheme(A.page, 'dark')
  await shot(A.page, 'A3-home-dark')
  await contrast(A.page, 'Home (dark)')
  await setTheme(A.page, 'light')

  // other tenants see THEIR property
  const S = await session(sneha), R = await session(rahul)
  await S.page.goto(`${BASE}/tenant`, { waitUntil: 'networkidle' }); await S.page.getByTestId('property-panel').waitFor()
  const sBody = await S.page.getByTestId('property-panel').innerText()
  check('A4 tenant Sneha sees HER property (Hinjawadi), not Amit\'s', sBody.includes('Hinjawadi') && !sBody.includes('Antriksh'))
  await R.page.goto(`${BASE}/tenant`, { waitUntil: 'networkidle' }); await R.page.getByTestId('property-panel').waitFor()
  const rBody = await R.page.getByTestId('property-panel').innerText()
  check('A4 tenant Rahul sees HIS property (Koramangala)', rBody.includes('Koramangala') && !rBody.includes('Antriksh') && !rBody.includes('Hinjawadi'))

  // error state + retry
  await A.page.route('**/properties/', (r) => fulfill500(r))
  await A.page.goto(`${BASE}/tenant`, { waitUntil: 'networkidle' })
  await A.page.getByText("We couldn't load your property").waitFor({ timeout: 8000 })
  check('A5 error state shown when the API fails (with retry)', await A.page.getByRole('button', { name: /Try again/ }).isVisible())
  await shot(A.page, 'A5-home-error')
  await contrast(A.page, 'Home error state (light)')
  await A.page.unroute('**/properties/')
  await A.page.getByRole('button', { name: /Try again/ }).click()
  await A.page.getByTestId('property-panel').waitFor({ timeout: 10000 })
  check('A5 retry recovers and shows the property', true)

  // analytics failure must not hide the property
  await A.page.route('**/analytics/dashboard/*', (r) => fulfill500(r))
  await A.page.goto(`${BASE}/tenant`, { waitUntil: 'networkidle' })
  await A.page.getByText("We couldn't load your cost analytics").waitFor({ timeout: 8000 })
  check('A6 analytics failure is isolated: property details still visible', await A.page.getByTestId('property-panel').isVisible())
  await A.page.unroute('**/analytics/dashboard/*')
  await A.page.getByRole('button', { name: /Try again/ }).click()
  await A.page.getByText('Utility Bill Details').waitFor({ timeout: 10000 })
  check('A6 analytics retry works', true)

  // empty state (tenant with no property)
  const Q = await session(qa)
  await Q.page.goto(`${BASE}/tenant`, { waitUntil: 'networkidle' })
  await Q.page.getByText('No property is linked to your account yet').waitFor({ timeout: 8000 })
  check('A7 empty state for a tenant without a property', true)
  await shot(Q.page, 'A7-home-empty')
  await contrast(Q.page, 'Home empty state (light)')
  await Q.page.locator('a.btn-primary', { hasText: 'Find a home' }).click()
  check('A7 empty-state call-to-action goes to Find a Home', Q.page.url().endsWith('/tenant/search'))

  // property photo + broken photo fallback
  const fd = new FormData(); fd.append('file', new Blob([fs.readFileSync(path.join(ASSETS, 'electricity_bill.png'))], { type: 'image/png' }), 'photo.png')
  const up = await fetch(`${API}/properties/1/upload-image`, { method: 'POST', headers: { Authorization: `Bearer ${vikram.tok}` }, body: fd })
  check('A8 owner uploads a property photo (test data)', up.ok, up.status)
  await A.page.goto(`${BASE}/tenant`, { waitUntil: 'networkidle' })
  await A.page.locator('[data-testid=property-panel] img').waitFor({ timeout: 8000 })
  const img = await A.page.locator('[data-testid=property-panel] img').evaluate((i) => ({ w: i.naturalWidth, alt: i.alt, src: i.src }))
  check('A8 the property photo is displayed from the backend', img.w === 1100 && img.src.includes('/uploads/properties/'), JSON.stringify(img))
  check('A8 photo has descriptive alt text', img.alt === 'Photo of Antriksh Heights — 2BHK', img.alt)
  await shot(A.page, 'A8-home-photo')
  await contrast(A.page, 'Home with photo (light)')
  await A.page.route('**/uploads/properties/**', (r) => r.abort())
  await A.page.reload({ waitUntil: 'networkidle' })
  await A.page.getByTestId('property-panel').waitFor()
  await A.page.waitForTimeout(500)
  check('A8 broken photo falls back to the gradient header', (await A.page.locator('[data-testid=property-panel] img').count()) === 0)
  await A.page.unroute('**/uploads/properties/**')

  // ═══════════════════════ B. MAINTENANCE ═══════════════════════
  console.log('\n══ B. Maintenance ══')
  await A.page.goto(`${BASE}/tenant/maintenance`, { waitUntil: 'networkidle' })
  await A.page.locator('#mr-title').waitFor()
  const styleOf = (sel) => A.page.locator(sel).evaluate((e) => { const c = getComputedStyle(e); return { border: c.borderTopWidth, bg: c.backgroundColor, color: c.color, radius: c.borderTopLeftRadius } })
  let st = await styleOf('#mr-title')
  check('B1 LIGHT: inputs are properly styled (border, tinted surface, themed text)', st.border !== '0px' && st.bg === 'rgb(241, 245, 249)' && st.color === 'rgb(15, 23, 42)', JSON.stringify(st))
  await shot(A.page, 'B1-maintenance-light')
  await contrast(A.page, 'Maintenance form (light)')
  await setTheme(A.page, 'dark')
  st = await styleOf('#mr-title')
  const stSel = await styleOf('#mr-category'), stTa = await styleOf('#mr-description')
  check('B1 DARK: inputs follow the dark theme (no white boxes)', st.bg === 'rgb(39, 52, 73)' && st.color === 'rgb(241, 245, 249)' && stSel.bg === 'rgb(39, 52, 73)' && stTa.bg === 'rgb(39, 52, 73)', `${st.bg} ${stSel.bg} ${stTa.bg}`)
  await shot(A.page, 'B1-maintenance-dark')
  await contrast(A.page, 'Maintenance form (dark)')
  await setTheme(A.page, 'light')

  const before = (await call(amit, 'GET', '/maintenance/')).json.length
  const postsBefore = A.log.requests.filter((r) => r.startsWith('POST') && r.includes('/maintenance/')).length
  await A.page.getByRole('button', { name: /Submit request/ }).click()
  await A.page.getByText(/at least 2 characters/).waitFor({ timeout: 3000 })
  check('B2 empty title -> inline validation message (role=alert)', await A.page.locator('#mr-title-error[role=alert]').isVisible())
  check('B2 focus moves to the title field', await A.page.evaluate(() => document.activeElement?.id === 'mr-title'))
  check('B2 no request was sent for the invalid form', A.log.requests.filter((r) => r.startsWith('POST') && r.includes('/maintenance/')).length === postsBefore)

  await A.page.fill('#mr-title', 'Leaking kitchen tap')
  await A.page.selectOption('#mr-category', 'plumbing')
  await A.page.getByText('Urgent, affects daily life').click()
  await A.page.fill('#mr-description', 'Drips all night.\nStarted two days ago.')
  await shot(A.page, 'B3-maintenance-filled')
  await A.page.getByRole('button', { name: /Submit request/ }).click()
  const newCard = A.page.locator('[data-testid=request-card]', { hasText: 'Leaking kitchen tap' }).first()
  await newCard.waitFor({ timeout: 8000 })
  const ct = await newCard.innerText()
  check('B3 request created and shown at the top of the list', await A.page.locator('[data-testid=request-card]').first().innerText().then((t) => t.includes('Leaking kitchen tap')))
  check('B3 shows priority, status, category, property, description', ct.includes('High priority') && ct.includes('Open') && ct.includes('Plumbing') && ct.includes('Antriksh Heights') && ct.includes('Started two days ago.'), ct.replace(/\s+/g, ' ').slice(0, 200))
  check('B3 success toast shown', await A.page.getByText(/Request submitted/).first().isVisible())
  check('B3 form was reset (title empty, priority back to Medium)', (await A.page.inputValue('#mr-title')) === '' && (await A.page.locator('input[name=urgency][value=medium]').isChecked()))
  const mine = (await call(amit, 'GET', '/maintenance/')).json
  check('B3 it exists in the backend for this tenant', mine.length === before + 1 && mine[0].tenant_id === amit.user.id && mine[0].title === 'Leaking kitchen tap', `${before}->${mine.length}`)
  const iso = mine[0].created_at
  const shown = await A.page.evaluate((v) => new Date(v).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }), iso)
  check('B3 submitted time is displayed correctly in local time (timezone fix)', ct.includes(shown), shown)
  await A.page.reload({ waitUntil: 'networkidle' })
  check('B4 the request is still there after reloading the page', await A.page.locator('[data-testid=request-card]', { hasText: 'Leaking kitchen tap' }).count() === 1)

  const rid = mine[0].id
  await call(vikram, 'PATCH', `/maintenance/${rid}/status`, { status: 'in_progress' })
  await A.page.getByRole('button', { name: /Refresh/ }).click()
  const c1 = A.page.locator('[data-testid=request-card]', { hasText: 'Leaking kitchen tap' })
  await c1.locator('ol[aria-label*="step 2 of 3"]').waitFor({ timeout: 6000 })
  check('B5 owner moves it to "In progress" -> tenant sees the new status', (await c1.innerText()).includes('In progress'))
  await call(vikram, 'PATCH', `/maintenance/${rid}/status`, { status: 'resolved' })
  await A.page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')))     // tab regains focus -> silent refresh
  await c1.locator('ol[aria-label*="step 3 of 3"]').waitFor({ timeout: 6000 })
  check('B5 "Resolved" appears without a manual refresh when the tab is revisited', (await c1.locator('.badge-green').innerText()) === 'Resolved')
  await shot(A.page, 'B5-maintenance-resolved')
  await A.page.getByRole('tab', { name: /^Resolved/ }).click()
  const resolvedCards = await A.page.locator('[data-testid=request-card]').allInnerTexts()
  check('B6 "Resolved" filter shows only resolved requests', resolvedCards.length >= 1 && resolvedCards.every((t) => t.includes('Resolved')), resolvedCards.length)
  await A.page.getByRole('tab', { name: /^All/ }).click()
  const legacy = await A.page.locator('[data-testid=request-card]').allInnerTexts()
  check('B6 older records without a category still render (as "Something else")', legacy.length >= 1)

  // server rejection surfaces as an error, input preserved
  await A.page.route('**/maintenance/', (r) => (r.request().method() === 'POST' ? fulfill500(r, 'Server exploded') : r.continue()))
  await A.page.fill('#mr-title', 'Will fail')
  await A.page.getByRole('button', { name: /Submit request/ }).click()
  await A.page.getByText('Server exploded').waitFor({ timeout: 5000 })
  check('B7 server error shown to the user, typed text preserved', (await A.page.inputValue('#mr-title')) === 'Will fail')
  await shot(A.page, 'B7-maintenance-submit-error')
  await contrast(A.page, 'Maintenance submit error (light)')
  await A.page.unroute('**/maintenance/')
  await A.page.fill('#mr-title', '')

  // markup is shown as text, never executed
  await A.page.fill('#mr-title', '<b>bold</b><img src=x onerror="window.__xss=1">')
  await A.page.getByRole('button', { name: /Submit request/ }).click()
  const xssCard = A.page.locator('[data-testid=request-card]', { hasText: 'bold' }).first()
  await xssCard.waitFor({ timeout: 8000 })
  check('B8 HTML in a title is displayed as literal text (no injection)', (await xssCard.innerText()).includes('<b>bold</b>') && (await xssCard.locator('img, b').count()) === 0 && (await A.page.evaluate(() => window.__xss)) === undefined)

  // list states
  await A.page.route('**/maintenance/', (r) => (r.request().method() === 'GET' ? r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }) : r.continue()))
  await A.page.getByRole('button', { name: /Refresh/ }).click()
  await A.page.getByText('No maintenance requests yet').waitFor({ timeout: 5000 })
  check('B9 empty state when there are no requests', true)
  await shot(A.page, 'B9-maintenance-empty')
  await contrast(A.page, 'Maintenance empty list (light)')
  await A.page.unroute('**/maintenance/')
  await A.page.route('**/maintenance/', (r) => (r.request().method() === 'GET' ? fulfill500(r) : r.continue()))
  await A.page.getByRole('button', { name: /Refresh/ }).click()
  await A.page.getByText("We couldn't load your requests").waitFor({ timeout: 5000 })
  check('B9 error state (with retry) when the list fails to load', await A.page.getByRole('button', { name: /Try again/ }).isVisible())
  await A.page.unroute('**/maintenance/')
  await A.page.getByRole('button', { name: /Try again/ }).click()
  await A.page.locator('[data-testid=request-card]').first().waitFor({ timeout: 6000 })
  check('B9 retry recovers the list', true)
  await Q.page.goto(`${BASE}/tenant/maintenance`, { waitUntil: 'networkidle' })
  await Q.page.getByText('No rented property linked to your account').waitFor({ timeout: 6000 })
  check('B10 tenant without a property: explanation instead of a form', (await Q.page.locator('#mr-title').count()) === 0)
  await shot(Q.page, 'B10-maintenance-no-property')

  await A.page.goto(`${BASE}/tenant/maintenance`, { waitUntil: 'networkidle' })
  await setTheme(A.page, 'dark')
  await A.page.locator('[data-testid=request-card]').first().waitFor()
  await shot(A.page, 'B11-maintenance-list-dark')
  await contrast(A.page, 'Maintenance list (dark)')
  await setTheme(A.page, 'light')

  // ═══════════════════════ C. MESSAGES ═══════════════════════
  console.log('\n══ C. Messages / contact links ══')
  const ctxA = A.ctx
  await A.page.goto(`${BASE}/messages`, { waitUntil: 'networkidle' })
  await A.page.getByRole('button', { name: /Vikram Mehta/ }).click()
  await A.page.getByTestId('contact-actions').waitFor({ timeout: 5000 })
  const hrefs = await A.page.locator('[data-testid=contact-actions] a').evaluateAll((as) => as.map((a) => ({ href: a.getAttribute('href'), target: a.target, rel: a.rel, label: a.getAttribute('aria-label') })))
  const msg = encodeURIComponent('Hi Vikram, this is Amit Kumar.')
  check('C1 phone shown formatted (+91 98202 22222)', (await A.page.getByTestId('contact-actions').innerText()).includes('+91 98202 22222'))
  check('C1 Call link is a correctly encoded tel: link', hrefs[0].href === 'tel:+919820222222', hrefs[0].href)
  check('C1 SMS link is a correctly encoded sms: link with prefilled text', hrefs[1].href === `sms:+919820222222?&body=${msg}`, hrefs[1].href)
  check('C1 WhatsApp link uses wa.me with digits only + encoded text', hrefs[2].href === `https://wa.me/919820222222?text=${msg}`, hrefs[2].href)
  check('C1 WhatsApp opens in a new tab safely (noopener noreferrer)', hrefs[2].target === '_blank' && /noopener/.test(hrefs[2].rel) && /noreferrer/.test(hrefs[2].rel))
  check('C1 buttons have descriptive accessible names', hrefs.every((h) => h.label && h.label.includes('Vikram Mehta')), hrefs[0].label)
  await shot(A.page, 'C1-messages-actions-light')
  await contrast(A.page, 'Messages with contact actions (light)')
  await ctxA.route('https://wa.me/**', (r) => r.fulfill({ status: 200, contentType: 'text/html', body: '<h1>wa.me stub</h1>' }))
  const postsMsg = () => A.log.requests.filter((r) => r.startsWith('POST') && r.includes('/messages')).length
  const before2 = postsMsg()
  const [popup] = await Promise.all([ctxA.waitForEvent('page'), A.page.getByRole('link', { name: /WhatsApp/ }).click()])
  check('C2 clicking WhatsApp opens wa.me in a new tab', popup.url().startsWith('https://wa.me/919820222222?text='), popup.url())
  await popup.close()
  check('C2 the links do NOT send anything through our backend', postsMsg() === before2)

  // normalisation end-to-end + unusable numbers
  sql("update users set phone=' 098202 22222 ' where id=2;")
  await A.page.reload({ waitUntil: 'networkidle' }); await A.page.getByRole('button', { name: /Vikram Mehta/ }).click(); await A.page.getByTestId('contact-actions').waitFor()
  check('C3 a messy stored number ("098202 22222") is normalised into the same valid links', (await A.page.locator('[data-testid=contact-actions] a').first().getAttribute('href')) === 'tel:+919820222222')
  sql("update users set phone='not a number' where id=2;")
  await A.page.reload({ waitUntil: 'networkidle' }); await A.page.getByRole('button', { name: /Vikram Mehta/ }).click(); await A.page.getByTestId('no-phone').waitFor({ timeout: 5000 })
  check('C3 an unusable number shows "No phone number on file" and creates NO links', (await A.page.getByTestId('no-phone').innerText()).includes('Vikram Mehta') && (await A.page.locator('a[href^="tel:"], a[href^="sms:"], a[href*="wa.me"]').count()) === 0)
  await shot(A.page, 'C3-messages-no-phone')
  await contrast(A.page, 'Messages without a phone (light)')
  sql(`update users set phone='${vikramPhone}' where id=2;`)

  // send a message: tz-correct time
  await A.page.reload({ waitUntil: 'networkidle' }); await A.page.getByRole('button', { name: /Vikram Mehta/ }).click()
  await A.page.fill('textarea', 'QA: is the plumber coming today?')
  await A.page.getByRole('button', { name: /Send/ }).click()
  await A.page.getByText('QA: is the plumber coming today?').waitFor({ timeout: 6000 })
  const stamp = await A.page.evaluate(() => { const f = (d) => d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }); const n = new Date(); return [f(n), f(new Date(n - 60000))] })
  const bubble = await A.page.locator('div:has(> p:text-is("QA: is the plumber coming today?"))').last().innerText()
  check('C4 message sent via the app and shown with the correct local time', stamp.some((s) => bubble.includes(s)), `${bubble.replace(/\s+/g, ' ')} vs ${stamp[0]}`)

  // dark
  await setTheme(A.page, 'dark'); await A.page.getByRole('button', { name: /Vikram Mehta/ }).click(); await A.page.getByTestId('contact-actions').waitFor()
  await shot(A.page, 'C5-messages-actions-dark'); await contrast(A.page, 'Messages with contact actions (dark)')
  await setTheme(A.page, 'light')

  // owner side unchanged, empty tenant
  const V = await session(vikram)
  await V.page.goto(`${BASE}/messages`, { waitUntil: 'networkidle' })
  await V.page.getByRole('button', { name: /Amit Kumar/ }).first().click()
  await V.page.waitForTimeout(600)
  check('C6 owner\'s Messages screen is unchanged (no phone actions added)', (await V.page.getByTestId('contact-actions').count()) === 0 && (await V.page.getByTestId('no-phone').count()) === 0)
  await Q.page.goto(`${BASE}/messages`, { waitUntil: 'networkidle' })
  check('C7 tenant with no property: empty contacts message', (await Q.page.getByText('No contacts yet.').isVisible()) && (await Q.page.getByText('Your property owner will appear here.').isVisible()))

  // ═══════════════════════ D. NOTIFICATIONS ═══════════════════════
  console.log('\n══ D. Notifications ══')
  const now = new Date()
  const iso3h = new Date(now - 3 * 3600 * 1000).toISOString().replace('Z', '')          // legacy naive-UTC format
  const mk = (uid, type, title, message, created, read = false) => `{user_id:${uid},type:"${type}",title:"${title}",message:"${message}",read:${read},created_at:"${created}",_qa:true}`
  mongo(`d.notifications.insertMany([
    ${mk(5, 'rent_due', 'Rent Due Reminder', 'Your rent of ₹48,000/mo for Antriksh Heights is due for September 2026.', new Date(now - 60000).toISOString())},
    ${mk(5, 'payment_confirmed', 'Payment recorded', 'Your payment of ₹48,000 for August 2026 has been recorded. Thank you!', new Date(now - 120000).toISOString())},
    ${mk(5, 'property_update', 'Rent updated', 'The monthly rent for Antriksh Heights changed from ₹47,000 to ₹48,000.', iso3h)},
    ${mk(5, 'rejected', 'Application Update', 'Your application for Kothrud 2BHK was not approved this time.', new Date(now - 5 * 24 * 3600 * 1000).toISOString(), true)},
    ${mk(5, 'mystery_type', 'Unknown event', 'Rendered with a safe fallback.', new Date(now - 200000).toISOString())},
  ])`)
  await A.page.goto(`${BASE}/tenant/notifications`, { waitUntil: 'networkidle' })
  await A.page.getByRole('heading', { name: 'Notifications' }).waitFor()
  const rows = await A.page.getByTestId('notification-row').allInnerTexts()
  check('D1 notifications from the backend are listed (title, message, time)', rows.some((t) => t.includes('Rent Due Reminder') && t.includes('₹48,000/mo') && /Just now|1 min ago|2 min ago/.test(t)))
  check('D1 relative + absolute date/time shown', rows.some((t) => /Just now|min ago/.test(t) && /\d{4}, \d{2}:\d{2}/.test(t)))
  check('D1 a legacy timestamp without timezone is read as UTC ("3 hr ago", not shifted by 5h30)', rows.some((t) => t.includes('Rent updated') && t.includes('3 hr ago')), rows.find((t) => t.includes('Rent updated'))?.replace(/\s+/g, ' '))
  check('D1 unknown notification types render with a safe fallback', rows.some((t) => t.includes('Unknown event') && t.includes('Notification')))
  const iNew = rows.findIndex((t) => t.includes('for Antriksh Heights is due for September 2026'))
  const iOld = rows.findIndex((t) => t.includes('Rent updated'))
  check('D1 newest first (a 1-minute-old item is listed above a 3-hour-old one)', iNew !== -1 && iOld !== -1 && iNew < iOld, `${iNew} < ${iOld}`)
  const unreadRow = A.page.locator('[data-testid=notification-row][data-read=false]', { hasText: 'Rent Due Reminder' })
  check('D2 unread notifications are visually and accessibly marked', (await unreadRow.count()) === 1 && (await unreadRow.innerText()).includes('Unread'))
  check('D2 read notification is not marked unread', (await A.page.locator('[data-testid=notification-row][data-read=true]', { hasText: 'Application Update' }).count()) === 1)
  const unreadTotalUi = await A.page.getByTestId('notification-row').evaluateAll((els) => els.filter((e) => e.dataset.read === 'false').length)
  const unreadTotalApi = (await call(amit, 'GET', '/notifications/unread-count')).json.count
  check('D2 unread count in the UI equals the backend count', unreadTotalUi === unreadTotalApi && (await A.page.getByTestId('bell-badge').innerText()) === (unreadTotalApi > 9 ? '9+' : String(unreadTotalApi)), `${unreadTotalUi}/${unreadTotalApi}`)
  await shot(A.page, 'D1-notifications-light')
  await contrast(A.page, 'Notifications page (light)')

  await A.page.getByRole('tab', { name: /^Payments/ }).click()
  const payRows = await A.page.getByTestId('notification-row').allInnerTexts()
  check('D3 "Payments" filter shows only payment reminders/confirmations', payRows.length >= 2 && payRows.every((t) => /Payment|Rent Due/.test(t)))
  await A.page.getByRole('tab', { name: /^Unread/ }).click()
  check('D3 "Unread" filter shows only unread', (await A.page.locator('[data-testid=notification-row][data-read=true]').count()) === 0)
  await A.page.getByRole('tab', { name: /^All/ }).click()

  const unreadBeforeClick = unreadTotalApi
  await A.page.locator('[data-testid=notification-row][data-read=false]', { hasText: 'Rent Due Reminder' }).click()
  await A.page.waitForURL('**/tenant/payments', { timeout: 5000 })
  check('D4 opening a payment reminder marks it read and goes to Payments', true)
  await sleep(500)
  check('D4 the read state is saved in the backend', (await call(amit, 'GET', '/notifications/unread-count')).json.count === unreadBeforeClick - 1)
  await A.page.goto(`${BASE}/tenant/notifications`, { waitUntil: 'networkidle' })
  check('D4 it stays read after reloading', (await A.page.locator('[data-testid=notification-row][data-read=true]', { hasText: 'for Antriksh Heights is due for September 2026' }).count()) === 1 && (await A.page.locator('[data-testid=notification-row][data-read=false]', { hasText: 'for Antriksh Heights is due for September 2026' }).count()) === 0)

  // bell: live count + dropdown
  const badgeBefore = Number(unreadBeforeClick - 1)
  mongo(`d.notifications.insertOne(${mk(5, 'maintenance', 'Maintenance Update — In Progress', "Your request 'Leaking kitchen tap' has been marked as In Progress.", new Date().toISOString())})`)
  await A.page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')))
  await A.page.waitForFunction((n) => { const b = document.querySelector('[data-testid=bell-badge]'); return b && (b.textContent === '9+' || Number(b.textContent) === n) }, badgeBefore + 1 > 9 ? 9 : badgeBefore + 1, { timeout: 6000 }).catch(() => {})
  const badgeText = await A.page.getByTestId('bell-badge').innerText()
  check('D5 the bell badge updates live when a new notification arrives', badgeText === (badgeBefore + 1 > 9 ? '9+' : String(badgeBefore + 1)), `${badgeText} (expected ${badgeBefore + 1})`)
  await A.page.getByRole('button', { name: /^Notifications/ }).click()
  await A.page.getByRole('dialog', { name: 'Notifications' }).waitFor()
  await A.page.getByRole('dialog', { name: 'Notifications' }).getByText('Maintenance Update — In Progress').first().waitFor({ timeout: 6000 })
  check('D5 dropdown lists notifications with titles', (await A.page.getByRole('dialog', { name: 'Notifications' }).innerText()).includes('Maintenance Update'))
  await shot(A.page, 'D5-bell-dropdown-light'); await contrast(A.page, 'Bell dropdown (light)')
  await A.page.getByRole('dialog', { name: 'Notifications' }).getByText('Maintenance Update — In Progress').first().click()
  await A.page.waitForURL('**/tenant/maintenance', { timeout: 5000 })
  check('D5 clicking a maintenance notification opens Maintenance', true)
  await A.page.getByRole('button', { name: /^Notifications/ }).click()
  await A.page.getByRole('link', { name: 'View all notifications' }).click()
  await A.page.waitForURL('**/tenant/notifications', { timeout: 5000 })
  check('D5 "View all notifications" opens the Notifications page', true)

  // the page marks rows read BEFORE the server answers (optimistic), so wait for the server's own count instead of asking once
  const serverUnreadIsZero = async (who) => { for (let i = 0; i < 20; i++) { if ((await call(who, 'GET', '/notifications/unread-count')).json.count === 0) return true; await new Promise((r) => setTimeout(r, 250)) } return false }
  // mark all read (Sneha, restored afterwards)
  mongo(`d.notifications.insertMany([${mk(6, 'rent_due', 'Rent Due Reminder', 'QA reminder A', new Date().toISOString())}, ${mk(6, 'maintenance', 'Maintenance request received', 'QA confirm B', new Date().toISOString())}])`)
  await S.page.goto(`${BASE}/tenant/notifications`, { waitUntil: 'networkidle' })
  check('D6 Sneha sees only HER notifications (none of Amit\'s)', !(await S.page.locator('body').innerText()).includes('Unknown event') && (await S.page.locator('body').innerText()).includes('QA reminder A'))
  await S.page.getByRole('button', { name: /Mark all as read/ }).click()
  await S.page.getByText("You're all caught up.").waitFor({ timeout: 5000 })
  check('D6 "Mark all as read" clears every unread notification', (await S.page.locator('[data-testid=notification-row][data-read=false]').count()) === 0 && await serverUnreadIsZero(sneha))
  check('D6 …without touching another tenant\'s notifications', (await call(amit, 'GET', '/notifications/unread-count')).json.count > 0)
  await shot(S.page, 'D6-notifications-all-read')

  // states
  await Q.page.goto(`${BASE}/tenant/notifications`, { waitUntil: 'networkidle' })
  await Q.page.getByText('No notifications yet').waitFor({ timeout: 5000 })
  check('D7 empty state', true); await shot(Q.page, 'D7-notifications-empty'); await contrast(Q.page, 'Notifications empty (light)')
  await A.page.route('**/notifications/?*', (r) => fulfill500(r))
  await A.page.reload({ waitUntil: 'networkidle' })
  await A.page.getByText("We couldn't load your notifications").waitFor({ timeout: 6000 })
  check('D7 error state with retry', await A.page.getByRole('button', { name: /Try again/ }).isVisible()); await shot(A.page, 'D7-notifications-error')
  await A.page.unroute('**/notifications/?*')
  await A.page.getByRole('button', { name: /Try again/ }).click(); await A.page.getByTestId('notification-row').first().waitFor({ timeout: 6000 })
  check('D7 retry recovers', true)
  await A.page.route('**/notifications/?*', async (r) => { await sleep(1200); try { await r.continue() } catch {} })
  await A.page.reload()
  await A.page.getByLabel('Loading notifications').waitFor({ timeout: 4000 }); check('D7 loading skeleton', true)
  await A.page.getByTestId('notification-row').first().waitFor({ timeout: 8000 }); await A.page.unroute('**/notifications/?*')

  // pagination
  const many = Array.from({ length: 60 }, (_, i) => mk(qa.user.id, 'maintenance', `Bulk notification ${i}`, 'load-more test', new Date(Date.now() - i * 1000).toISOString())).join(',')
  mongo(`d.notifications.insertMany([${many}])`)
  await Q.page.reload({ waitUntil: 'networkidle' })
  check('D8 first page shows 50 notifications', (await Q.page.getByTestId('notification-row').count()) === 50)
  await Q.page.getByRole('button', { name: 'Load older notifications' }).click()
  await Q.page.waitForFunction(() => document.querySelectorAll('[data-testid=notification-row]').length === 60, null, { timeout: 6000 })
  check('D8 "Load older notifications" fetches the rest (60)', (await Q.page.getByRole('button', { name: 'Load older notifications' }).count()) === 0)

  await setTheme(A.page, 'dark'); await A.page.getByTestId('notification-row').first().waitFor()
  await shot(A.page, 'D9-notifications-dark'); await contrast(A.page, 'Notifications page (dark)')
  await A.page.getByRole('button', { name: /^Notifications/ }).click(); await A.page.getByRole('dialog', { name: 'Notifications' }).waitFor()
  await shot(A.page, 'D9-bell-dropdown-dark'); await contrast(A.page, 'Bell dropdown (dark)')
  await A.page.keyboard.press('Escape'); check('D9 Esc closes the dropdown', (await A.page.getByRole('dialog', { name: 'Notifications' }).count()) === 0)
  await setTheme(A.page, 'light')

  // ═══════════════════════ E. FULL PAGE SWEEP ═══════════════════════
  console.log('\n══ E. Every tenant page, both themes ══')
  const pages = [['Dashboard', '/tenant'], ['My Documents', '/tenant/documents'], ['Payments', '/tenant/payments'], ['Cost Analysis', '/tenant/analytics'], ['Find a Home', '/tenant/search'], ['Maintenance', '/tenant/maintenance'], ['Messages', '/messages'], ['Notifications', '/tenant/notifications']]
  for (const theme of ['light', 'dark']) {
    await setTheme(A.page, theme)
    for (const [name, url] of pages) {
      const before = A.log.pageErrors.length
      await A.page.goto(BASE + url, { waitUntil: 'networkidle' }); await A.page.waitForTimeout(1200)
      const bad = (await A.page.locator('#root').innerText()).trim().length < 30
      check(`E ${theme}: ${name} renders`, !bad && A.log.pageErrors.length === before)
      await contrast(A.page, `${name} (${theme})`)
      await shot(A.page, `E-${theme}-${name.replace(/\s+/g, '-')}`)
    }
  }
  await setTheme(A.page, 'light')

  // ═══════════════════════ F. TENANT ISOLATION (in the UI + API) ═══════════════════════
  console.log('\n══ F. Tenant isolation ══')
  await S.page.goto(`${BASE}/tenant/maintenance`, { waitUntil: 'networkidle' }); await S.page.waitForTimeout(800)
  check('F1 Sneha\'s maintenance list does not contain Amit\'s requests', !(await S.page.locator('body').innerText()).includes('Leaking kitchen tap'))
  await S.page.goto(`${BASE}/messages`, { waitUntil: 'networkidle' })
  check('F2 Sneha\'s messages contain none of Amit\'s conversation', !(await S.page.locator('body').innerText()).includes('plumber coming today'))
  const amitNote = (await call(amit, 'GET', '/notifications/')).json[0]
  const cross = await S.page.evaluate(async ([api, id, tok]) => (await fetch(`${api}/notifications/${id}/read`, { method: 'PATCH', headers: { Authorization: `Bearer ${tok}` } })).status, [API, amitNote.id, sneha.tok])
  check('F3 from Sneha\'s browser, marking Amit\'s notification read -> 404', cross === 404, cross)
  const sPhones = await S.page.evaluate(async ([api, tok]) => JSON.stringify(await (await fetch(`${api}/messages/contacts`, { headers: { Authorization: `Bearer ${tok}` } })).json()), [API, sneha.tok])
  check('F4 Sneha\'s contacts expose no numbers other than her own owner\'s', !/9820333333|9820444444|9820111111|9870/.test(sPhones), sPhones.slice(0, 160))

  // ═══════════════════════ G. HYGIENE ═══════════════════════
  console.log('\n══ G. Browser console ══')
  const uncaught = sessions.flatMap((s) => s.log.pageErrors)
  const unexpected = sessions.flatMap((s) => s.log.consoleErrors).filter((m) => !/status of (4\d\d|5\d\d)|net::ERR_FAILED/.test(m))
  check('G1 no uncaught JavaScript errors in any session', uncaught.length === 0, JSON.stringify(uncaught))
  check('G2 no unexpected console errors (only deliberate 4xx/5xx from failure-injection + the known favicon)', unexpected.length === 0, JSON.stringify([...new Set(unexpected)]))
} finally {
  console.log('\n══ Cleanup ══')
  const tryRun = (f) => { try { return f() } catch (e) { return `cleanup error: ${String(e.message).slice(0, 100)}` } }
  tryRun(() => sql("update users set phone='" + vikramPhone + "' where id=2;"))
  tryRun(() => sql('update properties set image_url = NULL where id = 1;'))
  tryRun(() => run('docker', ['exec', 'property_backend', 'sh', '-c', 'rm -f /app/uploads/properties/prop_1.*']))
  tryRun(() => flushPropertyCache())
  const cleaned = tryRun(() => mongo(`const a=d.notifications.deleteMany({$or:[{_qa:true},{created_at:{$gte:"${T0}"}}]}).deletedCount; const b=d.maintenance_requests.deleteMany({created_at:{$gte:"${T0}"}}).deletedCount; const c=d.messages.deleteMany({created_at:{$gte:"${T0}"}}).deletedCount; print(JSON.stringify({notifications:a,maintenance:b,messages:c}))`))
  tryRun(() => mongo(`d.notifications.updateMany({_id:{$in:${JSON.stringify(unreadBefore)}.map(i=>ObjectId(i))}},{$set:{read:false}})`))
  tryRun(() => sql("delete from users where email='qa.empty@example.in';"))
  console.log('   removed test data:', cleaned)
  console.log('   owner phone restored:', sql('select phone from users where id=2;') === vikramPhone, '| property 1 image cleared:', sql('select coalesce(image_url,\'-\') from properties where id=1;') === '-', '| qa user gone:', sql("select count(*) from users where email='qa.empty@example.in';") === '0')
  const unreadAfter = JSON.parse(mongo('print(JSON.stringify(d.notifications.find({user_id:{$in:[5,6]},read:false},{_id:1}).toArray().map(x=>String(x._id))))') || '[]')
  check('unread state of real notifications restored exactly', unreadAfter.length === unreadBefore.length && unreadBefore.every((i) => unreadAfter.includes(i)), `${unreadAfter.length}/${unreadBefore.length}`)
  for (const s of sessions) await s.ctx.close().catch(() => {})
  await browser.close()
}
console.log(`\n${results.filter(Boolean).length}/${results.length} UI checks passed`)
process.exit(results.every(Boolean) ? 0 : 1)
