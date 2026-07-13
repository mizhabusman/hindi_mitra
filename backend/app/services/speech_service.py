"""
Azure AI Speech integration (token broker).

The browser talks to Azure Speech directly via the Speech SDK for the lowest
latency (STT, neural TTS, and phoneme-level pronunciation assessment). To keep
the subscription key server-side, the browser never sees it — instead it fetches
a short-lived (~10 min) authorization token from this service, which exchanges
the key for a token against Azure's STS endpoint.

This is the swappable "SpeechProvider" seam: if Azure isn't configured the app
falls back to the browser Web Speech API on the client.
"""
from __future__ import annotations

import logging

import httpx

from app.config import get_settings

logger = logging.getLogger("hindimitra.speech")
_settings = get_settings()


class SpeechNotConfiguredError(RuntimeError):
    pass


class SpeechTokenError(RuntimeError):
    pass


async def issue_token() -> dict:
    """Exchange the subscription key for a short-lived token + region."""
    if not _settings.speech_enabled:
        raise SpeechNotConfiguredError("Azure Speech is not configured")

    region = _settings.azure_speech_region
    url = f"https://{region}.api.cognitive.microsoft.com/sts/v1.0/issueToken"
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.post(
                url, headers={"Ocp-Apim-Subscription-Key": _settings.azure_speech_key}
            )
            resp.raise_for_status()
    except httpx.HTTPError as exc:
        logger.error("Azure token exchange failed: %s", exc)
        raise SpeechTokenError(str(exc)) from exc

    return {"token": resp.text, "region": region}
