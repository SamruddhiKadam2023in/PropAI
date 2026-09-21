import { chromium } from 'playwright-core'
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'

const BASE = 'http://localhost:3000', API = 'http://localhost:8000'
const OUT = path.resolve('shots/payments'); fs.mkdirSync(OUT, { recursive: true })
const DL = path.resolve('..', '.artifacts', 'exports', 'payments'); fs.mkdirSync(DL, { recursive: true })
const PY = process.env.PYTHON || 'python'
const src = fs.readFileSync('audit.mjs', 'utf8')
const auditFn = new Function('return ' + src.match(/const auditFn = (\(\) => \{[\s\S]*?\r?\n\})\r?\n\r?\nconst browser/)[1])()
const results = []
const check = (name, ok, detail = '') => { results.push(!!ok); console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail !== '' ? `  [${String(detail).slice(0, 170)}]` : '')) }
const pg = (sql) => execFileSync('docker', ['exec', '-i', 'property_postgres', 'psql', '-U', 'postgres', '-d', 'property_management', '-At'], { encoding: 'utf8', input: sql }).trim()
const login = async (email) => { const d = await (await fetch(`${API}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: 'PropAI@2024' }) })).json(); return d.access_token }
const norm = (s) => s.replace('Sept', 'Sep').replace(/\s+/g, ' ').trim()

const ORIG = "select md5(string_agg(t::text, '|' order by id)) from (select id, amount, payment_date, status, month, notes, receipt_url, created_at, tenant_id, property_id from payments where notes is distinct from 'PAYTEST') t"
const T0 = new Date().toISOString().slice(0, 19)
const mongoClean = () => execFileSync('docker', ['exec', '-i', 'property_mongodb', 'mongosh', '-u', 'mongo', '-p', 'mongo123', '--authenticationDatabase', 'admin', '--quiet', '--eval', `db.getSiblingDB("property_management").notifications.deleteMany({title:"Payment recorded", created_at:{$gte:"${T0}"}})`])
const before = pg(ORIG)
const origP6 = pg('select tenant_id, is_available from properties where id=6')
const today = (await (await fetch(`${API}/financial/payments/summary`, { headers: { Authorization: `Bearer ${await login('amit@example.in')}` } })).json()).today

const browser = await chromium.launch({ executablePath: process.env.BROWSER_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', headless: true })
const sessions = []
async function session(tok, { theme = 'light', viewport = { width: 1440, height: 1500 }, timezoneId = 'Asia/Kolkata' } = {}) {
  const ctx = await browser.newContext({ viewport, colorScheme: theme, timezoneId, acceptDownloads: true })
  await ctx.addInitScript(([t, k]) => { if (k) localStorage.setItem('token', k); if (!sessionStorage.getItem('seeded')) { localStorage.setItem('propai-theme', t); sessionStorage.setItem('seeded', '1') } }, [theme, tok])
  const page = await ctx.newPage()
  const log = { pageErrors: [], consoleErrors: [], requests: [] }
  page.on('pageerror', (e) => log.pageErrors.push(e.message.slice(0, 200)))
  page.on('console', (m) => { if (m.type() === 'error') log.consoleErrors.push(m.text().slice(0, 200)) })
  page.on('request', (r) => log.requests.push(`${r.method()} ${new URL(r.url()).pathname}`))
  const s = { ctx, page, log }; sessions.push(s); return s
}
const contrast = async (p, label) => { const f = await p.evaluate(auditFn); check(`contrast (0 failures): ${label}`, f.length === 0, f.length ? JSON.stringify(f.slice(0, 3)) : '') }
const setTheme = async (p, t) => { await p.evaluate((v) => localStorage.setItem('propai-theme', v), t); await p.reload({ waitUntil: 'networkidle' }); await p.waitForTimeout(400) }
const rows = (p) => p.getByTestId('txn-row')
const gotoPayments = async (p) => { await p.goto(`${BASE}/tenant/payments`, { waitUntil: 'domcontentloaded' }) }
const ready = async (p) => { await p.getByTestId('txn-row').or(p.getByText('No transactions yet')).first().waitFor({ timeout: 20000 }); await p.waitForTimeout(200) }

const tempIds = {}
try {
  console.log('\n══ A. Existing tenant (Amit): login -> Payments ══')
  const A = await session(null)
  await A.page.goto(`${BASE}/login`, { waitUntil: 'networkidle' })
  await A.page.fill('input[type=email]', 'amit@example.in'); await A.page.fill('input[type=password]', 'PropAI@2024')
  await A.page.locator('button[type=submit]').click()
  await A.page.waitForURL('**/tenant', { timeout: 15000 })
  await A.page.getByRole('link', { name: 'Payments' }).click()
  await A.page.getByRole('heading', { name: 'Payments', exact: true }).waitFor()
  await ready(A.page)
  check('A1 Tenant logs in through the real form and opens Payments from the sidebar', A.page.url().endsWith('/tenant/payments'))
  const cur = A.page.getByTestId('current-payment')
  const ct = norm(await cur.innerText())
  check('A2 current payment: "Rent due for September 2026", ₹48,000, status Due', /Rent due for September 2026/i.test(ct) && (await A.page.getByTestId('rent-due').innerText()) === '₹48,000' && (await A.page.getByTestId('period-status').innerText()) === 'Due', ct.slice(0, 90))
  check('A3 paid ₹0 / outstanding ₹48,000 / awaiting ₹0', (await A.page.getByTestId('paid-amount').innerText()) === '₹0' && (await A.page.getByTestId('balance-amount').innerText()) === '₹48,000' && (await A.page.getByTestId('pending-amount').innerText()) === '₹0')
  check('A4 property reference (Antriksh Heights, address) and last payment (₹48,000 on 01 Dec 2025 · Rent · TXN-000012)', (await A.page.getByTestId('property-title').innerText()).startsWith('Antriksh Heights') && /Andheri West/.test(ct) && /₹48,000 on 01 Dec 2025/.test(norm(await A.page.getByTestId('last-payment').innerText())) && /TXN-000012/.test(await A.page.getByTestId('last-payment').innerText()), norm(await A.page.getByTestId('last-payment').innerText()))
  check('A5 totals: ₹5,76,000 paid, 12 completed, 12 transactions (from the database)', (await A.page.getByTestId('total-paid').innerText()) === '₹5,76,000' && (await A.page.getByTestId('total-completed').innerText()) === '12' && (await A.page.getByTestId('total-transactions').innerText()) === '12')
  check('A6 history: 10 rows on page 1, pager "Page 1 of 2", count "12 of 12 transactions"', (await rows(A.page).count()) === 10 && /Page 1 of 2/.test(await A.page.getByTestId('pager').innerText()) && /12 of 12 transactions/.test(await A.page.getByTestId('txn-count').innerText()))
  const first = rows(A.page).first()
  check('A7 first row: TXN-000012 · 01 Dec 2025 · Rent for Dec 2025 · property · ₹48,000 · Completed · Receipt',
    (await first.getByTestId('txn-id').innerText()) === 'TXN-000012' && norm(await first.getByTestId('txn-date').innerText()) === '01 Dec 2025' && (await first.getByTestId('txn-type').innerText()) === 'Rent' && /for Dec 2025/.test(norm(await first.innerText())) && /Monthly rent — /.test(await first.getByTestId('txn-notes').innerText())
    && (await first.getByTestId('txn-property').innerText()).startsWith('Antriksh') && (await first.getByTestId('txn-amount').innerText()) === '₹48,000' && (await first.getByTestId('txn-status').innerText()) === 'Completed' && (await first.getByTestId('download-receipt').count()) === 1, norm(await first.innerText()).slice(0, 120))
  check('A8 the columns are labelled: Transaction ID, Date, Purpose, Property, Amount, Status, Receipt', JSON.stringify((await A.page.locator('thead th').allInnerTexts()).map((t) => t.trim().toLowerCase())) === JSON.stringify(['transaction id', 'date', 'purpose', 'property', 'amount', 'status', 'receipt']))
  const ids = await rows(A.page).getByTestId('txn-id').allInnerTexts()
  check('A9 newest first, IDs unique (TXN-000012 … TXN-000003)', ids[0] === 'TXN-000012' && ids[9] === 'TXN-000003' && new Set(ids).size === 10, ids.join(','))
  await A.page.getByRole('button', { name: /Next/ }).click(); await A.page.waitForTimeout(200)
  check('A10 page 2 has the remaining 2 (TXN-000002, TXN-000001)', JSON.stringify(await rows(A.page).getByTestId('txn-id').allInnerTexts()) === JSON.stringify(['TXN-000002', 'TXN-000001']))
  await A.page.getByRole('button', { name: /Previous/ }).click()
  await A.page.screenshot({ path: `${OUT}/A-payments-light.png` }); await contrast(A.page, 'Payments page (light)')

  console.log('\n══ B. Filters, receipts, other viewers ══')
  const opts = await A.page.getByTestId('filter-type').locator('option').allInnerTexts()
  check('B1 the purpose filter only offers purposes that exist (All + Rent)', JSON.stringify(opts) === JSON.stringify(['All purposes', 'Rent']), opts.join('|'))
  await A.page.getByTestId('filter-status').selectOption('pending')
  await A.page.getByText('No transactions match').waitFor()
  check('B2 a filter with no matches -> friendly message + "Clear filters"', (await A.page.getByRole('button', { name: 'Clear filters' }).isVisible()) && (await rows(A.page).count()) === 0)
  await A.page.getByRole('button', { name: 'Clear filters' }).click(); await A.page.waitForTimeout(200)
  check('B3 clearing restores all 12', /12 of 12/.test(await A.page.getByTestId('txn-count').innerText()))
  const [dl] = await Promise.all([A.page.waitForEvent('download', { timeout: 20000 }), rows(A.page).first().getByTestId('download-receipt').click()])
  await dl.saveAs(`${DL}/receipt.pdf`)
  const rec = execFileSync(PY, ['-c', `import pypdfium2 as p;d=p.PdfDocument(r"${DL}\\receipt.pdf");print(" ".join(d[i].get_textpage().get_text_bounded() for i in range(len(d))).replace("\\r\\n"," ").replace("\\n"," "))`], { encoding: 'utf8', env: { ...process.env, PYTHONIOENCODING: 'utf-8' } })
  check('B4 the receipt downloads (named by the server) and opens: Amit Kumar, ₹48,000, December 2025', /^receipt_12\.pdf$/.test(dl.suggestedFilename()) && /Amit Kumar/.test(rec) && /48,000/.test(rec) && /2025-12/.test(rec), `${dl.suggestedFilename()} :: ${rec.slice(0, 80)}`)
  const LA = await session(await login('amit@example.in'), { timezoneId: 'America/Los_Angeles' })
  await gotoPayments(LA.page); await ready(LA.page)
  check('B5 a viewer in Los Angeles (UTC-8) sees the same dates - 01 Dec 2025, not 30 Nov', norm(await rows(LA.page).first().getByTestId('txn-date').innerText()) === '01 Dec 2025' && /Rent due for September 2026/i.test(await LA.page.getByTestId('current-payment').innerText()))
  const S = await session(await login('sneha@example.in'))
  await gotoPayments(S.page); await ready(S.page)
  const st = await S.page.locator('body').innerText()
  check('B6 Sneha sees only HER data: Hinjawadi, ₹18,500, ₹2,22,000 paid - nothing of Amit\'s', /Hinjawadi/.test(st) && !/Antriksh|TXN-000012/.test(st) && (await S.page.getByTestId('rent-due').innerText()) === '₹18,500' && (await S.page.getByTestId('total-paid').innerText()) === '₹2,22,000')
  const owned = (await S.page.getByTestId('txn-row').getByTestId('txn-id').allInnerTexts()).map((t) => Number(t.slice(4)))
  check('B7 every transaction ID Sneha sees is one of her own rows (13..24)', owned.length === 10 && owned.every((n) => n >= 13 && n <= 24), owned.join(','))

  console.log('\n══ C. Recording a payment ══')
  await A.page.getByTestId('record-payment').click()
  const dlg = A.page.getByRole('dialog', { name: 'Record a payment' }); await dlg.waitFor()
  await dlg.getByTestId('save-payment').click()
  check('C1 empty amount -> message, nothing sent', (await dlg.getByText(/more than ₹0/).count()) === 1 && !A.log.requests.some((r) => r.startsWith('POST /financial/payments')))
  await dlg.locator('#rp-amount').fill('-5'); await dlg.getByTestId('save-payment').click()
  check('C2 negative amount rejected in the form', (await dlg.getByText(/more than ₹0/).count()) === 1)
  await A.page.screenshot({ path: `${OUT}/C-record-errors.png` }); await contrast(A.page, 'Record payment form with errors (light)')
  await dlg.locator('#rp-amount').fill('1500'); await dlg.locator('#rp-type').selectOption('maintenance'); await dlg.locator('#rp-notes').fill('PAYTEST')
  await dlg.getByTestId('save-payment').click()
  await A.page.getByText('Payment recorded').waitFor({ timeout: 8000}); await A.page.waitForTimeout(500)
  const top = rows(A.page).first()
  check('C3 recorded: it is the newest row - Maintenance charge, ₹1,500, Completed, dated TODAY (business date)', (await top.getByTestId('txn-type').innerText()) === 'Maintenance charge' && (await top.getByTestId('txn-amount').innerText()) === '₹1,500' && (await top.getByTestId('txn-status').innerText()) === 'Completed' && /^TXN-\d{6}$/.test(await top.getByTestId('txn-id').innerText()) && norm(await top.getByTestId('txn-date').innerText()) === norm(new Date(Number(today.slice(0, 4)), Number(today.slice(5, 7)) - 1, Number(today.slice(8))).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })))
  check('C4 totals updated (₹5,77,500 paid, 13 transactions); rent still outstanding (a maintenance charge is not rent)', (await A.page.getByTestId('total-paid').innerText()) === '₹5,77,500' && (await A.page.getByTestId('total-transactions').innerText()) === '13' && (await A.page.getByTestId('balance-amount').innerText()) === '₹48,000')
  check('C5 the purpose filter now includes "Maintenance charge"', (await A.page.getByTestId('filter-type').locator('option').allInnerTexts()).includes('Maintenance charge'))
  await A.page.getByTestId('record-payment').click()
  const d2 = A.page.getByRole('dialog', { name: 'Record a payment' }); await d2.waitFor()
  await d2.locator('#rp-amount').fill('48000'); await d2.locator('#rp-notes').fill('PAYTEST'); await d2.getByTestId('save-payment').click()
  await A.page.getByText('Payment recorded').first().waitFor({ timeout: 8000 }); await A.page.waitForTimeout(600)
  check('C6 recording the full rent -> "Paid", outstanding ₹0', (await A.page.getByTestId('period-status').innerText()) === 'Paid' && (await A.page.getByTestId('balance-amount').innerText()) === '₹0' && (await A.page.getByTestId('paid-amount').innerText()) === '₹48,000')
  check('C7 the payment was sent with today\'s BUSINESS date (from the server), not the browser clock', A.log.requests.filter((r) => r.startsWith('POST /financial/payments')).length === 2)
  await A.page.screenshot({ path: `${OUT}/C-after-payments.png` })
  pg("delete from payments where notes='PAYTEST'")

  console.log('\n══ D. Empty state / no property / multiple statuses ══')
  pg("insert into users (email, full_name, hashed_password, role, is_active) select 'ptest_empty@example.in', 'Empty Tenant', hashed_password, 'TENANT', true from users where id=5; insert into users (email, full_name, hashed_password, role, is_active) select 'ptest_noprop@example.in', 'Nohome Tenant', hashed_password, 'TENANT', true from users where id=5;")
  for (const l of pg("select email||'|'||id from users where email like 'ptest_%'").split('\n')) { const [e, i] = l.split('|'); tempIds[e] = Number(i) }
  pg(`update properties set tenant_id=${tempIds['ptest_empty@example.in']}, is_available=false where id=6;`)
  const E = await session(await login('ptest_empty@example.in'))
  await gotoPayments(E.page)
  await E.page.getByText('No transactions yet').waitFor({ timeout: 15000 })
  check('D1 tenant with a property but NO transactions: current payment shown (Bandra West ₹65,000 due) + "No transactions yet" empty state', (await E.page.getByTestId('rent-due').innerText()) === '₹65,000' && (await E.page.getByTestId('property-title').innerText()) === 'Bandra West 2BHK' && (await E.page.getByText('No transactions yet').isVisible()) && /No completed payment yet/.test(await E.page.getByTestId('last-payment').innerText()))
  check('D2 totals are zero (₹0 / 0 / 0)', (await E.page.getByTestId('total-paid').innerText()) === '₹0' && (await E.page.getByTestId('total-transactions').innerText()) === '0')
  await E.page.screenshot({ path: `${OUT}/D-empty.png` }); await contrast(E.page, 'Payments - empty state (light)')
  const N = await session(await login('ptest_noprop@example.in'))
  await gotoPayments(N.page); await N.page.getByText('No rented property yet').waitFor({ timeout: 15000 })
  check('D3 tenant with NO property: "No rented property yet" + no record button; history empty', (await N.page.getByTestId('record-payment').count()) === 0 && (await N.page.getByText('No transactions yet').isVisible()))
  pg(`insert into payments (amount, payment_date, status, month, payment_type, notes, tenant_id, property_id) values
    (65000, '2026-07-05 06:30:00+00', 'COMPLETED', '2026-07', 'rent', 'PAYTEST', ${tempIds['ptest_empty@example.in']}, 6),
    (130000, '2026-06-01 06:30:00+00', 'COMPLETED', '2026-06', 'security_deposit', 'PAYTEST', ${tempIds['ptest_empty@example.in']}, 6),
    (65000, '2026-09-12 06:30:00+00', 'PENDING', '${today.slice(0, 7)}', 'rent', 'PAYTEST', ${tempIds['ptest_empty@example.in']}, 6),
    (65000, '2026-09-13 06:30:00+00', 'FAILED', '${today.slice(0, 7)}', 'rent', 'PAYTEST', ${tempIds['ptest_empty@example.in']}, 6),
    (4200, '2026-09-10 06:30:00+00', 'COMPLETED', '2026-09', 'utility', 'PAYTEST', ${tempIds['ptest_empty@example.in']}, 6);`)
  await E.page.reload({ waitUntil: 'domcontentloaded' }); await rows(E.page).first().waitFor({ timeout: 15000 }); await E.page.waitForTimeout(300)
  const stat = await rows(E.page).evaluateAll((trs) => trs.map((r) => ({ s: r.dataset.status, receipt: !!r.querySelector('[data-testid=download-receipt]'), type: r.querySelector('[data-testid=txn-type]').innerText })))
  check('D4 five transactions with mixed statuses and purposes (Rent, Security deposit, Utility bill)', stat.length === 5 && new Set(stat.map((x) => x.s)).size === 3 && new Set(stat.map((x) => x.type)).size === 3, JSON.stringify(stat.map((x) => x.s)))
  check('D5 the Receipt button appears only for Completed payments', stat.every((x) => x.receipt === (x.s === 'completed')))
  check('D6 badges: Completed (green) / Pending / Failed', JSON.stringify([...new Set(await E.page.getByTestId('txn-status').allInnerTexts())].sort()) === JSON.stringify(['Completed', 'Failed', 'Pending']))
  check('D7 the pending ₹65,000 is shown as "Awaiting confirmation" - not counted as paid', (await E.page.getByTestId('pending-amount').innerText()) === '₹65,000' && (await E.page.getByTestId('paid-amount').innerText()) === '₹0' && (await E.page.getByTestId('balance-amount').innerText()) === '₹65,000')
  await E.page.getByTestId('filter-status').selectOption('failed'); await E.page.waitForTimeout(200)
  check('D8 filter by status: Failed -> 1 row', (await rows(E.page).count()) === 1 && (await rows(E.page).first().getByTestId('txn-status').innerText()) === 'Failed')
  await E.page.getByTestId('filter-status').selectOption('all'); await E.page.getByTestId('filter-type').selectOption('security_deposit'); await E.page.waitForTimeout(200)
  check('D9 filter by purpose: Security deposit -> ₹1,30,000', (await rows(E.page).count()) === 1 && (await rows(E.page).first().getByTestId('txn-amount').innerText()) === '₹1,30,000')
  await E.page.getByTestId('filter-type').selectOption('all')
  await E.page.screenshot({ path: `${OUT}/D-multiple-statuses.png` })

  console.log('\n══ E. Loading and error states ══')
  const L = await session(await login('amit@example.in'))
  await L.page.route('**/financial/payments**', async (r) => { await new Promise((z) => setTimeout(z, 1500)); try { await r.continue() } catch {} })
  await gotoPayments(L.page)
  await L.page.getByTestId('payments-loading').waitFor({ timeout: 5000 })
  check('E1 loading skeleton shown while the data loads (labelled for screen readers)', (await L.page.getByTestId('payments-loading').getAttribute('aria-label')) === 'Loading your payments')
  await L.page.screenshot({ path: `${OUT}/E-loading.png` })
  await ready(L.page); await L.page.unroute('**/financial/payments**')
  await L.page.route('**/financial/payments/summary', (r) => r.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ detail: 'boom' }) }))
  await L.page.reload({ waitUntil: 'domcontentloaded' })
  await L.page.getByText("Couldn't load your payments").waitFor({ timeout: 10000 })
  check('E2 a server error -> error state with a Try again button (no blank page, no stale data)', (await L.page.getByRole('button', { name: /Try again/ }).isVisible()) && (await L.page.getByTestId('current-payment').count()) === 0)
  await L.page.screenshot({ path: `${OUT}/E-error.png` }); await contrast(L.page, 'Payments - error state (light)')
  await L.page.unroute('**/financial/payments/summary')
  await L.page.getByRole('button', { name: /Try again/ }).click(); await ready(L.page)
  check('E3 "Try again" recovers and shows the data', (await rows(L.page).count()) === 10)
  await L.page.route('**/financial/payments', (r) => r.abort('failed'))
  await L.page.reload({ waitUntil: 'domcontentloaded' })
  await L.page.getByText("Couldn't load your payments").waitFor({ timeout: 10000 })
  check('E4 a network failure is handled the same way', /connection|Network/i.test(await L.page.locator('[role=alert]').first().innerText()))

  console.log('\n══ F. Phone width, dark mode, the rest of the tenant app, console ══')
  const M = await session(await login('amit@example.in'), { viewport: { width: 400, height: 900 } })
  await gotoPayments(M.page); await M.page.getByTestId('txn-card').first().waitFor({ timeout: 15000 })
  check('F1 phone: history becomes cards (table hidden), 10 cards, page does not scroll sideways', (await M.page.getByTestId('txn-card').count()) === 10 && !(await M.page.locator('table').first().isVisible()) && (await M.page.evaluate(() => (window.scrollTo(500, 0), window.scrollX))) === 0)
  const card = M.page.getByTestId('txn-card').first()
  check('F2 a card shows ID, date, amount, status, purpose, property and a Receipt button', (await card.getByTestId('txn-id').innerText()) === 'TXN-000012' && norm(await card.getByTestId('txn-date').innerText()) === '01 Dec 2025' && (await card.getByTestId('txn-amount').innerText()) === '₹48,000' && (await card.getByTestId('txn-status').innerText()) === 'Completed' && (await card.getByTestId('download-receipt').isVisible()))
  await M.page.screenshot({ path: `${OUT}/F-phone.png` }); await contrast(M.page, 'Payments at phone width')
  await setTheme(A.page, 'dark'); await ready(A.page)
  await A.page.screenshot({ path: `${OUT}/F-dark.png` }); await contrast(A.page, 'Payments page (dark)')
  await A.page.getByTestId('record-payment').click(); await A.page.getByRole('dialog').getByTestId('save-payment').click()
  await contrast(A.page, 'Record payment form with errors (dark)'); await A.page.keyboard.press('Escape')
  await A.page.getByRole('link', { name: 'Dashboard' }).first().click(); await A.page.getByText('Rent Payment History').first().waitFor({ timeout: 15000 })
  check('F3 the tenant Overview page (other module) still works, incl. its own Rent Payment History card', true)
  const uncaught = sessions.flatMap((s) => s.log.pageErrors)
  const unexpected = sessions.flatMap((s) => s.log.consoleErrors).filter((m) => !/Failed to load resource|net::ERR_FAILED/.test(m))
  check('F4 no JavaScript errors and no unexpected console errors', uncaught.length === 0 && unexpected.length === 0, JSON.stringify([...uncaught, ...new Set(unexpected)]))
} finally {
  pg("delete from payments where notes='PAYTEST'; update properties set tenant_id=NULL, is_available=true where id=6; delete from users where email like 'ptest_%';")
  mongoClean()
  for (const s of sessions) await s.ctx.close().catch(() => {})
  await browser.close()
  console.log(`\ncleanup: payments ${pg('select count(*) from payments')} (60 originals) unchanged: ${pg(ORIG) === before}; Bandra West restored: ${pg('select tenant_id, is_available from properties where id=6') === origP6}; temp users left: ${pg("select count(*) from users where email like 'ptest_%'")}`)
}
console.log(`\n${results.filter(Boolean).length}/${results.length} UI checks passed`)
process.exit(results.every(Boolean) ? 0 : 1)
