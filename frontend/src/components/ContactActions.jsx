import { MessageCircle, Phone, Smartphone } from 'lucide-react'
import { contactLinks, formatPhone } from '../utils/phone'

/**
 * Call / SMS / WhatsApp buttons. These are plain links that open the user's own phone,
 * messaging or WhatsApp app - nothing is sent through our backend.
 */
export default function ContactActions({ name, phone, message }) {
  const links = contactLinks(phone, message)
  if (!links) {
    return <p className="text-xs text-fg-subtle" data-testid="no-phone">No phone number on file for {name}.</p>
  }
  const shown = formatPhone(phone)
  const cls = 'btn-secondary !py-1.5 !px-3 flex items-center gap-1.5 text-xs'
  return (
    <div className="flex flex-wrap items-center gap-2" data-testid="contact-actions">
      <span className="text-xs text-fg-muted mr-1">{shown}</span>
      <a className={cls} href={links.call} aria-label={`Call ${name} on ${shown}`}>
        <Phone size={14} aria-hidden="true" /> Call
      </a>
      <a className={cls} href={links.sms} aria-label={`Send ${name} an SMS on ${shown}`}>
        <Smartphone size={14} aria-hidden="true" /> SMS
      </a>
      <a className={cls} href={links.whatsapp} target="_blank" rel="noopener noreferrer" aria-label={`Message ${name} on WhatsApp (opens in a new tab)`}>
        <MessageCircle size={14} aria-hidden="true" /> WhatsApp
      </a>
    </div>
  )
}
