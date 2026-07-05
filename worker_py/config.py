"""Environment + constants. Mirrors ``worker/lib/env.ts`` and the stream names
declared in ``worker/index.ts``."""

import os

from dotenv import load_dotenv


def load_env() -> None:
    """Load ``.env.local`` (preferred) then ``.env`` from the repo root.

    ``python-dotenv`` does not override already-set variables, so loading
    ``.env.local`` first makes it win — matching the Node worker's dotenv order.
    """
    root = os.getcwd()
    load_dotenv(os.path.join(root, ".env.local"))
    load_dotenv(os.path.join(root, ".env"))


# Repo root — the worker is always launched from the project root.
REPO_ROOT = os.getcwd()

# Single demo user for the hackathon.
WORKER_UID = os.environ.get("WORKER_UID", "demo")

# Job queue stream + consumer group (must match worker/index.ts and src/lib/jobs.ts).
STREAM = "jobs:agent"
GROUP = "workers"
CONSUMER = f"w-{os.getpid()}"
