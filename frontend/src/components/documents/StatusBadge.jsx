import { AlertTriangle, CheckCircle2, Loader2, UploadCloud, XCircle } from 'lucide-react'

const META = {
  uploading:  { label: 'Uploading',    cls: 'badge-blue',   Icon: UploadCloud,   spin: false },
  pending:    { label: 'Processing',   cls: 'badge-blue',   Icon: Loader2,       spin: true },
  processing: { label: 'Processing',   cls: 'badge-blue',   Icon: Loader2,       spin: true },
  completed:  { label: 'Completed',    cls: 'badge-green',  Icon: CheckCircle2,  spin: false },
  flagged:    { label: 'Needs review', cls: 'badge-yellow', Icon: AlertTriangle, spin: false },
  failed:     { label: 'Failed',       cls: 'badge-red',    Icon: XCircle,       spin: false },
}

export default function StatusBadge({ status, progress }) {
  const { label, cls, Icon, spin } = META[status] || META.failed
  return (
    <span className={`${cls} gap-1 flex-shrink-0`} role="status" aria-live="polite">
      <Icon size={12} className={spin ? 'animate-spin' : ''} aria-hidden="true" />
      {label}
      {status === 'uploading' && progress != null ? ` ${progress}%` : ''}
    </span>
  )
}
