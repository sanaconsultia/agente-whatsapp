import { google } from 'googleapis'

const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  'http://localhost'
)

oauth2Client.setCredentials({
  refresh_token: process.env.GOOGLE_REFRESH_TOKEN
})

const calendar = google.calendar({ version: 'v3', auth: oauth2Client })

export async function getAvailableSlots(date) {
  const startOfDay = new Date(`${date}T09:00:00+02:00`)
  const endOfDay = new Date(`${date}T18:00:00+02:00`)

  const res = await calendar.freebusy.query({
    requestBody: {
      timeMin: startOfDay.toISOString(),
      timeMax: endOfDay.toISOString(),
      items: [{ id: process.env.GOOGLE_CALENDAR_ID }]
    }
  })

  const busy = res.data.calendars[process.env.GOOGLE_CALENDAR_ID].busy
  const slots = []
  let current = new Date(startOfDay)

  while (current < endOfDay) {
    const slotEnd = new Date(current.getTime() + 60 * 60 * 1000)
    const isBusy = busy.some(b =>
      new Date(b.start) < slotEnd && new Date(b.end) > current
    )
    if (!isBusy) {
      slots.push(`${current.getHours()}:00`)
    }
    current = slotEnd
  }

  return slots
}

export async function createEvent(summary, date, hour, attendeeEmail) {
  const start = new Date(`${date}T${hour}:00`)
  const end = new Date(start.getTime() + 60 * 60 * 1000)

  await calendar.events.insert({
    calendarId: process.env.GOOGLE_CALENDAR_ID,
    requestBody: {
      summary,
      start: { dateTime: start.toISOString() },
      end: { dateTime: end.toISOString() },
      attendees: attendeeEmail ? [{ email: attendeeEmail }] : [],
    },
  })
}
