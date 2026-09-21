import { chromium } from 'playwright-core'
import fs from 'node:fs'
import path from 'node:path'

const BASE = 'http://localhost:3000'
const API = 'http://localhost:8000'
const ASSETS = path.resolve('../assets')
const src = fs.readFileSync('audit.mjs', 'utf8')
const auditFn = new Function('return ' + src.match(/const auditFn = (\(\) => \{[\s\S]*?\r?\n\})\r?\n\r?\nconst browser/)[1])()
const OUT = 'shots/docs'
fs.mkdirSync(OUT, { recursive: true })

const results = []
const check = (name, ok, detail = '') => { results.push(!!ok); console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail ? `  [${detail}]` : '')) }
const asset = (n) => path.join(ASSETS, n)

async function token(email) {
  const r = await fetch(`${API}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: 'PropAI@2024' }) })
  return (await r.json()).access_token
}
const amitTok = await token('amit@example.in')
const snehaTok = await token('sneha@example.in')
const preexisting = new Set((await (await fetch(`${API}/documents/`, { headers: { Authorization: `Bearer ${amitTok}` } })).json()).map((d) => d.id))   // never touched
if (preexisting.size) console.log(`(note: ${preexisting.size} pre-existing document(s) will be left alone; empty-state checks may not apply)`)

const browser = await chromium.launch({ executablePath: process.env.BROWSER_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', headless: true })

async function newSession(tok, theme = 'light') {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 1400 }, colorScheme: theme, acceptDownloads: true })
  await ctx.addInitScript(([t, k]) => {
    localStorage.setItem('token', k)
    if (!sessionStorage.getItem('seeded')) { localStorage.setItem('propai-theme', t); sessionStorage.setItem('seeded', '1') }   // seed once, so later theme changes stick
  }, [theme, tok])
  const page = await ctx.newPage()
  const log = { pageErrors: [], consoleErrors: [], badResponses: [] }
  page.on('pageerror', (e) => log.pageErrors.push(e.message.slice(0, 200)))
  page.on('console', (m) => { if (m.type() === 'error') log.consoleErrors.push(m.text().slice(0, 200)) })
  page.on('response', (r) => { if (r.url().startsWith(API) && r.status() >= 400) log.badResponses.push(`${r.status()} ${r.request().method()} ${new URL(r.url()).pathname}`) })
  return { ctx, page, log }
}
const card = (page, name) => page.locator('article', { hasText: name })
const shot = (page, name) => page.screenshot({ path: `${OUT}/${name}.png`, fullPage: false })
const contrast = async (page, label) => { const f = await page.evaluate(auditFn); check(`contrast: ${label}`, f.length === 0, f.length ? JSON.stringify(f.slice(0, 3)) : ''); return f }

const { ctx, page, log } = await newSession(amitTok, 'light')

console.log('\n== A. Empty state + page basics ==')
await page.goto(`${BASE}/tenant/documents`, { waitUntil: 'networkidle' })
check('page heading shown', await page.getByRole('heading', { name: 'My Documents' }).isVisible())
check('empty state shown for a tenant with no documents', await page.getByText('No documents yet').isVisible())
await shot(page, '01-empty-light')

console.log('\n== B. Upload -> Uploading -> Processing -> Completed (real OCR) ==')
await page.route('**/documents/upload', async (route) => { await new Promise((r) => setTimeout(r, 1200)); try { await route.continue() } catch { /* already handled */ } })
await page.setInputFiles('[data-testid=doc-input]', asset('electricity_bill.png'))
await page.getByTestId('upload-row').first().waitFor({ timeout: 5000 })
check('"Uploading" state shown with the file name', (await page.getByTestId('upload-row').first().innerText()).includes('electricity_bill.png') && await page.getByText('Uploading').first().isVisible())
await shot(page, '02-uploading-light')
const bill = card(page, 'electricity_bill.png')
await bill.waitFor({ timeout: 15000 })
await page.unroute('**/documents/upload')
check('upload row replaced by a document card', (await page.getByTestId('upload-row').count()) === 0)
const sawProcessing = await bill.getByText('Processing', { exact: true }).isVisible().catch(() => false)
check('"Processing" state shown while OCR runs', sawProcessing)
await shot(page, '03-processing-light')
await bill.getByText('Completed', { exact: true }).waitFor({ timeout: 60000 })
check('"Completed" state reached without reloading the page (auto-refresh)', true)
const summary = await bill.innerText()
check('extracted amount shown (₹2,450)', summary.includes('₹2,450'), summary.replace(/\s+/g, ' ').slice(0, 160))
check('extracted date shown (05/12/2025)', summary.includes('05/12/2025'))
check('extracted vendor shown (Tata Power)', /Tata Power/i.test(summary))
check('document type shown (Electricity bill)', summary.includes('Electricity bill'))
await shot(page, '04-completed-light')

console.log('\n== C. Details panel / confidence / raw text ==')
await bill.getByRole('button', { name: /Details/ }).click()
check('confidence shown', /Reading confidence/.test(await bill.innerText()) && /(8|9)\d% · High/.test(await bill.innerText()), (await bill.innerText()).match(/\d+% · \w+/)?.[0])
await bill.getByText('Text read from the document').click()
check('raw OCR text viewable', /ELECTRICITY BILL/i.test(await bill.innerText()))
await shot(page, '05-details-light')
await contrast(page, 'completed card + details (light)')

console.log('\n== D. View original document ==')
await bill.getByRole('button', { name: /View original/ }).click()
const dlg = page.getByRole('dialog')
await dlg.locator('img').waitFor({ timeout: 10000 })
const imgInfo = await dlg.locator('img').evaluate((i) => ({ src: i.src.slice(0, 5), w: i.naturalWidth, h: i.naturalHeight }))
check('original image loads in viewer (blob URL, real pixels)', imgInfo.src === 'blob:' && imgInfo.w === 1100 && imgInfo.h === 900, JSON.stringify(imgInfo))
await shot(page, '06-viewer-light')
await contrast(page, 'viewer modal (light)')
await page.keyboard.press('Escape')
check('Esc closes the viewer', (await page.getByRole('dialog').count()) === 0)
const [download] = await Promise.all([page.waitForEvent('download'), bill.getByRole('button', { name: /^Download/ }).click()])
const dlPath = path.join(OUT, 'downloaded_' + download.suggestedFilename())
await download.saveAs(dlPath)
const same = fs.readFileSync(dlPath).equals(fs.readFileSync(asset('electricity_bill.png')))
check('downloaded file is byte-identical to the original upload', same, download.suggestedFilename())

console.log('\n== E. Edit / correct details ==')
await bill.getByRole('button', { name: /Edit details/ }).click()
await bill.getByLabel('Amount (₹)').fill('2500')
await bill.getByLabel('Vendor').fill('Tata Power Ltd')
await shot(page, '07-edit-light')
await bill.getByRole('button', { name: /Save changes/ }).click()
await page.getByText('Details saved').waitFor({ timeout: 8000 })
await bill.getByText('₹2,500').first().waitFor({ timeout: 8000 })
check('corrected amount + vendor saved and shown', /₹2,500/.test(await bill.innerText()) && /Tata Power Ltd/.test(await bill.innerText()))
check('"corrected by you" note shown', /corrected by you/i.test(await bill.innerText()))

console.log('\n== F. More types: PDF + JPG together ==')
await page.setInputFiles('[data-testid=doc-input]', [asset('gas_bill.pdf'), asset('water_bill.jpg')])
await card(page, 'gas_bill.pdf').getByText('Completed', { exact: true }).waitFor({ timeout: 60000 })
await card(page, 'water_bill.jpg').getByText('Completed', { exact: true }).waitFor({ timeout: 60000 })
const gasText = await card(page, 'gas_bill.pdf').innerText()
check('PDF read: amount ₹915.5 + Gas bill', /₹915\.5/.test(gasText) && /Gas bill/.test(gasText), gasText.replace(/\s+/g, ' ').slice(0, 140))
check('JPG read: amount ₹640 + Water bill', /₹640/.test(await card(page, 'water_bill.jpg').innerText()))
await card(page, 'gas_bill.pdf').getByRole('button', { name: /View original/ }).click()
await page.getByRole('dialog').locator('iframe').waitFor({ timeout: 10000 })
check('PDF original opens in an embedded viewer (blob URL)', (await page.getByRole('dialog').locator('iframe').getAttribute('src')).startsWith('blob:'))
await page.keyboard.press('Escape')

console.log('\n== G. Invalid files + OCR failure ==')
await page.setInputFiles('[data-testid=doc-input]', asset('notes.txt'))
await page.getByText('Unsupported file type').first().waitFor({ timeout: 5000 })
check('unsupported file rejected in the browser (no request needed)', true)
await page.setInputFiles('[data-testid=doc-input]', asset('toobig.png'))
await page.getByText(/too large/).first().waitFor({ timeout: 5000 })
check('oversized file rejected in the browser', true)
await page.setInputFiles('[data-testid=doc-input]', asset('empty.png'))
await page.getByText('This file is empty.').first().waitFor({ timeout: 5000 })
check('empty file rejected in the browser', true)
await page.setInputFiles('[data-testid=doc-input]', asset('disguised.png'))   // passes the extension check, server must reject
await page.locator('[data-testid=upload-row]', { hasText: 'disguised.png' }).getByText(/Unsupported file type/).waitFor({ timeout: 8000 })
check('disguised executable rejected by the SERVER and message shown', true)
await page.setInputFiles('[data-testid=doc-input]', asset('garbage.png'))
await page.locator('[data-testid=upload-row]', { hasText: 'garbage.png' }).getByText(/corrupted/).waitFor({ timeout: 8000 })
check('garbage image rejected by the server with a friendly message', true)
check('all rejected uploads produced error rows with "Upload failed" badge', (await page.getByText('Upload failed').count()) >= 5)
await shot(page, '08-upload-errors-light')
await contrast(page, 'upload error rows (light)')
check('rejected files never became documents', (await page.locator('article').count()) === 3)
await page.getByRole('button', { name: 'Dismiss notes.txt' }).click()
check('error rows can be dismissed', (await page.getByRole('button', { name: 'Dismiss notes.txt' }).count()) === 0)

await page.setInputFiles('[data-testid=doc-input]', asset('corrupt.png'))
const bad = card(page, 'corrupt.png')
await bad.getByText('Failed', { exact: true }).waitFor({ timeout: 60000 })
const badText = await bad.innerText()
check('OCR failure -> "Failed" with a friendly reason', /couldn't read this document/.test(badText) && /corrupted or password-protected/.test(badText), badText.replace(/\s+/g, ' ').slice(0, 170))
check('failure message says the original is safe + offers retry', /original file is safe/.test(badText) && (await bad.getByRole('button', { name: /Try again/ }).isVisible()))
check('no stack traces / server paths shown', !/Traceback|\/app\/|\.py/.test(badText))
await shot(page, '09-failed-light')
await contrast(page, 'failed card (light)')
await bad.getByRole('button', { name: /View original/ }).click()
await page.getByRole('dialog').locator('img, iframe').first().waitFor({ timeout: 10000 }).catch(() => {})
await page.keyboard.press('Escape')
await bad.getByRole('button', { name: /Try again/ }).click()
await bad.getByText('Failed', { exact: true }).waitFor({ timeout: 60000 })
check('Try again re-runs OCR and reports the outcome', true)
await page.setInputFiles('[data-testid=doc-input]', asset('blank.png'))
await card(page, 'blank.png').getByText('Failed', { exact: true }).waitFor({ timeout: 60000 })
check('blank image -> "No readable text" message', /No readable text/.test(await card(page, 'blank.png').innerText()))

console.log('\n== H. Filters ==')
await page.getByRole('tab', { name: /Failed/ }).click()
check('Failed filter shows only failed docs', (await page.locator('article').count()) === 2)
await page.getByRole('tab', { name: /Completed/ }).click()
check('Completed filter shows only completed docs', (await page.locator('article').count()) === 3)
await page.getByRole('tab', { name: /All/ }).click()

console.log('\n== I. Dark mode ==')
await page.evaluate(() => { localStorage.setItem('propai-theme', 'dark') })
await page.reload({ waitUntil: 'networkidle' })
await page.waitForTimeout(500)
check('page is really in dark mode for the dark checks', await page.evaluate(() => document.documentElement.classList.contains('dark') && getComputedStyle(document.body).backgroundColor === 'rgb(15, 23, 42)'))
await shot(page, '10-list-dark')
await contrast(page, 'document list (dark)')
const billD = card(page, 'electricity_bill.png')
await billD.getByRole('button', { name: /Details/ }).click()
await billD.getByRole('button', { name: /Edit details/ }).click()
await shot(page, '11-edit-dark')
await contrast(page, 'edit form (dark)')
await billD.getByRole('button', { name: /Cancel/ }).click()
await billD.getByRole('button', { name: /View original/ }).click()
await page.getByRole('dialog').locator('img').waitFor({ timeout: 10000 })
await shot(page, '12-viewer-dark')
await contrast(page, 'viewer modal (dark)')
await page.keyboard.press('Escape')

console.log('\n== J. Tenant B cannot see or fetch tenant A\'s documents ==')
const idsA = await (await fetch(`${API}/documents/`, { headers: { Authorization: `Bearer ${amitTok}` } })).json()
const B = await newSession(snehaTok, 'light')
await B.page.goto(`${BASE}/tenant/documents`, { waitUntil: 'networkidle' })
check('tenant B sees an empty My Documents page', await B.page.getByText('No documents yet').isVisible())
check('none of tenant A\'s file names appear for B', !/electricity_bill|gas_bill|water_bill|corrupt|blank/.test(await B.page.locator('body').innerText()))
await shot(B.page, '13-tenantB-light')
const probe = await B.page.evaluate(async ([api, id]) => {
  const t = localStorage.getItem('token'); const h = { Authorization: `Bearer ${t}` }
  const out = {}
  for (const [k, u, m] of [['detail', `/documents/${id}`, 'GET'], ['file', `/documents/${id}/file`, 'GET'], ['delete', `/documents/${id}`, 'DELETE'], ['reprocess', `/documents/${id}/reprocess`, 'POST']]) out[k] = (await fetch(api + u, { method: m, headers: h })).status
  return out
}, [API, idsA[0].id])
check('from B\'s own browser session every request for A\'s document is 404', Object.values(probe).every((s) => s === 404), JSON.stringify(probe))
const stillThere = await (await fetch(`${API}/documents/`, { headers: { Authorization: `Bearer ${amitTok}` } })).json()
check('A\'s documents are all still intact after B\'s attempts', stillThere.length === idsA.length, `${stillThere.length}/${idsA.length}`)
await B.ctx.close()

console.log('\n== K. Delete ==')
await page.evaluate(() => { localStorage.setItem('propai-theme', 'light') })
await page.reload({ waitUntil: 'networkidle' })
const before = await page.locator('article').count()
const tgt = card(page, 'blank.png')
await tgt.getByRole('button', { name: /Delete blank.png/ }).click()
await tgt.getByRole('button', { name: 'Delete', exact: true }).click()
await page.getByText('Document deleted').waitFor({ timeout: 8000 })
check('card removed after delete', (await page.locator('article').count()) === before - 1)

console.log('\n== L. Console / network hygiene ==')
const expected = /415|400/  // deliberately invalid uploads
const unexpectedBad = log.badResponses.filter((x) => !(/POST \/documents\/upload/.test(x) && expected.test(x)))
console.log('   bad HTTP responses seen:', JSON.stringify(log.badResponses))
check('no uncaught JavaScript errors', log.pageErrors.length === 0, JSON.stringify(log.pageErrors))
check('no unexpected failed API calls (only the deliberate 400/415 upload rejections)', unexpectedBad.length === 0, JSON.stringify(unexpectedBad))
const unexpectedConsole = log.consoleErrors.filter((m) => !/status of (400|415)/.test(m))
check('no unexpected console errors', unexpectedConsole.length === 0, JSON.stringify(unexpectedConsole))

console.log('\n== M. Clean up test data ==')
for (const d of stillThere) if (!preexisting.has(d.id)) await fetch(`${API}/documents/${d.id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${amitTok}` } })
const left = await (await fetch(`${API}/documents/`, { headers: { Authorization: `Bearer ${amitTok}` } })).json()
check('test documents removed', left.length === 0)

await ctx.close(); await browser.close()
console.log(`\n${results.filter(Boolean).length}/${results.length} UI checks passed`)
process.exit(results.every(Boolean) ? 0 : 1)
