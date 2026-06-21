import nodemailer from 'nodemailer'

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.GMAIL_USER,
    pass: process.env.GMAIL_APP_PASSWORD,
  },
})

let lastAlertAt = 0
const COOLDOWN_MS = 15 * 60 * 1000 // máximo 1 email cada 15 minutos

export async function sendDisconnectAlert(statusCode, dashboardUrl) {
  if (!process.env.GMAIL_USER || !process.env.GMAIL_APP_PASSWORD) return

  const now = Date.now()
  if (now - lastAlertAt < COOLDOWN_MS) return
  lastAlertAt = now

  const needsManualAction = statusCode === 401
  const subject = needsManualAction
    ? '🔴 Bot WhatsApp cerró sesión — necesitas escanear QR'
    : `⚠️ Bot WhatsApp desconectado (código ${statusCode})`

  const body = needsManualAction
    ? `El bot ha cerrado sesión y NO reconectará solo.\n\nAbre este enlace y escanea el QR con el teléfono del bot:\n${dashboardUrl}\n\nPasos:\n1. Abre el enlace\n2. En el teléfono: WhatsApp → ⋮ → Dispositivos vinculados → Vincular dispositivo\n3. Escanea el QR`
    : `El bot se desconectó con código ${statusCode} e intentará reconectar automáticamente.\n\nSi en 5 minutos sigue sin responder, abre:\n${dashboardUrl}`

  try {
    await transporter.sendMail({
      from: `"Bot SanaConsultIA" <${process.env.GMAIL_USER}>`,
      to: process.env.ALERT_EMAIL || process.env.GMAIL_USER,
      subject,
      text: body,
    })
    console.log('[ALERT] Email enviado:', subject)
  } catch (e) {
    console.error('[ALERT] Error enviando email:', e.message)
  }
}
