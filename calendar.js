import axios from 'axios'

async function getAccessToken() {
  const res = await axios.post(
    'https://oauth2.googleapis.com/token',
    new URLSearchParams({
      client_id:     process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      refresh_token: process.env.GOOGLE_REFRESH_TOKEN,
      grant_type:    'refresh_token',
    }),
    { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
  )
  return res.data.access_token
}

export async function getAvailableSlots(date) {
  const startOfDay = new Date(`${date}T09:00:00+02:00`)
  const endOfDay   = new Date(`${date}T18:00:00+02:00`)

  const token = await getAccessToken()
  const res = await axios.post(
    'https://www.googleapis.com/calendar/v3/freeBusy',
    {
      timeMin: startOfDay.toISOString(),
      timeMax: endOfDay.toISOString(),
      items:   [{ id: process.env.GOOGLE_CALENDAR_ID }],
    },
    { headers: { Authorization: `Bearer ${token}` } }
  )

  const busy = res.data.calendars[process.env.GOOGLE_CALENDAR_ID].busy
  const slots = []
  let current = new Date(startOfDay)

  while (current < endOfDay) {
    const slotEnd = new Date(current.getTime() + 60 * 60 * 1000)
    const isBusy = busy.some(b =>
      new Date(b.start) < slotEnd && new Date(b.end) > current
    )
    if (!isBusy) slots.push(`${current.getHours()}:00`)
    current = slotEnd
  }

  return slots
}

export async function createEvent(summary, date, hour, attendeeEmail) {
  const [h, m] = hour.split(':').map(Number)
  const start = new Date(`${date}T00:00:00Z`)
  start.setUTCHours(h - 2, m, 0, 0)
  const end = new Date(start.getTime() + 60 * 60 * 1000)

  const token = await getAccessToken()
  await axios.post(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(process.env.GOOGLE_CALENDAR_ID)}/events`,
    {
      summary,
      start:     { dateTime: start.toISOString() },
      end:       { dateTime: end.toISOString() },
      attendees: attendeeEmail ? [{ email: attendeeEmail }] : [],
    },
    {
      headers: { Authorization: `Bearer ${token}` },
      params:  { sendUpdates: 'all' },
    }
  )
}
