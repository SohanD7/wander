// Dedicated pilot fixture; never changes the shipped demo trips.
export const PILOT_TRIP_ID = 'pilot-lisbon-demo'
export function seedPilotTrip(doc) {
  doc.transact(() => {
    const meta = doc.getMap('meta')
    for (const [key, value] of Object.entries({
      seeded: true,
      name: 'Wander pilot · destination vote',
      type: 'flight trip',
      place: 'destination undecided',
      start: '',
      end: '',
      budget: 0,
      destinationPollId: 'w_destination',
    }))
      meta.set(key, value)
    doc.getMap('widgets').set('w_destination', destinationStarter())
  })
}

export function destinationStarter() {
  return {
    id: 'w_destination',
    type: 'vote',
    x: 176,
    y: 128,
    z: 1,
    question: 'where should we go?',
    eligible: 4,
    closes: 'no deadline',
    options: [
      { id: 'o_lisbon', text: 'Lisbon' },
      { id: 'o_porto', text: 'Porto' },
    ],
  }
}
