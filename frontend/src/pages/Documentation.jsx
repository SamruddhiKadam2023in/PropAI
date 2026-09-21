import Layout from '../components/Layout'
import { Brain, FileSearch, TrendingUp, MapPin, Database, Server, Monitor, ShieldCheck, Cpu, GitBranch } from 'lucide-react'

// ── Architecture diagram node ────────────────────────────────────────────────
function Node({ icon: Icon, title, sub, color = 'indigo', className = '' }) {
  const COLORS = {
    indigo:  'border-indigo-200 dark:border-indigo-700 bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300',
    blue:    'border-blue-200  dark:border-blue-700  bg-blue-50  dark:bg-blue-900/30  text-blue-700  dark:text-blue-300',
    emerald: 'border-emerald-200 dark:border-emerald-700 bg-emerald-50 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300',
    amber:   'border-amber-200 dark:border-amber-700 bg-amber-50 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300',
    violet:  'border-violet-200 dark:border-violet-700 bg-violet-50 dark:bg-violet-900/30 text-violet-700 dark:text-violet-300',
    gray:    'border-gray-200 dark:border-gray-600 bg-gray-50 dark:bg-gray-700/50 text-gray-600 dark:text-gray-300',
  }
  return (
    <div className={`border-2 rounded-2xl p-3 text-center ${COLORS[color]} ${className}`}>
      <div className="flex items-center justify-center mb-1">
        <Icon size={18} />
      </div>
      <p className="text-xs font-bold leading-snug">{title}</p>
      {sub && <p className="text-[10px] opacity-70 mt-0.5 leading-tight">{sub}</p>}
    </div>
  )
}

function Arrow({ label, vertical = false }) {
  return vertical ? (
    <div className="flex flex-col items-center py-1">
      <div className="w-0.5 h-5 bg-gray-300 dark:bg-gray-600" />
      <div className="w-0 h-0 border-l-4 border-r-4 border-t-6 border-l-transparent border-r-transparent border-t-gray-400 dark:border-t-gray-500" />
      {label && <p className="text-[9px] text-gray-400 mt-0.5">{label}</p>}
    </div>
  ) : (
    <div className="flex items-center gap-1 px-1">
      <div className="h-0.5 flex-1 bg-gray-300 dark:bg-gray-600" />
      <div className="w-0 h-0 border-t-4 border-b-4 border-l-6 border-t-transparent border-b-transparent border-l-gray-400 dark:border-l-gray-500" />
      {label && <p className="text-[9px] text-gray-400 whitespace-nowrap">{label}</p>}
    </div>
  )
}

// ── ML model card ────────────────────────────────────────────────────────────
function MLCard({ icon: Icon, name, lib, purpose, formula, inputs, output, color }) {
  const COLORS = {
    amber:   { bg: 'bg-amber-50  dark:bg-amber-900/20',  border: 'border-amber-200 dark:border-amber-700', icon: 'text-amber-600 dark:text-amber-400', badge: 'bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300' },
    blue:    { bg: 'bg-blue-50   dark:bg-blue-900/20',   border: 'border-blue-200  dark:border-blue-700',  icon: 'text-blue-600  dark:text-blue-400',  badge: 'bg-blue-100  dark:bg-blue-900/40  text-blue-700  dark:text-blue-300'  },
    violet:  { bg: 'bg-violet-50 dark:bg-violet-900/20', border: 'border-violet-200 dark:border-violet-700',icon: 'text-violet-600 dark:text-violet-400',badge: 'bg-violet-100 dark:bg-violet-900/40 text-violet-700 dark:text-violet-300'},
    emerald: { bg: 'bg-emerald-50 dark:bg-emerald-900/20',border: 'border-emerald-200 dark:border-emerald-700',icon:'text-emerald-600 dark:text-emerald-400',badge:'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300'},
  }
  const c = COLORS[color]
  return (
    <div className={`rounded-2xl border-2 p-5 ${c.bg} ${c.border}`}>
      <div className="flex items-start gap-3 mb-3">
        <div className={`w-10 h-10 rounded-xl bg-white dark:bg-gray-800 border ${c.border} flex items-center justify-center flex-shrink-0 shadow-sm`}>
          <Icon size={20} className={c.icon} />
        </div>
        <div>
          <p className="font-bold text-gray-900 dark:text-white text-sm">{name}</p>
          <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${c.badge}`}>{lib}</span>
        </div>
      </div>
      <p className="text-sm text-gray-700 dark:text-gray-300 mb-3 leading-relaxed">{purpose}</p>
      {formula && (
        <div className="bg-white dark:bg-gray-800 rounded-xl px-3 py-2 mb-3 border border-gray-100 dark:border-gray-700">
          <p className="text-[11px] font-mono text-gray-600 dark:text-gray-300">{formula}</p>
        </div>
      )}
      <div className="grid grid-cols-2 gap-2 text-xs">
        <div>
          <p className="text-gray-400 font-medium mb-1">Inputs</p>
          <p className="text-gray-700 dark:text-gray-300">{inputs}</p>
        </div>
        <div>
          <p className="text-gray-400 font-medium mb-1">Output</p>
          <p className="text-gray-700 dark:text-gray-300">{output}</p>
        </div>
      </div>
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function Documentation() {
  return (
    <Layout>
      <div className="max-w-5xl space-y-10">
        {/* Header */}
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">System Architecture & Documentation</h1>
          <p className="text-gray-400 text-sm mt-1">
            AI-Driven Financial Analytics for Property Management · MES Pillai College of Engineering · ECS Dept · Prof. Padmaja Bangde
          </p>
        </div>

        {/* ── System Architecture Diagram ── */}
        <div className="card">
          <h2 className="section-title mb-1 flex items-center gap-2"><GitBranch size={18} className="text-indigo-600" /> System Architecture</h2>
          <p className="section-subtitle mb-6">3-tier architecture: React SPA → FastAPI → PostgreSQL / MongoDB / Redis</p>

          <div className="space-y-3">
            {/* Tier 1 - Frontend */}
            <div>
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">Tier 1 — Presentation Layer</p>
              <div className="grid grid-cols-4 gap-3">
                <Node icon={Monitor}     title="React 18 + Vite"    sub="SPA · Tailwind CSS"   color="indigo" />
                <Node icon={TrendingUp}  title="Recharts"           sub="Line, Bar, Pie charts" color="indigo" />
                <Node icon={Cpu}         title="TanStack Query"     sub="Cache + data fetch"    color="indigo" />
                <Node icon={ShieldCheck} title="JWT Auth"           sub="Axios interceptors"    color="indigo" />
              </div>
            </div>

            <div className="flex items-center gap-2 text-xs text-gray-400">
              <div className="flex-1 h-px bg-gray-200 dark:bg-gray-700" />
              <span className="px-2 py-0.5 bg-gray-100 dark:bg-gray-800 rounded-full">HTTP/REST · Bearer Token</span>
              <div className="flex-1 h-px bg-gray-200 dark:bg-gray-700" />
            </div>

            {/* Tier 2 - Backend */}
            <div>
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">Tier 2 — Application Layer</p>
              <div className="grid grid-cols-4 gap-3">
                <Node icon={Server}   title="FastAPI 0.104"    sub="async · Python 3.11"   color="blue" />
                <Node icon={Database} title="SQLAlchemy 2"     sub="async ORM"             color="blue" />
                <Node icon={Brain}    title="ML Pipeline"      sub="OCR · NLP · KNN · LR"  color="blue" />
                <Node icon={FileSearch} title="ReportLab"      sub="PDF · Excel reports"   color="blue" />
              </div>
            </div>

            <div className="flex items-center gap-2 text-xs text-gray-400">
              <div className="flex-1 h-px bg-gray-200 dark:bg-gray-700" />
              <span className="px-2 py-0.5 bg-gray-100 dark:bg-gray-800 rounded-full">asyncpg · Motor · redis-py</span>
              <div className="flex-1 h-px bg-gray-200 dark:bg-gray-700" />
            </div>

            {/* Tier 3 - Data */}
            <div>
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">Tier 3 — Data Layer</p>
              <div className="grid grid-cols-3 gap-3">
                <Node icon={Database} title="PostgreSQL 15"   sub="Users · Properties · Payments · Expenses" color="emerald" />
                <Node icon={Database} title="MongoDB 6"       sub="Analytics logs · Document metadata"       color="emerald" />
                <Node icon={Cpu}      title="Redis 7"         sub="API response cache · TTL 120–300s"        color="amber" />
              </div>
            </div>
          </div>

          {/* Docker */}
          <div className="mt-5 p-3 bg-slate-50 dark:bg-gray-800/60 rounded-xl border border-dashed border-gray-200 dark:border-gray-600 text-center">
            <p className="text-xs font-semibold text-gray-500 dark:text-gray-400">
              All 5 services containerised with <span className="text-blue-600 dark:text-blue-400 font-bold">Docker Compose</span>:
              {' '}<span className="font-mono text-gray-600 dark:text-gray-300">postgres · mongodb · redis · backend:8000 · frontend:3000</span>
            </p>
          </div>
        </div>

        {/* ── OCR + NLP Pipeline ── */}
        <div className="card">
          <h2 className="section-title mb-1 flex items-center gap-2"><FileSearch size={18} className="text-amber-600" /> OCR + NLP Document Pipeline</h2>
          <p className="section-subtitle mb-6">Auto-extracts amount, date, vendor from utility bill images using Tesseract + spaCy</p>

          <div className="overflow-x-auto">
            <div className="flex items-stretch gap-2 min-w-max pb-2">
              {[
                { step:'1', label:'File Upload',     sub:'JPEG / PNG / PDF',           bg:'bg-gray-100 dark:bg-gray-700', text:'text-gray-600 dark:text-gray-300' },
                { step:'→', label:'',  sub:'',  bg:'', text:'' },
                { step:'2', label:'Preprocessing',  sub:'Grayscale → Denoise → Threshold (OpenCV)', bg:'bg-blue-100 dark:bg-blue-900/40', text:'text-blue-700 dark:text-blue-300' },
                { step:'→', label:'',  sub:'',  bg:'', text:'' },
                { step:'3', label:'Tesseract OCR',  sub:'Text extraction from image pixels',         bg:'bg-amber-100 dark:bg-amber-900/40', text:'text-amber-700 dark:text-amber-300' },
                { step:'→', label:'',  sub:'',  bg:'', text:'' },
                { step:'4', label:'spaCy NER',      sub:'en_core_web_sm — entity recognition',       bg:'bg-violet-100 dark:bg-violet-900/40', text:'text-violet-700 dark:text-violet-300' },
                { step:'→', label:'',  sub:'',  bg:'', text:'' },
                { step:'5', label:'Confidence Gate',sub:'Combined = OCR×0.6 + NLP×0.4 ≥ 65%',       bg:'bg-indigo-100 dark:bg-indigo-900/40', text:'text-indigo-700 dark:text-indigo-300' },
                { step:'→', label:'',  sub:'',  bg:'', text:'' },
                { step:'6', label:'COALESCE',       sub:'User corrections override OCR data',         bg:'bg-emerald-100 dark:bg-emerald-900/40', text:'text-emerald-700 dark:text-emerald-300' },
              ].map(({ step, label, sub, bg, text }, i) => (
                step === '→'
                  ? <div key={i} className="flex items-center text-gray-400 text-xl font-light">→</div>
                  : (
                    <div key={i} className={`rounded-xl p-3 min-w-[130px] ${bg}`}>
                      <p className={`text-xs font-bold ${text} mb-1`}>Step {step}</p>
                      <p className={`text-sm font-semibold ${text}`}>{label}</p>
                      <p className={`text-[10px] ${text} opacity-80 mt-0.5 leading-tight`}>{sub}</p>
                    </div>
                  )
              ))}
            </div>
          </div>

          <div className="mt-4 grid grid-cols-3 gap-3 text-xs">
            <div className="p-3 bg-emerald-50 dark:bg-emerald-900/20 rounded-xl">
              <p className="font-semibold text-emerald-700 dark:text-emerald-400 mb-1">✓ Completed (≥ 65%)</p>
              <p className="text-emerald-600 dark:text-emerald-300">Auto-accepted, data saved to database</p>
            </div>
            <div className="p-3 bg-amber-50 dark:bg-amber-900/20 rounded-xl">
              <p className="font-semibold text-amber-700 dark:text-amber-400 mb-1">⚠ Flagged (&lt; 65%)</p>
              <p className="text-amber-600 dark:text-amber-300">User reviews and corrects extracted fields</p>
            </div>
            <div className="p-3 bg-red-50 dark:bg-red-900/20 rounded-xl">
              <p className="font-semibold text-red-700 dark:text-red-400 mb-1">✗ Failed</p>
              <p className="text-red-600 dark:text-red-300">No text detected, reupload clearer image</p>
            </div>
          </div>
        </div>

        {/* ── ML Models ── */}
        <div>
          <h2 className="section-title mb-1 flex items-center gap-2"><Brain size={18} className="text-violet-600" /> ML Models</h2>
          <p className="section-subtitle mb-5">Four machine learning algorithms powering the analytics engine</p>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <MLCard
              icon={FileSearch} name="Tesseract OCR" lib="pytesseract 0.3.10" color="amber"
              purpose="Optical Character Recognition extracts raw text from uploaded utility bill images. Images are first preprocessed using OpenCV: converted to grayscale, denoised with Gaussian blur, and binarised with adaptive thresholding."
              formula="confidence = char_certainty_avg / 100"
              inputs="JPEG / PNG image (preprocessed)"
              output="Raw text string + OCR confidence %"
            />
            <MLCard
              icon={Brain} name="spaCy NER Pipeline" lib="spaCy 3.7.2 · en_core_web_sm" color="violet"
              purpose="Named Entity Recognition pipeline identifies financial entities from OCR text. Uses pattern matching for known vendors (Tata Power, MSEDCL, Mahanagar Gas) and spaCy's NER for DATE, MONEY, ORG entities."
              formula="conf = fields_found / 3  (amount + date + vendor)"
              inputs="Raw OCR text string"
              output="amount, date, vendor, entity list, doc_type"
            />
            <MLCard
              icon={MapPin} name="KNN Rent Estimator" lib="scikit-learn KNeighborsRegressor" color="blue"
              purpose="K-Nearest Neighbors (k=5) trained on all properties in the database predicts market rent for a given property. Used to compute rent deviation — showing whether a tenant pays above or below the market rate."
              formula="market_rent = avg(rent of 5 nearest neighbours)"
              inputs="bedrooms, bathrooms, area_sqft, latitude, longitude"
              output="Predicted market rent · deviation %"
            />
            <MLCard
              icon={TrendingUp} name="Linear Regression Forecast" lib="scikit-learn LinearRegression" color="emerald"
              purpose="Predicts next month's utility expenses per category (electricity, water, gas, internet, maintenance) using 12 months of historical data. Trend direction is computed using a 3-month moving average."
              formula="ŷ = β₀ + β₁x  where x = month index (0..n)"
              inputs="12-month expense history per category"
              output="Predicted ₹ value for each category"
            />
          </div>
        </div>

        {/* ── RBAC ── */}
        <div className="card">
          <h2 className="section-title mb-4 flex items-center gap-2"><ShieldCheck size={18} className="text-emerald-600" /> Role-Based Access Control (RBAC)</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 dark:border-gray-700">
                  <th className="table-head text-left">Feature</th>
                  <th className="table-head text-center">Tenant</th>
                  <th className="table-head text-center">Owner</th>
                  <th className="table-head text-center">Manager</th>
                </tr>
              </thead>
              <tbody>
                {[
                  ['View own property & rent',        '✓', '✓', '✓'],
                  ['Upload documents (OCR)',           '✓', '✓', '✓'],
                  ['View payment history',             '✓', '✓', '✓'],
                  ['Download rent receipt PDF',        '✓', '—', '—'],
                  ['Manage properties (add/edit)',     '—', '✓', '✓'],
                  ['Download financial PDF / Excel',   '—', '✓', '✓'],
                  ['View all users',                   '—', '—', '✓'],
                  ['View all properties (any owner)',  '—', '—', '✓'],
                  ['Delete documents / properties',    '—', '—', '✓'],
                  ['Access system configuration',      '—', '—', '✓'],
                ].map(([feat, ...vals]) => (
                  <tr key={feat} className="table-row">
                    <td className="table-cell font-medium text-gray-800 dark:text-gray-200">{feat}</td>
                    {vals.map((v, i) => (
                      <td key={i} className={`table-cell text-center font-semibold ${v === '✓' ? 'text-emerald-600 dark:text-emerald-400' : 'text-gray-300 dark:text-gray-600'}`}>{v}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* ── Tech stack ── */}
        <div className="card">
          <h2 className="section-title mb-4 flex items-center gap-2"><Cpu size={18} className="text-indigo-600" /> Complete Technology Stack</h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {[
              ['Frontend',    'React 18 + Vite',          'indigo'],
              ['Styling',     'Tailwind CSS 3',           'indigo'],
              ['Charts',      'Recharts 2',               'indigo'],
              ['Backend',     'FastAPI 0.104',            'blue'],
              ['ORM',         'SQLAlchemy 2 (async)',     'blue'],
              ['Auth',        'JWT (PyJWT 2.8)',          'blue'],
              ['OCR',         'Tesseract + pytesseract',  'amber'],
              ['Vision',      'OpenCV headless',          'amber'],
              ['NLP',         'spaCy 3.7 en_core_web_sm','violet'],
              ['ML',          'scikit-learn 1.3.2',       'violet'],
              ['Reports',     'ReportLab + openpyxl',     'gray'],
              ['DB 1',        'PostgreSQL 15',            'emerald'],
              ['DB 2',        'MongoDB 6 (Motor 3)',      'emerald'],
              ['Cache',       'Redis 7',                  'emerald'],
              ['Infra',       'Docker Compose',           'gray'],
              ['Password',    'bcrypt 4 + passlib',       'gray'],
            ].map(([cat, val, color]) => {
              const TEXT = { indigo:'text-indigo-600 dark:text-indigo-400', blue:'text-blue-600 dark:text-blue-400', amber:'text-amber-600 dark:text-amber-400', violet:'text-violet-600 dark:text-violet-400', emerald:'text-emerald-600 dark:text-emerald-400', gray:'text-gray-500 dark:text-gray-400' }
              return (
                <div key={cat} className="flex items-start gap-2 p-3 rounded-xl bg-gray-50 dark:bg-gray-700/40 border border-gray-100 dark:border-gray-700">
                  <div>
                    <p className="text-[10px] text-gray-400 font-medium">{cat}</p>
                    <p className={`text-sm font-bold ${TEXT[color]}`}>{val}</p>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </Layout>
  )
}
