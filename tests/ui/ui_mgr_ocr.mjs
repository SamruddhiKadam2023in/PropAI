import { chromium } from 'playwright-core'
import fs from 'node:fs'
const BASE = 'http://localhost:3000', API = 'http://localhost:8000'
fs.mkdirSync('shots/mgr', { recursive: true })
const results = []
const check = (n, ok, d = '') => { results.push(!!ok); console.log((ok ? 'PASS ' : 'FAIL ') + n + (d !== '' ? `  [${String(d).slice(0, 160)}]` : '')) }
const browser = await chromium.launch({ executablePath: process.env.BROWSER_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', headless: true })
const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
const page = await ctx.newPage()
const errs = { page: [], console: [], api: [] }
page.on('pageerror', (e) => errs.page.push(e.message.slice(0, 200)))
page.on('console', (m) => { if (m.type() === 'error') errs.console.push(m.text().slice(0, 160)) })
page.on('response', (r) => { if (r.url().startsWith(API) && r.status() >= 400) errs.api.push(`${r.status()} ${new URL(r.url()).pathname}`) })
const tokReq = []
page.on('request', (r) => { if (/\/config\/ocr/.test(r.url())) tokReq.push(r.method() + ' ' + r.url()) })

await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' })
await page.fill('input[type=email]', 'rajesh@propai.in'); await page.fill('input[type=password]', 'PropAI@2024')
await page.locator('button[type=submit]').click()
await page.getByRole('heading', { name: 'Manager Dashboard' }).waitFor({ timeout: 10000 })
check('1 Manager logs in through the real form', true)
const nav = (await page.locator('nav a').allInnerTexts()).map((t) => t.trim()).filter(Boolean)
console.log('   Manager navigation:', nav.join(' | '))
check('2 "OCR Config" is no longer in the Manager navigation', !nav.some((t) => /ocr/i.test(t)))
check('3 the rest of the Manager navigation is unchanged', ['Dashboard', 'Users & Roles', 'All Properties', 'Applications', 'Rent Collection', 'Analytics', 'Messages'].every((l) => nav.some((t) => t.startsWith(l))), nav.length)
check('4 nothing on the Manager dashboard mentions OCR configuration', !/OCR Config|OCR Pipeline Configuration|Confidence Threshold|Dual-Engine/i.test(await page.locator('body').innerText()))
await page.screenshot({ path: 'shots/mgr/dashboard.png' })

await page.goto(`${BASE}/manager/ocr-config`, { waitUntil: 'networkidle' }); await page.waitForTimeout(700)
const body = await page.locator('body').innerText()
check('5 the old URL /manager/ocr-config no longer shows any OCR settings page', !/OCR Pipeline Configuration|Confidence Threshold|OCR Engine \(Dual|Save|TF-IDF Classification/i.test(body), body.replace(/\s+/g, ' ').slice(0, 90))
check('6 the browser never called the OCR config API from the Manager UI', tokReq.length === 0, tokReq.join(','))
for (const [label, path, re] of [['Users & Roles', '/manager/users', /Users|Roles/], ['All Properties', '/manager/properties', /Properties/], ['Applications', '/manager/applications', /Application/], ['Rent Collection', '/manager/rent-collection', /Rent Collection/], ['Analytics', '/manager/analytics', /Analytics/]]) {
  await page.goto(`${BASE}${path}`, { waitUntil: 'networkidle' }); await page.waitForTimeout(500)
  check(`7 Manager page still works: ${label}`, re.test(await page.locator('#root').innerText()))
}
const unexpected = errs.console.filter((m) => !/status of (4\d\d)|Failed to load resource/.test(m))
check('8 no JavaScript errors and no unexpected console errors', errs.page.length === 0 && unexpected.length === 0, JSON.stringify([...errs.page, ...unexpected]))
console.log('   API errors seen by the browser:', errs.api.length ? errs.api.join(', ') : 'none')
await browser.close()
console.log(`\n${results.filter(Boolean).length}/${results.length} checks passed`)
process.exit(results.every(Boolean) ? 0 : 1)
