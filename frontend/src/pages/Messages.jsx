import { useState, useEffect, useCallback, useRef } from 'react'
import Layout from '../components/Layout'
import api from '../services/api'
import toast from 'react-hot-toast'
import {
  MessageSquare, Send, RefreshCw, ChevronLeft,
} from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import ContactActions from '../components/ContactActions'
import { parseServerDate } from '../utils/dates'

const fmt = (iso) => {
  const d = parseServerDate(iso)   // the API's naive timestamps are UTC
  return d ? d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : ''
}

const ROLE_COLOR = {
  tenant:  'bg-success-soft text-success-fg',
  owner:   'bg-info-soft text-info-fg',
  manager: 'bg-violet-soft text-violet-fg',
}

export default function Messages() {
  const { user } = useAuth()
  const [contacts,  setContacts]  = useState([])
  const [selected,  setSelected]  = useState(null)   // contact object
  const [messages,  setMessages]  = useState([])
  const [body,      setBody]      = useState('')
  const [subject,   setSubject]   = useState('Property Query')
  const [loading,   setLoading]   = useState(false)
  const [sending,   setSending]   = useState(false)
  const bottomRef = useRef(null)

  const loadContacts = useCallback(async () => {
    try {
      const r = await api.get('/messages/contacts')
      setContacts(r.data)
    } catch { /* silent */ }
  }, [])

  const loadMessages = useCallback(async (contactId) => {
    setLoading(true)
    try {
      const r = await api.get('/messages/', { params: { with_user_id: contactId } })
      setMessages(r.data.reverse())   // oldest first
    } catch { /* silent */ }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { loadContacts() }, [loadContacts])

  useEffect(() => {
    if (selected) loadMessages(selected.id)
  }, [selected, loadMessages])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const handleSend = async (e) => {
    e.preventDefault()
    if (!body.trim() || !selected) return
    setSending(true)
    try {
      await api.post('/messages/', { to_user_id: selected.id, subject, body: body.trim() })
      setBody('')
      await loadMessages(selected.id)
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Failed to send')
    } finally { setSending(false) }
  }

  return (
    <Layout>
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <div className="w-9 h-9 tone-indigo rounded-xl flex items-center justify-center">
          <MessageSquare size={17} className="text-white" />
        </div>
        <div>
          <h1 className="text-xl font-bold text-fg">Messages</h1>
          <p className="text-xs text-fg-subtle">In-platform communication</p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-[minmax(13rem,1fr)_2fr] gap-4 h-[calc(100vh-200px)] min-h-[500px]">
        {/* Contact list */}
        <div className="card overflow-hidden flex flex-col">
          <div className="px-4 py-3 border-b border-line">
            <p className="text-sm font-semibold text-fg">Contacts</p>
            <p className="text-xs text-fg-subtle">{contacts.length} people</p>
          </div>
          <div className="flex-1 overflow-y-auto">
            {contacts.length === 0 ? (
              <div className="text-center py-10 text-fg-subtle text-sm px-4">
                No contacts yet.<br />
                {user?.role === 'tenant' && 'Your property owner will appear here.'}
                {user?.role === 'owner' && 'Your tenants will appear here.'}
              </div>
            ) : contacts.map((c) => (
              <button key={c.id} onClick={() => setSelected(c)}
                className={`w-full text-left px-4 py-3 border-b border-line hover:bg-accent-soft transition-colors ${
                  selected?.id === c.id ? 'bg-accent-soft border-l-2 border-l-accent' : ''
                }`}>
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 tone-indigo rounded-full flex items-center justify-center text-white font-bold text-sm flex-shrink-0">
                    {c.name?.[0]?.toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-fg truncate">{c.name}</p>
                    <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full ${ROLE_COLOR[c.role] || ''}`}>
                      {c.role}
                    </span>
                  </div>
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* Chat panel */}
        <div className="card overflow-hidden flex flex-col">
          {!selected ? (
            <div className="flex-1 flex items-center justify-center text-fg-subtle">
              <div className="text-center">
                <MessageSquare size={40} className="mx-auto mb-3 opacity-30" />
                <p className="font-medium">Select a contact to start chatting</p>
              </div>
            </div>
          ) : (
            <>
              {/* Header */}
              <div className="px-4 py-3 border-b border-line flex items-center gap-3">
                <button onClick={() => setSelected(null)} className="md:hidden p-1 text-fg-subtle">
                  <ChevronLeft size={18} />
                </button>
                <div className="w-8 h-8 tone-indigo rounded-full flex items-center justify-center text-white font-bold text-sm">
                  {selected.name?.[0]?.toUpperCase()}
                </div>
                <div>
                  <p className="text-sm font-semibold text-fg">{selected.name}</p>
                  <p className="text-xs text-fg-subtle capitalize">{selected.role}</p>
                </div>
                <button onClick={() => loadMessages(selected.id)} className="ml-auto p-1 text-fg-subtle hover:text-fg">
                  <RefreshCw size={14} />
                </button>
              </div>

              {/* Tenants can also reach their owner by phone, SMS or WhatsApp (opens the user's own app) */}
              {user?.role === 'tenant' && (
                <div className="px-4 py-2.5 border-b border-line bg-surface-2/60">
                  <ContactActions
                    name={selected.name}
                    phone={selected.phone}
                    message={`Hi ${selected.name?.split(' ')[0] || ''}, this is ${user.full_name}.`}
                  />
                </div>
              )}

              {/* Messages */}
              <div className="flex-1 overflow-y-auto p-4 space-y-3">
                {loading ? (
                  <div className="text-center py-10 text-fg-subtle">
                    <RefreshCw size={20} className="animate-spin mx-auto mb-2" />
                    <p className="text-sm">Loading…</p>
                  </div>
                ) : messages.length === 0 ? (
                  <div className="text-center py-10 text-fg-subtle text-sm">
                    No messages yet. Say hello!
                  </div>
                ) : messages.map((msg) => {
                  const mine = msg.from_id === user?.id
                  return (
                    <div key={msg.id} className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
                      <div className={`max-w-xs md:max-w-sm rounded-2xl px-4 py-2.5 shadow-sm ${
                        mine
                          ? 'bg-accent text-white rounded-br-md'
                          : 'bg-surface-2 text-fg rounded-bl-md'
                      }`}>
                        {msg.subject && msg.subject !== 'Property Query' && (
                          <p className={`text-[10px] font-semibold mb-1 ${mine ? 'text-white/90' : 'text-fg-muted'}`}>
                            {msg.subject}
                          </p>
                        )}
                        <p className="text-sm leading-relaxed">{msg.body}</p>
                        <p className={`text-[10px] mt-1 ${mine ? 'text-white/90' : 'text-fg-subtle'}`}>
                          {fmt(msg.created_at)}
                        </p>
                      </div>
                    </div>
                  )
                })}
                <div ref={bottomRef} />
              </div>

              {/* Compose */}
              <div className="border-t border-line p-3">
                <form onSubmit={handleSend} className="space-y-2">
                  <input
                    className="input text-sm"
                    placeholder="Subject (optional)"
                    value={subject}
                    onChange={e => setSubject(e.target.value)}
                  />
                  <div className="flex gap-2">
                    <textarea
                      className="input text-sm flex-1 resize-none"
                      rows={2}
                      placeholder={`Message to ${selected.name}…`}
                      value={body}
                      onChange={e => setBody(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) handleSend(e) }}
                    />
                    <button type="submit" disabled={!body.trim() || sending}
                      className="self-end btn-primary px-3 py-2 flex items-center gap-1.5 text-sm">
                      {sending
                        ? <RefreshCw size={14} className="animate-spin" />
                        : <Send size={14} />}
                      Send
                    </button>
                  </div>
                </form>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
    </Layout>
  )
}
