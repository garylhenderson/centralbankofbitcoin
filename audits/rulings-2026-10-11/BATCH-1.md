# Rulings batch 1: treasury wording

R1-R3 are recorded verbatim as RULED in launch/RULINGS-2026-10-11.md and summarized in DESIGN-v6.md. R1 supersedes D5(b). No launch dates have been edited yet; that follows this publication, through the source-relative producer already live at 7a00e2c.

R2 adds a dated correction above P&F section V; the original section is byte-identical to 7a00e2c. It distinguishes free charter issuance, the 85/15 sale price, an empty bought vault and its own 21,000-sat deposit/activation request. Current recipient wording on P&F VI, Schedule, buy guide/preview, holder guide and ceremony explanations is the Bank's treasury. Statement 2026-3 and its feed entry are corrected forward; all seven original release bodies/titles remain unchanged. Original historical references remain only where preservation is required and the dated correction explicitly identifies the current recipient.

The two ceremony source changes are display strings only, naming the 15% destination; no instruction or launch argument changed. Their new fingerprints require explicit Claude review and acceptance. Public site publication does not replace the separately hosted ceremony build; its reviewed rebuild follows the dates in batch 2.

R3 matches the existing production read-only-page analytics scope; wallet and ceremony security policies are unchanged. No actions are enabled, no transaction is signed and no program/release binary is changed.

Pre-review checks: original statement and section V preservation, feed parsing and the existing P&F VI link verified over HTTPS with the browser-compatible client (Python urllib was refused by the edge). No new external URL was introduced.

Review follow-up: added dated disclosure for Section VI rename and clarified founding charter exchange. The live producer reads only its detached 7a00e2c source. No launch directory enumeration is used by the server; BUILD contains output files only. Participating vaults remains accurate on the buy page: activation alone does not join payouts immediately. Treasury controller identification is not guessed.

Changed fingerprints from fresh builds:

```
mainnet buy/app.js
OLD e41be06d45ce42d765ef1666f1295f825dd4dff2befecf394e51b922b356cbac
NEW de4a1eceab6edd46465e70d57221d4c1d45f9875b32b3f5fb5d2cc449803fef2
mainnet ceremony-0cfecdcaf80584b6/app.js
OLD 4673d4246f6ef91d2d809f169c1a0241fcc39ec455132a05d33b9b3dbc09f2d7
NEW 9b1b35f1315cc2895d4f59c1957dc0c90e1ff2e955aa893160df9b9e5dbc40fb
mainnet-local buy/app.js
OLD ef16c1d8df9f7047cd80caffc9b6e933180b293eaa20bd238b59595fc6eea66b
NEW 39c1ea635b6c203d231ca686d429e3e6d5477dfd8aca1fa8fea83c18159a10e2
mainnet-local ceremony-0cfecdcaf80584b6/app.js
OLD ab6a155cbcbf5b58330cee5a0d151ce157122c8bd7098ccf3fbbdab3f5e8a081
NEW ca119d4cbf39bef06a3e5eb24b4c5ea714375257978d6bcbd786860ab37b8fb8
```
