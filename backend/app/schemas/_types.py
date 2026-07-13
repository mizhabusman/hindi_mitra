"""Shared schema field types."""
from __future__ import annotations

import datetime as dt
from typing import Annotated

from pydantic import PlainSerializer

from app.core.timeutil import ensure_utc


def _serialize_utc(value: dt.datetime) -> str:
    """Serialize a datetime as an explicit UTC ISO-8601 string.

    Emitting an explicit offset (…+00:00) lets the browser convert to the
    viewer's local time correctly — without it a naive string is parsed as
    local time and the clock appears wrong.
    """
    aware = ensure_utc(value)
    return aware.isoformat() if aware is not None else ""


# Use in schema fields in place of `datetime` so API responses always carry an
# explicit UTC offset and render consistently across the app.
UtcDateTime = Annotated[dt.datetime, PlainSerializer(_serialize_utc, return_type=str)]
