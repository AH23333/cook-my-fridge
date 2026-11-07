"""Dataset build/load pipeline for curated recipes."""
from __future__ import annotations

import json
from pathlib import Path

from .catalog import allergens_of
from .curated_data import SPECS
from .curated_data2 import SPECS_BATCH2
from .curated_data3 import SPECS_BATCH3
from .curated_data4 import SPECS_BATCH4
from .curated_data5 import SPECS_BATCH5
from .curated_data6 import SPECS_BATCH6
from .curated_data7 import SPECS_BATCH7
from .curated_data8 import SPECS_BATCH8
from .curated_data9 import SPECS_BATCH9
from .curated_data10 import SPECS_BATCH10
from .curated_data11 import SPECS_BATCH11
from .curated_data12 import SPECS_BATCH12
from .curated_data13 import SPECS_BATCH13

ALL_SPECS = (
    SPECS
    + SPECS_BATCH2
    + SPECS_BATCH3
    + SPECS_BATCH4
    + SPECS_BATCH5
    + SPECS_BATCH6
    + SPECS_BATCH7
    + SPECS_BATCH8
    + SPECS_BATCH9
    + SPECS_BATCH10
    + SPECS_BATCH11
    + SPECS_BATCH12
    + SPECS_BATCH13
)
from .models import IngredientUse, Recipe
from .validate import validate_recipe
from .config import CURATED_DIR

CURATED_FILE = CURATED_DIR / "base_recipes.jsonl"
# Public-dataset imports are kept in a separate shard so re-running `run.py
# data` never overwrites third-party records (or their provenance/license).
IMPORTED_FILE = CURATED_DIR / "imported_recipes.jsonl"

# Method-specific standard safety notes.
METHOD_SAFETY: dict[str, str] = {
    "炸": "油炸时注意油温，食材需沥干水分再下锅，防止溅油烫伤，不要让儿童单独操作。",
    "炖": "炖煮注意用火时长，离人关火；高压锅使用前检查密封圈和排气阀。",
    "煮": "煮制海鲜和肉类务必彻底熟透，避免寄生虫和细菌风险。",
    "蒸": "蒸制注意水蒸气烫伤，开盖时脸不要正对蒸锅。",
}

AI_DISCLAIMER = "AI 创意菜，未经过人工实测。请确保食材新鲜、彻底加热，注意过敏原。"


def _build_recipe(spec: dict) -> Recipe:
    ingredient_uses: list[IngredientUse] = []
    allergen_set: set[str] = set()
    for item in spec["ingredients"]:
        if len(item) == 3:
            canonical, amount, optional = item
        else:
            canonical, amount = item
            optional = False
        ingredient_uses.append(
            IngredientUse(
                name=canonical,
                canonical=canonical,
                amount=amount,
                optional=optional,
            )
        )
        allergen_set.update(allergens_of(canonical))

    safety_notes = list(spec.get("safety", []))
    for method in spec["methods"]:
        note = METHOD_SAFETY.get(method)
        if note and note not in safety_notes:
            safety_notes.append(note)

    return Recipe(
        id=spec["id"],
        title=spec["title"],
        ingredients=ingredient_uses,
        steps=spec["steps"],
        methods=spec["methods"],
        cuisine=spec.get("cuisine", ""),
        time_minutes=spec.get("time_minutes", 0),
        difficulty=spec.get("difficulty", "简单"),
        cookware=spec.get("cookware", []),
        tags=spec.get("tags", []),
        allergens=sorted(allergen_set),
        safety_notes=safety_notes,
        source=spec.get("source", "CookMyFridge 人工策展"),
        license=spec.get("license", "CC BY 4.0"),
        is_ai_generated=False,
    )


def build_curated_recipes() -> list[Recipe]:
    recipes = [_build_recipe(spec) for spec in ALL_SPECS]
    for recipe in recipes:
        result = validate_recipe(recipe)
        if not result.ok:
            raise ValueError(f"{recipe.id} {recipe.title} 校验失败: {result.errors}")
    return recipes


def write_curated(path: Path = CURATED_FILE) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    recipes = build_curated_recipes()
    with path.open("w", encoding="utf-8", newline="\n") as fh:
        for recipe in recipes:
            fh.write(json.dumps(recipe.to_dict(), ensure_ascii=False) + "\n")
    return path


def load_recipes(path: Path = CURATED_FILE) -> list[Recipe]:
    if not path.exists():
        write_curated(path)
    recipes = []
    for line in path.read_text(encoding="utf-8").splitlines():
        if line.strip():
            recipes.append(Recipe.from_dict(json.loads(line)))
    return recipes


def _read_recipe_lines(path: Path) -> list[Recipe]:
    """Parse a recipe shard, skipping corrupt lines instead of crashing.

    The imported shard is written by an external pipeline; one truncated line
    (e.g. an interrupted write) must not take down the whole site build.
    """
    recipes = []
    for line in path.read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        try:
            recipes.append(Recipe.from_dict(json.loads(line)))
        except (json.JSONDecodeError, KeyError, TypeError):
            continue
    return recipes


def load_shipped_recipes(
    curated_path: Path = CURATED_FILE, imported_path: Path = IMPORTED_FILE
) -> list[Recipe]:
    """Curated corpus plus validated public-dataset imports shipped to site/.

    The two shards are independent: base_recipes.jsonl is regenerated from
    SPECS, imported_recipes.jsonl is written only by the import pipeline.
    Imported rows losing an id/title collision are ignored, never merged in.
    """
    recipes = load_recipes(curated_path)
    if not imported_path.exists():
        return recipes
    seen_ids = {r.id for r in recipes}
    seen_titles = {r.title for r in recipes}
    for recipe in _read_recipe_lines(imported_path):
        if recipe.id in seen_ids or recipe.title in seen_titles:
            continue
        recipes.append(recipe)
        seen_ids.add(recipe.id)
        seen_titles.add(recipe.title)
    return recipes


def load_all_recipes(curated_path: Path = CURATED_FILE) -> list[Recipe]:
    """Load every shipped recipe file (curated + imported + AI shards)."""
    recipes = load_shipped_recipes(curated_path)
    ai_file = CURATED_DIR / "ai_recipes.jsonl"
    if ai_file.exists():
        for line in ai_file.read_text(encoding="utf-8").splitlines():
            if line.strip():
                recipes.append(Recipe.from_dict(json.loads(line)))
    return recipes
