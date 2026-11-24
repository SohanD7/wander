import { hasLiteralWandaAddress, wandaCommandText } from './wanda-command.mjs'
import { listKey, parseWandaList } from './zerosettle-lists.mjs'
import { parseWandaPoll } from './zerosettle-polls.mjs'

/**
 * @typedef {{type:'poll-choices', question:string} |
 *   {type:'list-items', action:'list'|'add', title:string} |
 *   {type:'list-target'|'list-name', items:string[]}} DetailPrompt
 * @typedef {{kind:'board'} | {kind:'help', topic:'general'|'polls'|'lists'} |
 *   {kind:'poll', question:string, options:string[]} |
 *   {kind:'list', action:'list'|'add'|'done', title?:string, items:string[]} |
 *   {kind:'rename', widgetType:'checklist'|'vote', title:string, newTitle:string} |
 *   {kind:'ask', prompt:DetailPrompt}} Intent
 */

const defaultQuestion = 'What should we do?'
const helpTopics = {
  polls: {
    example: '@Wanda vote on hiking or museum',
    shortcut: '@Wanda poll Where should we stop? | Cafe | Park',
    description: 'Start a poll with two or more choices.',
  },
  lists: {
    example: '@Wanda make a day bag checklist with water and snacks',
    shortcut: '@Wanda list Essentials | Headlamp | Rain jacket',
    description: 'Create a checklist, add items, or check them off.',
  },
}

export function wandaHelpReply(topic, config) {
  if (topic === 'general') {
    const examples = Object.entries(helpTopics).flatMap(([name, help]) =>
      config[name] ? [help.example] : [],
    )
    return ['Try one of these in this chat.', ...examples, '@Wanda send the trip link again'].join('\n')
  }
  if (!config[topic])
    return topic === 'polls'
      ? 'Polls are turned off in this chat.'
      : 'Checklists are turned off in this chat.'
  const { description, shortcut } = helpTopics[topic]
  return `${description} Copy this shortcut.\n${shortcut}`
}

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
  if (![title ?? 'Checklist', ...items].every(safe)) return null
  const prefix = action === 'add' ? 'add to' : action
  const parsed = parseWandaList('@Wanda ' + prefix + ' ' + [title ?? 'Checklist', ...items].join(' | '))
  return parsed.valid ? { kind: 'list', action, title, items: parsed.items } : null
}

/** Recognize only an addressed request with a supported sentence structure. @returns {Intent | null} */
export function interpretWanda(text) {
  const addressed = wandaCommandText(text)
  if (!addressed || addressed.length > 4000 || /[\r\n|]/u.test(addressed)) return null
  const request = addressed.trim().replace(/^(?:(?:can|could|would) (?:you|we)\s+|please\s+)/i, '')
  const help = /^(?:help(?: (polls|lists))?|what can you do)$/i.exec(clean(request))
  if (help) return { kind: 'help', topic: help[1]?.toLowerCase() ?? 'general' }
  if (/^vote$/i.test(clean(request))) {
    return { kind: 'ask', prompt: { type: 'poll-choices', question: defaultQuestion } }
  }

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

  const rename = /^rename (?:the )?(list|checklist|poll|vote) ("[^"]+"|“[^”]+”|.+?) to (.+)$/i.exec(request)
  const renameByName = /^rename (?:the )?(.+?) (list|checklist|poll|vote) to (.+)$/i.exec(request)
  if (rename || renameByName) {
    const type = (rename?.[1] ?? renameByName[2]).toLowerCase()
    const widgetType = type === 'list' || type === 'checklist' ? 'checklist' : 'vote'
    const unquote = (value) =>
      value.trim().replace(/^(?:"([^"]+)"|“([^”]+)”)$/u, (_, straight, curly) => straight ?? curly)
    const title = unquote(rename?.[2] ?? renameByName[1]).trim()
    const newTitle = unquote((rename ?? renameByName)[3]).trim()
    if (
      [title, newTitle].every(safe) &&
      [...title].length <= 300 &&
      [...newTitle].length <= (widgetType === 'checklist' ? 80 : 200)
    )
      return { kind: 'rename', widgetType, title, newTitle }
    return null
  }

  const unnamedList =
    /^(?:make|create|start|set up) (?:a |an |the |our )?(?:checklist|list) (?:with|for|including) (.+)$/i.exec(
      clean(request),
    )
  if (unnamedList) {
    const candidate = list('list', undefined, labels(unnamedList[1], 'and'))
    if (candidate) return { kind: 'ask', prompt: { type: 'list-name', items: candidate.items } }
  }
  const create =
    /^(?:make|create|start|set up) (?:a |an |the |our )?(.+?) (?:checklist|list) (?:with|for|including) (.+)$/i.exec(
      clean(request),
    )
  if (create) return list('list', sentence(clean(create[1])), labels(create[2], 'and'))
  const mentionsList = /(?:checklist|list)$/i.test(clean(request))
  const literal = hasLiteralWandaAddress(text)
  const add = /^add (.+?) to (?:the |our |my )?(.+?)(?: checklist| list)?$/i.exec(clean(request))
  if (add && (literal || mentionsList)) return list('add', clean(add[2]), labels(add[1], 'and'))
  const namedList =
    /^(?:make|create|start|set up) (?:a |an |the |our )?(.+?) (?:checklist|list)(?: with)?$/i.exec(
      clean(request),
    )
  const addTo = /^add to (?:the |our |my )?(.+?)(?: checklist| list)?$/i.exec(clean(request))
  const missingItems = namedList ?? addTo
  if (missingItems) {
    const title = namedList ? sentence(clean(missingItems[1])) : clean(missingItems[1])
    const action = namedList ? 'list' : 'add'
    if (!/^(?:a|an|the|our)$/i.test(title) && list(action, title, ['item']))
      return { kind: 'ask', prompt: { type: 'list-items', action, title } }
  }
  // A bare Wanda prefix followed by "add" is also used in ordinary chatter.
  const missingList = (literal || request !== addressed.trim()) && /^add (.+?)(?: to)?$/i.exec(clean(request))
  if (missingList && !/\s+to\s+|^to(?:\s|$)/i.test(missingList[1])) {
    const candidate = list('add', undefined, labels(missingList[1], 'and'))
    if (candidate) return { kind: 'ask', prompt: { type: 'list-target', items: candidate.items } }
  }

  const done =
    /^(?:check off|tick off|mark) (.+?)(?: as (?:done|complete))? (?:on|in|from) (?:the |our |my )?(.+?)(?: checklist| list)?$/i.exec(
      clean(request),
    )
  if (done && (literal || mentionsList)) return list('done', clean(done[2]), [clean(done[1])])
  const itemOnly = /^(?:mark (.+?) as (?:done|complete)|(?:check off|tick off) (.+))$/i.exec(clean(request))
  if (itemOnly) return list('done', undefined, [clean(itemOnly[1] ?? itemOnly[2])])
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
    case 'list-items':
      return list(prompt.action, prompt.title, labels(answer, 'and'))
    case 'list-name':
      return list('list', sentence(answer), prompt.items)
    case 'list-target': {
      const title = answer.replace(/^(?:the |our |my )/i, '').replace(/ (?:checklist|list)$/i, '')
      return list('add', title, prompt.items)
    }

    case 'create-list':
      if (/^(?:yes|yes please|sure|create it)$/i.test(answer)) {
        const { title, items } = prompt.intent
        return list('list', sentence(title), items)
      }
      return /^(?:no|no thanks|cancel)$/i.test(answer) ? { kind: 'cancel' } : null
    case 'select-target': {
      if (/^(?:no|no thanks|cancel)$/i.test(answer)) return { kind: 'cancel' }
      if (prompt.choices.length === 1 && /^(?:yes|yes please|sure)$/i.test(answer))
        return prompt.choices[0].intent
      return /^[1-5]$/.test(answer) ? (prompt.choices[Number(answer) - 1]?.intent ?? null) : null
    }
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
    case 'list-items':
      return `What should I ${prompt.action === 'list' ? 'put on' : 'add to'} ${prompt.title}?`
    case 'list-target':
      return 'Which list should I add that to?'
    case 'list-name':
      return 'What should I call the list?'

    case 'create-list':
      return `Create ${sentence(prompt.intent.title)} with ${prompt.intent.items.join(', ')}? Reply yes or no.`
    case 'select-target': {
      if (prompt.choices.length === 1) return `${prompt.question} Reply yes or no.`
      return (
        `${prompt.question} Reply with its number.\n` +
        prompt.choices.map((choice, index) => `${index + 1}. ${choice.label}`).join('\n')
      )
    }
    case 'choose-list':
    case 'choose-item': {
      const choices = prompt.choices.map((choice, index) => `${index + 1}. ${choice.label}`).join('\n')
      return `Which ${prompt.type === 'choose-list' ? 'list' : 'item'}? Reply with its number.\n${choices}`
    }
  }
}
