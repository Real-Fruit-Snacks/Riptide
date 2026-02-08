#!/usr/bin/env bash
# Riptide Launcher
# Usage: ./start.sh [--no-ssl] [--port 3000]
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$DIR"

PORT="${PORT:-3000}"
NO_SSL="${NO_SSL:-}"

# Parse arguments
while [[ $# -gt 0 ]]; do
  case "$1" in
    --no-ssl)  NO_SSL=1; shift ;;
    --port)    PORT="$2"; shift 2 ;;
    --help|-h)
      echo "Usage: ./start.sh [--no-ssl] [--port PORT]"
      echo ""
      echo "  --no-ssl   Disable HTTPS (use plain HTTP)"
      echo "  --port N   Listen on port N (default: 3000)"
      echo ""
      echo "Environment variables:"
      echo "  SSL_KEY    Path to custom SSL key"
      echo "  SSL_CERT   Path to custom SSL certificate"
      echo "  NO_SSL=1   Disable HTTPS"
      echo "  PORT=N     Listen on port N"
      exit 0
      ;;
    *) echo "Unknown option: $1"; exit 1 ;;
  esac
done

# Check Node.js
if ! command -v node &>/dev/null; then
  echo "Error: Node.js is not installed."
  echo "Install it from https://nodejs.org/ (v18+ required)"
  exit 1
fi

NODE_VERSION=$(node -v | sed 's/v//' | cut -d. -f1)
if [ "$NODE_VERSION" -lt 18 ]; then
  echo "Error: Node.js v18+ required (found v$NODE_VERSION)"
  exit 1
fi

# Install dependencies if needed
if [ ! -d "node_modules" ]; then
  echo "Installing dependencies..."
  npm install
fi

# Kill any existing instance on the port
if lsof -ti :"$PORT" &>/dev/null; then
  echo "Stopping existing process on port $PORT..."
  kill $(lsof -ti :"$PORT") 2>/dev/null || true
  sleep 1
fi

# Build launch command
export PORT
if [ -n "$NO_SSL" ]; then
  export NO_SSL
  PROTO="http"
else
  PROTO="https"
fi

echo ""
echo " ██████╗ ██╗██████╗ ████████╗██╗██████╗ ███████╗"
echo " ██╔══██╗██║██╔══██╗╚══██╔══╝██║██╔══██╗██╔════╝"
echo " ██████╔╝██║██████╔╝   ██║   ██║██║  ██║█████╗"
echo " ██╔══██╗██║██╔═══╝    ██║   ██║██║  ██║██╔══╝"
echo " ██║  ██║██║██║        ██║   ██║██████╔╝███████╗"
echo " ╚═╝  ╚═╝╚═╝╚═╝        ╚═╝   ╚═╝╚═════╝ ╚══════╝"
echo ""
echo "  Starting on ${PROTO}://localhost:${PORT}"
echo "  Press Ctrl+C to stop"
echo ""

exec node server.js
