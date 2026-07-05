"""Agent runner contract. Port of ``src/lib/core/agent/types.ts``."""

from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import Callable, List, Optional

OnStep = Callable[[str], None]


@dataclass
class RunResult:
    text: str
    ok: bool
    error: Optional[str] = None


class AgentRunner(ABC):
    name: str = "agent"
    #: True if this runner can use external tools / skills (web, shell, files).
    supports_tools: bool = False

    @abstractmethod
    async def run(
        self,
        *,
        prompt: str,
        system: Optional[str] = None,
        skills: Optional[List[str]] = None,
        max_turns: int = 40,
        on_step: Optional[OnStep] = None,
    ) -> RunResult:
        raise NotImplementedError
