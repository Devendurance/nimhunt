# Nimiq Pay integration spike

Technical proof that NimHunt can initialize the Nimiq provider, request an account, and sign a **development** treasure-seal message. This is not a reward claim and does not send NIM.

## Dev surface

Open:

```text
/play?dev=nimiq
```

Normal `/play` is unchanged. `/` is unchanged.

## Local phone test (Nimiq Pay)

1. Phone and computer use the same Wi-Fi/network.
2. Start Vite with network binding (do not use `localhost` on the phone):

   ```bash
   npm run dev -- --host
   ```

3. Copy the **Network** URL printed by Vite (Vite chooses the IP and port; this repo does not hardcode them).
4. Open Nimiq Pay.
5. Use its local/custom Mini App URL flow (Mini Apps → enter/custom URL).
6. Open:

   ```text
   http://<network-ip>:<port>/play?dev=nimiq
   ```

7. Tap **Request Nimiq account**.
8. Approve in Nimiq Pay.
9. Confirm the returned address (short form on screen, full address copyable).
10. Tap **Sign test treasure seal**.
11. Approve signing.
12. Confirm `publicKey` and `signature` are returned.

### Testnet

Not required for this spike. The spike only calls `init()`, `listAccounts()`, and `sign()`. It does not send transactions and does not switch networks.

If you later test NIM payments, use Nimiq Pay’s hidden dev menu: long-press the settings button for 10 seconds, then switch to **Testnet**. That switch only affects Nimiq provider operations.

## Browser fallback

Opening `/play?dev=nimiq` in a normal browser must stay usable:

- environment: browser development mode
- provider status: unavailable
- no `init()` polling
- no fake account
- no fake signature

`/play` without the query stays the Hunt shell and does not prompt the wallet.

## SDK methods used

```ts
import { init } from '@nimiq/mini-app-sdk'

const nimiq = await init({ timeout: 10_000 })
const accounts = await nimiq.listAccounts()
const signed = await nimiq.sign(message)
```

Expected sign result:

```ts
{ publicKey: string; signature: string }
```

Private keys are never requested, stored, or logged.

## Server-side signature verification

Development-only endpoint (Vite middleware, same origin as the Mini App):

```text
POST /api/dev/verify-treasure-seal
```

The server never trusts a client `valid` / `verified` field.

### Official crypto used

| Step | Package | API |
| --- | --- | --- |
| Parse public key | `@nimiq/core` 2.21.0 | `PublicKey.fromHex(hex)` |
| Parse signature | `@nimiq/core` | `Signature.fromHex(hex)` |
| Address from public key | `@nimiq/core` | `publicKey.toAddress()` |
| Parse expected wallet | `@nimiq/core` | `Address.fromString(wallet)` |
| Address equality | `@nimiq/core` | `derived.equals(expected)` |
| SHA-256 | `@nimiq/core` | `Hash.computeSha256(bytes)` |
| Verify | `@nimiq/core` | `publicKey.verify(signature, data)` |

`@nimiq/core` does **not** expose a high-level `verifySignedMessage()` helper. Nimiq Pay `sign()` matches the Hub/Keyguard signed-message convention:

```text
data = sha256( utf8("\x16Nimiq Signed Message:\n" + utf8(message).byteLength + message) )
publicKey.verify(signature, data)
```

Canonical payload serialization is shared (`src/domain/treasureSeal.ts`) and the exact signed string is verified. The server does not parse-then-reserialize before the crypto check.

### Address-binding rule

`valid` is true only when all of these hold:

1. signature is valid for the exact payload string
2. `publicKey.toAddress()` equals the expected wallet
3. payload `wallet` equals the expected wallet

### Dev UI

After a local Nimiq Pay signature on `/play?dev=nimiq`:

- `Verify test signature` → VERIFIED or REJECTED
- `Test tampered payload` changes `VAULT_BREAKER` → `GEM_RUNNER` without another wallet prompt and must be REJECTED

Copy on success: `Development verification passed. No NIM has been awarded.`
