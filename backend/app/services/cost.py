"""
Centralized token pricing.

Rates are US$ per 1,000,000 tokens. Verify against
https://docs.claude.com/en/docs/about-claude/pricing and update as needed.
"""
from __future__ import annotations

# model id -> (input $/Mtok, output $/Mtok)
PRICING: dict[str, tuple[float, float]] = {
    "claude-opus-4-8": (5.0, 25.0),
    "claude-sonnet-5": (3.0, 15.0),
    "claude-sonnet-4-6": (3.0, 15.0),
    "claude-haiku-4-5": (1.0, 5.0),
}

# Fallback if a model isn't in the table (use Sonnet-tier as a safe estimate).
_DEFAULT = (3.0, 15.0)


def estimate_cost(model: str, input_tokens: int, output_tokens: int) -> float:
    in_rate, out_rate = PRICING.get(model, _DEFAULT)
    return (input_tokens / 1e6) * in_rate + (output_tokens / 1e6) * out_rate
