"""Datetime helpers."""
from __future__ import annotations

import datetime as dt


def ensure_utc(value: dt.datetime | None) -> dt.datetime | None:
    """Return a timezone-aware UTC datetime (or None).

    Timestamps are stored in UTC, but SQLite drops tzinfo on read-back, so a
    naive value is treated as UTC. Aware values are converted to UTC. Making the
    value tz-aware ensures it serializes with an explicit offset, so the browser
    converts it to the viewer's local time correctly.
    """
    if value is None:
        return None
    if value.tzinfo is None:
        return value.replace(tzinfo=dt.timezone.utc)
    return value.astimezone(dt.timezone.utc)
