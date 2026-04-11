"""
Session management: temp directories keyed by UUID, auto-cleanup after 24h.
"""
import os
import shutil
import time
import uuid
from pathlib import Path

SESSIONS_DIR = Path("/tmp/project-it-sessions")
SESSION_TTL_SECONDS = 86400  # 24 hours


def create_session() -> str:
    session_id = str(uuid.uuid4())
    session_dir = SESSIONS_DIR / session_id
    session_dir.mkdir(parents=True, exist_ok=True)
    return session_id


def session_dir(session_id: str) -> Path:
    return SESSIONS_DIR / session_id


def session_step_path(session_id: str) -> Path:
    return SESSIONS_DIR / session_id / "upload.step"


def cleanup_old_sessions():
    """Delete session dirs older than SESSION_TTL_SECONDS."""
    if not SESSIONS_DIR.exists():
        return
    now = time.time()
    for entry in SESSIONS_DIR.iterdir():
        if entry.is_dir():
            age = now - entry.stat().st_mtime
            if age > SESSION_TTL_SECONDS:
                shutil.rmtree(entry, ignore_errors=True)
