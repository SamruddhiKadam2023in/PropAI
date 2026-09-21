import { chromium } from 'playwright-core'
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'

const BASE = 'http://localhost:3000'
const OUT = path.resolve('shots/export'); fs.mkdirSync(OUT, { recursive: true })
const DL = path.resolve('..', '.artifacts', 'exports', 'ui'); fs.mkdirSync(DL, { recursive: true })
const PY = process.env.PYTHON || 'python'
const src = fs.readFileSync('audit.mjs', 'utf8')
const auditFn = new Function('return ' + src.match(/const auditFn = (\(\) => \{[\s\S]*?\r?\n\})\r?\n\r?\nconst browser/)[1])()
const results = []
const check = (name, ok, detail = '') => { results.push(!!ok); console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail !== '' ? `  [${String(detail).slice(0, 170)}]` : '')) }

const browser = await chromium.launch({ executablePath: process.env.BROWSER_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', headless: true })
const sessions = []
async function session(theme = 'light', viewport = { width: 1440, height: 1400 }) {
  const ctx = await browser.newContext({ viewport, colorScheme: theme, acceptDownloads: true })
  const page = await ctx.newPage()
  const log = { pageErrors: [], consoleErrors: [], failed: [] }
  page.on('pageerror', (e) => log.pageErrors.push(e.message.slice(0, 200)))
  page.on('console', (m) => { if (m.type() === 'error') log.consoleErrors.push(m.text().slice(0, 200)) })
  page.on('response', (r) => { if (r.url().includes('/reports/') && r.status() >= 400) log.failed.push(`${r.status()} ${new URL(r.url()).pathname}`) })
  const s = { ctx, page, log }; sessions.push(s); return s
}
const download = async (page, locator) => { const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 30000 }), locator.click()]); return dl }

try {
  console.log('\n══ A. Manager login -> All Properties ══')
  const M = await session()
  await M.page.goto(`${BASE}/login`, { waitUntil: 'networkidle' })
  await M.page.fill('input[type=email]', 'rajesh@propai.in'); await M.page.fill('input[type=password]', 'PropAI@2024')
  await M.page.locator('button[type=submit]').click()
  await M.page.getByRole('heading', { name: 'Manager Dashboard' }).waitFor({ timeout: 10000 })
  await M.page.getByRole('link', { name: 'All Properties' }).click()
  await M.page.getByRole('heading', { name: 'All Properties' }).waitFor()
  await M.page.getByRole('heading', { name: 'Bandra West 2BHK' }).waitFor({ timeout: 15000 })
  check('A1 Manager logs in and opens All Properties (Bandra West is listed)', true)
  const pdfBtn = M.page.getByTestId('export-pdf'), xlsBtn = M.page.getByTestId('export-excel')
  check('A2 "Download PDF" and "Download Excel" are in the page header', (await pdfBtn.innerText()).includes('Download PDF') && (await xlsBtn.innerText()).includes('Download Excel'))
  const cf = await M.page.evaluate(auditFn)
  const mine = cf.filter((f) => /Download PDF|Download Excel/.test(f.text))
  check('A3 the new buttons pass the WCAG AA contrast check', mine.length === 0, JSON.stringify(mine))
  await M.page.screenshot({ path: `${OUT}/all-properties-header.png` })

  console.log('\n══ B. Real downloads from the browser ══')
  const dPdf = await download(M.page, pdfBtn)
  check('B1 PDF download starts, named by the server (properties_report_YYYY-MM-DD.pdf)', /^properties_report_\d{4}-\d{2}-\d{2}\.pdf$/.test(dPdf.suggestedFilename()), dPdf.suggestedFilename())
  await dPdf.saveAs(`${DL}/all_properties.pdf`)
  await M.page.getByText('Property report (PDF) downloaded').waitFor({ timeout: 5000 })
  check('B2 success message shown; buttons usable again', await pdfBtn.isEnabled() && await xlsBtn.isEnabled())
  const dXls = await download(M.page, xlsBtn)
  check('B3 Excel download starts (properties_report_YYYY-MM-DD.xlsx)', /^properties_report_\d{4}-\d{2}-\d{2}\.xlsx$/.test(dXls.suggestedFilename()), dXls.suggestedFilename())
  await dXls.saveAs(`${DL}/all_properties.xlsx`)
  await M.page.getByText('Property spreadsheet (Excel) downloaded').waitFor({ timeout: 5000 })
  check('B4 file sizes are real (not empty)', fs.statSync(`${DL}/all_properties.pdf`).size > 20000 && fs.statSync(`${DL}/all_properties.xlsx`).size > 8000, `${fs.statSync(`${DL}/all_properties.pdf`).size} / ${fs.statSync(`${DL}/all_properties.xlsx`).size} bytes`)
  console.log('   per-property buttons on the Bandra West card:')
  const card = M.page.locator('.card', { has: M.page.getByRole('heading', { name: 'Bandra West 2BHK' }) })
  const bPdf = await download(M.page, card.getByRole('button', { name: /PDF/ })); check('B5 Bandra West card: PDF button downloads report_6.pdf', bPdf.suggestedFilename() === 'report_6.pdf'); await bPdf.saveAs(`${DL}/bandra_report.pdf`)
  const bXls = await download(M.page, card.getByRole('button', { name: /Excel/ })); check('B6 Bandra West card: Excel button downloads report_6.xlsx', bXls.suggestedFilename() === 'report_6.xlsx'); await bXls.saveAs(`${DL}/bandra_report.xlsx`)

  console.log('\n══ C. Open the downloaded files and verify against the database ══')
  const v = JSON.parse(execFileSync(PY, [path.resolve('..', 'verify_ui_files.py'), DL], { encoding: 'utf8', env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' } }).trim().split('\n').pop())
  check('C1 the PDF opens', v.pdf_opens)
  check('C2 the PDF lists all 25 properties with their real rent', v.pdf_all_properties)
  check('C3 Bandra West is in the PDF (name, rent 65,000, owner Vikram Mehta)', v.pdf_bandra)
  check('C4 the Excel opens with proper headings', v.xlsx_headings)
  check('C5 the Excel has one row per database property (25)', v.xlsx_rows)
  check('C6 every Excel row matches the database: name, rent, status, owner, tenant', v.xlsx_data)
  check('C7 Bandra West per-property PDF: details shown + "no payments recorded" (no longer blank)', v.bandra_pdf)
  check('C8 Bandra West per-property Excel: Property sheet + explanatory notes', v.bandra_xlsx)

  console.log('\n══ D. Failure handling ══')
  await M.page.route('**/reports/properties/pdf', (r) => r.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ detail: 'The property report could not be generated. Please try again.' }) }))
  await pdfBtn.click()
  await M.page.getByText('The property report could not be generated. Please try again.').waitFor({ timeout: 5000 })
  check('D1 a server failure shows the server\'s own message (not a generic one) and re-enables the buttons', await pdfBtn.isEnabled())
  await M.page.unroute('**/reports/properties/pdf')
  await M.page.route('**/reports/properties/excel', (r) => r.abort('failed'))
  await xlsBtn.click(); await M.page.getByText('Failed to download report').waitFor({ timeout: 5000 })
  check('D2 a network failure shows a clear message and re-enables the buttons', await xlsBtn.isEnabled())
  await M.page.unroute('**/reports/properties/excel')

  console.log('\n══ E. Layout, dark mode, other roles, console ══')
  const P = await session('light', { width: 400, height: 900 })
  await P.ctx.addInitScript(([k]) => localStorage.setItem('token', k), [await M.page.evaluate(() => localStorage.getItem('token'))])
  await P.page.goto(`${BASE}/manager/properties`, { waitUntil: 'networkidle' }); await P.page.getByTestId('export-pdf').waitFor()
  const geo = await P.page.getByTestId('export-pdf').evaluate((e) => e.getBoundingClientRect().right)
  check('E1 phone width: buttons wrap inside the screen and the page does not scroll sideways', geo <= 400 && (await P.page.evaluate(() => (window.scrollTo(500, 0), window.scrollX))) === 0, geo)
  await P.page.screenshot({ path: `${OUT}/all-properties-phone.png` })
  const D = await session('dark'); await D.ctx.addInitScript(([k, t]) => { localStorage.setItem('token', k); localStorage.setItem('propai-theme', t) }, [await M.page.evaluate(() => localStorage.getItem('token')), 'dark'])
  await D.page.goto(`${BASE}/manager/properties`, { waitUntil: 'networkidle' }); await D.page.getByTestId('export-pdf').waitFor()
  const df = (await D.page.evaluate(auditFn)).filter((f) => /Download PDF|Download Excel/.test(f.text))
  check('E2 dark mode: the new buttons pass the contrast check', df.length === 0, JSON.stringify(df))
  await D.page.screenshot({ path: `${OUT}/all-properties-dark.png` })
  const uncaught = sessions.flatMap((s) => s.log.pageErrors)
  const unexpected = sessions.flatMap((s) => s.log.consoleErrors).filter((m) => !/Failed to load resource|net::ERR_FAILED/.test(m))
  const failed = sessions.flatMap((s) => s.log.failed)
  check('E3 no JavaScript errors and no unexpected console errors', uncaught.length === 0 && unexpected.length === 0, JSON.stringify([...uncaught, ...new Set(unexpected)]))
  console.log('   report requests that failed in the browser (only my two deliberate D-section injections expected):', failed.length ? failed.join(', ') : 'none')
} finally {
  for (const s of sessions) await s.ctx.close().catch(() => {})
  await browser.close()
}
console.log(`\n${results.filter(Boolean).length}/${results.length} UI checks passed`)
process.exit(results.every(Boolean) ? 0 : 1)
