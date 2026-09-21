"""Heuristic secret scan: prints locations/types only, never credential values.

Run from the repository root: python docs/security-fixes/scan-secrets-safe.py
Scans tracked working-tree text and every reachable Git blob under 4 MiB.
This is not a replacement for provider-aware secret scanning in CI.
"""
import base64
import json
import pathlib
import re
import subprocess

ROOT = pathlib.Path(__file__).resolve().parents[2]
PATTERNS = {
    "supabase_secret": re.compile(rb"sb_secret_[A-Za-z0-9_-]{15,}"),
    "private_key_block": re.compile(rb"-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----"),
    "github_token": re.compile(rb"(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,})"),
    "aws_access_key": re.compile(rb"\b(?:AKIA|ASIA)[A-Z0-9]{16}\b"),
    "literal_privileged_key": re.compile(
        rb"(?:SERVICE_ROLE_KEY|service_role_key|VAPID_PRIVATE_KEY|vapid_private_key)\s*[:=]\s*[\"']([A-Za-z0-9_./+\-=]{32,})[\"']"
    ),
}
JWT = re.compile(rb"\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+")


def git(*args):
    return subprocess.check_output(["git", *args], cwd=ROOT)


def findings(data):
    result = []
    for kind, pattern in PATTERNS.items():
        for match in pattern.finditer(data):
            result.append({"type": kind, "line": data[:match.start()].count(b"\n") + 1})
    for match in JWT.finditer(data):
        try:
            part = match.group().split(b".")[1]
            payload = json.loads(base64.urlsafe_b64decode(part + b"=" * (-len(part) % 4)))
            if payload.get("role") == "service_role":
                result.append({"type": "service_role_jwt", "line": data[:match.start()].count(b"\n") + 1})
        except (ValueError, TypeError):
            pass
    return result


report = {"working_tree_findings": [], "history_findings": [], "tracked_files": 0, "reachable_blobs_scanned": 0}
for raw in git("ls-files", "-z").split(b"\0"):
    if not raw:
        continue
    path = raw.decode("utf-8")
    file = ROOT / path
    if not file.is_file() or file.stat().st_size > 4 * 1024 * 1024:
        continue
    report["tracked_files"] += 1
    for item in findings(file.read_bytes()):
        report["working_tree_findings"].append({"path": path, **item})

objects = git("rev-list", "--objects", "--all").splitlines()
for row in objects:
    fields = row.split(b" ", 1)
    if len(fields) < 2:
        continue
    oid, rawpath = fields
    if git("cat-file", "-t", oid.decode()).strip() != b"blob":
        continue
    if int(git("cat-file", "-s", oid.decode())) > 4 * 1024 * 1024:
        continue
    report["reachable_blobs_scanned"] += 1
    for item in findings(git("cat-file", "blob", oid.decode())):
        report["history_findings"].append({"blob": oid.decode(), "path": rawpath.decode("utf-8", errors="replace"), **item})

report["reachable_commits"] = int(git("rev-list", "--all", "--count"))
print(json.dumps(report, indent=2, ensure_ascii=False))
