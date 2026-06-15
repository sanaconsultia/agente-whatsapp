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
import { getAIResponse, detectIntent } from './ai.js'
import { createEvent } from './calendar.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const logger = P({ level: 'silent' })

let sock = null
let state = 'disconnected'
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
    syncFullHistory: false,
    emitOwnEvents: true,
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
      if (!msg.message) continue

      const jid = msg.key.remoteJid
      if (jid?.endsWith('@g.us')) continue

      const phone = jid.replace('@s.whatsapp.net', '')
      const content = extractText(msg)
      if (!content) continue

      // Mensajes enviados por Jordi desde el número del bot
      if (msg.key.fromMe) {
        if (content.trim() === '#stop') {
          db.setMode(phone, 'human')
          console.log(`Modo manual activado para ${phone}`)
        } else if (content.trim() === '#bot') {
          db.setMode(phone, 'ai')
          console.log(`Bot reactivado para ${phone}`)
        }
        continue
      }

      const name = msg.pushName || phone
      const history = db.getMessages(phone, 20)
      db.saveMessage(phone, content, 'incoming', name)

      const now = new Date().toISOString()
      io.emit('new_message', { phone, name, content, direction: 'incoming', timestamp: now })
      io.emit('conversation_updated', { phone, name, last_message: content, last_message_at: now })

      const mode = db.getMode(phone)
      if (mode !== 'ai') continue

      try {
        const intent = await detectIntent(content)
        console.log('INTENT:', JSON.stringify(intent))

        if (intent.intent === 'agendar') {
          const missing = []
          if (!intent.fecha) missing.push('la fecha')
          if (!intent.hora) missing.push('la hora')
          if (!intent.nombre) missing.push('tu nombre')
          if (!intent.email) missing.push('tu email')

          if (missing.length > 0) {
            const reply = await getAIResponse(
              `El usuario quiere agendar pero faltan estos datos: ${missing.join(', ')}. Pídelos de forma natural y amable.`,
              history
            )
            await sock.sendMessage(jid, { text: reply })
          } else {
            await createEvent(
              `Reunión con ${intent.nombre}`,
              intent.fecha,
              intent.hora,
              intent.email
            )
            const reply = await getAIResponse(
              `Confirma al usuario que su cita ha sido agendada para el ${intent.fecha} a las ${intent.hora}. Sé breve y amable.`,
              history
            )
            await sock.sendMessage(jid, { text: reply })
          }
        } else {
          const reply = await getAIResponse(content, history)
          await sock.sendMessage(jid, { text: reply })
        }

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
  if (!m) return null

  if (m.conversation)                    return m.conversation
  if (m.extendedTextMessage?.text)       return m.extendedTextMessage.text
  if (m.imageMessage?.caption)           return m.imageMessage.caption
  if (m.videoMessage?.caption)           return m.videoMessage.caption
  if (m.documentMessage?.caption)
