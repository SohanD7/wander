import { wandaCommandText } from './wanda-command.mjs'
import { listKey, parseWandaList } from './zerosettle-lists.mjs'
import { parseWandaPoll } from './zerosettle-polls.mjs'

/**
 * @typedef {{kind:'board'} | {kind:'poll', question:string, options:string[]} |
 *   {kind:'list', action:'list'|'add'|'done', title:string, items:string[]} |
 *   {kind:'ask', prompt:{type:'poll-choices', question:string}}} Intent
 */

const defaultQuestion = 'What should we do?'
const clean = (text) =>
  text
    .trim()
    .replace(/[.?!]+$/, '')
    .trim()
const sentence = (text) => text.charAt(0).toUpperCase() + text.slice(1)
const safe = (text) =>
  Boolean(text) && !/[\r\n|]/u.test(text) && [...text].every((char) => char.charCodeAt(0) >= 32)
const labels = (text, conjunction) =>
  clean(text)
    .split(conjunction === 'or' ? /\s*,\s*(?:or\s+)?|\s+or\s+/i : /\s*,\s*(?:and\s+)?|\s+and\s+/i)
    .map(clean)

function poll(question, options) {
  if (!safe(question) || !options.every(safe)) return null
  const parsed = parseWandaPoll('@Wanda poll ' + [question, ...options].join(' | '))
  return parsed.valid ? { kind: 'poll', question: parsed.question, options: parsed.options } : null
}

export function pollChoices(question, text) {
  const input = text.replace(/^(?:the )?(?:options|choices)\s*:\s*/i, '')
  if (/^(?:i (?:don['’]t know|think)|not sure|maybe|no idea)\b/i.test(input)) return null
  const options = labels(input, 'or').map((option) => sentence(option.replace(/^going to (?:the )?/i, '')))
  return poll(question, options)
}

function list(action, title, items) {
  if (![title, ...items].every(safe)) return null
  const prefix = action === 'add' ? 'add to' : action
  const parsed = parseWandaList('@Wanda ' + prefix + ' ' + [title, ...items].join(' | '))
  return parsed.valid ? { kind: 'list', action, title: parsed.title, items: parsed.items } : null
}

/** Recognize only an addressed request with a supported sentence structure. @returns {Intent | null} */
export function interpretWanda(text) {
  const addressed = wandaCommandText(text)
  if (!addressed || addressed.length > 4000 || /[\r\n|]/u.test(addressed)) return null
  const request = addressed.trim().replace(/^(?:(?:can|could|would) (?:you|we)\s+|please\s+)/i, '')
  if (
    /^(?:send|share|resend|show)(?: (?:me|us))? (?:the |our )?(?:trip|board|canvas)(?: invite)? link(?: again)?[.!?]*$/i.test(
      request,
    ) ||
    /^(?:what(?:['’]s| is)|where(?:['’]s| is)) (?:the |our )?(?:trip|board|canvas) link[.!?]*$/i.test(request)
  )
    return { kind: 'board' }

  const vote =
    /^(?:(?:let(?:['’]?s| us)\s+)?vote on|choose between|(?:make|create|start|set up) (?:a )?poll)(?=$|[\s:?!.])\s*:?[ \t]*(?:(?:about|for|on|with)\s+)?(.*)$/i.exec(
      request,
    )
  if (vote) {
    const input = vote[1].trim()
    const explicit = /^(.+?\?)(?:\s+|:\s*)(.+)$/u.exec(input)
    const questionOnly =
      /^(?:what|where|when|which|who|how|should|do|does|is|are|will|would|can)\b.+\?$/i.test(input) &&
      !/\s+or\s+|,/i.test(input)
    const question = explicit?.[1] ?? (questionOnly ? input : defaultQuestion)
    const choices =
      explicit?.[2] ?? (questionOnly ? '' : input.replace(/^(?:an?|the|our)\s+activity\s*[:,]\s*/i, ''))
    return (
      pollChoices(question, choices) ?? {
        kind: 'ask',
        prompt: {
          type: 'poll-choices',
          question: safe(question) && [...question].length <= 300 ? question : defaultQuestion,
        },
      }
    )
  }

  const create =
    /^(?:make|create|start|set up) (?:a |an |the |our )?(.+?) (?:checklist|list) (?:with|for|including) (.+)$/i.exec(
      clean(request),
    )
  if (create) return list('list', sentence(clean(create[1])), labels(create[2], 'and'))
  const mentionsList = /(?:checklist|list)$/i.test(clean(request))
  const literal = /^\s*@wanda\s+/i.test(text)
  const add = /^add (.+?) to (?:the |our |my )?(.+?)(?: checklist| list)?$/i.exec(clean(request))
  if (add && (literal || mentionsList)) return list('add', clean(add[2]), labels(add[1], 'and'))
  const done =
    /^(?:check off|tick off|mark) (.+?)(?: as (?:done|complete))? (?:on|in|from) (?:the |our |my )?(.+?)(?: checklist| list)?$/i.exec(
      clean(request),
    )
  if (done && (literal || mentionsList)) return list('done', clean(done[2]), [clean(done[1])])
  return null
}

export const listMatches = (lists, title) =>
  lists.filter((entry) =>
    [listKey(title), listKey(title + ' list'), listKey(title + ' checklist')].includes(listKey(entry.title)),
  )

/** Pure interpretation of a reply to a particular previously sent prompt. */
export function interpretAnswer(prompt, text) {
  if (typeof text !== 'string' || text.length > 4000) return null
  const answer = clean((wandaCommandText(text) ?? text).trim().replace(/^answer\s+/i, ''))
  switch (prompt.type) {
    case 'poll-choices':
      return pollChoices(prompt.question, answer)
    case 'create-list':
      if (/^(?:yes|yes please|sure|create it)$/i.test(answer)) {
        const { title, items } = prompt.intent
        return list('list', sentence(title), items)
      }
      return /^(?:no|no thanks|cancel)$/i.test(answer) ? { kind: 'cancel' } : null
    case 'choose-list':
    case 'choose-item': {
      if (!/^[1-5]$/.test(answer)) return null
      const choice = prompt.choices[Number(answer) - 1]
      if (!choice) return null
      return {
        ...prompt.intent,
        ...(prompt.type === 'choose-list' ? { listId: choice.id } : { itemId: choice.id }),
      }
    }
  }
  return null
}

export function clarificationQuestion(prompt) {
  switch (prompt.type) {
    case 'poll-choices':
      return 'What are the options? Reply with two or more, like Hiking or Museum.'
    case 'create-list':
      return `Create ${sentence(prompt.intent.title)} with ${prompt.intent.items.join(', ')}? Reply yes or no.`
    case 'choose-list':
    case 'choose-item': {
      const choices = prompt.choices.map((choice, index) => `${index + 1}. ${choice.label}`).join('\n')
      return `Which ${prompt.type === 'choose-list' ? 'list' : 'item'}? Reply with its number.\n${choices}`
    }
  }
}
