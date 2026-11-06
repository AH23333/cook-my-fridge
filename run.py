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

    sub.add_parser("build")
    sub.add_parser("repair")
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

    if args.task == "repair":
        from cookmyfridge.batch import repair_all_caches

        print(repair_all_caches())
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
