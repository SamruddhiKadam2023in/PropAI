// The Owner Analytics page: importing a spreadsheet of expenses (for real bills OCR can't read reliably) through the real
// browser, and the Cost Analysis picking the imported amount up. Uses a throwaway owner + property; everything is removed.
import { chromium } from 'playwright-core'
import { execFileSync } from 'node:child_process'

const BASE = 'http://localhost:3000'
const API = 'http://localhost:8000'
const EMAIL = 'expimportui_owner@example.com', PW = 'ExpImportUi-Pass-1'

const results = []
const check = (name, ok, detail = '') => { results.push(!!ok); console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail ? `  [${String(detail).slice(0, 160)}]` : '')) }
const post = (url, body, tok) => fetch(API + url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(tok ? { Authorization: `Bearer ${tok}` } : {}) }, body: JSON.stringify(body) })
const pg = (sql) => execFileSync('docker', ['exec', '-i', 'property_postgres', 'psql', '-U', 'postgres', '-d', 'property_management', '-At'], { input: sql, encoding: 'utf8' }).trim()

const mgr = (await (await post('/auth/login', { email: 'rajesh@propai.in', password: 'PropAI@2024' })).json()).access_token
const made = await post('/auth/users', { email: EMAIL, full_name: 'Exp Import UI', password: PW, role: 'owner' }, mgr)
if (made.status !== 201) { console.log('FAIL could not create the throwaway owner', made.status); process.exit(1) }
const tok = (await (await post('/auth/login', { email: EMAIL, password: PW })).json()).access_token
const propId = pg(`insert into properties (title, address, city, state, pincode, property_type, rent_amount, is_available, owner_id)
  select 'UITEST EXPIMPORT flat', 'Test road', 'Mumbai', 'Maharashtra', '400001', 'apartment', 1000, true,
         (select id from users where email='${EMAIL}') returning id;`)

const browser = await chromium.launch({ executablePath: process.env.BROWSER_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', headless: true })
try {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 1000 } })
  await ctx.addInitScript((t) => localStorage.setItem('token', t), tok)
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message.slice(0, 160)))
  page.on('console', (m) => { if (m.type() === 'error' && !/favicon/.test(m.text())) errors.push(m.text().slice(0, 160)) })

  await page.goto(`${BASE}/owner/analytics`, { waitUntil: 'networkidle' })
  const body0 = await page.innerText('body')
  check('the Import expenses control is on the Analytics page', /Import expenses/.test(body0) && /Template/.test(body0))

  // a CSV with one good row and one bad row - the backend treats .csv exactly like .xlsx
  const csv = 'date,category,amount,vendor\n05/12/2025,electricity,2450,Tata Power\n01/12/2025,not-a-real-category,50,X\n'
  await page.setInputFiles('[data-testid="expense-import-input"]', { name: 'bills.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) })
  await page.getByText(/Imported 1 of 2/).waitFor({ timeout: 15000 }).then(() => check('a success toast reports exactly 1 of 2 rows imported', true), () => check('success toast shown', false))
  await page.getByText(/1 row skipped/).waitFor({ timeout: 5000 }).then(() => check('a second toast reports the 1 skipped row and why', true), () => check('skip toast shown', false))

  await page.waitForTimeout(1000)   // let the Cost Analysis re-fetch after the import
  const body1 = await page.innerText('body')
  check('the imported amount (2450) now appears in the Cost Analysis for this property', /2,?450/.test(body1))
  check('no console or page errors', errors.length === 0, errors.join(' ; '))
} finally {
  await browser.close()
  pg(`delete from expenses where property_id in (select id from properties where title='UITEST EXPIMPORT flat');
      delete from properties where title='UITEST EXPIMPORT flat';
      delete from users where email='${EMAIL}';`)
  check('cleanup: throwaway owner and property removed', pg(`select count(*) from users where email='${EMAIL}'`) === '0')
}
console.log(`\n${results.filter(Boolean).length}/${results.length} UI checks passed`)
process.exit(results.every(Boolean) ? 0 : 1)
