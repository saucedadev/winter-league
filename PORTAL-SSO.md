# Signing in through the Hub Portal

Winter League can hand sign-in over to the Hub Portal: people sign in once at
the portal, tap the Winter League tile, and arrive here already signed in.

It is **off until you set two values**, so this version deploys and behaves
exactly like the last one until you switch it on.

## What happens

1. Tapping the tile in the portal sends the browser to `/sso` with a one-time
   pass in the address fragment (`#token=...`). Fragments never reach a
   server, so the pass stays out of logs.
2. `/sso` posts the pass to `POST /api/auth/sso`, which checks that it:
   - is signed with `PORTAL_SSO_SECRET`,
   - was made by the portal (`iss`) for Winter League (`aud`),
   - hasn't expired (passes last 60 seconds), and
   - hasn't been used before (its ID is kept in `sso_used_passes`).
3. The person's Winter League account is found **by email**:
   - **One account:** that's the one.
   - **Several accounts on the same email** (Winter League allows this): the
     one whose username matches their portal username wins, then the one with
     the role the portal gave them. If that still leaves more than one, the
     sign-in is refused with a message, rather than guessed, because accounts
     can belong to different programs.
   - **No account:** one is created on the spot, with a username from their
     portal username (or name). A program director or coach created this way
     has **no program yet**; a System Admin assigns it under **Users**, as now.
4. Their role is set to the one chosen in the portal, and the usual Winter
   League session starts. Everything else (programs, teams, schedules,
   referee work) is untouched.

Signed-out visitors (an old bookmark, an expired session) are sent to the
portal and come straight back to the page they wanted, usually without
seeing a sign-in screen. **Sign out** returns to the portal.

`/login?local=1` still shows Winter League's own sign-in form, as a way in for
an administrator if the portal is ever down.

## Switching it on

**1. In the portal,** Admin > Apps > Add an app (or edit Winter League if it's
already listed):

| Field | Value |
|---|---|
| Name | Winter League |
| ID | `winter-league` |
| App address | `https://pac-youth-conf.vercel.app` |
| Sign-in path | `/sso` |
| Wake-up address | `https://pac-youth-conf-api.onrender.com/api/health` |
| Roles (value: shown as) | `super_admin`: System Admin, `program_director`: Program Director, `league_coach`: Coach, `referee_assignor`: Referee Assignor, `referee`: Referee |

**2. Make a shared secret,** for example with `openssl rand -hex 32`, and set it in both places:

| Where | Variable |
|---|---|
| Portal API (Render) | `SSO_SECRET_WINTER_LEAGUE` |
| Winter League API (Render, `pac-youth-conf-api`) | `PORTAL_SSO_SECRET` |

**3. Point Winter League's frontend at the portal** (Vercel, then redeploy,
because Vite reads these at build time):

| Variable | Value |
|---|---|
| `VITE_PORTAL_URL` | the portal's address, e.g. `https://hub-portal.vercel.app` |
| `VITE_PORTAL_APP_SLUG` | `winter-league` |

The API needs no other change: the new `sso_used_passes` table is added
automatically on start, like every other database update.

**4. Give people access** in the portal (Admin > People), choosing their Winter
League role. Use the same email address as their Winter League account so
they are matched to it.

## Switching it off

Clear `VITE_PORTAL_URL` and redeploy the frontend. Winter League's own sign-in
screen is back immediately. Clearing `PORTAL_SSO_SECRET` also stops the API
accepting passes.

## If tapping the tile doesn't sign you in

Since v53, a failed hand-off stops on Winter League's "That didn't work" page
and says which check failed. (v52 had a bug here: a failed hand-off sent the
browser back to the portal, which sent it straight back, round and round, until
Winter League's sign-in limit refused it with `429 Too Many Requests`.)

| The page says | Fix |
|---|---|
| …don't share the same secret… | `PORTAL_SSO_SECRET` on Winter League's API and `SSO_SECRET_WINTER_LEAGUE` on the portal's API must be the identical value. Check for a stray space or quotes, then let both services redeploy. |
| …made for a different app… | The app's ID in the portal (Admin > Apps) must be `winter-league`, or `PORTAL_APP_SLUG` must be set to whatever ID you used. The ID can't be changed once an app exists, so if it's wrong, add the app again with the right ID. |
| …the role "…", which Winter League doesn't have… | In Admin > Apps, the role **values** must be exactly `super_admin`, `program_director`, `league_coach`, `referee_assignor`, `referee`. The friendly names go in "Shown as". |
| …has expired… | The pass lasts a minute. If Winter League's API was asleep and slow to wake, tap the tile again. |
| …isn't set up for this app yet | `PORTAL_SSO_SECRET` isn't set on Winter League's API. |

If a browser was sent back and forth three times within two minutes without
signing in, Winter League stops trying and shows its own sign-in form with a
note, so nobody is left stuck in a loop.

**After a `429`:** the limit (30 sign-in attempts per 15 minutes from one
address) clears by itself after 15 minutes, or at once when Winter League's
API restarts (for example on its next deploy).

## Local development

The portal runs on 5180 (web) and 4200 (API), so it fits alongside Winter
League's 5174 / 4100.

- `backend/.env`: `PORTAL_SSO_SECRET=dev-secret-winter-league` (the portal's
  `.env.example` uses the same value)
- `frontend/.env`: `VITE_PORTAL_URL=http://localhost:5180`
