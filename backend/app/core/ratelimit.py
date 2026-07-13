"""
Lightweight in-memory rate limiter (sliding window).

Sufficient for a single-instance company deployment. For multi-instance /
horizontally-scaled deployments, back this with Redis (the interface stays the
same — swap the storage).
"""
from __future__ import annotations

import asyncio
import time
from collections import defaultdict, deque

from fastapi import HTTPException, status


class RateLimiter:
    def __init__(self, max_calls: int, window_seconds: int):
        self.max_calls = max_calls
        self.window = window_seconds
        self._hits: dict[str, deque[float]] = defaultdict(deque)
        self._lock = asyncio.Lock()

    async def check(self, key: str) -> None:
        now = time.monotonic()
        cutoff = now - self.window
        async with self._lock:
            q = self._hits[key]
            while q and q[0] < cutoff:
                q.popleft()
            if len(q) >= self.max_calls:
                retry = int(q[0] + self.window - now) + 1
                raise HTTPException(
                    status.HTTP_429_TOO_MANY_REQUESTS,
                    "Rate limit exceeded. Please slow down.",
                    headers={"Retry-After": str(retry)},
                )
            q.append(now)
