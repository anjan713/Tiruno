"""Tiruno Python worker.

A faithful port of the Node worker (``worker/``). It consumes the same
``jobs:agent`` Redis Stream, writes the same state keys, and publishes the same
realtime bus messages, so the Next.js app drives it unchanged. See ``README.md``.
"""

__all__ = ["main"]
