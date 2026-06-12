import axios from 'axios'

const SYSTEM_PROMPT = `Eres el asistente virtual de SanaConsultIA, una consultoría especializada en automatización e inteligencia artificial para pequeñas empresas. Ayuda a los usuarios con sus consultas de forma profesional y amable.`

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

  return response.data.choices[0].message.content.trim()
}
