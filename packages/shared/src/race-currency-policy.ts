/** An explicitly selected fixed policy, not a live exchange-rate quote. */
export type RaceCurrencyPolicy = Readonly<{
  version: string
  sourceCurrency: 'JPY'
  destinationCurrency: 'KRW'
  krwPerJpy: Readonly<{ numerator: number; denominator: number }>
  scale: Readonly<{ numerator: number; denominator: number }>
  rounding: 'floor' | 'ceil' | 'half_up'
}>

export type ConvertedRaceAmount = Readonly<{ policyVersion: string; amountKRW: number }>

function integer(value: unknown, minimum: number): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= minimum
}

function ratio(value: unknown): value is { numerator: number; denominator: number } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false
  }
  const record = value as Record<string, unknown>
  return integer(record.numerator, 1) && integer(record.denominator, 1)
}

/**
 * Returns null when no policy has been selected. It never obtains an exchange rate or
 * supplies a default; callers must persist the selected policy/version with the result.
 * Multiplication is exact and rounding happens once, after both rational factors.
 */
export function convertJpyRaceAmount(
  amountJPY: unknown,
  policy: unknown,
): ConvertedRaceAmount | null {
  if (!integer(amountJPY, 0)) {
    throw new Error('Invalid non-negative JPY amount')
  }
  if (policy === null || policy === undefined) {
    return null
  }
  if (!policy || typeof policy !== 'object' || Array.isArray(policy)) {
    throw new Error('Invalid race currency policy')
  }
  const candidate = policy as Record<string, unknown>
  if (
    typeof candidate.version !== 'string' ||
    !/^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/.test(candidate.version) ||
    candidate.sourceCurrency !== 'JPY' ||
    candidate.destinationCurrency !== 'KRW' ||
    !ratio(candidate.krwPerJpy) ||
    !ratio(candidate.scale) ||
    candidate.scale.numerator > candidate.scale.denominator ||
    (candidate.rounding !== 'floor' &&
      candidate.rounding !== 'ceil' &&
      candidate.rounding !== 'half_up')
  ) {
    throw new Error('Invalid or incomplete race currency policy')
  }
  const numerator =
    BigInt(amountJPY) * BigInt(candidate.krwPerJpy.numerator) * BigInt(candidate.scale.numerator)
  const denominator = BigInt(candidate.krwPerJpy.denominator) * BigInt(candidate.scale.denominator)
  let rounded = numerator / denominator
  const remainder = numerator % denominator
  if (
    (candidate.rounding === 'ceil' && remainder > BigInt(0)) ||
    (candidate.rounding === 'half_up' && remainder * BigInt(2) >= denominator)
  ) {
    rounded += BigInt(1)
  }
  if (rounded > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error('Converted race amount exceeds the safe integer range')
  }
  return Object.freeze({ policyVersion: candidate.version, amountKRW: Number(rounded) })
}
