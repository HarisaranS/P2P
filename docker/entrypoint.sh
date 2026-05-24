#!/bin/sh
set -e

# Start Tor when requested (SOCKS5 on 9050)
if [ "${HEXGAB_TRANSPORT}" = "tor" ]; then
  echo "Starting Tor..."
  tor -f /etc/tor/torrc &
  sleep 3
  export HEXGAB_TOR_SOCKS=127.0.0.1:9050
fi

exec "$@"
