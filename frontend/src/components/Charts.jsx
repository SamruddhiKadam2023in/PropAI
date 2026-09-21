import {
  LineChart, Line, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts'
import { SERIES, CHART, CATEGORY_COLORS } from '../theme/palette'

const currency = (v) => `₹${Number(v).toLocaleString('en-IN')}`

const axisTick = { fontSize: 11, fill: CHART.axis }
const legendText = (value) => <span style={{ color: CHART.text, fontSize: 12 }}>{value}</span>

export function ExpenseTrendChart({ data, categories = ['electricity', 'water', 'gas', 'internet', 'maintenance'] }) {
  if (!data || data.length === 0) return <Empty />
  return (
    <ResponsiveContainer width="100%" height={280}>
      <LineChart data={data} margin={{ top: 5, right: 10, left: 10, bottom: 5 }}>
        <CartesianGrid strokeDasharray="3 3" stroke={CHART.grid} />
        <XAxis dataKey="month" tick={axisTick} stroke={CHART.grid} />
        <YAxis tickFormatter={currency} tick={axisTick} stroke={CHART.grid} width={80} />
        <Tooltip formatter={(v) => currency(v)} {...CHART.tooltip} />
        <Legend formatter={legendText} />
        {categories.map((cat, i) => (
          <Line key={cat} type="monotone" dataKey={cat} stroke={SERIES[cat] || CATEGORY_COLORS[i % CATEGORY_COLORS.length]}
            strokeWidth={2} dot={{ r: 3 }} name={cat.charAt(0).toUpperCase() + cat.slice(1)} />
        ))}
      </LineChart>
    </ResponsiveContainer>
  )
}

export function MonthlyExpenseBar({ data }) {
  if (!data || data.length === 0) return <Empty />
  return (
    <ResponsiveContainer width="100%" height={260}>
      <BarChart data={data} margin={{ top: 5, right: 10, left: 10, bottom: 5 }}>
        <CartesianGrid strokeDasharray="3 3" stroke={CHART.grid} vertical={false} />
        <XAxis dataKey="month" tick={axisTick} stroke={CHART.grid} />
        <YAxis tickFormatter={currency} tick={axisTick} stroke={CHART.grid} width={80} />
        <Tooltip formatter={(v) => currency(v)} cursor={{ fill: CHART.cursor }} {...CHART.tooltip} />
        <Legend formatter={legendText} />
        <Bar dataKey="electricity" name="Electricity" fill={SERIES.electricity} radius={[3, 3, 0, 0]} />
        <Bar dataKey="water"       name="Water"       fill={SERIES.water}       radius={[3, 3, 0, 0]} />
        <Bar dataKey="gas"         name="Gas"         fill={SERIES.gas}         radius={[3, 3, 0, 0]} />
        <Bar dataKey="internet"    name="Internet"    fill={SERIES.internet}    radius={[3, 3, 0, 0]} />
        <Bar dataKey="maintenance" name="Maintenance" fill={SERIES.maintenance} radius={[3, 3, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  )
}

function PieLabel({ cx, cy, midAngle, outerRadius, name, percent }) {
  const r = outerRadius + 14
  const rad = Math.PI / 180
  const x = cx + r * Math.cos(-midAngle * rad)
  const y = cy + r * Math.sin(-midAngle * rad)
  return (
    <text x={x} y={y} fill={CHART.text} fontSize={11} textAnchor={x > cx ? 'start' : 'end'} dominantBaseline="central">
      {`${name} ${(percent * 100).toFixed(0)}%`}
    </text>
  )
}

export function LivingCostPie({ breakdown, data: dataProp }) {
  const data = dataProp
    ? dataProp
    : breakdown
      ? Object.entries(breakdown)
          .filter(([k]) => !['total', 'month'].includes(k) && breakdown[k] > 0)
          .map(([name, value]) => ({ name: name.charAt(0).toUpperCase() + name.slice(1), value }))
      : []
  if (!data || data.length === 0) return <Empty />

  return (
    <ResponsiveContainer width="100%" height={240}>
      <PieChart>
        <Pie data={data} cx="50%" cy="50%" innerRadius={50} outerRadius={80}
          dataKey="value" label={PieLabel} labelLine={false} stroke="none">
          {data.map((entry, i) => <Cell key={i} fill={entry.fill || CATEGORY_COLORS[i % CATEGORY_COLORS.length]} />)}
        </Pie>
        <Tooltip formatter={(v) => currency(v)} {...CHART.tooltip} />
      </PieChart>
    </ResponsiveContainer>
  )
}

export function RentDeviationGauge({ deviation }) {
  if (!deviation) return <Empty />
  const { tenant_rent, market_rent, deviation_percent, status } = deviation
  const badge = status === 'above_market' ? 'badge-red' : status === 'below_market' ? 'badge-green' : 'badge-blue'
  const tone  = status === 'above_market' ? 'text-danger-fg' : status === 'below_market' ? 'text-success-fg' : 'text-info-fg'

  return (
    <div className="text-center space-y-3 py-4">
      <div className={`text-4xl font-bold ${tone}`}>
        {deviation_percent > 0 ? '+' : ''}{deviation_percent.toFixed(1)}%
      </div>
      <div className={`${badge} text-sm px-3 py-1`}>
        {status === 'above_market' ? 'Above Market' : status === 'below_market' ? 'Below Market' : 'At Market Rate'}
      </div>
      <div className="grid grid-cols-2 gap-4 mt-4 text-sm">
        <div className="bg-surface-2 rounded-lg p-3">
          <p className="text-fg-subtle text-xs mb-1">Your Rent</p>
          <p className="font-bold text-fg">{currency(tenant_rent)}</p>
        </div>
        <div className="bg-surface-2 rounded-lg p-3">
          <p className="text-fg-subtle text-xs mb-1">Market Avg</p>
          <p className="font-bold text-fg">{currency(market_rent)}</p>
        </div>
      </div>
    </div>
  )
}

function Empty() {
  return <div className="flex items-center justify-center h-48 text-fg-subtle text-sm">No data yet</div>
}
