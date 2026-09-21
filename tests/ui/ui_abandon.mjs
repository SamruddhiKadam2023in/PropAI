import { chromium } from 'playwright-core'
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'

const BASE = 'http://localhost:3000', API = 'http://localhost:8000'
const OUT = path.resolve('shots/abandon'); fs.mkdirSync(OUT, { recursive: true })
const src = fs.readFileSync('audit.mjs', 'utf8')
const auditFn = new Function('return ' + src.match(/const auditFn = (\(\) => \{[\s\S]*?\r?\n\})\r?\n\r?\nconst browser/)[1])()
const results = []
const check = (name, ok, detail = '') => { results.push(!!ok); console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail !== '' ? `  [${String(detail).slice(0, 190)}]` : '')) }
const pg = (sql) => execFileSync('docker', ['exec', '-i', 'property_postgres', 'psql', '-U', 'postgres', '-d', 'property_management', '-At'], { encoding: 'utf8', input: sql }).trim()
const mongo = (js) => execFileSync('docker', ['exec', '-i', 'property_mongodb', 'mongosh', '-u', 'mongo', '-p', 'mongo123', '--authenticationDatabase', 'admin', '--quiet', '--eval', `const d=db.getSiblingDB("property_management"); ${js}`], { encoding: 'utf8' }).trim()
const j = async (url, opts = {}, tok) => { const r = await fetch(API + url, { ...opts, headers: { 'Content-Type': 'application/json', ...(tok ? { Authorization: `Bearer ${tok}` } : {}) } }); return { status: r.status, body: await r.json().catch(() => null) } }
const login = async (email, pw = 'PropAI@2024') => { const r = await j('/auth/login', { method: 'POST', body: JSON.stringify({ email, password: pw }) }); return { tok: r.body.access_token, id: r.body.user.id } }
const norm = (s) => s.replace('Sept', 'Sep').replace(/\s+/g, ' ').trim()

// Public sign-up now needs an emailed OTP, so fixtures are created like an admin would: POST /auth/users (Manager-only).
const _mgrTok = async () => (await (await fetch(`${API}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'rajesh@propai.in', password: 'PropAI@2024' }) })).json()).access_token
const makeUser = async (payload) => fetch(`${API}/auth/users`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await _mgrTok()}` }, body: JSON.stringify(payload) })

const BASEC = ['users', 'properties', 'payments', 'agreements'].map((t) => pg(`select count(*) from ${t}`)).join(',')
const PW = 'Abandon@2026', RENT = 10000
const T = {}, P = {}, TOK = {}

const browser = await chromium.launch({ executablePath: process.env.BROWSER_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', headless: true })
const sessions = []
async function session({ theme = 'light', viewport = { width: 1440, height: 1400 } } = {}) {
  const ctx = await browser.newContext({ viewport, colorScheme: theme, timezoneId: 'Asia/Kolkata' })
  await ctx.addInitScript(([t]) => { if (!sessionStorage.getItem('seeded')) { localStorage.setItem('propai-theme', t); sessionStorage.setItem('seeded', '1') } }, [theme])
  const page = await ctx.newPage()
  const log = { pageErrors: [], consoleErrors: [], failed: [] }
  page.on('pageerror', (e) => log.pageErrors.push(e.message.slice(0, 200)))
  page.on('console', (m) => { if (m.type() === 'error') log.consoleErrors.push(m.text().slice(0, 90) + ' @ ' + (m.location().url || '').slice(0, 120) + ' on ' + page.url().replace(BASE, '')) })
  page.on('response', (r) => { if (r.status() >= 400) log.failed.push(`${r.status()} ${r.url().startsWith(API) ? '' : 'EXT '}${new URL(r.url()).pathname}`) })
  const s = { ctx, page, log }; sessions.push(s); return s
}
async function uiLogin(s, email, expectPath) {
  await s.page.goto(`${BASE}/login`, { waitUntil: 'networkidle' })
  await s.page.fill('input[type=email]', email); await s.page.fill('input[type=password]', email.startsWith('abn_') ? PW : 'PropAI@2024')
  await s.page.locator('button[type=submit]').click()
  await s.page.waitForURL(`**${expectPath}`, { timeout: 15000 })
}
const contrast = async (p, label) => { const f = await p.evaluate(auditFn); check(`contrast (0 failures): ${label}`, f.length === 0, f.length ? JSON.stringify(f.slice(0, 3)) : '') }
const setTheme = async (p, t) => { await p.evaluate((v) => localStorage.setItem('propai-theme', v), t); await p.reload({ waitUntil: 'networkidle' }); await p.waitForTimeout(400) }
const row = (p, tenant) => p.getByTestId('agreement-row').filter({ hasText: tenant })
const card = (p, sub) => p.getByTestId('agreement-card').filter({ hasText: sub })
const overflow = (p) => p.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1)
const T0 = new Date().toISOString().slice(0, 19)

try {
  // ---------- setup through the real API ----------
  const owner = await login('vikram@propai.in')
  for (let i = 1; i <= 4; i++) {
    const email = `abn_ui${i}@example.com`
    await makeUser({ email, full_name: `Abandon UI ${i}`, password: PW, role: 'tenant' })
    const l = await login(email, PW); T[i] = l.id; TOK[i] = l.tok
    const pr = await j('/properties/', { method: 'POST', body: JSON.stringify({ title: `ABN-UI home ${i}`, address: `${i} UI Lane`, city: 'Pune', state: 'MH', pincode: '411001', property_type: 'apartment', bedrooms: 2, bathrooms: 1, area_sqft: 900, rent_amount: RENT }) }, owner.tok)
    P[i] = pr.body.id
  }
  const approve = async (i) => {
    await j(`/properties/${P[i]}/apply`, { method: 'POST' }, TOK[i])
    const apps = (await j('/properties/owner-applications', {}, owner.tok)).body
    const app = apps.find((a) => a.tenant_id === T[i] && a.status === 'pending')
    await j(`/properties/applications/${app._id}/approve`, { method: 'PATCH' }, owner.tok)
  }
  const pay = (i, amount, month) => j('/financial/payments', { method: 'POST', body: JSON.stringify({ amount, payment_date: new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' }), property_id: P[i], payment_type: 'rent', month }) }, TOK[i])
  const month = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' }).slice(0, 7)
  await approve(1); await approve(2); await approve(3)
  pg(`update properties set tenant_id=${T[4]}, is_available=false where id=${P[4]}`)     // tenant 4: rents, but no agreement recorded yet
  await pay(1, 30000, month)                                                              // UI1: will leave early with 30,000 paid
  const today = (await j('/financial/payments/summary', {}, TOK[1])).body.today

  console.log('\n══ A. Tenant with an ACTIVE agreement ══')
  const A = await session()
  await uiLogin(A, 'abn_ui1@example.com', '/tenant')
  await A.page.getByRole('link', { name: 'Payments' }).click()
  await A.page.getByTestId('agreement-card').first().waitFor({ timeout: 20000 })
  const c = A.page.getByTestId('agreement-card').first()
  check('A1 agreement card: Active badge, monthly ₹10,000, total ₹1,20,000, paid ₹30,000', (await c.getByTestId('agr-status').innerText()) === 'Active' && (await c.getByTestId('agr-rent').innerText()) === '₹10,000' && (await c.getByTestId('agr-total').innerText()) === '₹1,20,000' && (await c.getByTestId('agr-paid').innerText()) === '₹30,000', norm(await c.innerText()).slice(0, 120))
  check('A2 Case 5 in the UI: no outstanding banner, "owed for leaving early" ₹0, no pay button', (await A.page.getByTestId('outstanding-banner').count()) === 0 && (await c.getByTestId('agr-outstanding').innerText()) === '₹0' && (await A.page.getByTestId('pay-outstanding').count()) === 0)
  await A.page.screenshot({ path: `${OUT}/tenant-active.png`, fullPage: true })

  console.log('\n══ B. Owner: Agreements page, record a tenant leaving early ══')
  const O = await session()
  await uiLogin(O, 'vikram@propai.in', '/owner')
  await O.page.getByRole('link', { name: 'Agreements' }).click()
  await O.page.getByTestId('agreement-row').first().waitFor({ timeout: 20000 })
  check('B1 Owner opens Agreements from the sidebar; rows are real (tenant names)', O.page.url().endsWith('/owner/agreements') && (await row(O.page, 'Abandon UI 1').count()) === 1)
  const r1 = row(O.page, 'Abandon UI 1')
  check('B2 Active row: outstanding shown as — and a "Tenant left early" action', (await r1.getByTestId('ag-status').innerText()) === 'Active' && (await r1.getByTestId('ag-outstanding').innerText()) === '—' && (await r1.getByTestId('end-agreement').count()) === 1)
  await O.page.getByTestId('filter-outstanding').click(); await O.page.waitForTimeout(700)
  check('B3 "Outstanding" filter shows nothing before anyone leaves (no false positives)', (await O.page.getByTestId('agreement-row').filter({ hasText: 'Abandon UI' }).count()) === 0)
  await O.page.getByTestId('filter-all').click(); await O.page.waitForTimeout(700)

  await r1.getByTestId('end-agreement').click()
  await O.page.getByTestId('confirm-end').waitFor()
  const explain = norm(await O.page.getByTestId('end-explainer').innerText())
  check('B4 modal explains the rule with server figures: ₹10,000 × 12 = ₹1,20,000 less ₹30,000 paid; no penalties', /₹10,000 × 12 = ₹1,20,000/.test(explain) && /₹30,000 already paid/.test(explain) && /No penalties or fees/.test(explain), explain.slice(0, 160))
  await O.page.fill('#ea-date', new Date(Date.now() + 3 * 864e5).toISOString().slice(0, 10))
  await O.page.getByTestId('confirm-end').click()
  check('B5 future leave date rejected in the form', /can't be in the future/.test(await O.page.getByTestId('end-error').innerText()))
  await O.page.fill('#ea-date', today)
  await O.page.fill('#ea-reason', 'Moved to another city')
  await O.page.getByLabel('Abandoned').check()
  await O.page.screenshot({ path: `${OUT}/owner-end-modal.png` })
  await O.page.getByTestId('confirm-end').click()
  await O.page.getByTestId('confirm-end').waitFor({ state: 'detached', timeout: 15000 })
  await O.page.waitForTimeout(800)
  const r1b = row(O.page, 'Abandon UI 1')
  check('B6 row now Abandoned + Outstanding, ₹90,000 (1,20,000 − 30,000), paid ₹30,000', (await r1b.getByTestId('ag-status').innerText()) === 'Abandoned' && (await r1b.getByTestId('ag-settlement').innerText()) === 'Outstanding' && (await r1b.getByTestId('ag-outstanding').innerText()) === '₹90,000' && (await r1b.getByTestId('ag-paid').innerText()) === '₹30,000', norm(await r1b.innerText()).slice(0, 160))
  check('B7 leave date + reason shown; action button gone', /Reason: Moved to another city/.test(await r1b.innerText()) && (await r1b.getByTestId('end-agreement').count()) === 0)
  const tot = Number((await O.page.getByTestId('tot-outstanding').innerText()).replace(/[₹,]/g, ''))
  check('B8 totals: outstanding total includes the ₹90,000', tot >= 90000 && (await O.page.getByTestId('tot-owing').innerText()) !== '0', await O.page.getByTestId('tot-outstanding').innerText())
  await O.page.getByTestId('filter-outstanding').click(); await O.page.waitForTimeout(700)
  check('B9 Outstanding filter now lists that tenant', (await O.page.getByTestId('agreement-row').filter({ hasText: 'Abandon UI 1' }).count()) === 1)
  await O.page.getByTestId('filter-all').click(); await O.page.waitForTimeout(600)
  await O.page.screenshot({ path: `${OUT}/owner-agreements.png`, fullPage: true })
  check('B10 property was released in the database', pg(`select coalesce(tenant_id::text,'none')||','||is_available from properties where id=${P[1]}`) === 'none,true')

  console.log('\n══ C. Owner records an agreement for a tenant who has none (tenant 4), completed-term case ══')
  await O.page.getByTestId('record-agreement').click()
  await O.page.getByTestId('save-agreement').waitFor()
  const opts = await O.page.locator('#ra-prop option').allInnerTexts()
  check('C1 dropdown lists only rented properties without a running agreement (ABN-UI home 4)', opts.includes('ABN-UI home 4') && !opts.includes('ABN-UI home 2'), opts.join('|').slice(0, 120))
  await O.page.selectOption('#ra-prop', String(P[4]))
  await O.page.fill('#ra-term', '0'); await O.page.getByTestId('save-agreement').click()
  check('C2 term 0 rejected in the form', /between 1 and 120/.test(await O.page.getByTestId('record-error').innerText()))
  await O.page.fill('#ra-term', '12'); await O.page.fill('#ra-start', '2024-01-01')
  await O.page.getByTestId('save-agreement').click()
  await O.page.getByTestId('save-agreement').waitFor({ state: 'detached', timeout: 15000 })
  await O.page.waitForTimeout(800)
  const r4 = row(O.page, 'Abandon UI 4')
  check('C3 Case 1 in the UI: the 2024 agreement is Completed, no outstanding, nothing to end', (await r4.getByTestId('ag-status').innerText()) === 'Completed' && (await r4.getByTestId('ag-outstanding').innerText()) === '—' && (await r4.getByTestId('end-agreement').count()) === 0, norm(await r4.innerText()).slice(0, 140))

  console.log('\n══ D. Tenant who left: sees what they owe, pays it down ══')
  await A.page.reload({ waitUntil: 'networkidle' })
  await A.page.getByTestId('outstanding-banner').waitFor({ timeout: 15000 })
  check('D1 red banner: "You have ₹90,000 outstanding"', (await A.page.getByTestId('outstanding-total').innerText()) === '₹90,000')
  const d = A.page.getByTestId('agreement-card').first()
  check('D2 card: Abandoned + Outstanding, ₹90,000 still outstanding, explanation with sums and no extra charges', (await d.getByTestId('agr-status').innerText()) === 'Abandoned' && (await d.getByTestId('agr-settlement').innerText()) === 'Outstanding' && (await d.getByTestId('agr-outstanding').innerText()) === '₹90,000' && /₹1,20,000 − ₹30,000 already paid = ₹90,000\. No extra charges/.test(norm(await d.getByTestId('agr-alert').innerText())), norm(await d.getByTestId('agr-alert').innerText()).slice(0, 200))
  check('D3 no "rent due" card for the property they no longer rent', (await A.page.getByTestId('current-payment').count()) === 0)
  await A.page.screenshot({ path: `${OUT}/tenant-outstanding.png`, fullPage: true })
  await A.page.getByTestId('pay-outstanding').click()
  await A.page.getByTestId('save-payment').waitFor()
  check('D4 modal: title "Pay outstanding balance", amount prefilled 90000, purpose locked to Rent, hint states ceiling', (await A.page.getByRole('dialog').getByRole('heading', { name: 'Pay outstanding balance' }).count()) === 1 && (await A.page.locator('#rp-amount').inputValue()) === '90000' && (await A.page.locator('#rp-type').isDisabled()) && /up to ₹90,000/.test(await A.page.getByTestId('modal-hint').innerText()))
  await A.page.fill('#rp-amount', '90000.5'); await A.page.getByTestId('save-payment').click()
  check('D5 paying more than owed is refused in the form', /more than the ₹90,000 outstanding/.test(await A.page.locator('#rp-amount').locator('xpath=..').innerText()))
  // tamper: bypass the form and send an over-payment + a smaller "outstanding" straight to the API
  const tam = await j('/financial/payments', { method: 'POST', body: JSON.stringify({ amount: 95000, payment_date: today, property_id: P[1], payment_type: 'rent', agreement_id: Number(pg(`select id from agreements where tenant_id=${T[1]}`)) }) }, TOK[1])
  check('D6 bypassing the form with an over-payment is refused by the server (422)', tam.status === 422, JSON.stringify(tam.body).slice(0, 120))
  await A.page.fill('#rp-amount', '40000'); await A.page.getByTestId('save-payment').click()
  await A.page.getByTestId('save-payment').waitFor({ state: 'detached', timeout: 15000 })
  await A.page.getByTestId('outstanding-total').waitFor()
  await A.page.waitForTimeout(600)
  check('D7 after paying ₹40,000: outstanding ₹50,000, paid ₹70,000 (no double charge)', (await A.page.getByTestId('outstanding-total').innerText()) === '₹50,000' && (await A.page.getByTestId('agr-paid').first().innerText()) === '₹70,000', await A.page.getByTestId('outstanding-total').innerText())
  check('D8 new payment in the transaction history as Rent / Completed', (await A.page.getByTestId('txn-row').filter({ hasText: '₹40,000' }).count()) === 1)
  await A.page.getByTestId('pay-outstanding').click(); await A.page.getByTestId('save-payment').waitFor()
  check('D9 modal now prefilled with the remaining ₹50,000', (await A.page.locator('#rp-amount').inputValue()) === '50000')
  await A.page.getByTestId('save-payment').click()
  await A.page.getByTestId('save-payment').waitFor({ state: 'detached', timeout: 15000 })
  await A.page.getByTestId('agr-settled').waitFor({ timeout: 15000 })
  check('D10 Case 4 in the UI: fully paid -> Settled, banner gone, no pay button, "Everything ... has been paid"', (await A.page.getByTestId('outstanding-banner').count()) === 0 && (await A.page.getByTestId('pay-outstanding').count()) === 0 && (await A.page.getByTestId('agr-settlement').first().innerText()) === 'Settled' && (await A.page.getByTestId('agr-outstanding').first().innerText()) === '₹0')
  await A.page.screenshot({ path: `${OUT}/tenant-settled.png`, fullPage: true })
  await A.page.goto(`${BASE}/tenant/notifications`, { waitUntil: 'networkidle' })
  const nt = norm(await A.page.locator('main').innerText())
  check('D11 the tenant was notified of the abandonment and the amount', /Agreement abandoned/i.test(nt) && /₹90,000/.test(nt), nt.slice(0, 160))

  console.log('\n══ E. Manager sees everything ══')
  const M = await session()
  await uiLogin(M, 'rajesh@propai.in', '/manager')
  await M.page.getByRole('link', { name: 'Agreements' }).click()
  await M.page.getByTestId('agreement-row').first().waitFor({ timeout: 20000 })
  check('E1 Manager list includes owner vikram\'s tenants (Abandon UI 1 Settled, ₹0) and seeded tenants', (await row(M.page, 'Abandon UI 1').getByTestId('ag-settlement').innerText()) === 'Settled' && (await row(M.page, 'Abandon UI 1').getByTestId('ag-outstanding').innerText()) === '₹0' && (await M.page.getByTestId('agreement-row').count()) >= 7)
  await M.page.getByTestId('filter-abandoned').click(); await M.page.waitForTimeout(700)
  check('E2 "Abandoned" filter narrows to abandonment rows', (await M.page.getByTestId('agreement-row').filter({ hasText: 'Abandon UI 1' }).count()) === 1 && (await M.page.locator('[data-testid=agreement-row]:not([data-status=abandoned])').count()) === 0)
  await M.page.getByTestId('filter-terminated').click(); await M.page.waitForTimeout(700)
  check('E3 empty filter shows a friendly empty state', (await M.page.getByText('No agreements match').count()) === 1)

  console.log('\n══ F. Other owner sees none of these; tenant cannot open the owner page ══')
  const priya = await session()
  await uiLogin(priya, 'priya@propai.in', '/owner')
  await priya.page.goto(`${BASE}/owner/agreements`, { waitUntil: 'networkidle' })
  await priya.page.waitForTimeout(800)
  check('F1 another owner sees no ABN rows', (await priya.page.getByTestId('agreement-row').filter({ hasText: 'Abandon UI' }).count()) === 0)
  const tenant2 = await j('/agreements', {}, TOK[2])
  check('F2 tenant API for owner-only action refused: POST /agreements as tenant -> 403', (await j('/agreements', { method: 'POST', body: JSON.stringify({ property_id: P[2], start_date: today }) }, TOK[2])).status === 403 && tenant2.status === 200)

  console.log('\n══ G. Responsive + themes + contrast + console ══')
  await contrast(O.page, 'owner agreements (light)')
  await setTheme(O.page, 'dark'); await O.page.getByTestId('agreement-row').first().waitFor()
  await contrast(O.page, 'owner agreements (dark)')
  await O.page.screenshot({ path: `${OUT}/owner-dark.png`, fullPage: true })
  await A.page.goto(`${BASE}/tenant/payments`, { waitUntil: 'networkidle' }); await A.page.getByTestId('agreement-card').first().waitFor()
  await contrast(A.page, 'tenant payments (light)')
  await setTheme(A.page, 'dark'); await A.page.getByTestId('agreement-card').first().waitFor()
  await contrast(A.page, 'tenant payments (dark)')
  // outstanding state at phone width: use tenant 2 after they leave
  await j(`/agreements/${(await j('/agreements', {}, TOK[2])).body.items[0].id}/end`, { method: 'POST', body: JSON.stringify({ status: 'terminated', reason: 'Phone view' }) }, owner.tok)
  const Ph = await session({ viewport: { width: 390, height: 900 } })
  await uiLogin(Ph, 'abn_ui2@example.com', '/tenant')
  await Ph.page.goto(`${BASE}/tenant/payments`, { waitUntil: 'networkidle' }); await Ph.page.getByTestId('outstanding-banner').waitFor()
  check('G1 phone width: no horizontal scroll on tenant Payments with an outstanding agreement', !(await overflow(Ph.page)))
  check('G2 phone: banner shows ₹1,20,000 and Terminated status', (await Ph.page.getByTestId('outstanding-total').innerText()) === '₹1,20,000' && (await Ph.page.getByTestId('agr-status').first().innerText()) === 'Terminated')
  await Ph.page.screenshot({ path: `${OUT}/tenant-phone.png`, fullPage: true })
  await Ph.page.getByTestId('pay-outstanding').click(); await Ph.page.getByTestId('save-payment').waitFor()
  check('G3 phone: payment modal fits (no horizontal scroll)', !(await overflow(Ph.page)))
  const Po = await session({ viewport: { width: 390, height: 900 } })
  await uiLogin(Po, 'vikram@propai.in', '/owner')
  await Po.page.goto(`${BASE}/owner/agreements`, { waitUntil: 'networkidle' }); await Po.page.getByTestId('agreement-row').first().waitFor()
  check('G4 phone: owner Agreements has no horizontal scroll', !(await overflow(Po.page)))
  await Po.page.screenshot({ path: `${OUT}/owner-phone.png`, fullPage: true })

  const errs = sessions.flatMap((s) => [...s.log.pageErrors, ...s.log.consoleErrors]).filter((e) => !/favicon\.ico/.test(e))
  check('G5 no uncaught page errors / console errors in any session (known favicon 404 excluded)', errs.length === 0, errs.slice(0, 3).join(' | ') + ' :: ' + sessions.flatMap((s) => s.log.failed).join(', '))
  const failed = sessions.flatMap((s) => s.log.failed).filter((f) => !/^422 \/financial\/payments$/.test(f))
  check('G6 no unexpected failing API calls', failed.length === 0, failed.slice(0, 5).join(' | '))
} finally {
  for (const s of sessions) await s.ctx.close().catch(() => {})
  await browser.close()
  const ids = Object.values(T).join(',') || '0', pids = Object.values(P).join(',') || '0'
  pg(`delete from payments where tenant_id in (${ids}); delete from agreements where tenant_id in (${ids}) or property_id in (${pids}); delete from properties where id in (${pids}); delete from users where id in (${ids});`)
  if (Object.keys(T).length) mongo(`d.notifications.deleteMany({user_id:{$in:[${ids}]}}); d.rental_applications.deleteMany({tenant_id:{$in:[${ids}]}}); d.notifications.deleteMany({message:/ABN-UI|Abandon UI/});`)
  const after = ['users', 'properties', 'payments', 'agreements'].map((t) => pg(`select count(*) from ${t}`)).join(',')
  check('CLEANUP: table counts back to baseline', after === BASEC, `${BASEC} vs ${after}`)
  const left = mongo(`print(d.notifications.countDocuments({message:/ABN-UI|Abandon UI/}))`)
  check('CLEANUP: no ABN-UI notifications left in Mongo', left === '0', left)
  console.log(`\n${results.filter(Boolean).length}/${results.length} passed`)
  process.exit(results.every(Boolean) ? 0 : 1)
}
