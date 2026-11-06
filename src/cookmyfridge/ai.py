"""AI creativity engine (the wildcard half): structured generation, ingredient
whitelist enforcement, validation and mandatory safety labeling."""
from __future__ import annotations

import uuid

from .catalog import allergens_of
from .dataset import AI_DISCLAIMER, METHOD_SAFETY
from .llm import LLMClient, LLMError
from .models import (
    COOKING_METHODS,
    KNOWN_TAGS,
    METHOD_ALIASES,
    TAG_ALIASES,
    IngredientUse,
    Recipe,
)
from .normalize import normalize_strict
from .validate import validate_recipe

SYSTEM_PROMPT = (
    "你是一名严谨的家庭料理创意师。你只能使用给定食材目录中的标准食材名，"
    "禁止编造目录外食材，禁止建议生食或不安全做法。所有回复必须是一个合法 JSON，"
    "不要输出 markdown 围栏或任何解释文字。"
)

RECIPE_SCHEMA_HINT = (
    "JSON 结构：\n"
    "{\n"
    '  "title": "菜名",\n'
    '  "ingredients": [{"name": "目录标准食材名", "amount": "用量"}],\n'
    '  "steps": ["步骤1", "步骤2"],\n'
    '  "methods": ["炒|煮|蒸|烤|煎|炸|炖|凉拌|微波炉|电饭煲|空气炸锅|免开火"],\n'
    '  "cookware": ["厨具"],\n'
    '  "time_minutes": 15,\n'
    '  "difficulty": "简单|中等|较难",\n'
    f'  "tags": ["只能从以下选择：{ "|".join(KNOWN_TAGS) }"],\n'
    '  "risks": ["这道菜的风险提示"],\n'
    '  "creative_note": "创意说明，点出这道菜的灵感和搭配理由"\n'
    "}"
)


class AIGenerationError(LLMError):
    pass


def _as_list(value):
    """Coerce a scalar model value into a list. A raw string must be wrapped,
    never iterated character by character."""
    if value is None:
        return []
    if isinstance(value, list):
        return value
    return [value]


def _recipe_from_payload(
    payload: dict,
    recipe_id: str,
    *,
    include_ingredients: set[str] | None = None,
) -> Recipe:
    """Convert a validated AI payload into a Recipe, enforcing the whitelist."""
    raw_ingredients = payload.get("ingredients", [])
    if not isinstance(raw_ingredients, list):
        raise AIGenerationError("ingredients 必须是数组")

    ingredient_uses: list[IngredientUse] = []
    unknown: list[str] = []
    seen: set[str] = set()
    for row in raw_ingredients:
        raw_name = str(row.get("name", "")).strip()
        canonical = normalize_strict(raw_name)
        if canonical is None:
            unknown.append(raw_name)
            continue
        if canonical in seen:
            continue
        seen.add(canonical)
        ingredient_uses.append(
            IngredientUse(
                name=raw_name,
                canonical=canonical,
                amount=str(row.get("amount", "")),
                optional=bool(row.get("optional", False)),
            )
        )
    if unknown:
        raise AIGenerationError(f"模型使用了目录外食材: {unknown}")

    include_ingredients = include_ingredients or set()
    missing_context = [c for c in include_ingredients if c not in seen]
    if missing_context:
        raise AIGenerationError(
            f"生成结果没有覆盖指定食材: {missing_context}"
        )

    allergen_set: set[str] = set()
    for use in ingredient_uses:
        allergen_set.update(allergens_of(use.canonical))

    def _normalize_list(values, aliases):
        normalized = []
        for value in values:
            key = str(value).strip()
            key = aliases.get(key, key)
            if key not in normalized:
                normalized.append(key)
        return normalized

    methods = _normalize_list(_as_list(payload.get("methods")), METHOD_ALIASES)
    # A method name sometimes lands in the tags slot; keep only real tags.
    tags = [
        t
        for t in _normalize_list(_as_list(payload.get("tags")), TAG_ALIASES)
        if t not in COOKING_METHODS
    ]
    safety_notes = [AI_DISCLAIMER]
    for risk in _as_list(payload.get("risks")):
        text = str(risk).strip()
        if not text or text in ("无", "没有", "无风险", "暂无"):
            continue
        if text not in safety_notes:
            safety_notes.append(text)
    for method in methods:
        note = METHOD_SAFETY.get(method)
        if note and note not in safety_notes:
            safety_notes.append(note)

    recipe = Recipe(
        id=recipe_id,
        title=str(payload.get("title", "未命名创意菜")),
        ingredients=ingredient_uses,
        steps=[str(s) for s in _as_list(payload.get("steps"))],
        methods=[str(m) for m in methods],
        cuisine=str(payload.get("cuisine", "AI 创意")),
        time_minutes=int(payload.get("time_minutes", 0) or 0),
        difficulty=str(payload.get("difficulty", "简单")),
        cookware=[str(c) for c in _as_list(payload.get("cookware"))],
        tags=tags,
        allergens=sorted(allergen_set),
        safety_notes=safety_notes,
        source="GLM AI 生成（glm-4-flash）",
        license="AI-generated, see About",
        is_ai_generated=True,
    )
    result = validate_recipe(recipe)
    if not result.ok:
        raise AIGenerationError(f"AI 菜谱校验失败: {result.errors}")
    return recipe


class AIEngine:
    def __init__(self, client: LLMClient | None = None):
        self.client = client or LLMClient()

    def _generate_recipe(
        self,
        user_instruction: str,
        recipe_id: str,
        include_ingredients: set[str] | None = None,
        retries: int = 2,
    ) -> Recipe:
        """Full closed loop: call -> whitelist/validate -> retry with feedback."""
        messages = [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": f"{RECIPE_SCHEMA_HINT}\n\n任务：{user_instruction}"},
        ]
        last_error = ""
        for _ in range(retries + 1):
            payload = self.client.chat_json(messages, temperature=0.4)
            try:
                return _recipe_from_payload(
                    payload, recipe_id, include_ingredients=include_ingredients
                )
            except AIGenerationError as exc:
                last_error = str(exc)
                messages = messages + [
                    {
                        "role": "user",
                        "content": f"上一版有问题：{last_error}。请严格按要求修正，重新输出完整 JSON。",
                    },
                ]
        raise AIGenerationError(f"多次重试仍失败：{last_error}")

    def generate_wildcard(
        self,
        selected: list[str],
        recipe_id: str | None = None,
        extra_brief: str = "",
    ) -> Recipe:
        recipe_id = recipe_id or f"ai-wild-{uuid.uuid4().hex[:10]}"
        joined = "、".join(selected)
        instruction = (
            f"用户冰箱里有：{joined}。请围绕这些食材发明一道数据集里没有的创意家常菜，"
            "食材必须全部来自目录且以用户已有食材为主，可补充常见调料。"
            f"{extra_brief}"
        )
        return self._generate_recipe(
            instruction, recipe_id, include_ingredients=set(selected)
        )

    def generate_blindbox(
        self, selected: list[str], recipe_id: str | None = None
    ) -> Recipe:
        recipe_id = recipe_id or f"ai-blind-{uuid.uuid4().hex[:10]}"
        joined = "、".join(selected)
        instruction = (
            f"冰箱盲盒随机食材是：{joined}。请设计一道有趣、可执行、适合拍照分享的创意菜，"
            "食材名必须来自目录，步骤控制在 5 步以内。"
        )
        return self._generate_recipe(
            instruction, recipe_id, include_ingredients=set(selected)
        )

    def generate_variant(
        self,
        base: Recipe,
        kind: str,
        recipe_id: str | None = None,
    ) -> Recipe:
        recipe_id = recipe_id or f"ai-var-{base.id}-{kind}"
        briefs = {
            "lazy": "给我一个步骤更少、能偷懒的懒人版。",
            "lowcal": "给我一个低卡减脂版，减少油糖，多用蒸煮。",
            "airfryer": "改成用空气炸锅完成的版本，给出温度和时间。",
            "substitute": "换掉可能没有的食材，全部改用目录里常见易得的食材。",
            "method": "换一种完全不同的烹饪方式重做这道菜。",
            "leftover": "假设这是剩菜，给一个剩菜改造方案。",
            "fusion": "融合一个别的菜系的风味和调味，做出融合菜版本。",
        }
        brief = briefs.get(kind)
        if brief is None:
            raise AIGenerationError(f"未知变体类型: {kind}")
        title_suffix = {
            "lazy": "懒人版",
            "lowcal": "低卡版",
            "airfryer": "空气炸锅版",
            "substitute": "家常替代版",
            "method": "换做法版",
            "leftover": "剩菜改造版",
            "fusion": "融合版",
        }[kind]
        base_ingredients = [
            f"{i.canonical}（{i.amount}）" for i in base.ingredients
        ]
        instruction = (
            f"基于菜谱《{base.title}》，原食材：{ '、'.join(base_ingredients) }，"
            f"原做法：{ '；'.join(base.steps) }。{brief} "
            f"新菜的标题必须与原菜不同，命名为「{title_suffix}{base.title}」这种形式。"
            "输出一个完整的新菜谱 JSON，食材名必须来自目录。"
        )
        return self._generate_recipe(instruction, recipe_id)

    def generate_ideas(self, base: Recipe, n: int = 3) -> list[str]:
        instruction = (
            f"针对菜谱《{base.title}》，给我 {n} 个数据集里没有的新吃法/新搭配主意，"
            "每个一句话，具体可执行。只输出 JSON：{\"ideas\": [\"...\"]}"
        )
        payload = self.client.chat_json(
            [
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": instruction},
            ],
            temperature=0.6,
        )
        ideas = _as_list(payload.get("ideas"))
        if len(ideas) < n:
            raise AIGenerationError("ideas 字段格式或数量不符")
        return [str(x) for x in ideas[:n]]


VARIANT_KINDS = ("lazy", "lowcal", "airfryer", "substitute", "method", "leftover", "fusion")
