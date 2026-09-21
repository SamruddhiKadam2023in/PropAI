import { Bell, BellRing, CheckCircle2, CreditCard, FileText, Home, MessageSquare, UserPlus, Wrench, XCircle } from 'lucide-react'

export const TONE_CLASSES = {
  warning: 'bg-warning-soft text-warning-fg',
  success: 'bg-success-soft text-success-fg',
  info:    'bg-info-soft text-info-fg',
  danger:  'bg-danger-soft text-danger-fg',
  violet:  'bg-violet-soft text-violet-fg',
  accent:  'bg-accent-soft text-accent-text',
}

// `route` is where a tenant lands when they open the notification; `group` drives the page filters.
const META = {
  rent_due:          { label: 'Payment reminder',      Icon: BellRing,      tone: 'warning', route: '/tenant/payments',    group: 'payments' },
  payment_confirmed: { label: 'Payment confirmed',     Icon: CreditCard,    tone: 'success', route: '/tenant/payments',    group: 'payments' },
  maintenance:       { label: 'Maintenance',           Icon: Wrench,        tone: 'info',    route: '/tenant/maintenance', group: 'maintenance' },
  property_update:   { label: 'Property update',       Icon: Home,          tone: 'violet',  route: '/tenant',             group: 'property' },
  approved:          { label: 'Application approved',  Icon: CheckCircle2,  tone: 'success', route: '/tenant',             group: 'property' },
  rejected:          { label: 'Application update',    Icon: XCircle,       tone: 'danger',  route: '/tenant/search',      group: 'property' },
  new_message:       { label: 'Message',               Icon: MessageSquare, tone: 'accent',  route: '/messages',           group: 'other' },
  ocr_complete:      { label: 'Document',              Icon: FileText,      tone: 'accent',  route: '/tenant/documents',   group: 'other' },
  new_application:   { label: 'Application',           Icon: UserPlus,      tone: 'info',    route: null,                  group: 'other' },
}

const FALLBACK = { label: 'Notification', Icon: Bell, tone: 'accent', route: null, group: 'other' }

export const metaFor = (type) => META[type] || FALLBACK
