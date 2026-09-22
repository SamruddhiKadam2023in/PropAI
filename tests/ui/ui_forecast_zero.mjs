// A category with real spending this month, but a sharply DECLINING trend, must still show a forecast card (even if the
// predicted amount rounds to Rs 0) - it must not be hidden as if it had no history at all, the way a never-used category is.
// Uses a throwaway tenant + property + expenses; everything created is removed.
import { chromium } from 'playwright-core'
import { execFileSync } from 'node:child_process'

const BASE = 'http://localhost:3000'
const API = 'http://localhost:8000'
const EMAIL = 'forecastui_tenant@example.com', PW = 'ForecastUi-Pass-1'

const results = []
const check = (name, ok, detail = '') => { results.push(!!ok); console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail ? `  [${String(detail).slice(0, 160)}]` : '')) }
const post = (url, body, tok) => fetch(API + url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(tok ? { Authorization: `Bearer ${tok}` } : {}) }, body: JSON.stringify(body) })
const pg = (sql) => execFileSync('docker', ['exec', '-i', 'property_postgres', 'psql', '-U', 'postgres', '-d', 'property_management', '-At'], { input: sql, encoding: 'utf8' }).trim()

const mgr = (await (await post('/auth/login', { email: 'rajesh@propai.in', password: 'PropAI@2024' })).json()).access_token
const made = await post('/auth/users', { email: EMAIL, full_name: 'Forecast UI', password: PW, role: 'tenant' }, mgr)
if (made.status !== 201) { console.log('FAIL could not create the throwaway tenant', made.status); process.exit(1) }
const tok = (await (await post('/auth/login', { email: EMAIL, password: PW })).json()).access_token
const propId = pg(`insert into properties (title, address, city, state, pincode, property_type, rent_amount, is_available, owner_id, tenant_id)
  select 'UITEST FORECAST flat', 'Test road', 'Mumbai', 'Maharashtra', '400001', 'apartment', 1000, false,
         (select id from users where email='rajesh@propai.in'), (select id from users where email='${EMAIL}') returning id;`).split('\n')[0].trim()
// electricity: 2000 -> 200 (a steep decline; the regression's next-month prediction is negative, clamped to exactly Rs 0)
// water: 1000 -> 1000 (flat; a normal, non-zero forecast, to prove ordinary categories are unaffected)
// gas/internet/maintenance: no rows at all - must stay hidden, they have no history at any point
pg(`insert into expenses (category, amount, expense_date, month, property_id) values
  ('ELECTRICITY', 2000, '2025-10-05', '2025-10', ${propId}),
  ('ELECTRICITY', 200,  '2025-11-05', '2025-11', ${propId}),
  ('WATER', 1000, '2025-10-03', '2025-10', ${propId}),
  ('WATER', 1000, '2025-11-03', '2025-11', ${propId});`)

const browser = await chromium.launch({ executablePath: process.env.BROWSER_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', headless: true })
try {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 1200 } })
  await ctx.addInitScript((t) => localStorage.setItem('token', t), tok)
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message.slice(0, 160)))
  page.on('console', (m) => { if (m.type() === 'error' && !/favicon/.test(m.text())) errors.push(m.text().slice(0, 160)) })

  // "Next Month Forecast" lives in CostOverview, which is rendered on the tenant HOME page (/tenant), not /tenant/analytics
  // (that route shows KNN rent comparison + summary stats only, via a separate AnalyticsPage component).
  await page.goto(`${BASE}/tenant`, { waitUntil: 'networkidle' })
  await page.getByText('Next Month Forecast').waitFor({ timeout: 20000 })
  const cards = await page.locator('.card', { has: page.getByText('Next Month Forecast') }).first()
  const text = await cards.innerText().catch(() => '')

  check('the Electricity forecast card is shown even though the trend predicts Rs 0 (real spending exists this month)', /Electricity/.test(text) && /-?100(\.0)?% vs current/.test(text), text)
  check('the Water forecast card shows its real (non-zero, flat) prediction', /Water/.test(text) && /1,000|1000/.test(text), text)
  check('Gas, which has never had a single expense, is correctly NOT shown', !/\bGas\b/.test(text), text)
  check('Internet, which has never had a single expense, is correctly NOT shown', !/Internet/.test(text), text)
  check('Maintenance, which has never had a single expense, is correctly NOT shown', !/Maintenance/.test(text), text)
  check('no console or page errors', errors.length === 0, errors.join(' ; '))
} finally {
  await browser.close()
  pg(`delete from expenses where property_id in (select id from properties where title='UITEST FORECAST flat');
      delete from properties where title='UITEST FORECAST flat';
      delete from users where email='${EMAIL}';`)
  check('cleanup: throwaway tenant, property and expenses removed', pg(`select count(*) from users where email='${EMAIL}'`) === '0')
}
console.log(`\n${results.filter(Boolean).length}/${results.length} UI checks passed`)
process.exit(results.every(Boolean) ? 0 : 1)
