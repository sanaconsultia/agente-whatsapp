/* global io */
'use strict'

const socket = io()

// Estado local
let currentPhone = null
const convMap = {}   // phone → conversation object

// DOM refs
const $ = id => document.getElementById(id)
const convList     = $('conv-list')
const messagesArea = $('messages-area')
const noChatEl     = $('no-chat')
const chatViewEl   = $('chat-view')
const statusDot    = $('status-dot')
const statusText   = $('status-text')
const qrSection    = $('qr-section')
const qrImage      = $('qr-image')
const chatAvatar   = $('chat-avatar')
const chatName     = $('chat-name')
const chatPhone    = $('chat-phone')
const modeToggle   = $('mode-toggle')
const modeLabel    = $('mode-label')
const sendFormEl   = $('send-form')
const msgInput     = $('message-input')
const sendBtn      = $('send-btn')

// ── Socket events ──────────────────────────────────────────────────────────

socket.on('connection_state', ({ state, qr }) => {
  applyConnectionState(state)
  if (qr) showQR(qr)
})

socket.on('qr', showQR)

socket.on('whatsapp_connected', () => {
  qrSection.classList.add('hidden')
  applyConnectionState('open')
})

socket.on('whatsapp_disconnected', () => {
  applyConnectionState('disconnected')
})

socket.on('new_message', msg => {
  if (!msg.content) return
  if (msg.phone === currentPhone) {
    appendMessage(msg)
    scrollBottom()
  }
  bumpConv(msg.phone, msg.content, msg.name)
})

socket.on('conversation_updated', ({ phone, name, last_message, last_message_at }) => {
  if (convMap[phone]) {
    Object.assign(convMap[phone], { name, last_message, last_message_at })
    refreshConvItem(phone)
  }
})

socket.on('mode_changed', ({ phone, mode }) => {
  if (convMap[phone]) convMap[phone].mode = mode
  if (phone === currentPhone) applyModeUI(mode)
  const badge = convList.querySelector(`[data-phone="${CSS.escape(phone)}"] .mode-badge`)
  if (badge) {
    badge.textContent = mode === 'ai' ? 'IA' : 'Humano'
    badge.className = `mode-badge ${mode}`
  }
})

// ── Connection state ───────────────────────────────────────────────────────

function applyConnectionState(state) {
  const labels = { open: 'Conectado', qr: 'Esperando escaneo…', disconnected: 'Desconectado', connecting: 'Conectando…' }
  statusDot.className = `status-dot ${state === 'open' ? 'connected' : state}`
  statusText.textContent = labels[state] || state
}

function showQR(dataURL) {
  qrImage.src = dataURL
  qrSection.classList.remove('hidden')
  applyConnectionState('qr')
}

// ── Conversations ──────────────────────────────────────────────────────────

async function loadConversations() {
  const res = await fetch('/api/conversations')
  const list = await res.json()
  list.forEach(c => { convMap[c.phone] = c })
  renderConvList(list)
}

function renderConvList(list) {
  if (!list.length) {
    convList.innerHTML = '<p class="empty-state">Aún no hay conversaciones.<br>Envía un mensaje al bot para empezar.</p>'
    return
  }
  convList.innerHTML = list.map(convItemHTML).join('')
  convList.querySelectorAll('.conv-item').forEach(el =>
    el.addEventListener('click', () => openConversation(el.dataset.phone))
  )
}

function convItemHTML(c) {
  const time    = c.last_message_at ? fmtTime(c.last_message_at) : ''
  const preview = c.last_message ? truncate(c.last_message, 36) : 'Sin mensajes'
  const initial = (c.name || c.phone)[0].toUpperCase()
  const active  = c.phone === currentPhone ? ' active' : ''

  return `
    <div class="conv-item${active}" data-phone="${escHTML(c.phone)}">
      <div class="conv-avatar">${escHTML(initial)}</div>
      <div class="conv-info">
        <div class="conv-top">
          <span class="conv-name">${escHTML(c.name || c.phone)}</span>
          <span class="conv-time">${time}</span>
        </div>
        <div class="conv-bottom">
          <span class="conv-preview">${escHTML(preview)}</span>
          <span class="mode-badge ${c.mode}">${c.mode === 'ai' ? 'IA' : 'Humano'}</span>
        </div>
      </div>
    </div>`
}

function bumpConv(phone, content, name) {
  if (!convMap[phone]) {
    convMap[phone] = { phone, name: name || phone, mode: 'ai', last_message: content, last_message_at: new Date().toISOString() }
  } else {
    convMap[phone].last_message = content
    convMap[phone].last_message_at = new Date().toISOString()
    if (name && name !== phone) convMap[phone].name = name
  }
  refreshConvItem(phone)
}

function refreshConvItem(phone) {
  const c = convMap[phone]
  if (!c) return

  const tmp = document.createElement('div')
  tmp.innerHTML = convItemHTML(c)
  const newEl = tmp.firstElementChild
  newEl.addEventListener('click', () => openConversation(phone))

  const old = convList.querySelector(`[data-phone="${CSS.escape(phone)}"]`)
  if (old) old.remove()

  // Insertar en posición cronológica (más reciente arriba)
  const first = convList.querySelector('.conv-item')
  first ? convList.insertBefore(newEl, first) : convList.appendChild(newEl)
}

// ── Open conversation ──────────────────────────────────────────────────────

async function openConversation(phone) {
  currentPhone = phone
  const c = convMap[phone] || {}

  // Marca activa
  convList.querySelectorAll('.conv-item').forEach(el => el.classList.remove('active'))
  const el = convList.querySelector(`[data-phone="${CSS.escape(phone)}"]`)
  if (el) el.classList.add('active')

  // Header
  const initial = (c.name || phone)[0].toUpperCase()
  chatAvatar.textContent = initial
  chatName.textContent   = c.name || phone
  chatPhone.textContent  = `+${phone}`

  noChatEl.classList.add('hidden')
  chatViewEl.classList.remove('hidden')

  // Mensajes
  const res = await fetch(`/api/conversations/${encodeURIComponent(phone)}/messages`)
  const msgs = await res.json()
  messagesArea.innerHTML = msgs.map(msgHTML).join('')
  scrollBottom()

  applyModeUI(c.mode || 'ai')
}

// ── Messages ───────────────────────────────────────────────────────────────

function msgHTML(m) {
  const cls  = m.direction === 'outgoing' ? 'msg-out' : 'msg-in'
  const time = fmtTime(m.timestamp)
  return `
    <div class="message ${cls}">
      <div class="msg-bubble">
        <span class="msg-text">${escHTML(m.content)}</span>
        <span class="msg-time">${time}</span>
      </div>
    </div>`
}

function appendMessage(m) {
  const div = document.createElement('div')
  div.innerHTML = msgHTML(m)
  messagesArea.appendChild(div.firstElementChild)
}

function scrollBottom() {
  messagesArea.scrollTop = messagesArea.scrollHeight
}

// ── Mode toggle ────────────────────────────────────────────────────────────

function applyModeUI(mode) {
  modeToggle.checked = mode === 'human'
  modeLabel.textContent = mode === 'ai' ? '🤖 Modo IA activo' : '👤 Modo Humano activo'
  sendFormEl.classList.toggle('hidden', mode === 'ai')
}

modeToggle.addEventListener('change', async () => {
  if (!currentPhone) return
  const mode = modeToggle.checked ? 'human' : 'ai'
  await fetch(`/api/conversations/${encodeURIComponent(currentPhone)}/mode`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mode }),
  })
})

// ── Send message ───────────────────────────────────────────────────────────

async function doSend() {
  const text = msgInput.value.trim()
  if (!text || !currentPhone) return
  msgInput.value = ''
  msgInput.style.height = 'auto'

  await fetch(`/api/conversations/${encodeURIComponent(currentPhone)}/send`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: text }),
  })
}

sendBtn.addEventListener('click', doSend)

msgInput.addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); doSend() }
})

msgInput.addEventListener('input', function () {
  this.style.height = 'auto'
  this.style.height = Math.min(this.scrollHeight, 130) + 'px'
})

// ── Helpers ────────────────────────────────────────────────────────────────

function fmtTime(ts) {
  if (!ts) return ''
  // SQLite devuelve sin 'Z'; añadirla para que sea UTC
  const d = new Date(ts.includes('T') || ts.includes('Z') ? ts : ts.replace(' ', 'T') + 'Z')
  if (isNaN(d)) return ''
  const now = new Date()
  const sameDay = d.toDateString() === now.toDateString()
  return sameDay
    ? d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })
    : d.toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit' })
}

function truncate(str, n) {
  return str.length > n ? str.slice(0, n) + '…' : str
}

function escHTML(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

// ── Init ───────────────────────────────────────────────────────────────────

loadConversations()

fetch('/api/status')
  .then(r => r.json())
  .then(({ status }) => applyConnectionState(status))
  .catch(() => {})
