// Keys match the backend (services/agreements.py).
export const AGREEMENT_STATUS = {
  active: { label: 'Active', cls: 'badge-green' },
  completed: { label: 'Completed', cls: 'badge-gray' },
  terminated: { label: 'Terminated', cls: 'badge-yellow' },
  abandoned: { label: 'Abandoned', cls: 'badge-red' },
}
export const agreementStatus = (s) => AGREEMENT_STATUS[s] || { label: s || 'Unknown', cls: 'badge-gray' }

export const SETTLEMENT = {
  outstanding: { label: 'Outstanding', cls: 'badge-red' },
  settled: { label: 'Settled', cls: 'badge-green' },
}
