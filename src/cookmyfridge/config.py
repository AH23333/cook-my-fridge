"""Configuration: project paths and environment loading.

No secrets are hard-coded. The GLM key is read from the environment variable
ZHIPU_API_KEY, or parsed from an external .env file (path overridable via
COOKMYFRIDGE_ENV_FILE) so the key never lands in this repository.
"""
from __future__ import annotations

import os
from pathlib import Path

PACKAGE_ROOT = Path(__file__).resolve().parents[2]
DATA_DIR = PACKAGE_ROOT / "data"
CURATED_DIR = DATA_DIR / "curated"
CATALOG_DIR = DATA_DIR / "catalog"
RAW_DIR = DATA_DIR / "raw"
WEB_DIR = PACKAGE_ROOT / "web"
SITE_DIR = PACKAGE_ROOT / "site"
DOCS_DIR = PACKAGE_ROOT / "docs"

DEFAULT_ENV_FILE = PACKAGE_ROOT / ".env"

ZHIPU_DEFAULT_BASE = "https://open.bigmodel.cn/api/paas/v4"
DEFAULT_MODEL = "glm-4-flash"


def load_env_file(path: Path) -> dict[str, str]:
    """Parse a simple KEY=VALUE .env file, ignoring comments and blank lines."""
    env: dict[str, str] = {}
    if not path.exists():
        return env
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        env[key.strip()] = value.strip()
    return env


def zhipu_settings() -> tuple[str, str, str]:
    """Return (api_key, base_url, model). Raises KeyError if no key available."""
    env_file = Path(os.environ.get("COOKMYFRIDGE_ENV_FILE", DEFAULT_ENV_FILE))
    file_env = load_env_file(env_file)
    api_key = os.environ.get("ZHIPU_API_KEY") or file_env.get("ZHIPU_API_KEY", "")
    base_url = (
        os.environ.get("ZHIPU_BASE_URL")
        or file_env.get("ZHIPU_BASE_URL")
        or ZHIPU_DEFAULT_BASE
    )
    model = os.environ.get("COOKMYFRIDGE_MODEL") or DEFAULT_MODEL
    if not api_key:
        raise KeyError(
            "ZHIPU_API_KEY not found. Set the env var or point COOKMYFRIDGE_ENV_FILE "
            "to a .env containing ZHIPU_API_KEY."
        )
    return api_key, base_url.rstrip("/"), model
