import { chromium } from 'playwright-core'
import fs from 'node:fs'
import { execFileSync } from 'node:child_process'

const BASE = 'http://localhost:3000', API = 'http://localhost:8000'
const OUT = 'shots/clean'; fs.mkdirSync(OUT, { recursive: true })
const src = fs.readFileSync('audit.mjs', 'utf8')
const auditFn = new Function('return ' + src.match(/const auditFn = (\(\) => \{[\s\S]*?\r?\n\})\r?\n\r?\nconst browser/)[1])()
const results = []
const check = (name, ok, detail = '') => { results.push(!!ok); console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail !== '' ? `  [${String(detail).slice(0, 170)}]` : '')) }
const mongo = (js) => execFileSync('docker', ['exec', '-i', 'property_mongodb', 'mongosh', '-u', 'mongo', '-p', 'mongo123', '--authenticationDatabase', 'admin', '--quiet', '--eval', `const d=db.getSiblingDB("property_management"); ${js}`], { encoding: 'utf8' }).trim()
const login = async (email) => { const d = await (await fetch(`${API}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: 'PropAI@2024' }) })).json(); return { tok: d.access_token, h: { Authorization: `Bearer ${d.access_token}`, 'Content-Type': 'application/json' } } }
const T0 = new Date().toISOString()

const browser = await chromium.launch({ executablePath: process.env.BROWSER_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', headless: true })
const sessions = []
async function session(theme = 'light', tok = null, viewport = { width: 1440, height: 1500 }) {
  const ctx = await browser.newContext({ viewport, colorScheme: theme })
  await ctx.addInitScript(([t, k]) => { if (k) localStorage.setItem('token', k); if (!sessionStorage.getItem('seeded')) { localStorage.setItem('propai-theme', t); sessionStorage.setItem('seeded', '1') } }, [theme, tok])
  const page = await ctx.newPage()
  const log = { pageErrors: [], consoleErrors: [] }
  page.on('pageerror', (e) => log.pageErrors.push(e.message.slice(0, 200)))
  page.on('console', (m) => { if (m.type() === 'error') log.consoleErrors.push(m.text().slice(0, 200)) })
  const s = { ctx, page, log }; sessions.push(s); return s
}
const contrast = async (p, label) => { const f = await p.evaluate(auditFn); check(`contrast (0 failures): ${label}`, f.length === 0, f.length ? JSON.stringify(f.slice(0, 3)) : '') }
const setTheme = async (p, t) => { await p.evaluate((v) => localStorage.setItem('propai-theme', v), t); await p.reload({ waitUntil: 'networkidle' }); await p.waitForTimeout(400) }

const amit = await login('amit@example.in')
let rid = null
try {
  const O = await session('dark')
  await O.page.goto(`${BASE}/login`, { waitUntil: 'networkidle' })
  await O.page.fill('input[type=email]', 'vikram@propai.in'); await O.page.fill('input[type=password]', 'PropAI@2024')
  await O.page.locator('button[type=submit]').click()
  await O.page.getByRole('heading', { name: 'Owner Dashboard' }).waitFor({ timeout: 10000 })
  await O.page.getByRole('link', { name: 'Maintenance' }).click()
  await O.page.getByRole('heading', { name: 'Maintenance', exact: true }).waitFor()
  await O.page.getByTestId('record-row').first().waitFor()
  const body = await O.page.locator('body').innerText()

  console.log('\n══ Owner -> Maintenance (dark, as in your screenshot) ══')
  check('1 the page loads with the owner\'s real requests only (Vikram has 5)', (await O.page.getByTestId('record-row').count()) === 5 && (await O.page.getByTestId('stat-records').innerText()).includes('5'), await O.page.getByTestId('record-row').count())
  check('2 NO demo banner, switch or "Demo" badges', (await O.page.getByTestId('demo-banner').count()) === 0 && (await O.page.getByTestId('demo-toggle').count()) === 0 && (await O.page.getByTestId('demo-badge').count()) === 0 && !/Demo data|sample service record|Show demo/i.test(body))
  check('3 NO "Find Service Provider", "My Providers" or "Nearby" anywhere', !/Find Service Provider|My Providers|Nearby|Find provider/i.test(body) && (await O.page.getByTestId('row-find-provider').count()) === 0 && (await O.page.getByTestId('find-provider').count()) === 0)
  check('4 header now shows just the Refresh button', (await O.page.getByRole('button', { name: 'Refresh' }).isVisible()))
  await O.page.screenshot({ path: `${OUT}/owner-maintenance-dark.png` })
  await contrast(O.page, 'Owner Maintenance (dark)')
  check('5 summary cards reflect only real data (no fees recorded yet -> ₹0)', (await O.page.getByTestId('stat-billed').innerText()).includes('₹0'), (await O.page.getByTestId('stat-billed').innerText()).replace(/\s+/g, ' '))

  console.log('\n══ Everything else on the page still works ══')
  await O.page.getByTestId('view-cards').click(); await O.page.getByTestId('record-card').first().waitFor()
  check('6 card view works (5 cards, no demo badge, no provider button)', (await O.page.getByTestId('record-card').count()) === 5 && (await O.page.getByTestId('demo-badge').count()) === 0)
  await O.page.getByTestId('view-table').click(); await O.page.getByTestId('record-row').first().waitFor()
  await O.page.getByLabel('Search maintenance records').fill('zzzz'); await O.page.getByText('No records match your filters').waitFor()
  await O.page.getByRole('button', { name: 'Clear filters' }).click(); await O.page.getByTestId('record-row').first().waitFor()
  check('7 search / clear filters work', (await O.page.getByTestId('record-row').count()) === 5)
  await O.page.getByTestId('record-row').first().getByRole('button', { name: /View details/ }).click()
  const dlg = O.page.getByRole('dialog')
  await dlg.waitFor()
  check('8 details dialog: shows the request; footer has Start/Resolve + "Add service details", no provider button', (await dlg.getByRole('button', { name: /service details/ }).count()) === 1 && !/Nearby|Find service provider/i.test(await dlg.innerText()) && !/read-only/i.test(await dlg.innerText()))
  await O.page.keyboard.press('Escape')

  console.log('\n══ Service details on a REAL request (the feature that stays) ══')
  const r = await (await fetch(`${API}/maintenance/`, { method: 'POST', headers: amit.h, body: JSON.stringify({ title: 'REMOVAL CHECK tap', description: 'test', urgency: 'low', category: 'plumbing' }) })).json()
  rid = r.id
  await O.page.reload({ waitUntil: 'networkidle' }); await O.page.getByLabel('Search maintenance records').fill('REMOVAL CHECK'); await O.page.waitForTimeout(250)
  await O.page.getByTestId('record-row').first().getByRole('button', { name: /View details/ }).click()
  await O.page.getByRole('dialog').getByRole('button', { name: 'Add service details' }).click()
  const f = O.page.getByRole('dialog', { name: 'Add service details' })
  await f.locator('#sf-provider').fill('Real Plumber Co'); await f.locator('#sf-stype').fill('Tap repair'); await f.locator('#sf-date').fill('2026-09-20'); await f.locator('#sf-fee').fill('1000.50')
  await f.getByRole('button', { name: 'Add a charge' }).click(); await f.getByLabel('Charge 1 label').fill('Parts'); await f.getByLabel('Charge 1 amount').fill('249.50')
  check('9 live total = ₹1,250', (await f.getByTestId('form-total').innerText()) === '₹1,250')
  await f.getByRole('button', { name: 'Save service details' }).click(); await O.page.getByText('Service details saved').waitFor()
  await O.page.keyboard.press('Escape'); await O.page.waitForTimeout(300)
  check('10 saved: the row shows fee ₹1,000.50 / additional ₹249.50 / total ₹1,250 (and the card total updates)', (await O.page.getByTestId('record-row').first().locator('[data-col=total]').innerText()) === '₹1,250' && (await O.page.getByTestId('stat-billed').innerText()).includes('1,250'))
  await setTheme(O.page, 'light'); await O.page.getByTestId('record-row').first().waitFor()
  await contrast(O.page, 'Owner Maintenance (light)')

  console.log('\n══ Other roles and console ══')
  const T = await session('light', amit.tok)
  await T.page.goto(`${BASE}/tenant/maintenance`, { waitUntil: 'networkidle' }); await T.page.getByTestId('request-card').first().waitFor()
  check('11 tenant Maintenance page unchanged and clean', (await T.page.getByTestId('request-card').count()) >= 5 && !/Demo|Nearby|Find Service/i.test(await T.page.locator('body').innerText()))
  const M = await session('light', (await login('rajesh@propai.in')).tok)
  await M.page.goto(`${BASE}/manager`, { waitUntil: 'networkidle' }); await M.page.waitForTimeout(700)
  check('12 manager dashboard still renders', (await M.page.locator('#root').innerText()).includes('Manager Dashboard'))
  const uncaught = sessions.flatMap((s) => s.log.pageErrors)
  const unexpected = sessions.flatMap((s) => s.log.consoleErrors).filter((m) => !/status of (4\d\d|5\d\d)|net::ERR_FAILED|Failed to load resource/.test(m))
  check('13 no JavaScript errors or unexpected console errors', uncaught.length === 0 && unexpected.length === 0, JSON.stringify([...uncaught, ...new Set(unexpected)]))
} finally {
  if (rid) mongo(`d.maintenance_requests.deleteOne({_id:ObjectId("${rid}")}); print(d.notifications.deleteMany({created_at:{$gte:"${T0}"}}).deletedCount)`)
  console.log('\ncleanup: test request removed; real records now:', mongo('print(d.maintenance_requests.countDocuments({}))'))
  for (const s of sessions) await s.ctx.close().catch(() => {})
  await browser.close()
}
console.log(`\n${results.filter(Boolean).length}/${results.length} UI checks passed`)
process.exit(results.every(Boolean) ? 0 : 1)
