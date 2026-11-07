"""Config/env resolution tests: project .env is the single file source."""
import pytest

import cookmyfridge.config as config


def test_project_env_file_is_default():
    assert config.DEFAULT_ENV_FILE == config.PACKAGE_ROOT / ".env"


def test_env_file_resolution_prefers_primary(tmp_path, monkeypatch):
    primary = tmp_path / ".env"
    primary.write_text("ZHIPU_API_KEY=primary-key\n", encoding="utf-8")
    monkeypatch.setenv("COOKMYFRIDGE_ENV_FILE", str(primary))
    monkeypatch.delenv("ZHIPU_API_KEY", raising=False)

    api_key, base_url, model = config.zhipu_settings()
    assert api_key == "primary-key"
    assert base_url == config.ZHIPU_DEFAULT_BASE
    assert model == config.DEFAULT_MODEL


def test_missing_key_raises_with_guidance(tmp_path, monkeypatch):
    monkeypatch.setenv("COOKMYFRIDGE_ENV_FILE", str(tmp_path / "none.env"))
    monkeypatch.delenv("ZHIPU_API_KEY", raising=False)

    with pytest.raises(KeyError, match="ZHIPU_API_KEY"):
        config.zhipu_settings()
