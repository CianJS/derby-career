import test from 'node:test'
import assert from 'node:assert/strict'
import {
  convertJpyRaceAmount,
  type RaceCurrencyPolicy,
} from '../packages/shared/src/race-currency-policy'

// Synthetic rates for arithmetic tests only; these are not the game's approved policy.
const fixture: RaceCurrencyPolicy = {
  version: 'test-policy-v1',
  sourceCurrency: 'JPY',
  destinationCurrency: 'KRW',
  krwPerJpy: { numerator: 10, denominator: 1 },
  scale: { numerator: 1, denominator: 2 },
  rounding: 'floor',
}

test('race currency requires an explicit policy and applies both ratios exactly once', () => {
  assert.equal(convertJpyRaceAmount(50000, null), null)
  assert.equal(convertJpyRaceAmount(50000, undefined), null)
  assert.deepEqual(convertJpyRaceAmount(50000, fixture), {
    policyVersion: 'test-policy-v1',
    amountKRW: 250000,
  })
  assert.equal(convertJpyRaceAmount(34000000, fixture)?.amountKRW, 170000000)
  assert.equal(convertJpyRaceAmount(0, fixture)?.amountKRW, 0)
})

test('race currency rounds only the final rational result using the specified rule', () => {
  const policy = {
    ...fixture,
    krwPerJpy: { numerator: 5, denominator: 3 },
    scale: { numerator: 1, denominator: 2 },
  }
  assert.equal(convertJpyRaceAmount(1, { ...policy, rounding: 'floor' })?.amountKRW, 0)
  assert.equal(convertJpyRaceAmount(1, { ...policy, rounding: 'ceil' })?.amountKRW, 1)
  assert.equal(convertJpyRaceAmount(1, { ...policy, rounding: 'half_up' })?.amountKRW, 1)
  const tie = {
    ...fixture,
    krwPerJpy: { numerator: 1, denominator: 1 },
    scale: { numerator: 1, denominator: 2 },
  }
  assert.equal(convertJpyRaceAmount(1, { ...tie, rounding: 'half_up' })?.amountKRW, 1)
  assert.equal(convertJpyRaceAmount(2, { ...tie, rounding: 'ceil' })?.amountKRW, 1)
})

test('race currency rejects malformed policies, unsafe values and overflow', () => {
  for (const amount of [-1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, '50000']) {
    assert.throws(() => convertJpyRaceAmount(amount, fixture), /JPY amount/)
  }
  for (const policy of [
    {},
    { ...fixture, version: '' },
    { ...fixture, sourceCurrency: 'USD' },
    { ...fixture, destinationCurrency: 'JPY' },
    { ...fixture, krwPerJpy: { numerator: 1, denominator: 0 } },
    { ...fixture, scale: { numerator: 0, denominator: 1 } },
    { ...fixture, scale: { numerator: 2, denominator: 1 } },
    { ...fixture, rounding: 'nearest' },
  ]) {
    assert.throws(() => convertJpyRaceAmount(50000, policy), /currency policy/)
  }
  assert.throws(() => convertJpyRaceAmount(Number.MAX_SAFE_INTEGER, fixture), /safe integer range/)
  const largeIntermediate = {
    ...fixture,
    krwPerJpy: { numerator: Number.MAX_SAFE_INTEGER, denominator: Number.MAX_SAFE_INTEGER },
    scale: { numerator: 1, denominator: 1 },
  }
  assert.equal(
    convertJpyRaceAmount(Number.MAX_SAFE_INTEGER, largeIntermediate)?.amountKRW,
    Number.MAX_SAFE_INTEGER,
  )
})
