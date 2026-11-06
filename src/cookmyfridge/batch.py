"""Resumable offline AI batch processing (product doc section 七).

Every successful generation is immediately persisted, so interrupted runs pick
up where they stopped. Cache files are plain JSON dicts keyed by stable keys.
"""
from __future__ import annotations

import json
import time
from pathlib import Path

from .ai import AIEngine, VARIANT_KINDS
from .config import CURATED_DIR
from .dataset import load_recipes

CACHE_DIR = CURATED_DIR / "ai_cache"

# Common fridge combos for AI Wildcard cards (deliberately include combos that
# have no exact dataset match so the AI fills the gap).
WILDCARD_COMBOS: list[list[str]] = [
    ["鸡蛋", "午餐肉", "米饭"],
    ["番茄", "土豆"],
    ["面条", "鸡蛋", "小白菜"],
    ["米饭", "冷冻混合菜"],
    ["吐司", "鸡蛋", "奶酪"],
    ["手抓饼", "鸡蛋"],
    ["燕麦", "牛奶", "香蕉"],
    ["鸡胸肉", "西兰花"],
    ["嫩豆腐", "豆瓣酱"],
    ["方便面", "鸡蛋", "小白菜"],
    ["冻鸡块", "番茄酱"],
    ["速冻饺子", "醋"],
    ["红薯", "奶酪"],
    ["米粉", "虾仁"],
    ["意面", "番茄", "午餐肉"],
    ["冻玉米粒", "胡萝卜", "豌豆"],
    ["荞麦面", "鸡胸肉"],
    ["腐竹", "五花肉"],
    ["花蛤", "嫩豆腐"],
    ["鱿鱼", "青椒"],
]

# Seeded blind-box combos (3-5 ingredients), deterministic across reruns.
BLINDBOX_COMBOS: list[list[str]] = [
    ["香蕉", "燕麦", "酸奶"],
    ["鸡蛋", "番茄", "米饭"],
    ["土豆", "午餐肉", "奶酪"],
    ["虾仁", "西兰花", "米饭"],
    ["面条", "鸡蛋", "虾皮"],
    ["吐司", "香蕉", "花生酱"],
    ["手抓饼", "鸡蛋", "生菜"],
    ["鸡胸肉", "生菜", "黄瓜", "番茄"],
    ["嫩豆腐", "紫菜", "虾皮"],
    ["速冻饺子", "小葱", "辣椒"],
    ["红薯", "牛奶", "燕麦"],
    ["米粉", "牛肉", "青椒"],
]


def combo_key(selected: list[str]) -> str:
    return "|".join(sorted(selected))


def repair_safety_notes(notes: list) -> list:
    """Join runs of single-character entries back into one string.

    Older generations iterated a model-returned string char by char, so a
    risk such as "注意不要炒糊" was stored as separate one-character notes.
    The disclaimer is always the first entry; multi-character notes are real
    sentences and delimit a broken run.
    """
    if not isinstance(notes, list) or not notes:
        return notes
    fixed = [notes[0]]
    buffer: list[str] = []

    def flush() -> None:
        if buffer:
            fixed.append("".join(buffer))
            buffer.clear()

    meaningless = {"无", "没有", "无风险", "暂无", "/", "-"}
    for note in notes[1:]:
        if isinstance(note, str) and note.strip() in meaningless:
            continue  # model's "no risk" marker, not a real note
        if isinstance(note, str) and len(note.strip()) <= 1:
            buffer.append(note)
        else:
            flush()
            fixed.append(note)
    flush()
    return fixed


VARIANT_TITLE_SUFFIX: dict[str, str] = {
    "lazy": "懒人版",
    "lowcal": "低卡版",
    "airfryer": "空气炸锅版",
    "substitute": "家常替代版",
    "method": "换做法版",
    "leftover": "剩菜改造版",
    "fusion": "融合版",
}


# Root markers that already indicate the kind, so we do not prepend a suffix.
VARIANT_TITLE_MARKERS: dict[str, tuple[str, ...]] = {
    "lazy": ("懒人版", "懒人"),
    "lowcal": ("低卡版", "低卡"),
    "airfryer": ("空气炸锅版", "空气炸锅"),
    "substitute": ("家常替代版", "替代"),
    "method": ("换做法版", "换做法"),
    "leftover": ("剩菜改造版", "剩菜"),
    "fusion": ("融合版", "融合"),
}


def repair_variant_title(recipe_id: str, title: str) -> str:
    """Ensure a variant title carries its kind marker instead of reusing base title."""
    parts = recipe_id.rsplit("-", 1)
    if len(parts) != 2:
        return title
    kind = parts[1]
    suffix = VARIANT_TITLE_SUFFIX.get(kind)
    if not suffix:
        return title
    if any(marker in title for marker in VARIANT_TITLE_MARKERS.get(kind, (suffix,))):
        return title
    return suffix + title


def clean_variant_title(recipe_id: str, title: str) -> str:
    """Collapse redundant prefixes, then guarantee a kind marker is present."""
    parts = recipe_id.rsplit("-", 1)
    if len(parts) != 2:
        return title
    kind = parts[1]
    suffix = VARIANT_TITLE_SUFFIX.get(kind)
    markers = VARIANT_TITLE_MARKERS.get(kind, (suffix,))
    # Drop a leading suffix when the remainder already carries a marker.
    if suffix and title.startswith(suffix):
        remainder = title[len(suffix):].strip()
        if any(marker in remainder for marker in markers):
            title = remainder
    return repair_variant_title(recipe_id, title)


def repair_all_caches() -> dict:
    """Repair every cache store in place; return per-file changed counts."""
    changed_summary: dict = {}
    for name in ("wildcards", "blindboxes", "variants", "ideas"):
        store = CacheStore(CACHE_DIR / f"{name}.json")
        changed = 0
        for key, value in store.data.items():
            if not isinstance(value, dict):
                continue
            original = value.get("safety_notes")
            if isinstance(original, list):
                repaired = repair_safety_notes(original)
                if repaired != original:
                    value["safety_notes"] = repaired
                    changed += 1
            if name == "variants":
                old_title = value.get("title", "")
                new_title = clean_variant_title(value.get("id", ""), old_title)
                if new_title != old_title:
                    value["title"] = new_title
                    changed += 1
        if changed:
            store.flush()
        changed_summary[name] = changed
    return changed_summary


def prune_failures() -> dict:
    """Drop failure records whose item now exists in its cache; keep real failures."""
    stores = {
        "wildcards": CacheStore(CACHE_DIR / "wildcards.json"),
        "blindboxes": CacheStore(CACHE_DIR / "blindboxes.json"),
        "variants": CacheStore(CACHE_DIR / "variants.json"),
        "ideas": CacheStore(CACHE_DIR / "ideas.json"),
    }
    failures = CacheStore(CACHE_DIR / "failures.json")
    removed: list[str] = []
    for record in list(failures.data):
        job, _, key = record.partition(":")
        store = stores.get(job)
        if store is not None and store.has(key):
            del failures.data[record]
            removed.append(record)
    if removed:
        failures.flush()
    return {"removed": len(removed), "remaining": len(failures.data), "keys": removed}


class CacheStore:
    def __init__(self, path: Path):
        self.path = path
        self.data: dict = self._read()

    def _read(self) -> dict:
        if self.path.exists():
            return json.loads(self.path.read_text(encoding="utf-8"))
        return {}

    def has(self, key: str) -> bool:
        return key in self.data

    def put(self, key: str, value) -> None:
        self.data[key] = value
        self.flush()

    def flush(self) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        tmp = self.path.with_suffix(".tmp")
        tmp.write_text(
            json.dumps(self.data, ensure_ascii=False, indent=1),
            encoding="utf-8",
            newline="\n",
        )
        tmp.replace(self.path)


class BatchRunner:
    def __init__(self, engine: AIEngine | None = None, pause: float = 0.4):
        self.engine = engine or AIEngine()
        self.pause = pause
        CACHE_DIR.mkdir(parents=True, exist_ok=True)
        self.wildcards = CacheStore(CACHE_DIR / "wildcards.json")
        self.blindboxes = CacheStore(CACHE_DIR / "blindboxes.json")
        self.variants = CacheStore(CACHE_DIR / "variants.json")
        self.ideas = CacheStore(CACHE_DIR / "ideas.json")
        self.failures = CacheStore(CACHE_DIR / "failures.json")

    def _sleep(self) -> None:
        if self.pause:
            time.sleep(self.pause)

    def _attempt(self, job: str, key: str, store: CacheStore, producer) -> str:
        """Run one resilient item; return 'done' | 'skipped' | 'failed'."""
        if store.has(key):
            return "skipped"
        try:
            store.put(key, producer())
        except Exception as exc:  # keep the batch alive; record for later review
            self.failures.put(f"{job}:{key}", {"error": str(exc)})
            return "failed"
        self._sleep()
        return "done"

    @staticmethod
    def _tally(actions: list[str]) -> tuple[int, int, int]:
        return (
            actions.count("done"),
            actions.count("skipped"),
            actions.count("failed"),
        )

    # --- jobs ---------------------------------------------------------------

    def run_wildcards(self, limit: int | None = None) -> tuple[int, int, int]:
        combos = WILDCARD_COMBOS if limit is None else WILDCARD_COMBOS[:limit]
        actions = [
            self._attempt(
                "wildcards",
                combo_key(combo),
                self.wildcards,
                lambda c=combo: self.engine.generate_wildcard(c).to_dict(),
            )
            for combo in combos
        ]
        return self._tally(actions)

    def run_blindboxes(self, limit: int | None = None) -> tuple[int, int, int]:
        combos = BLINDBOX_COMBOS if limit is None else BLINDBOX_COMBOS[:limit]
        actions = [
            self._attempt(
                "blindboxes",
                combo_key(combo),
                self.blindboxes,
                lambda c=combo: self.engine.generate_blindbox(c).to_dict(),
            )
            for combo in combos
        ]
        return self._tally(actions)

    def run_ideas(self, limit: int | None = None) -> tuple[int, int, int]:
        recipes = load_recipes()
        if limit is not None:
            recipes = recipes[:limit]
        actions = [
            self._attempt(
                "ideas",
                base.id,
                self.ideas,
                lambda b=base: {"ideas": self.engine.generate_ideas(b)},
            )
            for base in recipes
        ]
        return self._tally(actions)

    def run_variants(
        self,
        kinds: list[str] | None = None,
        recipe_limit: int | None = None,
    ) -> tuple[int, int, int]:
        kinds = kinds or list(VARIANT_KINDS)
        bases = load_recipes()
        if recipe_limit is not None:
            bases = bases[:recipe_limit]
        actions = []
        for base in bases:
            for kind in kinds:
                key = f"{base.id}:{kind}"
                actions.append(
                    self._attempt(
                        "variants",
                        key,
                        self.variants,
                        lambda b=base, k=kind:
                            self.engine.generate_variant(b, k).to_dict(),
                    )
                )
        return self._tally(actions)
