"""LLM client tests: JSON extraction is offline; live calls are opt-in."""
import os

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
