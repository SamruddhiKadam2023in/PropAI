import { useEffect, useRef } from 'react'
import { X } from 'lucide-react'

export default function Modal({ title, subtitle, onClose, children, wide = false, footer = null }) {
  const closeRef = useRef(null)

  useEffect(() => {
    const opener = document.activeElement
    closeRef.current?.focus()
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('keydown', onKey); opener?.focus?.() }
  }, [onClose])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-overlay/60 backdrop-blur-sm"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div role="dialog" aria-modal="true" aria-label={title}
        className={`bg-surface border border-line rounded-2xl shadow-2xl w-full ${wide ? 'max-w-3xl' : 'max-w-xl'} max-h-[90vh] flex flex-col overflow-hidden`}>
        <div className="flex items-start gap-3 px-5 py-4 border-b border-line">
          <div className="min-w-0 flex-1">
            <h2 className="font-bold text-fg break-words">{title}</h2>
            {subtitle && <p className="text-xs text-fg-subtle mt-0.5">{subtitle}</p>}
          </div>
          <button ref={closeRef} type="button" onClick={onClose} aria-label="Close" className="p-1.5 rounded-lg text-fg-muted hover:text-fg hover:bg-surface-2">
            <X size={18} />
          </button>
        </div>
        <div className="overflow-y-auto p-5">{children}</div>
        {footer && <div className="border-t border-line px-5 py-3 bg-surface-2/50">{footer}</div>}
      </div>
    </div>
  )
}
