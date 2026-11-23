import { randomUUID, randomInt, randomBytes, createHmac, timingSafeEqual } from 'node:crypto'
import { sendZeroSettleText } from '../zerosettle-ack.mjs'
export const token = () => randomBytes(32).toString('base64url')
export const problem = (status, message) => Object.assign(new Error(message), { status })
export function claims({ query, key, transport, config, clock = Date.now }) {
  const hash = (type, value) =>
    createHmac('sha256', key)
      .update(type + '|' + value)
      .digest('base64url')
  const invitation = (id) => hash('invite', id)
  function session(cookie, trip) {
    if (!cookie) return null
    return query(
      'SELECT m.* FROM wander_session s JOIN wander_member m ON m.picker=s.picker AND m.trip=s.trip WHERE s.digest=$1 AND s.trip=$2 AND s.expires>$3 AND m.active',
      [hash('session', cookie), trip, clock()],
    )[0]
  }
  async function challenge(trip, browser, picker) {
    const m = query('SELECT * FROM wander_member WHERE trip=$1 AND picker::text=$2 AND active', [
      trip.id,
      picker,
    ])[0]
    if (!m || !m.handle.startsWith('+')) throw problem(400, 'Choose a phone number in this group.')
    const now = clock(),
      binding = hash('browser', browser)
    query('DELETE FROM wander_challenge WHERE created<$1', [now - 86400000])
    query('DELETE FROM wander_session WHERE expires<$1', [now])
    const recent = query(
      'SELECT created,picker,browser FROM wander_challenge WHERE created>$1 AND (picker=$2 OR browser=$3 OR trip=$4)',
      [now - 3600000, picker, binding, trip.id],
    )
    const same = recent.filter((c) => c.picker === picker)
    if (
      same.some((c) => Number(c.created) > now - 60000) ||
      same.length >= 5 ||
      recent.filter((c) => c.browser === binding).length >= 8 ||
      recent.filter((c) => c.trip === trip.id).length >= 40
    )
      throw problem(429, 'Please wait before requesting another code.')
    const id = randomUUID(),
      code = String(randomInt(1000000)).padStart(6, '0')
    query('BEGIN')
    try {
      query("UPDATE wander_challenge SET state='superseded' WHERE picker=$1 OR (trip=$2 AND browser=$3)", [
        picker,
        trip.id,
        binding,
      ])
      query("INSERT INTO wander_challenge VALUES($1,$2,$3,$4,$5,$6,0,'sending')", [
        id,
        trip.id,
        picker,
        binding,
        hash(id, code),
        now,
      ])
      query('COMMIT')
    } catch (e) {
      query('ROLLBACK')
      throw e
    }
    const result = await sendZeroSettleText({
      config,
      to: m.handle,
      text: 'Your Wander verification code is ' + code + '. It expires in 5 minutes.',
      signal: new AbortController().signal,
      fetchImpl: transport(trip),
    })
    const saved = query("UPDATE wander_challenge SET state=$1 WHERE id=$2 AND state='sending' RETURNING id", [
      result.state,
      id,
    ])
    if (!saved.length) throw problem(409, 'A newer code was requested.')
    if (result.state !== 'sent')
      throw problem(
        502,
        result.state === 'failed'
          ? 'The private message failed. Try again later.'
          : 'Delivery is uncertain. Request a new code after a minute.',
      )
    return { challenge: id }
  }
  function verify(trip, browser, id, code) {
    const c = query(
      "SELECT c.* FROM wander_challenge c JOIN wander_member m ON m.picker=c.picker AND m.trip=c.trip WHERE c.id::text=$1 AND c.trip=$2 AND c.browser=$3 AND c.state='sent' AND m.active AND c.created>$4 AND c.attempts<5",
      [id, trip.id, hash('browser', browser), clock() - 300000],
    )[0]
    if (!c) throw problem(400, 'That code expired or was replaced. Request a new code.')
    if (!timingSafeEqual(Buffer.from(c.digest), Buffer.from(hash(id, code)))) {
      query('UPDATE wander_challenge SET attempts=attempts+1 WHERE id=$1', [id])
      throw problem(400, 'That code doesn’t match. Check your private message and try again.')
    }
    query('BEGIN')
    let cookie
    try {
      query("UPDATE wander_challenge SET state='used' WHERE id=$1", [id])
      query('UPDATE wander_member SET claimed=true WHERE picker=$1', [c.picker])
      cookie = issueSession(trip.id, c.picker)
      query('COMMIT')
    } catch (e) {
      query('ROLLBACK')
      throw e
    }
    return cookie
  }
  function issueSession(trip, picker) {
    const cookie = token()
    query('INSERT INTO wander_session VALUES($1,$2,$3,$4)', [
      hash('session', cookie), trip, picker, clock() + 30 * 86400000,
    ])
    return cookie
  }
  return {
    issueSession,
    invitation,
    session,
    challenge,
    verify,
    logout: (cookie) => query('DELETE FROM wander_session WHERE digest=$1', [hash('session', cookie)]),
  }
}
