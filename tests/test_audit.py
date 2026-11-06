"""Offline integrity audit tests."""
import cookmyfridge.audit as audit


def test_audit_passes_on_shipped_data():
    report = audit.run_audit()
    assert report["ok"] is True
    assert report["problems"] == []
    assert report["counts"]["recipes"] >= 100


def test_audit_detects_unknown_ingredient(monkeypatch):
    from cookmyfridge.dataset import load_recipes

    recipes = load_recipes()
    # Corrupt one ingredient canonical in memory and point the audit at it.
    recipes[0].ingredients[0].canonical = "不存在的食材"
    monkeypatch.setattr(audit, "load_recipes", lambda: recipes)
    report = audit.run_audit()
    assert report["ok"] is False
    assert any("目录外食材" in p for p in report["problems"])
