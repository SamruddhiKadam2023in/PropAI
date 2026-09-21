// Data-viz colours resolve to the CSS variables in src/index.css, so charts and
// icon chips follow the active theme with no per-component colour literals.
const v = (name, alpha) => (alpha === undefined ? `rgb(var(--${name}))` : `rgb(var(--${name}) / ${alpha})`)

export const SERIES = {
  electricity: v('series-electricity'),
  water:       v('series-water'),
  gas:         v('series-gas'),
  internet:    v('series-internet'),
  maintenance: v('series-maintenance'),
}

export const seriesTint = (key, alpha = 0.16) => v(`series-${key}`, alpha)

export const CHART = {
  grid:   v('line'),
  axis:   v('fg-subtle'),
  text:   v('fg-muted'),
  cursor: v('fg', 0.06),
  tooltip: {
    contentStyle: {
      backgroundColor: v('surface'),
      border: `1px solid ${v('line-strong')}`,
      borderRadius: 12,
      color: v('fg'),
      boxShadow: '0 8px 24px rgb(0 0 0 / 0.18)',
    },
    labelStyle: { color: v('fg'), fontWeight: 600 },
    itemStyle: { color: v('fg-muted') },
  },
}

export const CATEGORY_COLORS = [
  SERIES.electricity, SERIES.water, SERIES.gas, SERIES.internet, SERIES.maintenance,
  v('success-fg'), v('info-fg'),
]
