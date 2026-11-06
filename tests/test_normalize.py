"""Normalization and synonym resolution tests."""
from cookmyfridge.normalize import clean_text, normalize_name, normalize_strict


def test_direct_canonical():
    assert normalize_name("番茄") == "番茄"
    assert normalize_name("土豆") == "土豆"


def test_synonyms():
    assert normalize_name("西红柿") == "番茄"
    assert normalize_name("马铃薯") == "土豆"
    assert normalize_name("芫荽") == "香菜"
    assert normalize_name("青瓜") == "黄瓜"


def test_fullwidth_and_parentheses():
    assert normalize_name("西红柿（番茄）") == "番茄"
    assert normalize_name("番茄(西红柿)") == "番茄"


def test_quantity_prefix():
    assert normalize_name("2 个西红柿") == "番茄"
    assert normalize_name("100克土豆") == "土豆"
    assert normalize_name("适量盐") == "盐"
    assert normalize_name("少许白砂糖") == "白糖"


def test_alternatives():
    assert normalize_name("黄油/橄榄油") == "黄油"


def test_unknown_fallback():
    assert normalize_name("外星蓝椒") == "外星蓝椒"
    assert normalize_strict("外星蓝椒") is None


def test_strict_known():
    assert normalize_strict("西红柿") == "番茄"


def test_clean_text():
    assert clean_text(" 番茄　") == "番茄"
    assert clean_text("盐，") == "盐"
