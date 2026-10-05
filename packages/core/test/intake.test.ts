/**
 * The intake agent's judgement, with no model, no database and no clock.
 *
 * Each block pins one decision the agent makes on a customer's behalf, because
 * each is a decision a customer feels: asking for something they already said,
 * answering "thanks" with another message, writing to an Arabic speaker in
 * English, or holding a conversation with another company's auto-responder.
 */

import { describe, expect, it } from 'vitest'
import {
  classifyNewContent,
  clampIntakeSettings,
  containerTypeCode,
  decideIntakeReply,
  DEFAULT_INTAKE_REQUIREMENTS,
  DEFAULT_INTAKE_SETTINGS,
  detectLanguage,
  INTAKE_REQUIREMENT_CHOICES,
  requirementChoiceFields,
  requirementChoiceFor,
  evaluateCompleteness,
  isChitChat,
  listNaturally,
  looksAutoReply,
  missingPhrase,
  turnDueAt,
  withoutStrayContainerCount,
  readExtractedEnquiry,
  silencedBeforeReading,
  statesContainerKind,
  type IntakeDecisionInput,
} from '../src/index'

const keys = (known: Parameters<typeof evaluateCompleteness>[0]) =>
  evaluateCompleteness(known, DEFAULT_INTAKE_REQUIREMENTS).missing.map((r) => r.key)

describe('completeness against the default requirements', () => {
  it('asks for the lane, the cargo and the mode when nothing is known', () => {
    expect(keys({})).toEqual(['mode', 'origin', 'destination', 'commodity'])
  })

  it('does not ask for mode-specific facts before the mode is known', () => {
    expect(keys({ origin: 'Shanghai', destination: 'Shuwaikh', commodity: 'tiles' })).toEqual([
      'mode',
    ])
  })

  it('needs a container count and type for sea FCL', () => {
    const base = { mode: 'sea_fcl', origin: 'Shanghai', destination: 'Shuwaikh', commodity: 'x' }
    expect(keys(base)).toEqual(['containerCount', 'containerType'])
    expect(keys({ ...base, containerCount: '2' })).toEqual(['containerType'])
    expect(
      evaluateCompleteness(
        { ...base, containerCount: '2', containerType: '40HC' },
        DEFAULT_INTAKE_REQUIREMENTS,
      ).complete,
    ).toBe(true)
  })

  it('takes weight or volume, either one, for LCL and air', () => {
    const base = { origin: 'Dubai', destination: 'Kuwait', commodity: 'parts' }
    expect(keys({ ...base, mode: 'air' })).toEqual(['weightOrVolume'])
    expect(keys({ ...base, mode: 'air', volumeCbm: '1.2' })).toEqual([])
    expect(keys({ ...base, mode: 'sea_lcl', grossWeightKg: '800' })).toEqual([])
  })

  // The settings form saves only the choices it offers, so a default outside
  // that menu is dropped the first time anyone saves a branch (live run: KWI
  // lost the courier weight requirement).
  it('offers every default requirement on the settings form, with the same fields', () => {
    for (const requirement of DEFAULT_INTAKE_REQUIREMENTS) {
      expect(INTAKE_REQUIREMENT_CHOICES[requirement.mode ?? 'all']).toContain(requirement.key)
      expect(requirementChoiceFor(requirement)).toBe(requirement.key)
      expect(requirementChoiceFields(requirement.key)).toEqual([...requirement.fields])
    }
  })

  it('shows a row stored under the old courier key as its field choice', () => {
    expect(
      requirementChoiceFor({ key: 'weight', mode: 'courier', fields: ['grossWeightKg'] }),
    ).toBe('grossWeightKg')
    expect(requirementChoiceFor({ key: 'mystery', mode: 'courier', fields: ['origin'] })).toBe(null)
  })

  it('treats a blank value and an unknown mode as not stated', () => {
    expect(keys({ mode: 'sea', origin: '  ', destination: 'Kuwait', commodity: 'x' })).toEqual([
      'mode',
      'origin',
    ])
  })

  it('lists a key once even if an administrator scoped it to several modes', () => {
    const requirements = [
      { key: 'w', mode: null, fields: ['grossWeightKg'] as const },
      { key: 'w', mode: null, fields: ['grossWeightKg'] as const },
    ]
    expect(evaluateCompleteness({}, requirements).missing).toHaveLength(1)
  })

  it('is complete with no requirements configured at all', () => {
    expect(evaluateCompleteness({}, []).complete).toBe(true)
  })
})

describe('chit-chat', () => {
  it.each([
    'ok',
    'OK 👍',
    'thanks!',
    'Thank you so much',
    '👍',
    '🙏🙏',
    'salam',
    'Assalamu alaikum',
    'السلام عليكم',
    'شكراً',
    'تمام، شكرا جزيلا',
    'Hi',
    'good morning dear',
    '[WhatsApp sticker]',
    '[WhatsApp reaction message]',
    '',
  ])('%j says nothing an enquiry can use', (text) => {
    expect(isChitChat(text)).toBe(true)
  })

  it.each([
    'ok, 3 containers',
    'thanks — it is 2x40HC from Ningbo',
    'yes',
    'no',
    'Shanghai to Shuwaikh',
    'شكرا، الوزن 500 كيلو',
    'Hi, I need a rate for 2 pallets Dubai to Kuwait by air',
    // A caption-less picture or PDF is often the whole enquiry.
    '[WhatsApp image]',
    '[WhatsApp document: booking.pdf]',
  ])('%j carries content', (text) => {
    expect(isChitChat(text)).toBe(false)
  })

  it('never calls a long paragraph chit-chat', () => {
    expect(isChitChat('thanks '.repeat(40))).toBe(false)
  })
})

describe('auto-replies', () => {
  it.each([
    'I am currently out of the office until Sunday.',
    'Thank you for contacting Gulf Traders. We will get back to you as soon as possible.',
    'This is an automated message, please do not reply.',
    'شكراً لتواصلك معنا، سيتم الرد عليك في أقرب وقت',
    'رد آلي: نحن خارج أوقات العمل',
  ])('%j is a machine', (text) => {
    expect(looksAutoReply(text)).toBe(true)
  })

  it('does not mistake a customer for a machine', () => {
    expect(looksAutoReply('Thanks for the quick reply, the weight is 400 kg')).toBe(false)
  })
})

describe('what a turn’s new messages amount to', () => {
  it('is substantive if any message is', () => {
    expect(classifyNewContent(['hi', '2x40HC Shanghai', 'thanks'])).toBe('substantive')
  })
  it('is automatic over chit-chat', () => {
    expect(classifyNewContent(['ok', 'Out of office until Monday'])).toBe('automatic')
  })
  it('is chit-chat when everything is', () => {
    expect(classifyNewContent(['ok', '👍'])).toBe('chit_chat')
  })
  it('is nothing when there are no messages', () => {
    expect(classifyNewContent([])).toBe('none')
  })
})

/*
  The same verdict decides whether an inbound message opens an enquiry at all
  (`ingestMessage` reads the subject with the body). A customer's "Hello" on
  the live site opened one and was sent a reference for nothing.
*/
describe('a greeting opens no enquiry', () => {
  it.each([
    'hello',
    'Hello',
    'hello?',
    'hi',
    'Hi!',
    'salam',
    'السلام عليكم',
    'مرحبا',
    'مرحباً',
    'thanks',
    'شكرا',
    'ok',
    '👍',
    '🙏',
  ])('%j, as subject and body, is chit-chat', (text) => {
    expect(classifyNewContent([text, text])).toBe('chit_chat')
  })

  it.each([
    'please price two 40ft containers from Jebel Ali to Shuwaikh port, general cargo, ready 15 October',
    'ارجو تسعير حاويتين 40 قدم من جبل علي الى ميناء الشويخ، بضائع عامة، جاهزة 15 اكتوبر',
    'Hello, 2x40HC Shanghai to Shuwaikh',
  ])('%j is a request', (text) => {
    expect(classifyNewContent([text, text])).toBe('substantive')
  })

  it('reads an email subject with its body', () => {
    expect(classifyNewContent(['RFQ', 'Hi'])).toBe('substantive')
    expect(classifyNewContent(['', 'Hi'])).toBe('chit_chat')
  })
})

describe('language', () => {
  it('reads Arabic from Arabic script', () => {
    expect(detectLanguage(['السلام عليكم', 'عندي حاويتين ٤٠ قدم من شنغهاي', '40HC'])).toBe('ar')
  })
  it('reads English from Latin script, Arabizi included', () => {
    expect(detectLanguage(['salam', '2 containers from Ningbo please'])).toBe('en')
  })
  it('keeps the previous answer when the messages name no script', () => {
    expect(detectLanguage(['👍', '2'], 'ar')).toBe('ar')
    expect(detectLanguage(['👍'])).toBe('en')
  })
})

describe('the clarification list', () => {
  it('lists naturally in English', () => {
    expect(listNaturally(['a'], 'en')).toBe('a')
    expect(listNaturally(['a', 'b'], 'en')).toBe('a and b')
    expect(listNaturally(['a', 'b', 'c'], 'en')).toBe('a, b and c')
  })

  it('lists naturally in Arabic, with و attached', () => {
    expect(listNaturally(['أ', 'ب', 'ج'], 'ar')).toBe('أ، وب، وج')
  })

  it('names exactly the missing facts, alternatives joined by or', () => {
    const { missing } = evaluateCompleteness(
      { mode: 'air', destination: 'Kuwait', commodity: 'parts' },
      DEFAULT_INTAKE_REQUIREMENTS,
    )
    expect(missingPhrase(missing, 'en')).toBe(
      'where it ships from and the total weight or the volume in cubic metres',
    )
    expect(missingPhrase(missing, 'ar')).toBe(
      'مكان التحميل، والوزن الإجمالي أو الحجم بالمتر المكعب',
    )
  })
})

describe('the decision', () => {
  const now = new Date('2026-10-01T10:00:00Z')
  const incomplete = evaluateCompleteness({ origin: 'x' }, DEFAULT_INTAKE_REQUIREMENTS)
  const complete = evaluateCompleteness({}, [])
  const base: IntakeDecisionInput = {
    now,
    agentEnabled: true,
    enquiryOpen: true,
    newContent: 'substantive',
    completeness: incomplete,
    alreadyReady: false,
    handedOff: false,
    clarificationsSent: 0,
    lastClarifiedAt: null,
    humanActiveAt: null,
    senderGuard: null,
    settings: DEFAULT_INTAKE_SETTINGS,
  }
  const hoursAgo = (h: number) => new Date(now.getTime() - h * 3600_000)

  it('clarifies an incomplete enquiry once', () => {
    expect(decideIntakeReply(base)).toEqual({
      action: 'clarify',
      reason: 'clarified',
      markReady: false,
    })
  })

  it('waits out the cooldown before asking again', () => {
    const asked = { ...base, clarificationsSent: 1, lastClarifiedAt: hoursAgo(2) }
    expect(decideIntakeReply(asked).reason).toBe('cooldown')
    expect(decideIntakeReply({ ...asked, lastClarifiedAt: hoursAgo(7) }).action).toBe('clarify')
  })

  it('hands off at the cap instead of asking a third time', () => {
    const capped = { ...base, clarificationsSent: 2, lastClarifiedAt: hoursAgo(10) }
    expect(decideIntakeReply(capped)).toEqual({
      action: 'handoff',
      reason: 'cap_reached',
      markReady: false,
    })
    expect(decideIntakeReply({ ...capped, handedOff: true }).reason).toBe('handed_off')
  })

  it('hands off immediately with a cap of zero', () => {
    expect(
      decideIntakeReply({ ...base, settings: { ...DEFAULT_INTAKE_SETTINGS, clarifyCap: 0 } })
        .action,
    ).toBe('handoff')
  })

  it('confirms the first time it is complete, and marks it ready', () => {
    expect(decideIntakeReply({ ...base, completeness: complete })).toEqual({
      action: 'confirm',
      reason: 'confirmed',
      markReady: true,
    })
  })

  it('says nothing more once confirmed', () => {
    expect(decideIntakeReply({ ...base, completeness: complete, alreadyReady: true }).reason).toBe(
      'already_complete',
    )
  })

  it('stays silent while a person is talking to the customer, but still marks ready', () => {
    const human = { ...base, humanActiveAt: hoursAgo(1) }
    expect(decideIntakeReply(human)).toEqual({
      action: 'none',
      reason: 'human_active',
      markReady: false,
    })
    expect(decideIntakeReply({ ...human, completeness: complete })).toEqual({
      action: 'none',
      reason: 'human_active',
      markReady: true,
    })
    expect(decideIntakeReply({ ...base, humanActiveAt: hoursAgo(13) }).action).toBe('clarify')
  })

  it('never answers chit-chat, an auto-reply, or nothing', () => {
    expect(decideIntakeReply({ ...base, newContent: 'chit_chat' }).reason).toBe('chit_chat')
    expect(decideIntakeReply({ ...base, newContent: 'automatic' }).reason).toBe('automatic')
    expect(decideIntakeReply({ ...base, newContent: 'none' }).reason).toBe('no_new_content')
  })

  it('honours the operator switch and a closed enquiry before anything else', () => {
    expect(decideIntakeReply({ ...base, agentEnabled: false }).reason).toBe('agent_off')
    expect(decideIntakeReply({ ...base, enquiryOpen: false }).reason).toBe('closed')
  })

  it('lets a sender-level loop breaker silence the reply, not the ready flag', () => {
    expect(decideIntakeReply({ ...base, senderGuard: 'cap' }).reason).toBe('loop_guard')
    expect(decideIntakeReply({ ...base, completeness: complete, senderGuard: 'cap' })).toEqual({
      action: 'none',
      reason: 'loop_guard',
      markReady: true,
    })
  })
})

describe('silence known before the model is asked', () => {
  const now = new Date('2026-10-01T10:00:00Z')
  const incomplete = evaluateCompleteness({ origin: 'x' }, DEFAULT_INTAKE_REQUIREMENTS)
  const complete = evaluateCompleteness({}, [])
  const base: IntakeDecisionInput = {
    now,
    agentEnabled: true,
    enquiryOpen: true,
    newContent: 'substantive',
    completeness: incomplete,
    alreadyReady: false,
    handedOff: false,
    clarificationsSent: 0,
    lastClarifiedAt: null,
    humanActiveAt: null,
    senderGuard: null,
    settings: DEFAULT_INTAKE_SETTINGS,
  }
  const hoursAgo = (h: number) => new Date(now.getTime() - h * 3600_000)

  it('names an agent switched off, a loop breaker, a closed enquiry and chit-chat, so the turn skips its model call', () => {
    expect(silencedBeforeReading({ ...base, senderGuard: 'burst' })).toBe('loop_guard')
    expect(silencedBeforeReading({ ...base, agentEnabled: false })).toBe('agent_off')
    expect(silencedBeforeReading({ ...base, enquiryOpen: false })).toBe('closed')
    expect(silencedBeforeReading({ ...base, newContent: 'chit_chat' })).toBe('chit_chat')
    expect(silencedBeforeReading({ ...base, newContent: 'automatic' })).toBe('automatic')
  })

  it('still reads under a takeover, whose reply alone is silenced', () => {
    const human = { ...base, humanActiveAt: hoursAgo(1) }
    expect(silencedBeforeReading(human)).toBeNull()
    // The coordinator gets the proposals and a completing read still marks ready.
    expect(decideIntakeReply({ ...human, completeness: complete })).toEqual({
      action: 'none',
      reason: 'human_active',
      markReady: true,
    })
  })

  it('leaves the handoff, the cap and the cooldown to read, because a complete read confirms', () => {
    const capped = { ...base, clarificationsSent: 2, lastClarifiedAt: hoursAgo(1), handedOff: true }
    expect(silencedBeforeReading(capped)).toBeNull()
    expect(decideIntakeReply({ ...capped, completeness: complete }).action).toBe('confirm')
  })

  it('only ever names a turn the decision would silence, complete or not', () => {
    const variants: Partial<IntakeDecisionInput>[] = [
      {},
      { humanActiveAt: hoursAgo(1) },
      { senderGuard: 'cap' },
      { agentEnabled: false },
      { enquiryOpen: false },
      { newContent: 'automatic' },
      { newContent: 'none' },
    ]
    for (const v of variants) {
      const input = { ...base, ...v }
      if (silencedBeforeReading(input) === null) continue
      for (const completeness of [complete, incomplete]) {
        expect(decideIntakeReply({ ...input, completeness }).action).toBe('none')
      }
    }
  })
})

describe('the debounce', () => {
  const t0 = new Date('2026-10-01T10:00:00Z')
  const at = (s: number) => new Date(t0.getTime() + s * 1000)

  it('waits a quiet window after the latest message', () => {
    expect(turnDueAt(t0, at(30), 120, 600)).toEqual(at(150))
  })

  it('never waits past the maximum from the first message', () => {
    expect(turnDueAt(t0, at(550), 120, 600)).toEqual(at(600))
  })

  it('never schedules before the latest message', () => {
    expect(turnDueAt(t0, at(700), 120, 600)).toEqual(at(700))
  })
})

describe('settings', () => {
  it('clamps a stored row into bounds and fills the gaps', () => {
    const s = clampIntakeSettings({ whatsappQuietSeconds: 0, clarifyCap: 99, enabled: true })
    expect(s.whatsappQuietSeconds).toBe(15)
    expect(s.clarifyCap).toBe(5)
    expect(s.enabled).toBe(true)
    expect(s.humanTakeoverHours).toBe(DEFAULT_INTAKE_SETTINGS.humanTakeoverHours)
  })
})

describe('container types as people write them', () => {
  it.each([
    ['40HC', '40HC'],
    ["40' HC", '40HC'],
    ['40ft high cube', '40HC'],
    ['40 HQ', '40HC'],
    ['20 dry', '20GP'],
    ['20GP', '20GP'],
    ["20' reefer", '20RF'],
    ['٤٠ قدم عالية', '40HC'],
    ['حاوية 20 قدم عادي', '20GP'],
  ])('%j is %s', (raw, code) => {
    expect(containerTypeCode(raw)).toBe(code)
  })

  it.each(['40', 'container', 'two boxes', '40ft', '20', '20 pallets', '2026', '120HC'])(
    '%j is not guessed',
    (raw) => {
      expect(containerTypeCode(raw)).toBeNull()
    },
  )

  /*
    The demo enquiry's customer wrote "2 × 40'HC" and was still asked for the
    container type. These are the spellings a Gulf desk actually receives,
    including the ones where the size touches a letter ("2x40HC", "need
    40HC"), which a word-boundary match could not see.
  */
  it.each([
    ["40'HC", '40HC'],
    ['40’HC', '40HC'],
    ['40 HC', '40HC'],
    ['40HQ', '40HC'],
    ["40'HQ", '40HC'],
    ["40' high cube", '40HC'],
    ['40ft high-cube', '40HC'],
    ['40 hi-cube', '40HC'],
    ['40-HC', '40HC'],
    ['45HC', '45HC'],
    ["45' HC", '45HC'],
    ['20GP', '20GP'],
    ['20DV', '20GP'],
    ["20'", '20GP'],
    ['20ft', '20GP'],
    ['20 foot', '20GP'],
    ['٢٠ قدم', '20GP'],
    ['2x40HC', '40HC'],
    ['2 X 40HC', '40HC'],
    ['1 x 20GP', '20GP'],
    ['need 40HC', '40HC'],
    ['two 40HC', '40HC'],
    ['40HC x 2', '40HC'],
    ["2 × 40'HC of steel coils", '40HC'],
    ['20 pallets in a 40HC', '40HC'],
    ['40RF', '40RF'],
    ['20 open-top', '20OT'],
  ])('%j as written is %s', (raw, code) => {
    expect(containerTypeCode(raw)).toBe(code)
  })

  it('treats a twenty written as a size as naming its kind, and a forty not', () => {
    expect(statesContainerKind("1 x 20'")).toBe(true)
    expect(statesContainerKind('٢٠ قدم')).toBe(true)
    expect(statesContainerKind("2 × 40'HC of steel coils")).toBe(true)
    expect(statesContainerKind('40ft hi-cube')).toBe(true)
    expect(statesContainerKind("2 x 40'")).toBe(false)
    expect(statesContainerKind('120 ft of fencing')).toBe(false)
  })

  it('is proposed as a code, and dropped off a non-FCL enquiry', () => {
    const read = readExtractedEnquiry({
      fields: [
        { field: 'containerType', value: "40' high cube", confidence: 0.9, evidence: null },
        { field: 'containerType', value: '40', confidence: 0.9, evidence: null },
      ],
      confidence: 0.9,
    })
    expect(read.fields).toEqual([{ field: 'containerType', value: '40HC', confidence: 0.9 }])

    // Evidence that names only a size is a guessed kind, and is dropped.
    const guessed = readExtractedEnquiry({
      fields: [
        { field: 'containerType', value: '40GP', confidence: 0.8, evidence: 'حاويتين ٤٠ قدم' },
      ],
      confidence: 0.8,
    })
    expect(guessed.fields).toEqual([])
    const stated = readExtractedEnquiry({
      fields: [
        { field: 'containerType', value: '40HC', confidence: 0.8, evidence: '2 x 40ft high cube' },
      ],
      confidence: 0.8,
    })
    expect(stated.fields.map((f) => f.value)).toEqual(['40HC'])
    // The kind alone, with the size from an earlier message, still counts.
    expect(statesContainerKind('حاويات عادية مو هاي كيوب')).toBe(true)
    expect(statesContainerKind('2 x 40ft')).toBe(false)
    expect(withoutStrayContainerCount(read.fields, 'air')).toEqual([])
  })
})
