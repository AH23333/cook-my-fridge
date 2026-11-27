"""Stdlib-only Zhipu GLM client with robust JSON extraction and retries."""
from __future__ import annotations

import json
import re
import time
import urllib.error
import urllib.request

from .config import zhipu_settings

_FENCE_RE = re.compile(r"```(?:json|JSON)?\s*(.*?)```", re.DOTALL)
_RETRYABLE_STATUS = {408, 429, 500, 502, 503, 504}


class LLMError(RuntimeError):
    pass


def extract_json(text: str):
    """Parse JSON from a model reply, tolerating code fences and prose."""
    payload = text.strip()
    fence = _FENCE_RE.search(payload)
    if fence:
        payload = fence.group(1).strip()
    try:
        return json.loads(payload)
    except json.JSONDecodeError:
        pass
    # Fall back to the outermost balanced-looking object/array slice.
    for open_ch, close_ch in (("{", "}"), ("[", "]")):
        start = payload.find(open_ch)
        end = payload.rfind(close_ch)
        if start != -1 and end != -1 and end > start:
            try:
                return json.loads(payload[start : end + 1])
            except json.JSONDecodeError:
                continue
    raise LLMError(f"无法从模型输出中提取 JSON: {text[:200]}")


class LLMClient:
    def __init__(self, api_key: str | None = None, base_url: str | None = None,
                 model: str | None = None):
        # Only touch environment/.env config for values the caller did not
        # supply explicitly, so fully-parameterised instances (e.g. tests)
        # never require ZHIPU_API_KEY to exist.
        self.api_key = api_key
        self.base_url = base_url
        self.model = model
        if self.api_key is None or self.base_url is None or self.model is None:
            settings_key, settings_base, settings_model = zhipu_settings()
            self.api_key = self.api_key or settings_key
            self.base_url = self.base_url or settings_base
            self.model = self.model or settings_model

    def chat(
        self,
        messages: list[dict],
        temperature: float = 0.7,
        max_tokens: int | None = None,
        timeout: int = 60,
        retries: int = 3,
    ) -> str:
        url = self.base_url + "/chat/completions"
        payload: dict = {
            "model": self.model,
            "messages": messages,
            "temperature": temperature,
        }
        if max_tokens is not None:
            payload["max_tokens"] = max_tokens
        body = json.dumps(payload).encode("utf-8")
        headers = {
            "Content-Type": "application/json",
            "Authorization": f"Bearer {self.api_key}",
        }
        attempt = 0
        while True:
            attempt += 1
            try:
                req = urllib.request.Request(
                    url, data=body, headers=headers, method="POST"
                )
                with urllib.request.urlopen(req, timeout=timeout) as resp:
                    data = json.loads(resp.read().decode("utf-8"))
                return data["choices"][0]["message"]["content"]
            except urllib.error.HTTPError as exc:
                detail = exc.read().decode("utf-8", errors="replace")[:300]
                if exc.code in _RETRYABLE_STATUS and attempt <= retries:
                    self._backoff(attempt)
                    continue
                raise LLMError(f"HTTP {exc.code}: {detail}") from exc
            except (urllib.error.URLError, TimeoutError) as exc:
                if attempt <= retries:
                    self._backoff(attempt)
                    continue
                raise LLMError(f"网络错误: {exc}") from exc

    @staticmethod
    def _backoff(attempt: int) -> None:
        time.sleep(min(2 ** attempt * 0.5, 8.0))

    def chat_json(
        self,
        messages: list[dict],
        temperature: float = 0.3,
        retries: int = 2,
        timeout: int = 60,
    ):
        """Call the model and parse JSON; re-prompt once on parse failure."""
        last_text = ""
        for _ in range(retries + 1):
            last_text = self.chat(
                messages, temperature=temperature, timeout=timeout
            )
            try:
                return extract_json(last_text)
            except LLMError:
                messages = messages + [
                    {"role": "assistant", "content": last_text},
                    {
                        "role": "user",
                        "content": "你的上一条回复无法被解析为 JSON。请只输出一个合法 JSON，不要围栏、不要解释。",
                    },
                ]
        raise LLMError(f"chat_json 多次重试仍失败: {last_text[:200]}")
