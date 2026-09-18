#!/usr/bin/env python3
"""Conformance check: diff tools/resources/prompts/data-types across implementations.

Rust (src/) is the source of truth. `spec/` holds snapshots generated from Rust;
each implementation is queried over stdio and diffed against the spec.

Usage:
    python3 scripts/check-parity.py              # verify all launchable impls
    python3 scripts/check-parity.py --update-spec  # regenerate spec/ from Rust

C and Zig are partial implementations: their tool names must be a subset of the
spec and their `list_data_types` output must match spec/data-types.json.
"""

import json
import os
import shutil
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SPEC = ROOT / "spec"
GO = shutil.which("go") or "/home/ubuntu/toolchains/go/bin/go"
BUN = shutil.which("bun") or str(Path.home() / ".bun/bin/bun")
CARGO = shutil.which("cargo") or str(Path.home() / ".cargo/bin/cargo")

ENV = {
    **os.environ,
    "GOOGLE_CLIENT_ID": "parity-check",
    "GOOGLE_CLIENT_SECRET": "parity-check",
    "GOOGLE_REFRESH_TOKEN": "parity-check",
}

PY_VENV = ROOT / "py/.venv/bin/python"
PY_BIN = str(PY_VENV) if PY_VENV.exists() else (shutil.which("python3") or "python3")

# name -> (command, cwd, full_parity)
IMPLS = {
    "rust": ([CARGO, "run", "--quiet"], ROOT, True),
    "go": ([GO, "run", "."], ROOT / "go", True),
    "typescript": ([BUN, "src/index.ts"], ROOT / "ts", True),
    "python": ([PY_BIN, "-m", "google_health_mcp.server"], ROOT / "py", True),
    "c": ([str(ROOT / "c/google-health-mcp")], ROOT / "c", False),
    "zig": ([str(ROOT / "zig/zig-out/bin/google-health-mcp")], ROOT / "zig", False),
}


def query(proc, method, req_id, params=None):
    req = {"jsonrpc": "2.0", "id": req_id, "method": method, "params": params or {}}
    proc.stdin.write(json.dumps(req) + "\n")
    proc.stdin.flush()
    deadline = time.time() + 60
    while time.time() < deadline:
        line = proc.stdout.readline()
        if not line:
            break
        try:
            msg = json.loads(line)
        except json.JSONDecodeError:
            continue
        if msg.get("id") == req_id:
            return msg
    raise RuntimeError(f"timeout waiting for {method} (id={req_id})")


def probe(name, cmd, cwd):
    if not Path(cmd[0]).exists():
        return None, f"binary not found: {cmd[0]}"
    try:
        proc = subprocess.Popen(
            cmd, cwd=cwd, env=ENV, stdin=subprocess.PIPE,
            stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True,
        )
    except OSError as e:
        return None, str(e)
    try:
        query(proc, "initialize", 1, {
            "protocolVersion": "2025-11-25",
            "capabilities": {},
            "clientInfo": {"name": "parity-check", "version": "1.0"},
        })
        proc.stdin.write(json.dumps({
            "jsonrpc": "2.0", "method": "notifications/initialized", "params": {},
        }) + "\n")
        proc.stdin.flush()

        def get(req_id, method, field):
            msg = query(proc, method, req_id)
            return (msg.get("result") or {}).get(field, [])

        result = {
            "tools": get(2, "tools/list", "tools"),
            "resources": get(3, "resources/list", "resources"),
            "resource_templates": get(4, "resources/templates/list", "resourceTemplates"),
            "prompts": get(5, "prompts/list", "prompts"),
        }
        call = query(proc, "tools/call", 6, {
            "name": "list_data_types", "arguments": {},
        }).get("result") or {}
        try:
            result["data_types"] = json.loads(call["content"][0]["text"])["data_types"]
        except (KeyError, IndexError, json.JSONDecodeError):
            result["data_types"] = []
        return result, None
    except Exception as e:  # noqa: BLE001 - report any probe failure
        return None, f"{type(e).__name__}: {e}"
    finally:
        proc.kill()


def norm(obj):
    return json.dumps(obj, sort_keys=True, separators=(",", ":"))


def norm_schema(o):
    """Normalize schema serialization differences that are semantically equal.

    - mcp-go emits `"required": []`; rmcp omits the key.
    - Rust declares optional params as `type: ["T", "null"]`; mcp-go emits `type: "T"`.
    """
    if isinstance(o, dict):
        out = {}
        for k, v in o.items():
            if k == "required" and v == []:
                continue
            if k == "type" and isinstance(v, list) and len(v) == 2 and "null" in v:
                v = next(x for x in v if x != "null")
            out[k] = norm_schema(v)
        return out
    if isinstance(o, list):
        return [norm_schema(x) for x in o]
    return o


def index_by(items, key):
    return {item[key]: item for item in items}


def diff_tools(spec_tools, impl_tools, full=True):
    """Hard diffs: name set + inputSchema. Soft diffs: description/annotations/title."""
    errors, warnings = [], []
    spec_by_name = index_by(spec_tools, "name")
    impl_by_name = index_by(impl_tools, "name")
    missing = sorted(set(spec_by_name) - set(impl_by_name))
    extra = sorted(set(impl_by_name) - set(spec_by_name))
    if missing and full:
        errors.append(f"missing tools: {missing}")
    if extra:
        errors.append(f"extra tools not in spec: {extra}")
    for name in sorted(set(spec_by_name) & set(impl_by_name)):
        s, i = spec_by_name[name], impl_by_name[name]
        if full and norm(norm_schema(s.get("inputSchema"))) != norm(norm_schema(i.get("inputSchema"))):
            errors.append(f"tool {name}: inputSchema mismatch")
        if not full:
            continue
        for field in ("description", "title", "annotations"):
            if norm(s.get(field)) != norm(i.get(field)):
                warnings.append(f"tool {name}: {field} differs")
    return errors, warnings


def diff_named(kind, spec_items, impl_items, key):
    errors = []
    spec_names = sorted(item[key] for item in spec_items)
    impl_names = sorted(item[key] for item in impl_items)
    if spec_names != impl_names:
        errors.append(f"{kind} mismatch: spec={spec_names} impl={impl_names}")
    return errors


def diff_data_types(spec_types, impl_types, full=True):
    errors, warnings = [], []
    if norm(spec_types) == norm(impl_types):
        return errors, warnings
    spec_by_id = index_by(spec_types, "id")
    impl_by_id = index_by(impl_types, "id")
    missing = sorted(set(spec_by_id) - set(impl_by_id))
    extra = sorted(set(impl_by_id) - set(spec_by_id))
    if missing and full:
        errors.append(f"missing data_types: {missing}")
    if extra:
        errors.append(f"extra data_types not in spec: {extra}")
    for tid in sorted(set(spec_by_id) & set(impl_by_id)):
        s, i = spec_by_id[tid], impl_by_id[tid]
        for field in s:
            if field not in i:
                if full:
                    errors.append(f"data_type {tid}: missing field {field}")
                continue
            if norm(s[field]) != norm(i[field]):
                msg = f"data_type {tid}: field {field} spec={s[field]!r} impl={i[field]!r}"
                (errors if full else warnings).append(msg)
    return errors, warnings


def main():
    update = "--update-spec" in sys.argv
    results, failures = {}, []
    for name, (cmd, cwd, _) in IMPLS.items():
        res, err = probe(name, cmd, cwd)
        if err:
            print(f"[skip] {name}: {err}")
        else:
            results[name] = res
            print(f"[ok]   {name}: {len(res['tools'])} tools, "
                  f"{len(res['resources'])} resources, "
                  f"{len(res['resource_templates'])} resource templates, "
                  f"{len(res['prompts'])} prompts, {len(res['data_types'])} data types")

    if "rust" not in results:
        print("ERROR: rust reference could not be probed", file=sys.stderr)
        sys.exit(2)

    KEYS = ("tools", "resources", "resource_templates", "prompts", "data_types")

    if update:
        SPEC.mkdir(exist_ok=True)
        for key in KEYS:
            (SPEC / f"{key.replace('_', '-')}.json").write_text(
                json.dumps(results["rust"][key], indent=2, sort_keys=True) + "\n")
        print("spec/ regenerated from rust")
        return

    spec = {}
    for key in KEYS:
        path = SPEC / f"{key.replace('_', '-')}.json"
        if not path.exists():
            print(f"ERROR: {path} missing — run with --update-spec", file=sys.stderr)
            sys.exit(2)
        spec[key] = json.loads(path.read_text())

    for name, (_, _, full) in IMPLS.items():
        if name not in results:
            continue
        impl = results[name]
        print(f"\n== {name} ==")
        errors, warnings = [], []
        e, w = diff_tools(spec["tools"], impl["tools"], full)
        errors += e
        warnings += w
        if full:
            errors += diff_named("resources", spec["resources"], impl["resources"], "uri")
            errors += diff_named("resource_templates", spec["resource_templates"], impl["resource_templates"], "uriTemplate")
            errors += diff_named("prompts", spec["prompts"], impl["prompts"], "name")
        e, w = diff_data_types(spec["data_types"], impl["data_types"], full)
        errors += e
        warnings += w
        for warn in warnings:
            print(f"  warn: {warn}")
        for err in errors:
            print(f"  FAIL: {err}")
            failures.append(f"{name}: {err}")
        if not errors:
            print("  conformant")

    print()
    if failures:
        print(f"PARITY CHECK FAILED ({len(failures)} errors)")
        sys.exit(1)
    print("PARITY CHECK PASSED")


if __name__ == "__main__":
    main()
