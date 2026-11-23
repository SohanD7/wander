import { describe, expect, it } from 'vitest'
import { linkMessage } from './link-message.mjs'

describe('supplied link recognition', () => {
  it('recognizes clear bare domains, paths and punctuation, normalizing only missing schemes', () => {
    expect(linkMessage('Try (bomb.com), github.com/username! https://example.org/a_(b)?x=1&y=2.').urls).toEqual([
      'https://bomb.com', 'https://github.com/username', 'https://example.org/a_(b)?x=1&y=2',
    ])
    expect(linkMessage('HTTPS://Example.com/Path?Tag=A').urls).toEqual(['HTTPS://Example.com/Path?Tag=A'])
    expect(linkMessage('bomb.com bomb.com https://bomb.com').urls).toEqual(['https://bomb.com'])
  })
  it.each(['alice@example.com', 'mail me at alice+pilot@github.com/username', '3.14 or 192.168.1.2',
    'ordinary text, e.g. this sentence.', 'file.txt document.pdf', 'ftp://github.com/username', 'mailto:alice@example.com'])('does not create cards for %s', (text) => {
    expect(linkMessage(text).urls).toEqual([])
  })
  it('keeps comments and mixed votes with bare links', () => {
    expect(linkMessage('I vote for Porto (bomb.com).').voteText).toBe('I vote for Porto')
    expect(linkMessage('(bomb.com).').comment).toBe('')
    expect(linkMessage('i VoTe FoR pOrTo github.com/username\nNice place')).toEqual({ urls: ['https://github.com/username'], comment: 'i VoTe FoR pOrTo \nNice place', voteText: 'i VoTe FoR pOrTo' })
  })
})
