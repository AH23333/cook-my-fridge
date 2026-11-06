"""Structural and vocabulary validation for recipes (used by both curated
authoring and the AI pipeline; only validated records are shipped)."""
from __future__ import annotations

from dataclasses import dataclass

from .catalog import is_known
from .models import (
    COOKING_METHODS,
    DIFFICULTIES,
    INGREDIENT_CATEGORIES,
    KNOWN_TAGS,
    Recipe,
)


@dataclass
class ValidationResult:
    errors: list[str]

    @property
    def ok(self) -> bool:
        return not self.errors


def validate_recipe(recipe: Recipe, strict_ingredients: bool = True) -> ValidationResult:
    errors: list[str] = []

    if not recipe.id:
        errors.append("id 不能为空")
    if not recipe.title:
        errors.append("title 不能为空")
    if not recipe.ingredients:
        errors.append("ingredients 至少包含 1 项")
    if not recipe.steps:
        errors.append("steps 至少包含 1 步")
    if not recipe.methods:
        errors.append("methods 至少包含 1 种烹饪方式")

    seen_canonical: set[str] = set()
    for idx, ing in enumerate(recipe.ingredients):
        if not ing.name:
            errors.append(f"ingredients[{idx}] 缺少 name")
        if not ing.canonical:
            errors.append(f"ingredients[{idx}] 缺少 canonical")
        elif strict_ingredients and not is_known(ing.canonical):
            errors.append(f"ingredients[{idx}] canonical 不在食材白名单: {ing.canonical}")
        if ing.canonical in seen_canonical:
            errors.append(f"ingredients[{idx}] 食材重复: {ing.canonical}")
        seen_canonical.add(ing.canonical)

    for method in recipe.methods:
        if method not in COOKING_METHODS:
            errors.append(f"未知烹饪方式: {method}（合法值: {list(COOKING_METHODS)}）")

    if recipe.difficulty not in DIFFICULTIES:
        errors.append(f"未知难度: {recipe.difficulty}")
    if recipe.time_minutes < 0:
        errors.append("time_minutes 不能为负")

    for tag in recipe.tags:
        if tag not in KNOWN_TAGS:
            errors.append(f"未知标签: {tag}")

    if recipe.is_ai_generated and not recipe.safety_notes:
        errors.append("AI 生成菜谱必须包含 safety_notes")

    return ValidationResult(errors)


def vocabulary_snapshot() -> dict:
    """Expose controlled vocabularies for tooling/frontend checks."""
    return {
        "categories": list(INGREDIENT_CATEGORIES),
        "methods": list(COOKING_METHODS),
        "difficulties": list(DIFFICULTIES),
        "tags": list(KNOWN_TAGS),
    }
