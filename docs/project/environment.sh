set -eu
SUDO=; [ "$(id -u)" -eq 0 ] || SUDO=sudo
$SUDO apt-get update
$SUDO apt-get install -y jq git python3 python3-venv python3-websockets build-essential curl
if ! node --version 2>/dev/null | grep -q '^v22\.'; then
  curl -fsSL https://deb.nodesource.com/setup_22.x -o /tmp/nodesource_setup_22.sh
  $SUDO bash /tmp/nodesource_setup_22.sh
  $SUDO apt-get install -y nodejs
fi
python3 -m venv ~/.platformio/penv
~/.platformio/penv/bin/pip install 'platformio==6.1.19'
# Last line: its status is the script's.
command -v jq && node --version | grep '^v22\.' && ~/.platformio/penv/bin/pio --version
