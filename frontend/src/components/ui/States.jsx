import { AlertTriangle, RefreshCw } from 'lucide-react'

export function Skeleton({ className = '' }) {
  return <div className={`animate-pulse rounded-xl bg-surface-3/70 ${className}`} aria-hidden="true" />
}

export function EmptyState({ icon: Icon, title, description, action }) {
  return (
    <div className="card text-center py-12">
      {Icon && <Icon size={36} className="mx-auto text-fg-subtle mb-3" aria-hidden="true" />}
      <p className="font-semibold text-fg">{title}</p>
      {description && <p className="text-sm text-fg-subtle mt-1 max-w-md mx-auto">{description}</p>}
      {action && <div className="mt-4 flex justify-center">{action}</div>}
    </div>
  )
}

export function ErrorState({ title = "Something went wrong", description, onRetry, compact = false }) {
  return (
    <div className={`card text-center ${compact ? 'py-6' : 'py-12'}`} role="alert">
      <AlertTriangle size={compact ? 24 : 32} className="mx-auto text-danger-fg mb-2" aria-hidden="true" />
      <p className="font-semibold text-fg">{title}</p>
      {description && <p className="text-sm text-fg-subtle mt-1">{description}</p>}
      {onRetry && (
        <button type="button" className="btn-primary mt-4 inline-flex items-center gap-2" onClick={onRetry}>
          <RefreshCw size={14} /> Try again
        </button>
      )}
    </div>
  )
}
