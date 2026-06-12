import 'dotenv/config'
import express from 'express'
import { createServer } from 'http'
import { Server } from 'socket.io'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import * as db from './database.js'
import { initWhatsApp, sendMessage, getConnectionState } from './whatsapp.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const app = express()
const httpServer = createServer(app)
const io = new Server(httpServer)

app.use(express.json())
app.use(express.static(join(__dirname, 'dashboard')))

// ── API REST ─────────────────────────────────────────────────────────────────

app.get('/api/status', (_req, res) => {
  const { state } = getConnectionState()
  res.json({ status: state })
})

app.get('/api/conversations', (_req, res) => {
  res.json(db.getConversations())
})

app.get('/api/conversations/:phone/messages', (req, res) => {
  const messages = db.getMessages(decodeURIComponent(req.params.phone))
  res.json(messages)
})

app.post('/api/conversations/:phone/mode', (req, res) => {
  const phone = decodeURIComponent(req.params.phone)
  const { mode } = req.body

  if (!['ai', 'human'].includes(mode)) {
    return res.status(400).json({ error: 'mode debe ser "ai" o "human"' })
  }

  db.setMode(phone, mode)
  io.emit('mode_changed', { phone, mode })
  res.json({ ok: true })
})

app.post('/api/conversations/:phone/send', async (req, res) => {
  const phone = decodeURIComponent(req.params.phone)
  const { message } = req.body

  if (!message?.trim()) {
    return res.status(400).json({ error: 'message requerido' })
  }

  try {
    await sendMessage(phone, message.trim())
    db.saveMessage(phone, message.trim(), 'outgoing')

    const now = new Date().toISOString()
    io.emit('new_message', { phone, content: message.trim(), direction: 'outgoing', timestamp: now })
    io.emit('conversation_updated', { phone, last_message: message.trim(), last_message_at: now })

    res.json({ ok: true })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ── Socket.IO ────────────────────────────────────────────────────────────────

io.on('connection', (socket) => {
  const { state, qr } = getConnectionState()
  socket.emit('connection_state', { state })
  if (qr) socket.emit('qr', qr)
})

// ── Arranque ─────────────────────────────────────────────────────────────────

const PORT = process.env.PORT || 3000

httpServer.listen(PORT, () => {
  console.log(`\n🚀 Dashboard → http://localhost:${PORT}\n`)
  initWhatsApp(io)
})
