import { exportJWK, generateKeyPair, SignJWT, type FetchImplementation } from 'jose'
import { readConfig } from '../src/config'

export const OIDC_TEST_ISSUER = 'https://identity.example.invalid'
export const OIDC_TEST_AUDIENCE = 'derby-career-api'
export function oidcConfig(env: NodeJS.ProcessEnv = {}) {
  return readConfig({
    DATABASE_URL: 'postgresql://test/test',
    AUTH_MODE: 'oidc-jwt',
    NODE_ENV: 'production',
    HOST: '0.0.0.0',
    LOG_LEVEL: 'silent',
    OIDC_ISSUER: OIDC_TEST_ISSUER,
    OIDC_AUDIENCE: OIDC_TEST_AUDIENCE,
    OIDC_JWKS_URL: OIDC_TEST_ISSUER + '/.well-known/jwks.json',
    EVENT_DIRECTOR_CONFIG: JSON.stringify({
      version: 'event-director-v1',
      monthlyProbability: 0,
      pityAfterMisses: 3,
      monthStartShare: 1,
    }),
    ...env,
  })
}
export async function testIssuer(algorithm: 'ES256' | 'RS256' = 'ES256') {
  const primary = await generateKeyPair(algorithm)
  const secondary = await generateKeyPair(algorithm)
  const firstKey = {
    ...(await exportJWK(primary.publicKey)),
    kid: 'primary',
    alg: algorithm,
    use: 'sig',
  }
  const secondKey = {
    ...(await exportJWK(secondary.publicKey)),
    kid: 'secondary',
    alg: algorithm,
    use: 'sig',
  }
  const jwks = { keys: [firstKey] }
  const requests: { url: string; redirect: string }[] = []
  const fetcher: FetchImplementation = async (url, options) => {
    requests.push({ url, redirect: options.redirect })
    return Response.json(jwks)
  }
  const sign = (
    subject = 'user-one',
    claims: Record<string, unknown> = {},
    header: Record<string, unknown> = {},
    useSecondary = false,
  ) => {
    const now = Math.floor(Date.now() / 1000)
    return new SignJWT({
      iss: OIDC_TEST_ISSUER,
      aud: OIDC_TEST_AUDIENCE,
      sub: subject,
      iat: now,
      exp: now + 600,
      ...claims,
    })
      .setProtectedHeader({
        alg: algorithm,
        typ: 'at+jwt',
        kid: useSecondary ? 'secondary' : 'primary',
        ...header,
      })
      .sign(useSecondary ? secondary.privateKey : primary.privateKey)
  }
  return { jwks, secondKey, requests, fetcher, sign }
}
