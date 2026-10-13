# Account sign-out release, October 13

Published source `6eb1eca8952cb0c774ca034a2832d46dd22dbba6`, after Claude
approved source `fcc3584c6d0fae966cb7a6799c5381775e98af04` and its four changed
account/style pins across the two profiles. See SIGNOUT-REVIEW.md. The first
static review requested clearer build provenance; the supplied commit/file
hashes, prior pin comparison and ceremony-footer diff resolved it. Both reviews
ran through first-party Claude Sonnet with extra usage disabled, never OpenRouter.

The account now has an explicitly labelled Sign out button in its top navigation,
in addition to the existing heading control. Both call the same Bank sign-out
endpoint. Failures are shown at the top and remain retryable. Success clears the
private desk and replaces the page with account sign-in. No Gary backend code,
financial flags, programs or announcement content was published by this fix.

Validation: 1,153 offline assertions plus 87 Node cases; 58 ecosystem assertions;
13 browser checks repeated with the published files; 31 live release checks.
The public account HTML, script and stylesheet match the reviewed build.
Both data and reconciliation timers are active with successful latest runs after
the publication handoff. Both financial switches remain off. The installed
ceremony artifact still verifies against d1b17742d19a1082f89f0d6bb105e69ac5a6a3da575602d6e62b883da5b94b9f.

Restore point: `/var/backups/cbob-ecosystem/20261013T211534-cbob-publish.kUUPT2EA`.
Public-data source is pinned to the published commit. These browser sign-out
checks use synthetic sessions; the owner's actual sign-out confirmation remains
pending. No member was impersonated.

The burn answer was independently checked against MINT claim_charter_vault:
Core BurnV1 consumes the eligible Proof of Burn before create_vault in the same
atomic instruction. A failure rolls the whole transaction back. Tests C.3 and
C.7 positively identify the burned state and reject re-use; R42.C12b verifies
rollback when a new vault address is already funded. Gary Club's claim adapter
uses this same instruction. Today's passing local-validator rehearsal covers
these assertions, and fresh program read-backs match the reviewed binaries.
No successful mainnet charter claim is claimed before October 19.
