"""
Thin wrapper around the Anthropic async SDK.

All Claude access goes through here so model selection, prompt caching, and
error handling live in one place. The API key is read from settings — it is
never exposed to clients.
"""
from __future__ import annotations

import json
import logging
from collections.abc import AsyncIterator
from dataclasses import dataclass

import anthropic
from anthropic import AsyncAnthropic

from app.config import get_settings

logger = logging.getLogger("hindimitra.claude")
_settings = get_settings()

_client = AsyncAnthropic(api_key=_settings.anthropic_api_key)


class ClaudeError(RuntimeError):
    """Raised when an Anthropic call fails after SDK retries."""


@dataclass
class Usage:
    input_tokens: int = 0
    output_tokens: int = 0


def system_blocks(text: str) -> list[dict]:
    """
    Build a cacheable system prompt. The persona prompt is stable across a
    conversation's turns, so caching it cuts input cost substantially.
    """
    return [{"type": "text", "text": text, "cache_control": {"type": "ephemeral"}}]


async def complete(
    *,
    system: str,
    messages: list[dict],
    model: str | None = None,
    max_tokens: int = 500,
) -> tuple[str, Usage]:
    """Non-streaming completion. Used for short one-shot generations (openers)."""
    try:
        resp = await _client.messages.create(
            model=model or _settings.model_conversation,
            max_tokens=max_tokens,
            system=system_blocks(system),
            messages=messages,
            thinking={"type": "disabled"},  # snappy, low-latency spoken replies
        )
    except anthropic.APIError as exc:
        logger.error("Anthropic completion failed: %s", exc)
        raise ClaudeError(str(exc)) from exc

    text = "".join(b.text for b in resp.content if b.type == "text").strip()
    usage = Usage(resp.usage.input_tokens, resp.usage.output_tokens)
    return text, usage


async def stream(
    *,
    system: str,
    messages: list[dict],
    model: str | None = None,
    max_tokens: int = 500,
) -> AsyncIterator[str | Usage]:
    """
    Stream a reply. Yields text chunks (str) as they arrive, then yields a
    single final `Usage` object once the stream completes.
    """
    try:
        async with _client.messages.stream(
            model=model or _settings.model_conversation,
            max_tokens=max_tokens,
            system=system_blocks(system),
            messages=messages,
            thinking={"type": "disabled"},
        ) as s:
            async for chunk in s.text_stream:
                yield chunk
            final = await s.get_final_message()
            yield Usage(final.usage.input_tokens, final.usage.output_tokens)
    except anthropic.APIError as exc:
        logger.error("Anthropic stream failed: %s", exc)
        raise ClaudeError(str(exc)) from exc


# For structured scoring/assessment we want the full token budget on the JSON,
# low latency, and reproducible output — so we disable thinking and set
# temperature=0. But newer models reject `temperature` (400), and some reject an
# explicit `thinking` config, so we record any parameter a given model rejects
# and drop it on later calls. Self-healing, no per-model hardcoding.
_unsupported_params: dict[str, set[str]] = {}


async def structured(
    *,
    system: str,
    messages: list[dict],
    schema: dict,
    model: str,
    max_tokens: int = 1024,
    cache_system: bool = True,
    temperature: float | None = 0.0,
) -> tuple[dict, Usage]:
    """
    Call Claude and constrain the reply to a JSON schema (structured outputs).

    Used for scoring and the final assessment. The system prompt (a stable
    rubric) is cached by default. Thinking is disabled and temperature is 0 so
    the whole token budget goes to the JSON (no truncation), latency stays low,
    and the same performance yields the same scores. Any parameter a model
    rejects is detected and dropped automatically; determinism then rests on the
    anchored rubric and the structured-output schema.
    """
    sys = system_blocks(system) if cache_system else system

    async def _call(drop: set[str]):
        kwargs: dict = {
            "model": model,
            "max_tokens": max_tokens,
            "system": sys,
            "messages": messages,
            "output_config": {"format": {"type": "json_schema", "schema": schema}},
        }
        if temperature is not None and "temperature" not in drop:
            kwargs["temperature"] = temperature
        if "thinking" not in drop:
            kwargs["thinking"] = {"type": "disabled"}
        return await _client.messages.create(**kwargs)

    drop = _unsupported_params.get(model, set())
    try:
        resp = await _call(drop)
    except anthropic.APIError as exc:
        # If the model rejects `temperature` and/or `thinking`, drop them and retry.
        extra = {p for p in ("temperature", "thinking") if p in str(exc).lower() and p not in drop}
        if extra:
            drop = drop | extra
            _unsupported_params[model] = drop
            try:
                resp = await _call(drop)
            except anthropic.APIError as exc2:
                logger.error("Anthropic structured call failed: %s", exc2)
                raise ClaudeError(str(exc2)) from exc2
        else:
            logger.error("Anthropic structured call failed: %s", exc)
            raise ClaudeError(str(exc)) from exc

    text = next((b.text for b in resp.content if b.type == "text"), "")
    try:
        data = json.loads(text)
    except (json.JSONDecodeError, TypeError) as exc:
        raise ClaudeError(f"Model returned non-JSON output: {exc}") from exc
    return data, Usage(resp.usage.input_tokens, resp.usage.output_tokens)
