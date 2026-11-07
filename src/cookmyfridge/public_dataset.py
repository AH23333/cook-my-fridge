"""Import external public recipe datasets into the validated static corpus.

CookMyFridge ships a hand-curated corpus; this module is the *pipeline* for
adding third-party data without letting it bypass the project's guardrails:

* only catalog ingredients survive (unknown names go to a review report),
* every record must pass ``validate_recipe`` (controlled vocabularies),
* titles/ids are de-duplicated against the curated corpus,
* source and license are attached explicitly, never guessed,
* ``--dry-run`` reports what *would* happen without touching any file.

Supported shapes (auto-detected by extension):

``.jsonl``  one JSON object per line, e.g. Recipe1M-style normalised records
``.csv``    Food.com RAW_recipes-style with list-valued cells written as
            Python list literals (``"['flour', '2 eggs']"``)

Typical column names are mapped case-insensitively; see ``FIELD_ALIASES``.
No third-party dataset is bundled: licenses differ and must be supplied by
the operator with ``--license`` / ``--dataset``. See ``data/raw/README.md``.
"""
from __future__ import annotations

import ast
import csv
import hashlib
import json
import re
from collections import Counter
from pathlib import Path
from typing import Any, Iterable

from .catalog import allergens_of, canonical_set
from .config import CATALOG_DIR
from .dataset import AI_DISCLAIMER, IMPORTED_FILE, METHOD_SAFETY, load_shipped_recipes
from .models import COOKING_METHODS, DIFFICULTIES, KNOWN_TAGS, IngredientUse, Recipe
from .normalize import normalize_strict
from .validate import validate_recipe

UNMAPPED_FILE = CATALOG_DIR / "unmapped_ingredients.json"
DEFAULT_LICENSE = "未标注许可，仅限本地评估"

FIELD_ALIASES: dict[str, tuple[str, ...]] = {
    "title": ("title", "name", "recipe_name", "recipeName", "dish"),
    "ingredients": ("ingredients", "ingredient_list", "ner", "items"),
    "steps": ("steps", "directions", "instructions", "recipeInstructions"),
    "minutes": ("minutes", "time_minutes", "time", "total_time", "cook_time"),
    "methods": ("methods", "cooking_methods"),
    "tags": ("tags", "labels", "categories"),
    "difficulty": ("difficulty", "level"),
    "cuisine": ("cuisine", "cuisine_type"),
    "cookware": ("cookware", "equipment"),
}

METHOD_KEYWORDS: tuple[tuple[str, tuple[str, ...]], ...] = (
    ("炒", ("炒", "爆香", "翻炒", "煸")),
    ("蒸", ("蒸", "上汽")),
    ("炸", ("油炸", "炸至", "下油锅炸")),
    ("空气炸锅", ("空气炸锅",)),
    ("微波炉", ("微波炉", "微波")),
    ("电饭煲", ("电饭煲",)),
    ("烤", ("烤箱", "烘烤", "烤至")),
    ("煎", ("煎",)),
    ("炖", ("炖", "焖", "红烧", "小火慢")),
    ("凉拌", ("凉拌", "拌匀", "拌入")),
    ("免开火", ("免开火", "不用开火", "无需加热", "冷藏")),
    ("煮", ("煮", "焯", "烧开", "沸水")),
)

_AMOUNT_RE = re.compile(
    r"(\d+(?:\.\d+)?\s*(?:克|g|G|千克|kg|斤|毫升|ml|升|L|勺|汤匙|茶匙|大勺|小勺"
    r"|个|片|根|把|块|瓣|粒|颗|条|只|支|袋|罐|瓶|盒|包|杯|碗|份))"
    r"|(半\s*(?:个|根|块|盒|勺|杯|碗))"
    r"|(少许|适量|若干)"
)
_STRIP_TRAILING = re.compile(r"[，,。.；;\s]+$")


def _value(row: dict, field: str) -> Any:
    lowered = {str(k).lower(): v for k, v in row.items()}
    for alias in FIELD_ALIASES[field]:
        if alias.lower() in lowered and lowered[alias.lower()] not in (None, ""):
            return lowered[alias.lower()]
    return None


def parse_list(value: Any) -> list[Any]:
    """Coerce a CSV/JSON list cell into a list, preserving dict ingredient rows."""
    if value is None:
        return []
    if isinstance(value, (list, tuple)):
        items: Iterable = value
    elif isinstance(value, str):
        text = value.strip()
        if not text:
            return []
        if text[0] in "[(":
            try:
                parsed = ast.literal_eval(text)
                items = parsed if isinstance(parsed, (list, tuple)) else [str(parsed)]
            except (ValueError, SyntaxError):
                items = re.split(r"[\n;]+", text)
        else:
            items = re.split(r"[\n;]+", text)
    else:
        items = [value]
    return [
        x if isinstance(x, dict) else str(x).strip()
        for x in items
        if x is not None and (isinstance(x, dict) or str(x).strip())
    ]


def _as_str_list(value: Any) -> list[str]:
    return [str(x) for x in parse_list(value) if not isinstance(x, dict)]


def _amount_of(raw: str) -> str:
    match = _AMOUNT_RE.search(raw)
    return match.group(0).replace(" ", "") if match else "适量"


def _ingredient_line(raw: Any, known: set[str]) -> tuple[IngredientUse | None, str | None]:
    """Return (ingredient, unmapped_name). Exactly one of the two is non-None."""
    raw_name = str(raw.get("name", raw.get("canonical", ""))) if isinstance(raw, dict) else str(raw)
    raw_name = raw_name.strip()
    if not raw_name:
        return None, ""
    canonical = normalize_strict(raw_name)
    if not canonical or canonical not in known:
        return None, _STRIP_TRAILING.sub("", raw_name)
    amount = str(raw.get("amount", "")) if isinstance(raw, dict) else ""
    if not amount:
        amount = _amount_of(raw_name)
    return IngredientUse(name=raw_name, canonical=canonical, amount=amount), None


def _infer_methods(steps: list[str], supplied: Any) -> list[str]:
    given = [m for m in _as_str_list(supplied) if m in COOKING_METHODS]
    if given:
        return list(dict.fromkeys(given))[:3]
    text = " ".join(steps)
    found = [method for method, words in METHOD_KEYWORDS if any(w in text for w in words)]
    return (found or ["煮"])[:3]


def _minutes(value: Any, steps: list[str]) -> int:
    try:
        n = int(float(str(value).strip()))
    except (TypeError, ValueError):
        n = 0
    if 1 <= n <= 240:
        return n
    return max(10, min(15 * len(steps), 60))


def _clean_steps(raw: Any) -> list[str]:
    steps: list[str] = []
    for line in _as_str_list(raw):
        text = _STRIP_TRAILING.sub("", re.sub(r"\s+", " ", line)).strip()
        if len(text) < 4:
            continue
        steps.append(text[:200])
        if len(steps) >= 10:
            break
    return steps


def map_record(
    row: dict,
    *,
    dataset: str,
    license_name: str,
    known: set[str],
    existing_titles: set[str],
    index: int = 0,
) -> tuple[Recipe | None, str, list[str]]:
    """Map one raw record. Returns (recipe_or_none, skip_reason, unmapped)."""
    title = str(_value(row, "title") or "").strip()
    if not title:
        return None, "missing_title", []
    if len(title) > 40:
        return None, "title_too_long", []
    if title in existing_titles:
        return None, "duplicate_title", []

    raw_ingredients = parse_list(_value(row, "ingredients"))
    if len(raw_ingredients) < 2:
        return None, "too_few_ingredients", []
    uses: list[IngredientUse] = []
    unmapped: list[str] = []
    seen: set[str] = set()
    for raw in raw_ingredients:
        use, unknown = _ingredient_line(raw, known)
        if use is None:
            if unknown:
                unmapped.append(unknown)
            continue
        if use.canonical in seen:
            continue
        seen.add(use.canonical)
        uses.append(use)
    if unmapped or len(uses) < 2:
        return None, "unknown_ingredient" if unmapped else "too_few_ingredients", unmapped

    steps = _clean_steps(_value(row, "steps"))
    if len(steps) < 2:
        return None, "too_few_steps", []

    methods = _infer_methods(steps, _value(row, "methods"))
    tags = [t for t in _as_str_list(_value(row, "tags")) if t in KNOWN_TAGS]
    minutes = _minutes(_value(row, "minutes"), steps)
    if minutes <= 15 and "快手" not in tags:
        tags.append("快手")
    difficulty_raw = str(_value(row, "difficulty") or "简单")
    difficulty = difficulty_raw if difficulty_raw in DIFFICULTIES else "简单"
    allergens: set[str] = set()
    for use in uses:
        allergens.update(allergens_of(use.canonical))
    safety = [AI_DISCLAIMER] if "AI" in dataset.upper() else []
    for method in methods:
        note = METHOD_SAFETY.get(method)
        if note and note not in safety:
            safety.append(note)

    digest = hashlib.sha1(f"{dataset}:{title}".encode("utf-8")).hexdigest()[:10]
    recipe = Recipe(
        id=f"pub-{digest}",
        title=title,
        ingredients=uses,
        steps=steps,
        methods=methods,
        cuisine=str(_value(row, "cuisine") or "")[:30],
        time_minutes=minutes,
        difficulty=difficulty,
        cookware=_as_str_list(_value(row, "cookware"))[:4],
        tags=tags[:6],
        allergens=sorted(allergens),
        safety_notes=safety,
        source=f"公开数据集：{dataset}（离线导入）",
        license=license_name,
        is_ai_generated=False,
    )
    result = validate_recipe(recipe)
    if not result.ok:
        return None, "validation:" + ";".join(result.errors[:2]), []
    return recipe, "", []


def read_records(path: Path, fmt: str = "auto", limit: int | None = None) -> list[dict]:
    """Read JSONL or CSV records. Raises ValueError on unsupported formats."""
    suffix = path.suffix.lower()
    if fmt == "auto":
        fmt = "jsonl" if suffix in (".jsonl", ".ndjson", ".json") else "csv" if suffix == ".csv" else ""
    if fmt not in ("jsonl", "csv"):
        raise ValueError(f"无法识别的数据格式（用 --format jsonl|csv）: {path.name}")
    rows: list[dict] = []
    if fmt == "jsonl":
        for line in path.read_text(encoding="utf-8").splitlines():
            if not line.strip():
                continue
            try:
                value = json.loads(line)
            except json.JSONDecodeError:
                continue
            if isinstance(value, dict):
                rows.append(value)
    else:
        with path.open("r", encoding="utf-8-sig", newline="") as fh:
            for row in csv.DictReader(fh):
                rows.append(dict(row))
    return rows[:limit] if limit else rows


def _load_existing(path: Path) -> list[dict]:
    if not path.exists():
        return []
    out = []
    for line in path.read_text(encoding="utf-8").splitlines():
        if line.strip():
            try:
                out.append(json.loads(line))
            except json.JSONDecodeError:
                continue
    return out


def _atomic_write_text(path: Path, text: str) -> None:
    """Write via a sibling tmp file so a crash never truncates the target."""
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(text, encoding="utf-8", newline="\n")
    tmp.replace(path)


def import_dataset(
    source: Path,
    *,
    dataset: str = "未命名数据集",
    license_name: str = DEFAULT_LICENSE,
    fmt: str = "auto",
    limit: int | None = None,
    dry_run: bool = False,
    imported_path: Path = IMPORTED_FILE,
    unmapped_path: Path = UNMAPPED_FILE,
) -> dict:
    """Validate and append records. Never mutates files when ``dry_run``."""
    rows = read_records(source, fmt, limit)
    known = canonical_set()
    existing_titles = {r.title for r in load_shipped_recipes()}
    existing = _load_existing(imported_path)
    existing_ids = {str(row.get("id")) for row in existing}
    reasons: Counter[str] = Counter()
    unmapped: Counter[str] = Counter()
    accepted: list[dict] = []

    for index, row in enumerate(rows):
        recipe, reason, unknowns = map_record(
            row, dataset=dataset, license_name=license_name,
            known=known, existing_titles=existing_titles, index=index,
        )
        for name in unknowns:
            unmapped[name] += 1
        if recipe is None:
            reasons[reason] += 1
            continue
        if recipe.id in existing_ids:
            reasons["duplicate_id"] += 1
            continue
        existing_ids.add(recipe.id)
        existing_titles.add(recipe.title)
        accepted.append(recipe.to_dict())

    report = {
        "total": len(rows),
        "imported": len(accepted),
        "skipped": len(rows) - len(accepted),
        "reasons": dict(sorted(reasons.items())),
        "unmapped": dict(sorted(unmapped.items(), key=lambda kv: (-kv[1], kv[0]))),
        "dry_run": bool(dry_run),
        "target": str(imported_path),
    }
    if dry_run:
        return report

    merged = {str(row.get("id")): row for row in existing}
    for row in accepted:
        merged[row["id"]] = row
    lines = [json.dumps(merged[key], ensure_ascii=False) for key in sorted(merged)]
    _atomic_write_text(
        imported_path, "\n".join(lines) + ("\n" if lines else "")
    )
    _atomic_write_text(
        unmapped_path,
        json.dumps(
            {
                "note": "以下名称未收录进食材目录，相关菜谱未被导入；人工确认后可加同义词或目录条目。",
                "dataset": dataset,
                "items": [
                    {"name": name, "count": count}
                    for name, count in sorted(unmapped.items(), key=lambda kv: (-kv[1], kv[0]))
                ],
            },
            ensure_ascii=False,
            indent=2,
        ) + "\n",
    )
    report["total_imported_file"] = len(merged)
    return report
