"""Core domain models and the canonical controlled vocabularies."""
from __future__ import annotations

from dataclasses import asdict, dataclass, field

# --- Controlled vocabularies -------------------------------------------------

INGREDIENT_CATEGORIES: tuple[str, ...] = (
    "蔬菜",
    "肉蛋",
    "水产",
    "主食",
    "豆乳",
    "调料",
    "水果",
    "冷冻食品",
)

COOKING_METHODS: tuple[str, ...] = (
    "炒",
    "煮",
    "蒸",
    "烤",
    "煎",
    "炸",
    "炖",
    "凉拌",
    "微波炉",
    "电饭煲",
    "空气炸锅",
    "免开火",
)

DIFFICULTIES: tuple[str, ...] = ("简单", "中等", "较难")

# Default tags used across the dataset and the AI batch jobs.
KNOWN_TAGS: tuple[str, ...] = (
    "快手",
    "低卡",
    "下饭",
    "一人食",
    "早餐",
    "夜宵",
    "素食",
    "剩菜改造",
    "空气炸锅",
    "免开火",
    "宝宝辅食",
    "减脂餐",
)


# --- Data classes ------------------------------------------------------------

@dataclass
class IngredientUse:
    """One ingredient line in a recipe."""

    name: str                       # raw text as authored, e.g. "西红柿（番茄也行）"
    canonical: str                  # standardized ingredient name
    amount: str = ""                # free-text quantity, e.g. "2 个" / "适量"
    optional: bool = False

    def to_dict(self) -> dict:
        return asdict(self)

    @classmethod
    def from_dict(cls, data: dict) -> "IngredientUse":
        return cls(
            name=str(data["name"]),
            canonical=str(data["canonical"]),
            amount=str(data.get("amount", "")),
            optional=bool(data.get("optional", False)),
        )


@dataclass
class Recipe:
    id: str
    title: str
    ingredients: list[IngredientUse]
    steps: list[str]
    methods: list[str]
    cuisine: str = ""
    time_minutes: int = 0
    difficulty: str = "简单"
    cookware: list[str] = field(default_factory=list)
    tags: list[str] = field(default_factory=list)
    allergens: list[str] = field(default_factory=list)
    safety_notes: list[str] = field(default_factory=list)
    source: str = ""
    license: str = ""
    is_ai_generated: bool = False

    def to_dict(self) -> dict:
        data = asdict(self)
        data["ingredients"] = [i.to_dict() for i in self.ingredients]
        return data

    @classmethod
    def from_dict(cls, data: dict) -> "Recipe":
        return cls(
            id=str(data["id"]),
            title=str(data["title"]),
            ingredients=[IngredientUse.from_dict(i) for i in data["ingredients"]],
            steps=[str(s) for s in data.get("steps", [])],
            methods=[str(m) for m in data.get("methods", [])],
            cuisine=str(data.get("cuisine", "")),
            time_minutes=int(data.get("time_minutes", 0)),
            difficulty=str(data.get("difficulty", "简单")),
            cookware=[str(c) for c in data.get("cookware", [])],
            tags=[str(t) for t in data.get("tags", [])],
            allergens=[str(a) for a in data.get("allergens", [])],
            safety_notes=[str(s) for s in data.get("safety_notes", [])],
            source=str(data.get("source", "")),
            license=str(data.get("license", "")),
            is_ai_generated=bool(data.get("is_ai_generated", False)),
        )

    @property
    def canonical_ingredients(self) -> list[str]:
        return [i.canonical for i in self.ingredients if not i.optional]
