#!/usr/bin/env bash
# Start the backend + local copy of the site on http://127.0.0.1:${PORT:-8000}
#   ./run_local.sh            foreground
#   ./run_local.sh --daemon   background, log in logs/server.log, PID in logs/server.pid
set -euo pipefail
cd "$(dirname "$0")"
PORT="${PORT:-8000}"
HOST="${HOST:-127.0.0.1}"
# Python with torch + transformers. Default: the venv the model was trained with.
PY="${SIGN_PYTHON:-/data1/workspaces/cy0410/sign/avatar_mvp/integrated/context_selector_20261119/.venv/bin/python}"
# Extra web packages (fastapi, uvicorn, ...) live in ./.deps so the shared venv is not modified.
if [ ! -d .deps/fastapi ]; then
  "$PY" -m pip install -q --target .deps -r backend/requirements.txt
fi
export PYTHONPATH="$PWD/.deps:$PWD${PYTHONPATH:+:$PYTHONPATH}"
export TOKENIZERS_PARALLELISM=false OMP_NUM_THREADS="${OMP_NUM_THREADS:-4}"
CMD=("$PY" -m uvicorn backend.app:app --host "$HOST" --port "$PORT")
if [ "${1:-}" = "--daemon" ]; then
  mkdir -p logs
  if [ -f logs/server.pid ] && kill -0 "$(cat logs/server.pid)" 2>/dev/null; then
    echo "already running (PID $(cat logs/server.pid))"; exit 0
  fi
  nohup "${CMD[@]}" >> logs/server.log 2>&1 &
  echo $! > logs/server.pid
  echo "started PID $! -> http://$HOST:$PORT  (log: logs/server.log)"
else
  exec "${CMD[@]}"
fi
