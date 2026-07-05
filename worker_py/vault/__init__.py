"""Vault registry — Obsidian-compatible "living files" memory backend."""

import os
from typing import Optional

from .obsidian import ObsidianVault, VaultNote, VaultSearchHit

__all__ = ["ObsidianVault", "VaultNote", "VaultSearchHit", "get_vault", "vault_provider_name"]

_cached: Optional[ObsidianVault] = None


def get_vault() -> ObsidianVault:
    global _cached
    if _cached is None:
        _cached = ObsidianVault()
    return _cached


def vault_provider_name() -> str:
    return (os.environ.get("VAULT_PROVIDER") or "obsidian").lower()
