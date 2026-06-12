import makeWASocket, {
  DisconnectReason,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
} from '@whiskeysockets/baileys'
import QRCode from 'qrcode'
import P from 'pino'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import * as db from './database.js'
import { getAIResponse } from './ai.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const logger = P({ level: 'silent' })

let sock = null
let state = 'disconnected'  // 'disconnected' | 'qr' | 'open'
let latestQR = null

export function getConnectionState() {
  return { state, qr: latestQR }
}

export async function initWhatsApp(io) {
  const { state: authState, saveCreds } = await useMultiFileAuthState(
    join(__dirname, 'auth_info')
  )

  let version
  try {
    const latest = await fetchLatestBaileysVersion()
    version = latest.version
  } catch {
    // usar versión integrada de Baileys si falla la red
  }

  sock = makeWASocket({
    version,
    auth: authState,
    printQRInTerminal: false,
    logger,
    browser: ['SanaConsultIA', 'Chrome', '1.0.0'],
    generateHighQualityLinkPreview: false,
  })

  sock.ev.on('creds.update', saveCreds)

  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update

    if (qr) {
      latestQR = await QRCode.toDataURL(qr)
      state = 'qr'
      io.emit('qr', latestQR)
      console.log('QR generado — escanea con WhatsApp')
    }

    if (connection === 'open') {
      latestQR = null
      state = 'open'
      io.emit('whatsapp_connected')
      console.log('✓ WhatsApp conectado')
    }

    if (connection === 'close') {
      state = 'disconnected'
      io.emit('whatsapp_disconnected')

      const statusCode = lastDisconnect?.error?.output?.statusCode
      const loggedOut = statusCode === DisconnectReason.loggedOut

      console.log(`Conexión cerrada (${statusCode}), reconectando: ${!loggedOut}`)
      if (!loggedOut) setTimeout(() => initWhatsApp(io), 4_000)
    }
  })

  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return

    for (const msg of messages) {
      if (!msg.message || msg.key.fromMe) continue
      if (msg.key.remoteJid?.endsWith('@g.us')) continue  // ignorar grupos

      const phone = msg.key.remoteJid.replace('@s.whatsapp.net', '')
      const name = msg.pushName || phone
      const content = extractText(msg)

      // historial previo para contexto de IA (antes de guardar el mensaje actual)
      const history = db.getMessages(phone, 20)

      db.saveMessage(phone, content, 'incoming', name)

      const now = new Date().toISOString()
      io.emit('new_message', { phone, name, content, direction: 'incoming', timestamp: now })
      io.emit('conversation_updated', { phone, name, last_message: content, last_message_at: now })

      const mode = db.getMode(phone)
      if (mode !== 'ai') continue

      try {
        const reply = await getAIResponse(content, history)
        await sock.sendMessage(msg.key.remoteJid, { text: reply })

        db.saveMessage(phone, reply, 'outgoing')
        const ts = new Date().toISOString()
        io.emit('new_message', { phone, content: reply, direction: 'outgoing', timestamp: ts })
        io.emit('conversation_updated', { phone, name, last_message: reply, last_message_at: ts })
      } catch (err) {
        console.error('Error generando respuesta IA:', err.message)
      }
    }
  })
}

export async function sendMessage(phone, text) {
  if (!sock || state !== 'open') throw new Error('WhatsApp no conectado')
  const jid = phone.includes('@') ? phone : `${phone}@s.whatsapp.net`
  await sock.sendMessage(jid, { text })
}

function extractText(msg) {
  const m = msg.message
  if (!m) return '[Mensaje vacío]'

  if (m.conversation)                    return m.conversation
  if (m.extendedTextMessage?.text)       return m.extendedTextMessage.text
  if (m.imageMessage?.caption)           return m.imageMessage.caption
  if (m.videoMessage?.caption)           return m.videoMessage.caption
  if (m.documentMessage?.caption)        return m.documentMessage.caption
  if (m.audioMessage)                    return '[Mensaje de voz 🎤]'
  if (m.imageMessage)                    return '[Imagen 🖼️]'
  if (m.videoMessage)                    return '[Video 📹]'
  if (m.documentMessage)                 return `[Documento 📄: ${m.documentMessage.fileName || ''}]`.trim()
  if (m.stickerMessage)                  return '[Sticker]'
  if (m.locationMessage)                 return '[Ubicación 📍]'
  if (m.contactMessage)                  return '[Contacto 👤]'
  if (m.reactionMessage)                 return null  // ignorar reacciones

  return '[Mensaje no soportado]'
}
