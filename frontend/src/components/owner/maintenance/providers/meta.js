import { Droplets, Hammer, KeyRound, Snowflake, Sparkles, Wrench, Zap } from 'lucide-react'

// Keys match the backend's service categories (services/provider_directory.py).
export const SERVICE_CATEGORIES = [
  { key: 'plumber', label: 'Plumber', chip: 'Plumber' },
  { key: 'electrician', label: 'Electrician', chip: 'Electrician' },
  { key: 'ac_technician', label: 'AC Technician', chip: 'AC' },
  { key: 'carpenter', label: 'Carpenter', chip: 'Carpenter' },
  { key: 'cleaning', label: 'Cleaning Service', chip: 'Cleaning' },
  { key: 'locksmith', label: 'Locksmith', chip: 'Locksmith' },
  { key: 'handyman', label: 'General Handyman', chip: 'Handyman' },
]
// Filter row: All first, then the categories in the order the owner asked for.
export const FILTER_CHIPS = [
  { key: 'all', chip: 'All' },
  ...['plumber', 'electrician', 'carpenter', 'ac_technician', 'cleaning', 'locksmith', 'handyman'].map((k) => SERVICE_CATEGORIES.find((c) => c.key === k)),
]
export const CATEGORY_ICON = { plumber: Droplets, electrician: Zap, ac_technician: Snowflake, carpenter: Hammer, cleaning: Sparkles, locksmith: KeyRound, handyman: Wrench }
export const categoryLabel = (key) => SERVICE_CATEGORIES.find((c) => c.key === key)?.label || 'Service'
export const STATUS_BADGE = { available: { label: 'Available', cls: 'badge-green' }, unavailable: { label: 'Unavailable', cls: 'badge-gray' } }
