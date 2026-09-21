// Phone numbers arrive from the API already normalised to E.164 (e.g. "+919820222222").
// Links are only built for numbers that pass this check, so a malformed value can never produce a broken or unsafe link.
const E164 = /^\+[1-9]\d{7,14}$/

export const isValidPhone = (phone) => typeof phone === 'string' && E164.test(phone)

export function formatPhone(phone) {
  if (!isValidPhone(phone)) return ''
  const m = phone.match(/^\+91(\d{5})(\d{5})$/)
  return m ? `+91 ${m[1]} ${m[2]}` : phone
}

/**
 * tel: and sms: use the "+" form (RFC 3966); wa.me wants digits only. Message text is URL-encoded.
 * `?&body=` is the form both iOS and Android SMS apps accept.
 */
export function contactLinks(phone, message = '') {
  if (!isValidPhone(phone)) return null
  const text = encodeURIComponent(message)
  return {
    call: `tel:${phone}`,
    sms: message ? `sms:${phone}?&body=${text}` : `sms:${phone}`,
    whatsapp: `https://wa.me/${phone.slice(1)}${message ? `?text=${text}` : ''}`,
  }
}
