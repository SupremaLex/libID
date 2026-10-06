import { type BrowserContext, expect, type Page, test } from '@playwright/test'
import { authorizeOnGitHub, githubAccount } from './github.ts'
import { authorizeOnGoogle } from './google.ts'
import { isLive, liveSecret } from './live.ts'
import { presentAsPerson } from './person.ts'
import { googleSession, restoreSession, xSession } from './session.ts'
import { authorizeOnX, restoreXSession } from './x.ts'

/** Proving in the browser, after the platform returns the popup. */
const OUTCOME_TIMEOUT = 8 * 60_000

type Name = 'GitHub' | 'X' | 'Google'

const expected: Record<Name, { platform: string; userId: RegExp }> = {
  GitHub: { platform: 'github', userId: /^\d+$/ },
  X: { platform: 'x', userId: /^\d+$/ },
  // The token's `sub`, hashed: no Google account id reaches the page.
  Google: { platform: 'google', userId: /^0x[0-9a-f]{64}$/ },
}

/**
 * Start the platform's ceremony from its link, let `authorize` drive the popup
 * through the platform, then check what the page reports: the proved account,
 * its id's shape, the ceremony and a non-empty, unexpired proof.
 */
async function proveThroughTheUi(
  page: Page,
  context: BrowserContext,
  name: Name,
  expectedUser: string,
  authorize: (popup: Page) => Promise<void>,
) {
  await page.goto('/')
  await expect(page.getByTestId('status')).toHaveText('Choose a platform to prove.')
  const [popup] = await Promise.all([
    context.waitForEvent('page'),
    page.getByRole('link', { name: `Prove ${name}` }).click(),
  ])
  await authorize(popup)

  // The page reports one outcome when the run ends, its own message on failure.
  const outcome = page.getByTestId('outcome')
  await expect(outcome).not.toHaveText('—', { timeout: OUTCOME_TIMEOUT })
  await expect(outcome).toHaveText('proved')
  await expect(page.getByTestId('user-name')).toHaveText(expectedUser, { ignoreCase: true })
  await expect(page.getByTestId('user-id')).toHaveText(expected[name].userId)
  await expect(page.getByTestId('platform')).toHaveText(expected[name].platform)
  await expect(page.getByTestId('ceremony-version')).toHaveText(/^[1-9]\d*$/)
  await expect(page.getByTestId('attestations')).not.toHaveText('—')
  expect(Number(await page.getByTestId('proof-bytes').textContent())).toBeGreaterThan(0)
  expect(Number(await page.getByTestId('expires-at').textContent())).toBeGreaterThan(
    Date.now() / 1000,
  )
}

test('a GitHub identity is proved in the browser', async ({ page, context }) => {
  test.skip(!isLive('github'), 'GitHub is not in LIBID_LIVE_PLATFORMS')
  const account = githubAccount()
  test.skip(!account, 'GH_TEST_ALICE_USERNAME, _PASSWORD and _TOTP_SECRET are not set')
  await proveThroughTheUi(page, context, 'GitHub', account!.username, (popup) =>
    authorizeOnGitHub(popup, account!),
  )
})

test('an X identity is proved in the browser', async ({ page, context }) => {
  test.skip(!isLive('x'), 'X is not in LIBID_LIVE_PLATFORMS')
  const session = xSession()
  test.skip(!session, 'X_TEST_ALICE_COOKIES or X_TEST_ALICE_COOKIES_FILE is not set')
  const username = liveSecret('X_TEST_ALICE_USERNAME')
  test.skip(!username, 'X_TEST_ALICE_USERNAME is not set')
  await presentAsPerson(context)
  await restoreXSession(context, session!)
  await proveThroughTheUi(page, context, 'X', username!, (popup) => authorizeOnX(popup))
})

test('a Google identity is proved in the browser', async ({ page, context }) => {
  test.skip(!isLive('google'), 'Google is not in LIBID_LIVE_PLATFORMS')
  const session = googleSession()
  test.skip(!session, 'GOOGLE_TEST_ALICE_COOKIES or GOOGLE_TEST_ALICE_COOKIES_FILE is not set')
  const email = liveSecret('GOOGLE_TEST_ALICE_EMAIL')
  test.skip(!email, 'GOOGLE_TEST_ALICE_EMAIL is not set')
  await presentAsPerson(context)
  await restoreSession(context, session!)
  await proveThroughTheUi(page, context, 'Google', email!, (popup) =>
    authorizeOnGoogle(popup, email!),
  )
})
