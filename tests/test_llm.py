"""LLM client tests: JSON extraction is offline; live calls are opt-in."""
import io
import os
import urllib.error
import urllib.request

import pytest

from cookmyfridge.llm import LLMClient, LLMError, extract_json


def test_extract_plain_object():
    assert extract_json('{"a": 1, "b": "x"}') == {"a": 1, "b": "x"}


def test_extract_fenced_object():
    text = '```json\n{"ok": true}\n```'
    assert extract_json(text) == {"ok": True}


def test_extract_fence_without_language():
    assert extract_json("```\n[1, 2, 3]\n```") == [1, 2, 3]


def test_extract_object_embedded_in_prose():
    text = '好的，结果如下：\n{"name": "测试", "n": 2}\n以上。'
    assert extract_json(text) == {"name": "测试", "n": 2}


def test_extract_chinese_content():
    text = '```json\n{"title": "番茄炒蛋", "methods": ["炒"]}\n```'
    result = extract_json(text)
    assert result["title"] == "番茄炒蛋"


def test_extract_failure_raises():
    with pytest.raises(LLMError):
        extract_json("这里完全没有 JSON 内容")


def test_chat_http_retries_bounded(monkeypatch):
    """A permanently failing endpoint must stop after 1 + retries attempts."""
    monkeypatch.setattr("time.sleep", lambda _s: None)  # skip real backoff
    attempts = []

    def always_503(req, timeout=None):
        attempts.append(1)
        raise urllib.error.HTTPError(
            req.full_url, 503, "unavailable", {}, io.BytesIO(b"busy")
        )

    monkeypatch.setattr(urllib.request, "urlopen", always_503)
    client = LLMClient(api_key="k", base_url="https://example.invalid", model="m")
    with pytest.raises(LLMError, match="503"):
        client.chat([{"role": "user", "content": "hi"}], retries=3)
    assert len(attempts) == 4


def test_chat_http_non_retryable_fails_immediately(monkeypatch):
    monkeypatch.setattr("time.sleep", lambda _s: None)
    attempts = []

    def always_401(req, timeout=None):
        attempts.append(1)
        raise urllib.error.HTTPError(
            req.full_url, 401, "unauthorized", {}, io.BytesIO(b"bad key")
        )

    monkeypatch.setattr(urllib.request, "urlopen", always_401)
    client = LLMClient(api_key="k", base_url="https://example.invalid", model="m")
    with pytest.raises(LLMError, match="401"):
        client.chat([{"role": "user", "content": "hi"}], retries=3)
    assert len(attempts) == 1  # 401 is not retried


def test_chat_json_retries_bounded_on_unparseable(monkeypatch):
    calls = []
    client = LLMClient(api_key="k", base_url="https://example.invalid", model="m")

    def garbage(messages, **kwargs):
        calls.append(len(messages))
        return "这根本不是 JSON"

    monkeypatch.setattr(client, "chat", garbage)
    with pytest.raises(LLMError, match="多次重试"):
        client.chat_json([{"role": "user", "content": "hi"}], retries=2)
    assert len(calls) == 3  # 1 + 2 parse retries, then gives up
    assert calls == [1, 3, 5]  # assistant reply + correction appended each round


def test_extract_empty_raises():
    with pytest.raises(LLMError):
        extract_json("")


@pytest.mark.skipif(os.environ.get("RUN_LIVE") != "1", reason="需要真实 API，设 RUN_LIVE=1 启用")
def test_live_chat_json_roundtrip():
    client = LLMClient()
    result = client.chat_json(
        [
            {"role": "system", "content": "只输出 JSON。"},
            {"role": "user", "content": '返回 {"ping": "pong"}，可带 json 围栏。'},
        ],
        temperature=0.1,
    )
    assert result == {"ping": "pong"}
