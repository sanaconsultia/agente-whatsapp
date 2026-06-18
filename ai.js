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

SanaConsultIA no tiene oficina física. Las reuniones siempre se realizan en la dirección del cliente o por videollamada.

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
  console.error('Error generando respuesta IA:', response.data)
  throw new Error('Respuesta vacía de OpenRouter')
}
return content.trim()
}

export async function detectIntent(userMessage) {
  const today = new Date().toISOString().split('T')[0]

  const response = await axios.post(
    'https://openrouter.ai/api/v1/chat/completions',
    {
      model: process.env.OPENROUTER_MODEL || 'anthropic/claude-3-haiku',
      messages: [
        {
          role: 'system',
          content: `Analiza el mensaje del usuario y devuelve SOLO un objeto JSON con esta estructura, sin texto adicional:
{
  "intent": "agendar" | "consulta" | "otro",
  "fecha": "YYYY-MM-DD o null",
  "hora": "HH:MM o null",
  "nombre": "nombre del usuario o null",
  "email": "email del usuario o null"
}
La fecha de hoy es ${today}. Usa siempre el año actual al interpretar fechas. Si el usuario no especifica año, usa el año actual.
Si el usuario quiere agendar una reunión, visita o llamada, intent="agendar".
Si menciona fecha u hora concretas, extráelas. Si no, déjalas null.
Extrae también nombre y email si los menciona. Si no, déjalos null.`
        },
        { role: 'user', content: userMessage }
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
    return JSON.parse(response.data.choices[0].message.content.trim())
  } catch {
    return { intent: 'otro', fecha: null, hora: null, nombre: null, email: null }
  }
}
