/**
 * Form labels, resolved on the server.
 *
 * The form is a client component, and `next-intl`'s server translator cannot
 * cross that boundary — so the strings are resolved here and passed as props.
 * One function rather than two call sites so the create and edit pages cannot
 * drift apart.
 */

import { getTranslations } from 'next-intl/server'
import type { CustomerFormLabels } from './customer-form'

export async function customerFormLabels(): Promise<CustomerFormLabels> {
  const t = await getTranslations('customers')
  const tc = await getTranslations('common')

  return {
    identity: t('identity'),
    code: t('code'),
    codeHint: t('codeHint'),
    legalNameEn: t('legalNameEn'),
    legalNameAr: t('legalNameAr'),
    registration: t('registration'),
    taxRegistration: t('taxRegistration'),
    country: t('country'),
    branch: t('branch'),
    isActive: t('isActiveLabel'),
    terms: t('terms'),
    termsHint: t('termsHint'),
    paymentTermsDays: t('paymentTermsDays'),
    creditLimit: t('creditLimit'),
    creditCurrency: t('creditCurrency'),
    freeTimeDays: t('freeTimeDays'),
    defaultIncoterm: t('defaultIncoterm'),
    marginKind: t('marginKind'),
    marginValue: t('marginValue'),
    marginHint: t('marginHint'),
    marginKinds: {
      percent: t('marginKinds.percent'),
      absolute: t('marginKinds.absolute'),
      target_sell: t('marginKinds.target_sell'),
    },
    submit: t('save'),
    submitting: tc('saving'),
    saved: tc('saved'),
    choose: tc('choose'),
  }
}
