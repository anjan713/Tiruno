"""NotebookLM integration (Python port of ``src/lib/core/notebooklm``).

Client wraps the ``notebooklm-mcp-cli`` operations (with a hermetic mock mode);
``retention`` manages the per-article lifecycle + rotation in Redis. See
docs/notebooklm-ingestion.md and the worker agents (notebook_ingest, gmail_ingest,
notebook_retention) for the orchestration.
"""

from . import retention
from .client import NotebookLMClient, NotebookLMError, reset_mock_store
from .config import NotebookLMConfig, notebooklm_config, notebooklm_enabled

__all__ = [
    "retention",
    "NotebookLMClient",
    "NotebookLMError",
    "reset_mock_store",
    "NotebookLMConfig",
    "notebooklm_config",
    "notebooklm_enabled",
]
