"""Ingredient name normalization and synonym resolution.

The goal is to map messy real-world strings ("2 个西红柿", "番茄（西红柿）",
"适量马铃薯") to a canonical catalog name. Unknown inputs fall back to a
cleaned surface form rather than being silently dropped.
"""
from __future__ import annotations

import re

from .catalog import synonym_map

_FULLWIDTH_PUNCT = str.maketrans("（）【】　", "()[] ")
_PAREN_RE = re.compile(r"[（(【\[].*?[)）】\]]")
_SPLIT_ALT_RE = re.compile(r"[/、]|或者|还是")
# Leading quantity: Arabic/Chinese numerals + common units, or quantifier words.
_QUANTITY_RE = re.compile(
    r"^[\d.]+\s*(?:克|g|G|千克|kg|公斤|斤|毫升|ml|mL|升|L|勺|汤匙|茶匙|大勺|小勺"
    r"|个|片|根|把|块|瓣|粒|颗|条|只|支|袋|罐|瓶|盒|包|杯|扎|小撮|撮|适量|少许)?"
)
_QUANTIFIER_PREFIX_RE = re.compile(r"^(?:适量|少许|若干|少量|多点|少点)\s*")
_TRAILING_JUNK_RE = re.compile(r"[，,。.\s]+$")


def clean_text(raw: str) -> str:
    text = raw.translate(_FULLWIDTH_PUNCT).strip()
    text = _TRAILING_JUNK_RE.sub("", text)
    return text


def _candidates(raw: str) -> list[str]:
    """Yield candidate surface forms in lookup priority order."""
    text = clean_text(raw)
    if not text:
        return []
    candidates: list[str] = []
    # 1. Whole string.
    candidates.append(text)
    # 2. First alternative when "a/b" style.
    first_alt = _SPLIT_ALT_RE.split(text)[0].strip()
    if first_alt and first_alt != text:
        candidates.append(first_alt)
    # 3. Parenthetical content (often holds the canonical synonym).
    for match in re.findall(r"[（(【\[](.*?)[)）】\]]", text):
        inner = match.strip()
        if inner:
            candidates.append(inner)
    # 4. String with parentheticals removed.
    stripped = _PAREN_RE.sub("", text).strip()
    if stripped and stripped != text:
        candidates.append(stripped)
    # 5. Quantity-stripped variants of each of the above.
    expanded: list[str] = []
    for cand in candidates:
        no_quant = _QUANTITY_RE.sub("", cand).strip()
        no_quant = _QUANTIFIER_PREFIX_RE.sub("", no_quant).strip()
        if no_quant and no_quant != cand:
            expanded.append(no_quant)
    candidates.extend(expanded)
    # Deduplicate preserving order.
    seen: set[str] = set()
    result = []
    for cand in candidates:
        if cand and cand not in seen:
            seen.add(cand)
            result.append(cand)
    return result


def normalize_name(raw: str) -> str:
    """Return a canonical catalog name, or a cleaned fallback for unknowns."""
    mapping = synonym_map()
    for cand in _candidates(raw):
        if cand in mapping:
            return mapping[cand]
    fallback = clean_text(raw)
    fallback = _QUANTIFIER_PREFIX_RE.sub("", fallback)
    fallback = _QUANTITY_RE.sub("", fallback).strip()
    return fallback or clean_text(raw)


def normalize_strict(raw: str) -> str | None:
    """Like normalize_name but return None for anything not in the catalog."""
    mapping = synonym_map()
    for cand in _candidates(raw):
        if cand in mapping:
            return mapping[cand]
    return None
