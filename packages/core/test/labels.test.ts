/**
 * Labels beside codes in the assistant's tool results.
 *
 * A live Arabic answer showed `in_transit` in a table under Arabic headings:
 * the tools returned codes and nothing else to show. These pin the labelling
 * itself, and that every code the database can store has a word in both
 * languages. The words matching the web catalogue is checked on the web side,
 * where the catalogue is.
 */

import { describe, expect, it } from 'vitest'
import { ASSISTANT_TOOLS } from '../src/assistant'
import { MODES } from '../src/extraction'
import { LABELS, labelFor, withLabels, type LabelVocabulary } from '../src/labels'
import {
  customsMachine,
  enquiryMachine,
  invoiceMachine,
  jobMachine,
  quoteMachine,
} from '../src/states'

describe('withLabels', () => {
  it('puts the label beside the code, in the language asked for', () => {
    const result = {
      total: 1,
      rows: [{ reference: 'KWI-JOB-0001', status: 'in_transit', mode: 'sea_fcl' }],
    }
    const spec = { 'rows.status': 'jobStatus', 'rows.mode': 'mode' } as const

    expect(withLabels(result, spec, 'ar')).toEqual({
      total: 1,
      rows: [
        {
          reference: 'KWI-JOB-0001',
          status: 'in_transit',
          statusLabel: 'قيد النقل',
          mode: 'sea_fcl',
          modeLabel: 'بحري حاوية كاملة',
        },
      ],
    })
    expect(withLabels(result, spec, 'en')).toMatchObject({
      rows: [{ statusLabel: 'In transit', modeLabel: 'Sea FCL' }],
    })
  })

  it('labels by path, so the same key in another place is left alone', () => {
    const result = { shipment: { status: 'arrived' }, customs: [{ status: 'held' }] }
    const labelled = withLabels(
      result,
      { 'shipment.status': 'jobStatus', 'customs.status': 'customsStatus' },
      'en',
    ) as { shipment: { statusLabel: string }; customs: { statusLabel: string }[] }
    expect(labelled.shipment.statusLabel).toBe('Arrived')
    expect(labelled.customs[0]!.statusLabel).toBe('Held')
  })

  it('gives no label for a code it does not hold, rather than a guessed one', () => {
    expect(withLabels({ status: 'teleported' }, { status: 'jobStatus' }, 'en')).toEqual({
      status: 'teleported',
    })
  })

  it('leaves dates and nulls as they are', () => {
    const when = new Date('2026-10-02T00:00:00Z')
    expect(withLabels({ eta: when, status: null }, { status: 'jobStatus' }, 'en')).toEqual({
      eta: when,
      status: null,
    })
  })
})

describe('the vocabularies', () => {
  const stored: Record<string, readonly string[]> = {
    jobStatus: jobMachine.states,
    enquiryStatus: enquiryMachine.states,
    quoteStatus: quoteMachine.states,
    invoiceStatus: invoiceMachine.states,
    customsStatus: customsMachine.states,
    mode: MODES,
    direction: ['import', 'export', 'cross_trade'],
    severity: ['low', 'medium', 'high', 'critical'],
    clockKind: ['demurrage', 'detention', 'storage'],
  }

  it('has a word in both languages for every code the database stores', () => {
    for (const [vocabulary, codes] of Object.entries(stored)) {
      for (const code of codes) {
        const v = vocabulary as LabelVocabulary
        expect(labelFor(v, code, 'en'), `${vocabulary}.${code} en`).toBeTruthy()
        expect(labelFor(v, code, 'ar'), `${vocabulary}.${code} ar`).toBeTruthy()
      }
    }
  })

  it('is named by every tool spec that uses it', () => {
    for (const tool of ASSISTANT_TOOLS) {
      for (const vocabulary of Object.values(tool.labels ?? {})) {
        expect(LABELS[vocabulary], `${tool.name} names ${vocabulary}`).toBeDefined()
      }
    }
    // The tools whose results carry statuses, modes or directions all label them.
    const labelled = ASSISTANT_TOOLS.filter((tool) => tool.labels).map((tool) => tool.name)
    expect(labelled).toEqual(
      expect.arrayContaining(['search', 'get_job', 'list_jobs', 'list_enquiries', 'get_invoice']),
    )
  })
})
