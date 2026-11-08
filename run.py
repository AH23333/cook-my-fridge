"""Project command-line entry point.

Usage:
    python run.py data
    python run.py wildcards [--limit N]
    python run.py blindboxes [--limit N]
    python run.py ideas [--limit N]
    python run.py variants [--kinds a,b] [--recipe-limit N]
    python run.py build
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent / "src"))

from cookmyfridge.batch import BatchRunner  # noqa: E402
from cookmyfridge.dataset import write_curated  # noqa: E402


def main() -> None:
    parser = argparse.ArgumentParser(description="CookMyFridge task runner")
    sub = parser.add_subparsers(dest="task", required=True)

    sub.add_parser("data")

    for name in ("wildcards", "blindboxes", "ideas"):
        p = sub.add_parser(name)
        p.add_argument("--limit", type=int, default=None)

    p_var = sub.add_parser("variants")
    p_var.add_argument("--kinds", type=str, default=None)
    p_var.add_argument("--recipe-limit", type=int, default=None)

    p_import = sub.add_parser("import", help="import a public recipe dataset")
    p_import.add_argument("--source", required=True, help="path to .jsonl / .csv")
    p_import.add_argument("--format", default="auto", choices=("auto", "jsonl", "csv"))
    p_import.add_argument("--dataset", default="未命名数据集", help="provenance label")
    p_import.add_argument("--license", default=None, help="license of the source dataset")
    p_import.add_argument("--limit", type=int, default=None)
    p_import.add_argument("--dry-run", action="store_true")

    sub.add_parser("enrich", help="fill missing variants/ideas with labelled templates")
    sub.add_parser("build")
    p_serve = sub.add_parser(
        "serve", help="preview site/ locally (negotiates precompressed .br/.gz)"
    )
    p_serve.add_argument("--port", type=int, default=8000)
    sub.add_parser("repair")
    sub.add_parser("prune-failures")
    sub.add_parser("audit")

    args = parser.parse_args()

    if args.task == "data":
        path = write_curated()
        print(f"curated recipes written: {path}")
        return

    if args.task == "build":
        from cookmyfridge.build import build_site

        summary = build_site()
        print(summary)
        return

    if args.task == "serve":
        from cookmyfridge.serve import serve_site

        serve_site(args.port)
        return

    if args.task == "import":
        from cookmyfridge.public_dataset import DEFAULT_LICENSE, import_dataset

        report = import_dataset(
            Path(args.source),
            dataset=args.dataset,
            license_name=args.license or DEFAULT_LICENSE,
            fmt=args.format,
            limit=args.limit,
            dry_run=args.dry_run,
        )
        print(report)
        return

    if args.task == "enrich":
        from cookmyfridge.enrich import enrich_missing

        print(enrich_missing())
        return

    if args.task == "repair":
        from cookmyfridge.batch import repair_all_caches

        print(repair_all_caches())
        return

    if args.task == "prune-failures":
        from cookmyfridge.batch import prune_failures

        print(prune_failures())
        return

    if args.task == "audit":
        from cookmyfridge.audit import run_audit

        report = run_audit()
        print(report)
        if not report["ok"]:
            sys.exit(1)
        return

    runner = BatchRunner()
    if args.task == "wildcards":
        print("done, skipped, failed =", runner.run_wildcards(args.limit))
    elif args.task == "blindboxes":
        print("done, skipped, failed =", runner.run_blindboxes(args.limit))
    elif args.task == "ideas":
        print("done, skipped, failed =", runner.run_ideas(args.limit))
    elif args.task == "variants":
        kinds = args.kinds.split(",") if args.kinds else None
        print("done, skipped, failed =", runner.run_variants(kinds, args.recipe_limit))


if __name__ == "__main__":
    main()
