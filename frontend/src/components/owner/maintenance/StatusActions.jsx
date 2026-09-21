import { CheckCircle2, Play } from 'lucide-react'

// Same workflow the Owner page has always had: Start (open -> in progress) and Resolve.
export default function StatusActions({ record, onStatus, busy }) {
  return (
    <div className="flex items-center gap-1.5">
      {record.status === 'open' && (
        <button type="button" className="btn-secondary !py-1 !px-2.5 !text-xs flex items-center gap-1" disabled={busy}
          onClick={() => onStatus(record, 'in_progress')} aria-label={`Start work on ${record.title}`}>
          <Play size={12} aria-hidden="true" /> Start
        </button>
      )}
      {record.status !== 'resolved' && (
        <button type="button" className="btn-success !py-1 !px-2.5 !text-xs flex items-center gap-1" disabled={busy}
          onClick={() => onStatus(record, 'resolved')} aria-label={`Mark ${record.title} as resolved`}>
          <CheckCircle2 size={12} aria-hidden="true" /> Resolve
        </button>
      )}
    </div>
  )
}
