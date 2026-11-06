"""Dataset build/load pipeline for curated recipes."""
from __future__ import annotations

import json
from pathlib import Path

from .catalog import allergens_of
from .curated_data import SPECS
from .models import IngredientUse, Recipe
from .validate import validate_recipe
from .config import CURATED_DIR

CURATED_FILE = CURATED_DIR / "base_recipes.jsonl"

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
    recipes = [_build_recipe(spec) for spec in SPECS]
    for recipe in recipes:
        result = validate_recipe(recipe)
        if not result.ok:
            raise ValueError(f"{recipe.id} {recipe.title} 校验失败: {result.errors}")
    return recipes


def write_curated(path: Path = CURATED_FILE) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8", newline="\n") as fh:
        for recipe in build_curated_recipes():
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


def load_all_recipes(curated_path: Path = CURATED_FILE) -> list[Recipe]:
    """Load every shipped recipe file (curated + AI-generated shards)."""
    recipes = load_recipes(curated_path)
    ai_file = CURATED_DIR / "ai_recipes.jsonl"
    if ai_file.exists():
        for line in ai_file.read_text(encoding="utf-8").splitlines():
            if line.strip():
                recipes.append(Recipe.from_dict(json.loads(line)))
    return recipes
