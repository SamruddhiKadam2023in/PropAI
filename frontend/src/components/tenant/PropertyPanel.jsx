import { useState } from 'react'
import { Building2, MapPin } from 'lucide-react'
import { assetUrl } from '../../utils/assets'
import { parseAmenities, propertyTypeLabel } from '../../utils/property'

const TONES = ['tone-indigo', 'tone-blue', 'tone-emerald']
const money = (n) => (n == null ? null : `₹${Number(n).toLocaleString('en-IN')}`)

function Field({ label, value }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs font-medium text-fg-subtle">{label}</dt>
      <dd className={`text-sm mt-0.5 break-words ${value ? 'text-fg font-semibold' : 'text-fg-subtle italic'}`}>{value || 'Not provided'}</dd>
    </div>
  )
}

export default function PropertyPanel({ property }) {
  const [imageFailed, setImageFailed] = useState(false)
  const image = imageFailed ? null : assetUrl(property.image_url)
  const tone = TONES[property.id % TONES.length]
  const amenities = parseAmenities(property.amenities)
  const location = [property.city, property.state].filter(Boolean).join(', ')
  const status = property.is_available
    ? { label: 'Available', cls: 'badge-green' }
    : { label: 'Occupied · Your home', cls: 'badge-indigo' }

  return (
    <section aria-label="Your property" className="card !p-0 overflow-hidden" data-testid="property-panel">
      <div className={`relative min-h-[13rem] flex flex-col justify-end ${image ? 'tone-slate' : tone}`}>
        {image ? (
          <>
            <img src={image} alt={`Photo of ${property.title}`} onError={() => setImageFailed(true)}
              className="absolute inset-0 w-full h-full object-cover" />
            <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/40 to-black/10" aria-hidden="true" />
          </>
        ) : (
          <Building2 size={120} className="absolute right-4 top-4 text-white/10" aria-hidden="true" />
        )}

        <div className="relative z-10 p-6 text-white">
          <div className="flex flex-wrap gap-2 mb-3">
            <span className={`${status.cls} !bg-black/35 !text-white`}>{status.label}</span>
            {property.property_type && <span className="badge-gray !bg-black/35 !text-white">{propertyTypeLabel(property.property_type)}</span>}
          </div>
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div className="min-w-0">
              <p className="text-white/90 text-xs font-medium uppercase tracking-wide mb-1">Your property</p>
              <h2 className="text-2xl font-bold leading-tight">{property.title}</h2>
              <p className="flex items-start gap-1.5 mt-1.5 text-white/90 text-sm">
                <MapPin size={14} className="mt-0.5 flex-shrink-0" aria-hidden="true" />
                <span>{[property.address, location].filter(Boolean).join(', ')}{property.pincode ? ` – ${property.pincode}` : ''}</span>
              </p>
            </div>
            <div className="text-right">
              <p className="text-white/90 text-xs">Monthly rent</p>
              <p className="text-3xl font-bold">{money(property.rent_amount)}</p>
            </div>
          </div>
        </div>
      </div>

      <div className="p-6 space-y-5">
        <dl className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <Field label="Property type" value={propertyTypeLabel(property.property_type)} />
          <Field label="Bedrooms" value={property.bedrooms != null ? `${property.bedrooms} BHK` : null} />
          <Field label="Bathrooms" value={property.bathrooms != null ? String(property.bathrooms) : null} />
          <Field label="Area" value={property.area_sqft ? `${property.area_sqft} sq.ft` : null} />
          <Field label="Location" value={location} />
          <Field label="Pincode" value={property.pincode} />
          <Field label="Rent" value={property.rent_amount != null ? `${money(property.rent_amount)} / month` : null} />
          <Field label="Status" value={status.label} />
        </dl>

        {property.description && <p className="text-sm text-fg-muted leading-relaxed">{property.description}</p>}

        {amenities.length > 0 && (
          <div>
            <p className="text-xs font-medium text-fg-subtle mb-2">Amenities</p>
            <ul className="flex flex-wrap gap-2">
              {amenities.map((a) => <li key={a} className="badge-indigo">{a}</li>)}
            </ul>
          </div>
        )}
      </div>
    </section>
  )
}
