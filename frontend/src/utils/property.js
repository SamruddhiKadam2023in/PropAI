// `amenities` is a JSON array string for properties created in the app and a comma list for seeded ones.
export function parseAmenities(value) {
  if (!value) return []
  if (Array.isArray(value)) return value.map(String)
  try {
    const parsed = JSON.parse(value)
    if (Array.isArray(parsed)) return parsed.map(String)
  } catch { /* not JSON - fall through */ }
  return String(value).split(',').map((s) => s.trim()).filter(Boolean)
}

export const propertyTypeLabel = (type) => (type ? type.charAt(0).toUpperCase() + type.slice(1) : '')
