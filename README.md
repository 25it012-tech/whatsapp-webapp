# Common — independent chat & calling MVP

A mobile-friendly Next.js app for your own conversations. This is not affiliated with WhatsApp or Meta and does not use their APIs.

**Status:** source implementation only. Dependencies have not been installed, and lint, tests, production build, database policies, and live calls have not been executed in the authoring environment. No deployment has been created. Do not treat this as production-ready.

## Implemented scope

| Capability | Implementation |
| --- | --- |
| Accounts | Supabase email/password signup and login; unique usernames |
| Contacts | Exact username or account UUID lookup |
| Messages | One-to-one stored text, Realtime subscriptions, polling fallback |
| Voice calls | Browser WebRTC; explicit accept/decline and mic mute |
| Video calls | Camera preview, remote stream, camera toggle |
| Call lifecycle | Timeout, busy decline, hangup, media cleanup |
| UI | Responsive conversation layout and keyboard message submission |
| Access control | Participant-only message and call-signal reads using RLS |

## Local setup

Requires Node.js 22 or later, npm, a new Supabase project, and two accounts for testing.

```bash
git clone https://github.com/25it012-tech/whatsapp-webapp.git
cd whatsapp-webapp
git switch feature/chat-and-calls
npm install
cp .env.example .env.local
```

On Windows PowerShell, use `Copy-Item .env.example .env.local` instead of `cp`.

In a **new** Supabase project, open SQL Editor and execute `supabase/schema.sql` once, **before registering users**. It creates profiles, messages, call signals, indexes, policies, an auth trigger, and Realtime publication entries. It is intentionally not a repeatable migration; inspect existing schemas before applying it elsewhere. Existing auth users require a separately reviewed profile backfill.

In `.env.local`, set `NEXT_PUBLIC_SUPABASE_URL` to your project URL and `NEXT_PUBLIC_SUPABASE_ANON_KEY` to the public anon/publishable key. Never use `service_role`. Public configuration is compiled into the browser bundle, so rebuild after changing it.

Enable email/password authentication. Set the Supabase Auth Site URL and allowed redirects for localhost and your eventual HTTPS deployment. Keep email confirmation enabled; configure email delivery for production. Use at least eight-character passwords. A duplicate/invalid username can cause the signup profile trigger to reject registration.

```bash
npm run dev
```

Open `http://localhost:3000`. Register two accounts in separate browsers/browser profiles, confirm both emails, then find the other username and send a message. Use distinct browser profiles rather than tabs sharing the same login storage.

## Calling and TURN

Both people must be signed in with the app open. Start a voice/video call from a conversation; the other person explicitly accepts. Camera and microphone permission is requested only after Start/Accept. HTTPS is required except on localhost. A LAN HTTP address is not a substitute for HTTPS on a phone.

The default configuration uses Google's public STUN server. **STUN alone does not provide reliable cross-network calls.** Configure a TURN service before relying on calls outside a local test environment.

`NEXT_PUBLIC_TURN_CREDENTIALS_ENDPOINT` is an optional endpoint that **you must supply**; this repository does not implement a TURN credential server. It receives the user's Supabase bearer token and must validate that token server-side, apply rate limits, and return short-lived RTCIceServer credentials:

```json
{
  "iceServers": [
    {
      "urls": "turn:YOUR_TURN_HOST:3478",
      "username": "SHORT_LIVED_USERNAME",
      "credential": "SHORT_LIVED_CREDENTIAL"
    }
  ]
}
```

Use a trusted same-origin endpoint where possible; a cross-origin endpoint needs explicit CORS permission for your app and its Authorization header. Never send tokens to an untrusted endpoint. Never expose your TURN provider master secret in public environment variables. Production TURN should support restricted networks, including TLS/TCP where appropriate.

Calls exchange non-trickle SDP through participant-restricted database rows. Incoming signaling is polled every two seconds; ICE gathering can delay ringing. Signals time out after approximately one minute. No background push notifications or calls to telephone numbers are supported.

## Validation and release checks

```bash
npm run test
npm run lint
npm run build
npm audit
```

The project is JavaScript, not TypeScript; no standalone type-check is configured. Lint and the Next.js build provide static checks. Validation tests were committed before the validation implementation. Dependency ranges are not a reproducible lock: review the resolved versions, remediate applicable advisories, and commit the generated package-lock.json before release.

| Manual check | Expected result |
| --- | --- |
| Two users send messages | Correct conversation receives each message |
| Reload/reconnect | Recent conversation history reloads |
| Third unrelated account queries private rows | RLS denies visibility |
| Spoof sender ID or insert as anonymous | Database rejects the write |
| Voice call on two devices | Both directions have audio |
| Video call | Both streams display; local preview is muted |
| Decline, hangup, mute, camera off | Correct state and media behavior |
| Deny permissions or lose network | Error appears; call eventually ends |
| Hang up during permission prompt | Granted tracks are stopped after cancellation |
| Different networks with TURN | Call succeeds; inspect relay candidates in browser diagnostics |
| Mobile and keyboard navigation | Conversation controls remain usable |

Run call tests on two devices/headphones to avoid echo. Add automated integration and WebRTC tests before production; unit tests currently cover only validation helpers. No CI workflow is included.

## Security and limitations

| Area | Current limitation / required follow-up |
| --- | --- |
| Message privacy | Messages are plaintext in your database; this is NOT end-to-end encrypted messaging |
| Directory | Authenticated users can discover usernames and account IDs, but not account emails |
| Media | WebRTC transport encryption; do not claim audited WhatsApp-equivalent security |
| Abuse prevention | Add blocking, reporting, rate limits, signup CAPTCHA, and contact consent before public launch |
| Signaling retention | Schedule privileged daily deletion of call_signals older than one day; SDP may contain network addresses |
| History | Latest 200 messages shown; sidebar derives from latest 500 account messages; no older-history pagination |
| Calls | One active call; foreground app required; no guaranteed multi-tab coordination |
| Not included | Groups, attachments, read receipts, online/typing indicators, password recovery UI, push notifications |
| Operations | Add monitoring, backups, account deletion, privacy policy, and retention controls |

## Deployment

After checks pass, import this GitHub repository into a Next.js-compatible host, select `feature/chat-and-calls` for a preview, configure the environment variables, and deploy with HTTPS. Configure Supabase Auth URLs for that domain. Test real accounts and cross-network calls before promoting a release. `main` has not been modified; review and merge separately when ready.
