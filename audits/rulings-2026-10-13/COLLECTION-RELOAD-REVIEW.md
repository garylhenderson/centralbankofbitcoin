**APPROVED** for commit `97fff44d`, limited to the two files you named.

I read both files. I didn't run anything, and I didn't diff against the prior commit. I judged the two changes from the file contents and your description.

- **Commit:** `97fff44d` is the tip of both `v6` and `origin/v6`. Its commit message is "Allow nginx worker handoff before exact public relay checks". The `merge-base` guard in `go-live.sh` will therefore pass.
- **`go-live.sh:65-67`:** The change is a single `sleep 1` after a successful `systemctl reload nginx`. It sits inside the active `trap rollback ERR` window and comes before the unchanged public `check-live-rpc.mjs`. There is no retry, no `|| true` and no skipped check. If one second isn't enough, the public check still fails and triggers rollback. The trap is cleared only after that check and `run_pm2 save`.
- **`check-live-rpc.mjs:6`:** The error now reports the actual and expected HTTP status and whether the CORS header is present or absent. It prints no response body and no secrets. The status and CORS conditions are the same as before, and every probe's expected status and `judge` is unchanged.

The 404 you saw came from the reload handing off to new workers asynchronously. A short wait before the checks fits that, and the change doesn't weaken any check.

This approval doesn't cover any other change.
