#!/bin/sh
set -eu
: "${LOPE_BROWSER_TOKEN:?A per-owner browser token is required}"
: "${SELKIES_BASIC_AUTH_PASSWORD:?A separate random Selkies password is required}"
: "${LOPE_BROWSER_ORIGINS:?Set the exact LopeOS origin}"
umask 077
mkdir -p /tmp/lope-services /tmp/runtime-ubuntu /profiles/normal
# The allocator guarantees exclusive ownership of this profile. A removed container
# can leave a lock referring to its old hostname; it cannot own the profile now.
rm -f /profiles/normal/chromium/SingletonLock /profiles/normal/chromium/SingletonSocket /profiles/normal/chromium/SingletonCookie
cp -R /opt/lope-services/. /tmp/lope-services/
chmod -R u+w /tmp/lope-services
exec /etc/container-entrypoint.sh
