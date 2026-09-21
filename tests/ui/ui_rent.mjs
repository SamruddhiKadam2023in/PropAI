import { chromium } from 'playwright-core'
import fs from 'node:fs'
import { execFileSync } from 'node:child_process'

const BASE = 'http://localhost:3000', API = 'http://localhost:8000'
const OUT = 'shots/rent'; fs.mkdirSync(OUT, { recursive: true })
const src = fs.readFileSync('audit.mjs', 'utf8')
const auditFn = new Function('return ' + src.match(/const auditFn = (\(\) => \{[\s\S]*?\r?\n\})\r?\n\r?\nconst browser/)[1])()
const results = []
const check = (name, ok, detail = '') => { results.push(!!ok); console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail !== '' ? `  [${String(detail).slice(0, 170)}]` : '')) }
const pg = (sql) => execFileSync('docker', ['exec', 'property_postgres', 'psql', '-U', 'postgres', '-d', 'property_management', '-Atc', sql], { encoding: 'utf8' }).trim()
const login = async (email) => { const d = await (await fetch(`${API}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: 'PropAI@2024' }) })).json(); return { tok: d.access_token, h: { Authorization: `Bearer ${d.access_token}`, 'Content-Type': 'application/json' } } }

const browser = await chromium.launch({ executablePath: process.env.BROWSER_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', headless: true })
const sessions = []
async function session(tok, timezoneId = 'Asia/Kolkata', theme = 'light', viewport = { width: 1440, height: 1300 }) {
  const ctx = await browser.newContext({ viewport, colorScheme: theme, timezoneId })
  await ctx.addInitScript(([t, k]) => { localStorage.setItem('token', k); if (!sessionStorage.getItem('seeded')) { localStorage.setItem('propai-theme', t); sessionStorage.setItem('seeded', '1') } }, [theme, tok])
  const page = await ctx.newPage()
  const log = { pageErrors: [], consoleErrors: [], rc: [] }
  page.on('pageerror', (e) => log.pageErrors.push(e.message.slice(0, 200)))
  page.on('console', (m) => { if (m.type() === 'error') log.consoleErrors.push(m.text().slice(0, 200)) })
  page.on('request', (r) => { if (r.url().includes('/financial/rent-collection')) log.rc.push(new URL(r.url()).searchParams.toString()) })
  const s = { ctx, page, log }; sessions.push(s); return s
}
const contrast = async (p, label) => { const f = await p.evaluate(auditFn); check(`contrast (0 failures): ${label}`, f.length === 0, f.length ? JSON.stringify(f.slice(0, 3)) : '') }
const table = async (p) => (await p.locator('tbody tr').evaluateAll((trs) => trs.map((tr) => { const td = [...tr.querySelectorAll('td')]; return { property: td[0].innerText.split('\n')[0].trim(), tenant: td[2].innerText.split('\n')[0].trim(), status: td[4].innerText.trim(), date: td[5].innerText.trim().replace('Sept', 'Sep') } })))
const waitTable = async (p) => { await p.locator('tbody tr').first().waitFor({ timeout: 15000 }); await p.waitForTimeout(250) }

const mgr = await login('rajesh@propai.in'), TEN = { amit: await login('amit@example.in'), sneha: await login('sneha@example.in'), rahul: await login('rahul@example.in') }
const propOf = async (n) => (await (await fetch(`${API}/properties/`, { headers: TEN[n].h })).json())[0].id
const pay = (n, when, amount = 10000, extra = {}) => propOf(n).then((id) => fetch(`${API}/financial/payments`, { method: 'POST', headers: TEN[n].h, body: JSON.stringify({ property_id: id, amount, payment_date: when, notes: 'DATETEST', ...extra }) }))
const before = pg("select md5(string_agg(t::text, '|' order by id)) from (select * from payments where notes is distinct from 'DATETEST') t")
const { today, month: curMonth } = await (await fetch(`${API}/financial/rent-collection`, { headers: mgr.h })).json()
const dmy = (iso) => new Date(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10))).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }).replace('Sept', 'Sep')

try {
  console.log('\n══ A. Manager login -> Rent Collection ══')
  const M = await session(mgr.tok)
  await M.page.goto(`${BASE}/login`, { waitUntil: 'networkidle' }); await M.page.evaluate(() => localStorage.clear())
  await M.page.reload({ waitUntil: 'networkidle' })
  await M.page.fill('input[type=email]', 'rajesh@propai.in'); await M.page.fill('input[type=password]', 'PropAI@2024')
  await M.page.locator('button[type=submit]').click()
  await M.page.getByRole('heading', { name: 'Manager Dashboard' }).waitFor({ timeout: 10000 })
  check('A0 Manager logs in through the real form', true)
  const snap = await M.page.locator('.card', { hasText: 'Rent Collection —' }).first().innerText().catch(() => '')
  check('A1 Overview snapshot card shows the CURRENT month (not a hard-coded "Dec 2025")', /Rent Collection — /.test(snap) && !/Dec 2025/.test(snap) && snap.includes(new Date(curMonth + '-01T12:00:00Z').toLocaleDateString('en-IN', { month: 'short', year: 'numeric', timeZone: 'UTC' })), snap.split('\n')[0])
  await M.page.getByRole('link', { name: 'Rent Collection' }).click(); await waitTable(M.page)
  const sel = M.page.getByLabel('Rent month')
  check('B1 month selector defaults to the current month', (await sel.inputValue()) === curMonth, `${await sel.inputValue()} vs ${curMonth}`)
  const opts = await sel.locator('option').evaluateAll((os) => os.map((o) => [o.value, o.textContent]))
  check('B2 selector lists 36 months counting back from now (no hard-coded 2025 list)', opts.length === 36 && opts[0][0] === curMonth && opts[35][0] < opts[0][0] && opts.some(([v]) => v === '2025-12') && new Set(opts.map((o) => o[0])).size === 36, `${opts[0]} … ${opts[35]}`)
  check('B3 options are readable ("Sep 2026")', /^[A-Z][a-z]{2,3} \d{4}$/.test(opts[0][1]), opts[0][1])
  let t = await table(M.page)
  check('B4 five tenants listed for the current month, all Pending / "Awaiting" (no payments yet)', t.length === 5 && t.every((r) => r.status === 'Pending' && /Awaiting/.test(r.date)), JSON.stringify(t[0]))
  await M.page.screenshot({ path: `${OUT}/rent-current-month.png` })
  const cf = await M.page.evaluate(auditFn)
  const mine = cf.filter((f) => /Pick dates|Showing rent|Paid from|Paid to|Clear dates|can't be after/.test(f.text))
  check('B5 contrast: my new date filter (labels, note) passes WCAG AA', mine.length === 0, JSON.stringify(mine))
  console.log('   (info) pre-existing Manager-page text below AA, not part of this change:', JSON.stringify([...new Set(cf.filter((f) => !mine.includes(f)).map((f) => f.text.slice(0, 40)))]))

  console.log('\n══ C. Existing records (2025): correct dates for every viewer timezone ══')
  await sel.selectOption('2025-12'); await waitTable(M.page)
  t = await table(M.page)
  check('C1 Dec 2025: 5 Paid, every payment dated 01 Dec 2025 (viewer in India)', t.length === 5 && t.every((r) => r.status === 'Paid' && r.date === '01 Dec 2025'), JSON.stringify(t.map((r) => r.date)))
  const LA = await session(mgr.tok, 'America/Los_Angeles')
  await LA.page.goto(`${BASE}/manager/rent-collection`, { waitUntil: 'networkidle' }); await waitTable(LA.page)
  await LA.page.getByLabel('Rent month').selectOption('2025-12'); await waitTable(LA.page)
  const tLA = await table(LA.page)
  check('C2 the SAME page for a viewer in Los Angeles (UTC-8) also shows 01 Dec 2025 - not 30 Nov (the old off-by-one)', tLA.every((r) => r.date === '01 Dec 2025'), JSON.stringify(tLA.map((r) => r.date)))
  const NY = await session(mgr.tok, 'America/New_York')
  await NY.page.goto(`${BASE}/manager/rent-collection`, { waitUntil: 'networkidle' }); await waitTable(NY.page); await NY.page.getByLabel('Rent month').selectOption('2025-10'); await waitTable(NY.page)
  check('C3 New York viewer, Oct 2025: 01 Oct 2025', (await table(NY.page)).every((r) => r.date === '01 Oct 2025'))

  console.log('\n══ D. New payments: today / previous / boundary / multiple ══')
  await pay('amit', today, 15000)                                   // today (date-only)
  await pay('sneha', '2026-08-31T20:30:00Z', 20000)                // 01 Sep 02:00 IST - the reported bug
  await pay('rahul', '2026-09-05', 18000)                           // an earlier date this month
  await pay('rahul', '2026-09-12', 500)                             // second payment, same tenant + month
  await M.page.reload({ waitUntil: 'networkidle' }); await waitTable(M.page)
  t = Object.fromEntries((await table(M.page)).map((r) => [r.tenant.split(' ')[0], r]))
  check('D1 (refreshed page) TODAY: Amit shown Paid on today\'s date', t.Amit.status === 'Paid' && t.Amit.date === dmy(today), t.Amit.date)
  check('D2 01 Sep 02:00 IST payment: Sneha shown on 01 Sep 2026, in SEPTEMBER (was 31 Aug / August)', t.Sneha.status === 'Paid' && t.Sneha.date === '01 Sep 2026', t.Sneha.date)
  check('D3 two payments same month: Rahul shows the latest date (12 Sep 2026)', t.Rahul.status === 'Paid' && t.Rahul.date === '12 Sep 2026', t.Rahul.date)
  const cards = await M.page.locator('.stat-card').allInnerTexts()
  check('D4 summary cards: 3 of 5 paid, 60%, collected ₹53,500 (15,000 + 20,000 + 18,000 + 500)', /3 of 5/.test(cards.join(' ')) && /60%/.test(cards.join(' ')) && /53,500/.test(cards.join(' ')), cards.map((c) => c.replace(/\n/g, ' ')).join(' | '))
  await sel.selectOption('2026-08'); await waitTable(M.page)
  check('D5 August 2026 still empty: the Sept-1 payment did not leak into August', (await table(M.page)).every((r) => r.status === 'Pending'))
  await sel.selectOption(curMonth); await waitTable(M.page)
  const LA2 = await session(mgr.tok, 'America/Los_Angeles'); await LA2.page.goto(`${BASE}/manager/rent-collection`, { waitUntil: 'networkidle' }); await waitTable(LA2.page)
  const tLA2 = Object.fromEntries((await table(LA2.page)).map((r) => [r.tenant.split(' ')[0], r]))
  check('D6 Los Angeles viewer sees the same dates for the new payments (01 Sep, 12 Sep)', tLA2.Sneha.date === '01 Sep 2026' && tLA2.Rahul.date === '12 Sep 2026' && tLA2.Amit.date === dmy(today), JSON.stringify([tLA2.Sneha.date, tLA2.Rahul.date, tLA2.Amit.date]))
  await M.page.screenshot({ path: `${OUT}/rent-with-payments.png` })

  console.log('\n══ E. Filtering by date ══')
  const from = M.page.locator('#rc-from'), to = M.page.locator('#rc-to')
  check('E1 date pickers cannot select a future date (max = today)', (await from.getAttribute('max')) === today && (await to.getAttribute('max')) === today)
  const n0 = M.log.rc.length
  await from.fill('2026-09-01'); await to.fill('2026-09-05'); await waitTable(M.page)
  t = Object.fromEntries((await table(M.page)).map((r) => [r.tenant.split(' ')[0], r]))
  check('E2 1 Sep - 5 Sep: Sneha (1 Sep) and Rahul (5 Sep) are paid; Amit (today) is not', t.Sneha.status === 'Paid' && t.Rahul.status === 'Paid' && t.Amit.status === 'Pending' && t.Rahul.date === '05 Sep 2026', JSON.stringify([t.Sneha.status, t.Rahul.date, t.Amit.status]))
  check('E3 the request used date_from / date_to (not the month) and the month selector is switched off', /date_from=2026-09-01/.test(M.log.rc.at(-1)) && /date_to=2026-09-05/.test(M.log.rc.at(-1)) && !/month=/.test(M.log.rc.at(-1)) && (await sel.isDisabled()))
  check('E4 a note explains what is shown', /from 01 Sep(t)? 2026 to 05 Sep(t)? 2026/.test(await M.page.getByTestId('filter-note').innerText()), await M.page.getByTestId('filter-note').innerText())
  await from.fill('2026-09-12'); await to.fill('2026-09-12'); await waitTable(M.page)
  t = Object.fromEntries((await table(M.page)).map((r) => [r.tenant.split(' ')[0], r]))
  check('E5 single day 12 Sep: only Rahul (inclusive range)', t.Rahul.status === 'Paid' && t.Rahul.date === '12 Sep 2026' && t.Sneha.status === 'Pending')
  await from.fill('2026-09-10'); await M.page.waitForTimeout(500)
  const nReq = M.log.rc.length
  await to.fill('2026-09-02')
  await M.page.getByRole('alert').filter({ hasText: "can't be after" }).waitFor()
  await M.page.waitForTimeout(600)
  check('E6 "from" after "to" -> clear message, and NO request is sent for the invalid range', M.log.rc.length === nReq && !M.log.rc.some((q) => /date_to=2026-09-02/.test(q)), `${M.log.rc.length - nReq} extra requests`)
  await shot(M.page, 'rent-invalid-range')
  await M.page.getByTestId('clear-dates').click(); await waitTable(M.page)
  check('E7 "Clear dates" returns to the month view', (await sel.isEnabled()) && (await from.inputValue()) === '' && (await sel.inputValue()) === curMonth && (await table(M.page)).find((r) => r.tenant.startsWith('Amit')).status === 'Paid')
  await from.fill('2026-09-01'); await M.page.reload({ waitUntil: 'networkidle' }); await waitTable(M.page)
  check('E8 refreshing the page resets to the current month (no stale filter) and data persists', (await sel.inputValue()) === curMonth && (await table(M.page)).find((r) => r.tenant.startsWith('Rahul')).date === '12 Sep 2026')
  await M.ctx.setExtraHTTPHeaders({})

  console.log('\n══ F. Dark mode, phone width, console ══')
  const D = await session(mgr.tok, 'Asia/Kolkata', 'dark'); await D.page.goto(`${BASE}/manager/rent-collection`, { waitUntil: 'networkidle' }); await waitTable(D.page)
  await D.page.screenshot({ path: `${OUT}/rent-dark.png` })
  const df = (await D.page.evaluate(auditFn)).filter((f) => /Pick dates|Showing rent|Paid from|Paid to|Clear dates/.test(f.text))
  check('F0 contrast in dark mode: my new date filter passes WCAG AA', df.length === 0, JSON.stringify(df))
  const P = await session(mgr.tok, 'Asia/Kolkata', 'light', { width: 400, height: 900 }); await P.page.goto(`${BASE}/manager/rent-collection`, { waitUntil: 'networkidle' }); await waitTable(P.page)
  check('F1 phone width: the date filter row wraps, page does not scroll sideways', (await P.page.evaluate(() => (window.scrollTo(500, 0), window.scrollX))) === 0)
  await P.page.screenshot({ path: `${OUT}/rent-phone.png` })
  const uncaught = sessions.flatMap((s) => s.log.pageErrors)
  const unexpected = sessions.flatMap((s) => s.log.consoleErrors).filter((m) => !/status of (4\d\d)|Failed to load resource/.test(m))
  check('F2 no JavaScript errors and no unexpected console errors', uncaught.length === 0 && unexpected.length === 0, JSON.stringify([...uncaught, ...new Set(unexpected)]))
} finally {
  pg("delete from payments where notes='DATETEST'")
  for (const s of sessions) await s.ctx.close().catch(() => {})
  await browser.close()
  console.log(`\ncleanup: payments ${pg('select count(*) from payments')} (60 originals); original rows unchanged: ${pg("select md5(string_agg(t::text, '|' order by id)) from (select * from payments where notes is distinct from 'DATETEST') t") === before}`)
}
async function shot(p, n) { await p.screenshot({ path: `${OUT}/${n}.png` }) }
console.log(`\n${results.filter(Boolean).length}/${results.length} UI checks passed`)
process.exit(results.every(Boolean) ? 0 : 1)
