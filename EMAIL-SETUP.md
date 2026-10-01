# Email setup (Brevo)

The Winter League app sends email for password resets, forgotten usernames, schedule change requests, draft reviews, added games, referee assignments and scores. Until you finish this guide, the app runs with `EMAIL_PROVIDER=console`, so those emails are only written to the Render log and nobody receives them.

This guide connects the app to **Brevo** (SMTP). It takes about 20 minutes of clicking, plus up to 48 hours for DNS to take effect.

**Before you start, you need:**

- A Brevo account. The free plan sends about **300 emails a day**, which is plenty for the league.
- **A domain you own** (for example `winterleague.org`) and access to its DNS settings, at the registrar or host where you bought it. This matters most: Gmail, Yahoo and Outlook reject or spam-folder mail "from" a free address such as `@gmail.com` sent through a service like Brevo. The sender must be an address on your own domain.
- Access to the API service on Render (Environment tab).

---

## Step 1: Sign in to Brevo

1. Go to <https://www.brevo.com> and sign in, or create a free account.
2. If you already use Brevo for Gym Hive, **reuse that account**. One account can send for several apps. You'll give the Winter League its own sender name and address in Step 3.

## Step 2: Authenticate your domain

This step proves to Gmail and Microsoft that Brevo may send mail for your domain. Without it, mail lands in spam or is rejected.

1. In Brevo, open the account menu (your name, top right) → **Settings** → **Senders, Domains, IPs** → **Domains** tab.
2. Click **Add a domain**, type your domain (e.g. `winterleague.org`), and continue.
3. Choose how to add the DNS records:
   - **Automatic:** if your DNS host is listed (e.g. GoDaddy, Cloudflare), sign in to it from Brevo and it adds the records for you.
   - **Manual:** Brevo shows three or four records. In another tab, open your DNS host's DNS page and add each one exactly as shown:

     | Record | Type | What it does |
     |---|---|---|
     | Brevo code | TXT | Proves you own the domain |
     | DKIM | CNAME (or TXT) | Signs each email so it can't be forged |
     | DMARC | TXT (name `_dmarc`) | Tells inboxes what to do with unsigned mail. Required by Gmail, Yahoo and Microsoft. |

     Copy the values with Brevo's copy buttons. A missing character breaks the record. If your domain already has a DMARC record, keep it; don't add a second one.
4. Back in Brevo, click **Authenticate this email domain**.
5. The domain shows **Authenticated** when the records are found. It's often minutes, but can take up to **48 hours**. Continue with Step 3 meanwhile; just don't switch the app to Brevo (Step 5) until the domain shows Authenticated.

## Step 3: Add the sender

1. **Settings** → **Senders, Domains, IPs** → **Senders** tab → **Add a sender**.
2. **From name:** `Winter League` (or the league's name). This name only shows inside Brevo: the app sends every email under the **app name from Branding & Theme**, so renaming the app renames the sender too.
3. **From email:** `no-reply@<your domain>`, e.g. `no-reply@winterleague.org`. The mailbox doesn't need to exist, since the emails say replies aren't read.
4. Save. Because the domain is authenticated, the sender is verified automatically. If Brevo asks you to confirm by email instead, the domain isn't authenticated yet (back to Step 2).

## Step 4: Create an SMTP key

1. **Settings** → **SMTP & API** → **SMTP** tab.
2. You may see a notice that *"Unauthorized IP addresses are not blocked for your SMTP keys"* with an **Activate** button. **Leave it off.** Render doesn't send from a fixed IP address, so turning on blocking would stop the app's emails or set off security alerts. It's optional; Brevo doesn't require it.
3. Click **Generate a new SMTP key** (top right). Brevo may ask for a verification code sent to your email.
4. Name it `Winter League (Render)`, choose **Standard**, and pick an expiry (or none).
5. **Copy the key now.** Brevo shows it only once. If you lose it, generate a new one and delete the old one.
6. Find the **SMTP login**. Once a key exists, the SMTP tab lists the connection details: **SMTP server** `smtp-relay.brevo.com`, **Port** `587` (the app already uses both), and **Login**, an address such as `8a1b2c001@smtp-brevo.com`. On some (usually older) accounts the login is the email you sign in to Brevo with. Copy whatever the page shows as the login; you need it in Step 5.

   Can't see a login after creating the key? Refresh the page. Still nothing: the login is shown in Brevo's SMTP connection details. Search Brevo's help for "SMTP login" or ask Brevo support, since the app can't send without it.

> **Keep it working:** Brevo turns off an SMTP key after **90 days without a successful send**. In the off-season, if emails stop after a long quiet spell, generate a new key and update `BREVO_SMTP_PASS` (Step 5).

## Step 5: Put the settings on Render

1. In Render, open the **API** service (the backend, not the frontend) → **Environment**.
2. Set these four variables:

   | Key | Value |
   |---|---|
   | `EMAIL_PROVIDER` | `brevo` |
   | `EMAIL_FROM` | `Winter League <no-reply@winterleague.org>`. The address must be exactly the sender from Step 3. The name in front is only a fallback: emails go out under the app name from Branding. |
   | `BREVO_SMTP_USER` | the **Login** from Step 4 (e.g. `8a1b2c001@smtp-brevo.com`) |
   | `BREVO_SMTP_PASS` | the **SMTP key** from Step 4 |
   | `BLOB_READ_WRITE_TOKEN` | optional, for your logo in emails; see Step 6 |
   | `BREVO_SMTP_PORT` | optional; leave it out. The app uses port **2525**, because Render's free plan blocks the usual email ports (25, 465 and 587). Set `587` only if you move to a paid plan and want the standard port. |

3. Click **Save, rebuild, and deploy** (or Save, then **Manual Deploy** → **Deploy latest commit**). The variables take effect after the restart.
4. Check that `APP_URL` lists your real site first. Links in emails (e.g. "Reset your password") are built from it.

> Don't paste the SMTP key anywhere else (chat, email, a file in the repo). If it leaks, delete it in Brevo and create a new one.

## Step 6: Let emails show your logo (Vercel Blob)

Skip this if you use the built-in hexagon mark; it already shows in every email.

Brevo doesn't deliver images attached inside an email, so emails load your uploaded logo from a web address. Vercel Blob gives it one that's always on. (Without it, the app's own server on Render serves the logo, but Render's free plan puts the server to sleep, so an email opened while it's asleep may show an empty box instead of the logo.)

1. In Vercel, open the **Storage** tab (on your team, or on the frontend project) → **Create** → **Blob**.
2. Name it `winter-league-email` and pick a region near you.
3. Choose **Public** access. This matters: email apps load the logo without signing in, and Vercel doesn't let you change it later. The store only ever holds the logo.
4. Create it, and connect it to your frontend project if Vercel offers to.
5. Copy the store's **`BLOB_READ_WRITE_TOKEN`**. Vercel adds it to the connected project's **Settings → Environment Variables**, where you can reveal and copy it. The store's own page also shows it.
6. In Render, on the **API** service → **Environment**, add `BLOB_READ_WRITE_TOKEN` with that value, and save and redeploy.

The app uploads the logo the next time an email goes out or you save Branding & Theme. A new logo gets a new file, so inboxes never show an old one. Keep the token private, like the SMTP key.

## Step 7: Send a test

The quickest check: sign in as a System Admin, open **Menu → League admin → Branding & Theme**, scroll to **Emails**, and click **Send me a test email**. It sends a sample to the email address on your own account.

- *"Sent to …"*: check your inbox (and spam) for it. Below it, **Logo in this email** says where the logo loads from (Vercel Blob, the Render server, or the app's website) and whether it actually loads. If the Vercel Blob upload failed, it shows Vercel's exact error.
- *"Email is in console mode…"*: `EMAIL_PROVIDER` isn't `brevo` yet, or the service wasn't redeployed (Step 5).
- *"The email couldn't be sent: …"*: the reason is from Brevo; see Troubleshooting below.

Then try a real one:

1. Open the app in a private/incognito window → **Forgot password?** → enter the username of an account that has **your** email address.
2. The email should arrive within a minute. Check that:
   - it's from **Winter League &lt;no-reply@…&gt;** (your app name), not a `brevosend.com` address;
   - it's in the inbox, not spam;
   - the reset link opens your app.
3. In Brevo, **Transactional** → **Logs** (or **Statistics**) shows every email the app sent: Delivered, Opened, Bounced or Blocked.
4. Try **Forgot username** the same way.

## What the emails look like

Every email has the **app name and logo** across the top in the **theme's color**, the message with any details in a box, a button to the right page of the app, and a footer saying the inbox isn't monitored and who to contact instead (coaches: their program director; referees: the assignor; directors and the assignor: the league administrator). All of it comes from **Branding & Theme**, where the **Emails** section shows a live sample. Each email also includes a plain-text version for email apps that don't show designs.

Logos: email apps don't show SVG, so the server makes a small PNG copy of the logo for emails when you click **Save branding** (or, for a logo saved earlier, with the next email), and emails load it from Vercel Blob (Step 6). The built-in mark is served by the app's website, which is always on.

## The demo environment

The demo loads everyone with placeholder emails (`@example.com`), so password resets and notifications triggered on the demo are "sent" to addresses nobody reads, and they bounce. Repeated bounces can hurt your sender reputation with Brevo, so it's safest to leave the **demo** API on `EMAIL_PROVIDER=console`.

If the demo does need to send (to show an email live), put your own address on your admin account (Users) and use **Send me a test email** on Branding & Theme, or edit one test account to your own address and trigger emails only for it.

## Troubleshooting

| What you see | Likely cause | Fix |
|---|---|---|
| Test email says the server *couldn't reach Brevo*, or the Render log shows `Connection timeout` | The port is blocked (Render's free plan blocks 25, 465 and 587) | Remove `BREVO_SMTP_PORT` or set it to `2525`, and redeploy |
| No email; Render log shows `📧 [email:console]` | `EMAIL_PROVIDER` is still `console`, or the service wasn't redeployed | Set it to `brevo` and redeploy |
| Render log shows `Invalid login` / `535 Authentication failed` | Wrong `BREVO_SMTP_USER` or key; key expired or deactivated | Use the **Login** exactly as the SMTP tab shows it; generate a new key |
| Email arrives from `…@brevosend.com` | The domain isn't authenticated | Finish Step 2 and wait for **Authenticated** |
| Email goes to spam, or Outlook/Hotmail rejects it | DMARC or DKIM record missing or mistyped | Re-check the records in Step 2; Brevo shows which one fails |
| `Sender not valid` error | The address in `EMAIL_FROM` doesn't match a sender in Step 3 | Make the address in `EMAIL_FROM` match exactly |
| Empty box where the logo should be | Vercel Blob isn't set up, so the logo comes from the sleeping Render server; or the email app blocks images | Set up Step 6; click "show images" in the email app. If the Render log says *could not upload the email logo to Vercel Blob*, check the token and that the store is **Public** |
| The hexagon shows instead of your logo | The logo couldn't be converted, or has no web address yet | Send another email after Step 6; if the Branding page's sample shows the hexagon too, re-export the logo as a PNG and upload that |
| Some emails missing on a busy day | Free plan daily limit (about 300) | Check Brevo's usage; upgrade if the league regularly exceeds it |
| Reset link points to the wrong site | `APP_URL` first entry | Put the main site first in `APP_URL` |

## Help articles

- [Create and manage your SMTP keys](https://help.brevo.com/hc/en-us/articles/7959631848850-Create-and-manage-your-SMTP-keys)
- [Authenticate your domain with Brevo (Brevo code, DKIM, DMARC)](https://help.brevo.com/hc/en-us/articles/12163873383186-Authenticate-your-domain-with-Brevo-Brevo-code-DKIM-DMARC)
- [Comply with Gmail, Yahoo and Microsoft's requirements for email senders](https://help.brevo.com/hc/en-us/articles/14925263522578-Comply-with-Gmail-Yahoo-and-Microsoft-s-requirements-for-email-senders)
- [Create a new sender](https://help.brevo.com/hc/en-us/articles/208836149-Create-a-new-sender-From-name-and-From-email)
- [Vercel Blob](https://vercel.com/docs/vercel-blob)
- [Brevo: embedded images aren't supported for transactional email](https://community.brevo.com/t/does-transactional-email-support-embedded-image/6665)
- [Brevo: which SMTP port to use](https://help.brevo.com/hc/en-us/articles/10905415650322)
