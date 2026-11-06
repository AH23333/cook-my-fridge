"""Dataset retrieval engine (the reliable half): matching, classification,
ranking and filtering over curated recipes."""
from __future__ import annotations

from dataclasses import dataclass, field

from .catalog import is_pantry_staple, substitutions_for
from .models import Recipe

# Classification thresholds (see product doc, section 二.2 and 十 acceptance).
# Cook Now is strictly 0 non-staple missing: pantry staples already absorb
# trivial seasonings, so any remaining missing item is a real main ingredient
# and belongs in Almost There with substitution suggestions. This resolves the
# doc's "0~1 / 1~3" boundary overlap toward the >=60% zero-missing metric.
COOK_NOW_MAX_MISSING = 0
ALMOST_MIN_MISSING = 1
ALMOST_MAX_MISSING = 3

DIFFICULTY_RANK = {"简单": 0, "中等": 1, "较难": 2}


@dataclass
class Match:
    recipe: Recipe
    matched: list[str]
    missing: list[str]
    missing_staples: list[str] = field(default_factory=list)
    missing_substitutions: dict[str, list[dict]] = field(default_factory=dict)

    @property
    def match_count(self) -> int:
        return len(self.matched)

    @property
    def missing_count(self) -> int:
        # Only non-staple ingredients drive the user-facing missing count.
        return len(self.missing)

    @property
    def coverage(self) -> float:
        total = len(self.matched) + len(self.missing)
        return len(self.matched) / total if total else 0.0

    @property
    def bucket(self) -> str:
        if self.missing_count <= COOK_NOW_MAX_MISSING:
            return "cook_now"
        if ALMOST_MIN_MISSING <= self.missing_count <= ALMOST_MAX_MISSING:
            return "almost_there"
        return "out_of_reach"


@dataclass
class SearchFilters:
    methods: list[str] | None = None
    max_time_minutes: int | None = None
    difficulty: list[str] | None = None
    tags: list[str] | None = None


@dataclass
class SearchResult:
    cook_now: list[Match]
    almost_there: list[Match]
    all_matches: list[Match]


class SearchIndex:
    def __init__(self, recipes: list[Recipe]):
        self.recipes = {r.id: r for r in recipes}
        self.inverted: dict[str, set[str]] = {}
        self.method_index: dict[str, set[str]] = {}
        for recipe in recipes:
            for canonical in recipe.canonical_ingredients:
                self.inverted.setdefault(canonical, set()).add(recipe.id)
            for method in recipe.methods:
                self.method_index.setdefault(method, set()).add(recipe.id)

    # --- candidate pruning --------------------------------------------------

    def candidate_ids(self, selected: set[str]) -> set[str]:
        """Recipes sharing at least one selected ingredient."""
        ids: set[str] = set()
        for canonical in selected:
            ids.update(self.inverted.get(canonical, set()))
        return ids

    # --- matching ------------------------------------------------------------

    def match_recipe(self, recipe: Recipe, selected: set[str]) -> Match:
        required = set(recipe.canonical_ingredients)
        matched = sorted(required & selected)
        absent = required - selected
        missing = sorted(c for c in absent if not is_pantry_staple(c))
        missing_staples = sorted(c for c in absent if is_pantry_staple(c))
        subs = {
            canonical: substitutions_for(canonical)
            for canonical in missing
            if substitutions_for(canonical)
        }
        return Match(
            recipe=recipe,
            matched=matched,
            missing=missing,
            missing_staples=missing_staples,
            missing_substitutions=subs,
        )

    # --- filtering ------------------------------------------------------------

    @staticmethod
    def _passes_filters(recipe: Recipe, filters: SearchFilters) -> bool:
        if filters.methods and not any(m in recipe.methods for m in filters.methods):
            return False
        if (
            filters.max_time_minutes is not None
            and recipe.time_minutes > filters.max_time_minutes
        ):
            return False
        if filters.difficulty and recipe.difficulty not in filters.difficulty:
            return False
        if filters.tags and not any(t in recipe.tags for t in filters.tags):
            return False
        return True

    # --- ranking --------------------------------------------------------------

    @staticmethod
    def _sort_key(match: Match) -> tuple:
        recipe = match.recipe
        return (
            match.missing_count,
            -match.match_count,
            recipe.time_minutes,
            DIFFICULTY_RANK.get(recipe.difficulty, 3),
            recipe.id,
        )

    # --- public API -----------------------------------------------------------

    def search(
        self,
        selected: list[str] | set[str],
        filters: SearchFilters | None = None,
    ) -> SearchResult:
        selected_set = set(selected)
        filters = filters or SearchFilters()
        cook_now: list[Match] = []
        almost: list[Match] = []
        all_matches: list[Match] = []
        for recipe_id in self.candidate_ids(selected_set):
            recipe = self.recipes[recipe_id]
            if not self._passes_filters(recipe, filters):
                continue
            match = self.match_recipe(recipe, selected_set)
            if match.bucket == "out_of_reach":
                continue
            all_matches.append(match)
            if match.bucket == "cook_now":
                cook_now.append(match)
            else:
                almost.append(match)
        cook_now.sort(key=self._sort_key)
        almost.sort(key=self._sort_key)
        all_matches.sort(key=self._sort_key)
        return SearchResult(
            cook_now=cook_now,
            almost_there=almost,
            all_matches=all_matches,
        )
