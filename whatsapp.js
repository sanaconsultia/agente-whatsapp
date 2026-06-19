import makeWASocket, {
  DisconnectReason,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  USyncQuery,
  USyncUser,
} from '@whiskeysockets/baileys'
import QRCode from 'qrcode'
import P from 'pino'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import { access, symlink, lstat } from 'fs/promises'
import * as db from './database.js'
import { getAIResponse, detectIntent } from './ai.js'
import { createEvent } from './calendar.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const logger = P({ level: 'silent' })

// Persists across reconnections — accumulates LID→@s.whatsapp.net mappings
const lidToJid = new Map()

// Baileys bug workaround: for @lid JIDs, sessions are stored as
// session-{user}.0.json but looked up as session-{user}.json (no device suffix).
// We create a symlink so the lookup finds the existing device-0 session.
async function ensureLidSessionAlias(rawJid) {
  const user = rawJid.split('@')[0]
  const authDir = join(__dirname, 'auth_info')
  const linkPath = join(authDir, `session-${user}.json`)
  const targetFile = `session-${user}.0.json`
  const targetPath = join(authDir, targetFile)

  try {
    const stat = await lstat(linkPath)
    if (stat.isSymbolicLink() || stat.isFile()) return  // already exists
  } catch { /* doesn't exist */ }

  try {
    await access(targetPath)  // only create if device-0 session exists
    await symlink(targetFile, linkPath)
    console.log(`[LID] Session alias creado: session-${user}.json → ${targetFile}`)
  } catch (e) {
    console.log(`[LID] No se pudo crear alias de sesión:`, e.message)
  }
}

async function resolveLidToJid(rawJid) {
  if (lidToJid.has(rawJid)) return lidToJid.get(rawJid)
  try {
    if (typeof sock?.executeUSyncQuery !== 'function') return rawJid
    const query = new USyncQuery()
      .withContext('interactive')
      .withMode('query')
      .withLIDProtocol()
      .withUser(new USyncUser().withLid(rawJid))
    const result = await sock.executeUSyncQuery(query)
    const entry = result?.list?.[0]
    const resolved = (entry?.id && !entry.id.endsWith('@lid')) ? entry.id
                   : (entry?.lid && !entry.lid.endsWith('@lid')) ? entry.lid
                   : null
    if (resolved) {
      console.log('[LID] Resuelto via USync:', rawJid, '→', resolved)
      lidToJid.set(rawJid, resolved)
      return resolved
    }
  } catch (e) {
    console.error('[LID] Error USync:', e.message)
  }
  console.log('[LID] No resuelto:', rawJid)
  return rawJid
}

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

  sock.ev.on('contacts.upsert', contacts => {
    for (const c of contacts) {
      if (c.lid && c.id) lidToJid.set(c.lid, c.id)
    }
  })
  sock.ev.on('contacts.update', updates => {
    for (const u of updates) {
      if (u.lid && u.id) lidToJid.set(u.lid, u.id)
    }
  })

  sock.ev.on('messages.update', updates => {
    for (const { key, update } of updates) {
      if (key.fromMe) console.log('[ACK]', key.remoteJid, 'status:', update.status)
    }
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

      const rawJid = msg.key.remoteJid
      if (rawJid?.endsWith('@g.us')) continue

      // Resolve @lid to @s.whatsapp.net via active USync server query.
      // LIDs are opaque — passive contacts.upsert only covers address-book
      // contacts, so we resolve on demand and cache the result.
      // Also create a session alias so Baileys can find the Signal session for
      // the reply (Baileys stores @lid sessions as user.0.json but looks them
      // up as user.json when device ID is undefined in relayMessage).
      let jid = rawJid
      if (rawJid?.endsWith('@lid')) {
        await ensureLidSessionAlias(rawJid)
        jid = await resolveLidToJid(rawJid)
      }

      const phone = jid.replace(/@(s\.whatsapp\.net|lid)$/, '')
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
        const intent = await detectIntent(content, history)
        console.log('INTENT:', JSON.stringify(intent))

        const sendReply = async (text) => {
          if (!text) { console.error('[AI] Respuesta vacía — no se envía nada'); return }
          await sock.sendMessage(jid, { text })
          db.saveMessage(phone, text, 'outgoing')
          const ts = new Date().toISOString()
          io.emit('new_message', { phone, name, content: text, direction: 'outgoing', timestamp: ts })
          io.emit('conversation_updated', { phone, name, last_message: text, last_message_at: ts })
        }

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
            await sendReply(reply)
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
            await sendReply(reply)
          }
        } else {
          console.log(`[AI] Generando respuesta para ${phone}:`, content.slice(0, 60))
          const reply = await getAIResponse(content, history)
          console.log(`[AI] Respuesta obtenida (${reply.length} chars):`, reply.slice(0, 80))
          await sendReply(reply)
        }

      } catch (err) {
        const detail = err.response?.data ?? err.message
        console.error('Error generando respuesta IA:', detail)
        await sock.sendMessage(jid, { text: 'Lo siento, estoy teniendo problemas técnicos. Inténtalo de nuevo en un momento.' })
      }
    }
  })
}

export async function sendMessage(phone, text) {
  if (!sock || state !== 'open') throw new Error('WhatsApp no conectado')
  const jid = phone.includes('@') ? phone : `${phone}@s.whatsapp.net`
  const result = await sock.sendMessage(jid, { text })
  console.log('[SEND-API] OK →', jid, 'msgId:', result?.key?.id, 'status:', result?.status)
}

function extractText(msg) {
  const m = msg.message
  if (!m) return null

  if (m.conversation)                    return m.conversation
  if (m.extendedTextMessage?.text)       return m.extendedTextMessage.text
  if (m.imageMessage?.caption)           return m.imageMessage.caption
  if (m.videoMessage?.caption)           return m.videoMessage.caption
  if (m.documentMessage?.caption)return m.documentMessage.caption
  if (m.audioMessage)                    return '[Mensaje de voz 🎤]'
  if (m.imageMessage)                    return '[Imagen 🖼️]'
  if (m.videoMessage)                    return '[Video 📹]'
  if (m.documentMessage)                 return `[Documento 📄: ${m.documentMessage.fileName || ''}]`.trim()
  if (m.stickerMessage)                  return '[Sticker]'
  if (m.locationMessage)                 return '[Ubicación 📍]'
  if (m.contactMessage)                  return '[Contacto 👤]'
  if (m.reactionMessage)                 return null
return null
}
