// A PUBLIC build (no VITE_SHOW_DEMO_LOGIN) must not contain the Quick Demo Login panel, the demo emails or the demo password,
// and must not point anywhere at localhost:8000 when VITE_API_URL is given. Builds into a temp folder; touches nothing else.
import { execSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const FRONTEND = path.resolve('../../frontend')
const OUT = fs.mkdtempSync(path.join(os.tmpdir(), 'propai-prod-'))
const results = []
const check = (name, ok, detail = '') => { results.push(!!ok); console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail !== '' ? `  [${detail}]` : '')) }

execSync(`npm run build -- --outDir "${OUT}" --emptyOutDir`, {
  cwd: FRONTEND, stdio: 'pipe',
  env: { ...process.env, VITE_SHOW_DEMO_LOGIN: 'false', VITE_API_URL: 'https://api.example.com' },
})
const assets = path.join(OUT, 'assets')
const js = fs.readdirSync(assets).filter((f) => f.endsWith('.js')).map((f) => fs.readFileSync(path.join(assets, f), 'utf8')).join('\n')
check('public build has no "Quick Demo Login" panel text', !/Quick Demo/i.test(js))
check('public build has no demo password', !js.includes('PropAI@2024'))
check('public build has no Manager / Owner demo account emails (amit@example.in is only a sign-up form placeholder)', !/rajesh@propai\.in|vikram@propai\.in/.test(js))
check('API address comes from VITE_API_URL', js.includes('https://api.example.com'))
check('no hard-coded http://localhost:8000 image/API links left in the app code', !/["'`]http:\/\/localhost:8000\$\{/.test(js) && !/`http:\/\/localhost:8000\$/.test(js))
fs.rmSync(OUT, { recursive: true, force: true })
console.log(`\n${results.filter(Boolean).length}/${results.length} passed`)
process.exit(results.every(Boolean) ? 0 : 1)
