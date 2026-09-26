import api from './api'

export const getOcrConfig = () => api.get('/config/ocr').then((r) => r.data)
export const updateOcrConfig = (payload) => api.put('/config/ocr', payload).then((r) => r.data)
