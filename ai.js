import axios from 'axios'

const SYSTEM_PROMPT = `Eres el asistente virtual de SanaConsultIA, una consultoría especializada en automatización e inteligencia artificial para pequeñas y medianas empresas, con base en Barcelona y la Costa Brava.

SanaConsultIA ofrece soluciones completamente personalizadas y a medida. Cada proyecto se diseña según las necesidades específicas del cliente, sin límites en el tipo de solución. Los precios dependen siempre del alcance del proyecto.

Algunos ejemplos de proyectos realizados o en desarrollo:
- Chatbot inteligente para páginas web que captura leads y atiende consultas 24/7.
- Agente de WhatsApp automatizado que responde clientes de forma autónoma.
- Sistema de agendado automático de visitas o citas sin intervención humana.
- Automatización de llamadas entrantes y salientes con registro en audio MP3 y correo electrónico.
- Páginas web profesionales.
- Aplicaciones a medida.
- Cualquier proyecto de automatización o IA que el negocio necesite.

Nuestro enfoque es como un traje a medida: escuchamos al cliente, entendemos su negocio y diseñamos la solución más adecuada. Nunca cerramos la puerta a ningún proyecto.

SanaConsultIA no tiene oficina física. Las reuniones SIEMPRE se realizan en las instalaciones del cliente o por videollamada. NUNCA digas que el cliente venga a ningún sitio — eres tú (Jordi de SanaConsultIA) quien va a visitar al cliente en su local. Usa siempre frases como "iré a visitarte", "quedamos en tu local", "me pasaré por tu centro".

Para hablar con Jordi y recibir un presupuesto personalizado, el cliente puede llamar al 629 88 15 48 o visitar sanaconsultia.es.

Responde siempre en el idioma del cliente, de forma profesional, cercana y concisa. Si preguntan por precios, explica que son personalizados según el proyecto y anímalos a contactar directamente con Jordi.`

export async function getAIResponse(userMessage, history = []) {
  const messages = [
    { role: 'system', content: SYSTEM_PROMPT },
    ...history.map(m => ({
      role: m.direction === 'incoming' ? 'user' : 'assistant',
      content: m.content,
    })),
    { role: 'user', content: userMessage },
  ]

  const response = await axios.post(
    'https://openrouter.ai/api/v1/chat/completions',
    {
      model: process.env.OPENROUTER_MODEL || 'anthropic/claude-3-haiku',
      messages,
      max_tokens: 600,
      temperature: 0.7,
    },
    {
      headers: {
        Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': process.env.SITE_URL || 'http://localhost:3000',
        'X-Title': process.env.SITE_NAME || 'SanaConsultIA',
      },
      timeout: 30_000,
    }
  )

  const content = response.data?.choices?.[0]?.message?.content
  if (!content) {
    console.error('OpenRouter respuesta vacía:', response.data)
    throw new Error(`OpenRouter devolvió contenido vacío (model: ${response.data?.model ?? 'unknown'})`)
  }
  return content.trim()
}

export async function detectIntent(userMessage, history = []) {
  const today = new Date().toISOString().split('T')[0]

  // Pre-calculate next 7 days so the AI doesn't need to do date arithmetic
  const dayNames = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado']
  const nextDays = []
  for (let i = 0; i <= 7; i++) {
    const d = new Date()
    d.setDate(d.getDate() + i)
    nextDays.push(`${dayNames[d.getDay()]} ${d.toISOString().split('T')[0]}`)
  }
  const todayDay = dayNames[new Date().getDay()]

  const conversationMessages = [
    ...history.slice(-8).map(m => ({
      role: m.direction === 'incoming' ? 'user' : 'assistant',
      content: m.content,
    })),
    { role: 'user', content: userMessage },
  ]

  const response = await axios.post(
    'https://openrouter.ai/api/v1/chat/completions',
    {
      model: process.env.OPENROUTER_MODEL || 'anthropic/claude-3-haiku',
      messages: [
        {
          role: 'system',
          content: `Analiza TODA la conversación y devuelve SOLO un objeto JSON con esta estructura, sin texto adicional:
{
  "intent": "agendar" | "consulta" | "otro",
  "fecha": "YYYY-MM-DD o null",
  "hora": "HH:MM o null",
  "nombre": "nombre del usuario o null",
  "email": "email del usuario o null"
}
Hoy es ${todayDay} ${today}. Los próximos días son: ${nextDays.join(', ')}.
Cuando el usuario mencione un día de la semana (ej: "el miércoles"), usa exactamente la fecha de esa lista.
Si la intención es agendar, extrae fecha/hora/nombre/email de TODO el historial, no solo del último mensaje.
Si un dato ya fue mencionado en mensajes anteriores de la conversación, inclúyelo aunque no esté en el último mensaje.
Si el usuario quiere agendar una reunión, visita o llamada, intent="agendar".`
        },
        ...conversationMessages,
      ],
      max_tokens: 150,
      temperature: 0,
    },
    {
      headers: {
        Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
        'Content-Type': 'application/json',
      },
      timeout: 15_000,
    }
  )

  try {
    const raw = response.data?.choices?.[0]?.message?.content
    if (!raw) {
      console.error('Error en detectIntent:', response.data)
      return { intent: 'otro', fecha: null, hora: null, nombre: null, email: null }
    }
    return JSON.parse(raw.trim())
  } catch {
    return { intent: 'otro', fecha: null, hora: null, nombre: null, email: null }
  }
}
