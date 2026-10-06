// The local stack's ports, for the stack, the app and the tests.
// compose.yaml and bridge-config.toml repeat what they need.

/** The app, served by Vite; Bridge admits this origin. */
export const APP_ORIGIN = 'http://localhost:4695'
export const APP_PORT = 4695
export const BRIDGE = 'http://localhost:4682'
export const NOTARY = 'http://localhost:4687'

export type Platform = 'github' | 'x' | 'google'

/** The platforms a live run proves: LIBID_LIVE_PLATFORMS, comma-separated, or all three. */
export function livePlatforms(env: Record<string, string | undefined>): Platform[] {
  const listed = env.LIBID_LIVE_PLATFORMS?.split(',').map((name) => name.trim())
  return (listed ?? ['github', 'x', 'google']) as Platform[]
}
