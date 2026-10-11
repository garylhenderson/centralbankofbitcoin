#!/usr/bin/env bash
# Publish committed public assets. Does not initialize programs or enable trading.
set -euo pipefail
cd /opt/cbob-vaults
[ "${1:-}" = '--execute' ] || { echo 'Dry: builds public/hosted profiles, backs up touched site files, publishes pages and navigation. Pass --execute after review.'; exit 0; }
git diff --quiet HEAD -- web bank scripts || { echo 'Commit reviewed changes before publishing.' >&2; exit 1; }
node web/build.mjs > /tmp/cbob-public-build.log
node web/build.mjs --profile mainnet-local > /tmp/cbob-hosted-build.log
backup="/var/backups/cbob-ecosystem/$(date -u +%Y%m%dT%H%M%SZ)"
sudo mkdir -p "$backup"
for section in assets account vault redeem claim buy market governance history data v; do
  if [ -e "/var/www/centralbankofbitcoin/$section" ]; then sudo cp -a "/var/www/centralbankofbitcoin/$section" "$backup/"; fi
done
while IFS= read -r file; do
  rel="${file#web/site/}"
  if [ -f "/var/www/centralbankofbitcoin/$rel" ]; then sudo mkdir -p "$backup/$(dirname "$rel")"; sudo cp -a "/var/www/centralbankofbitcoin/$rel" "$backup/$rel"; fi
done < <(rg --files web/site)
for section in assets account vault redeem claim buy market governance history; do sudo rsync -a "web/dist/$section/" "/var/www/centralbankofbitcoin/$section/"; done
sudo rsync -a web/site/ /var/www/centralbankofbitcoin/
sudo install -d -o ubuntu -g www-data -m 755 /var/www/centralbankofbitcoin/data /var/www/centralbankofbitcoin/v
/usr/bin/flock -n /opt/cbob-vaults/.cache/public-data.flock /usr/bin/node bank/public-data.mjs
printf 'Published committed Bank pages. Backup: %s\n' "$backup"
