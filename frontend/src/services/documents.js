import api from './api'

export const listDocuments = () => api.get('/documents/').then((r) => r.data)

export const uploadDocument = (file, onProgress) => {
  const form = new FormData()
  form.append('file', file)
  return api
    .post('/documents/upload', form, {
      timeout: 120000,
      onUploadProgress: (e) => e.total && onProgress?.(Math.round((e.loaded * 100) / e.total)),
    })
    .then((r) => r.data)
}

// The original file is only reachable with the user's token, so it is fetched as a Blob.
export const fetchOriginal = (id, { download = false } = {}) =>
  api
    .get(`/documents/${id}/file`, { responseType: 'blob', params: download ? { download: true } : undefined })
    .then((r) => r.data)

export async function saveOriginal(doc) {
  const blob = await fetchOriginal(doc.id, { download: true })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = doc.filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export const correctDocument = (id, body) => api.patch(`/documents/${id}/correct`, body).then((r) => r.data)
export const reprocessDocument = (id) => api.post(`/documents/${id}/reprocess`).then((r) => r.data)
export const deleteDocument = (id) => api.delete(`/documents/${id}`)
