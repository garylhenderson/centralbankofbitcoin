# Owner signing session

Prepared October 13. Recommended window: Thursday October 15, allow 30 minutes.
This is a preparation checklist, not a booked appointment or signing approval.

## Before the session

- Use Brave with the real Phantom extension and the owner wallet
  `Hc6WGt2kbuRn1QmS9XG7tZLtwXV6ptBCc44UEZJnVCYb` available. Never enter a
  recovery phrase or private key on a website or in this conversation.
- The operator runs the fresh chain, artifact, certificate and environment
  checks in `SIGNING-DELIVERY-2026-10-12.md`. The signing service stays closed
  until that supervised window. The private path and temporary credentials
  are delivered privately then; they are not stored in this public repository.
- Verify the previously accepted artifact: source
  `a9dcaca08e6db389a24333009d7008ba8c9d235d`, artifact SHA-256
  `d1b17742d19a1082f89f0d6bb105e69ac5a6a3da575602d6e62b883da5b94b9f`.
  A new holder-page release must not silently replace this ceremony artifact.
- Read back Monday October 19, 2026 at noon Austin time as the charter start.
  Initialization writes that date permanently. A failed Friday lock check
  cannot postpone an initialized charter by changing the website.

## At the signing page

1. Open the private `sign.centralbankofbitcoin.com` link in Brave. Check the
   hostname and TLS certificate; verify the displayed source and artifact.
2. Connect the owner Phantom wallet. Confirm the page reads mainnet successfully
   without a second authentication prompt for its RPC connection. Stop on an
   unexplained warning, wrong account, wrong network or fingerprint mismatch.
3. Review each transaction's purpose, accounts and current SOL fee/rent estimate.
   Sign each transaction yourself. The sequence creates the vault collection,
   initializes SEAL, MINT, BURN and GOV, and prepares the required token accounts
   and revenue rent. The page determines which confirmed steps remain.
4. If a response is lost, check the transaction and refresh the confirmed state
   before signing again. Do not assume a timeout means it failed.

## Before leaving

- Record the collection address and transaction signatures. Run the independent
  `verify-ceremony.mjs --after` read-back immediately, before public activity.
- Close signing access and verify the refusal page and stopped service.
- Commit the collection configuration, rebuild the holder release and adapter,
  and complete live acceptance before enabling either capability switch.

The lock is a separate irreversible action on Friday October 16 at noon Austin
time. Its full-suite certification must run after Thursday noon Austin against
the exact live Core bytes. A failed gate means no lock. The owner witnesses the
certification, records its digest outside this server, and explicitly authorizes
the authority removals. See `PRELOCK-R1.md`.
