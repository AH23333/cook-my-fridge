"""Config/env resolution tests: project .env first, legacy path as fallback."""
import pytest

import cookmyfridge.config as config


def test_project_env_file_is_default():
    assert config.DEFAULT_ENV_FILE == config.PACKAGE_ROOT / ".env"


def test_env_file_resolution_prefers_primary(tmp_path, monkeypatch):
    primary = tmp_path / ".env"
    primary.write_text("ZHIPU_API_KEY=primary-key\n", encoding="utf-8")
    legacy = tmp_path / "legacy.env"
    legacy.write_text("ZHIPU_API_KEY=legacy-key\n", encoding="utf-8")
    monkeypatch.setenv("COOKMYFRIDGE_ENV_FILE", str(primary))
    monkeypatch.setattr(config, "LEGACY_ENV_FILE", legacy)
    monkeypatch.delenv("ZHIPU_API_KEY", raising=False)

    api_key, base_url, model = config.zhipu_settings()
    assert api_key == "primary-key"
    assert base_url == config.ZHIPU_DEFAULT_BASE
    assert model == config.DEFAULT_MODEL


def test_legacy_env_file_used_when_primary_missing_key(tmp_path, monkeypatch):
    primary = tmp_path / ".env"  # exists but carries no key
    primary.write_text("OTHER=1\n", encoding="utf-8")
    legacy = tmp_path / "legacy.env"
    legacy.write_text("ZHIPU_API_KEY=legacy-key\n", encoding="utf-8")
    monkeypatch.setenv("COOKMYFRIDGE_ENV_FILE", str(primary))
    monkeypatch.setattr(config, "LEGACY_ENV_FILE", legacy)
    monkeypatch.delenv("ZHIPU_API_KEY", raising=False)

    api_key, _, _ = config.zhipu_settings()
    assert api_key == "legacy-key"


def test_missing_key_raises_with_guidance(tmp_path, monkeypatch):
    monkeypatch.setenv("COOKMYFRIDGE_ENV_FILE", str(tmp_path / "none.env"))
    monkeypatch.setattr(config, "LEGACY_ENV_FILE", tmp_path / "also-none.env")
    monkeypatch.delenv("ZHIPU_API_KEY", raising=False)

    with pytest.raises(KeyError, match="ZHIPU_API_KEY"):
        config.zhipu_settings()
