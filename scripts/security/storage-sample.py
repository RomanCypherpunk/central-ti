"""Amostra anonima limitada: HEAD de um objeto por bucket e imagem opcional em TEMP.
Nao persiste nomes/URLs/conteudo no relatorio; hash identifica o objeto amostrado.
"""
import argparse
import datetime
import hashlib
import json
import pathlib
import tempfile
import urllib.error
import urllib.parse
import urllib.request
from importlib.util import spec_from_file_location, module_from_spec

spec = spec_from_file_location("probe", pathlib.Path(__file__).with_name("probe-anon.py"))
probe = module_from_spec(spec)
spec.loader.exec_module(probe)


def listing(bucket, prefix):
    req = urllib.request.Request(probe.URL + "/storage/v1/object/list/" + bucket,
        data=json.dumps({"prefix": prefix, "limit": 10, "sortBy": {"column": "name", "order": "asc"}}).encode(),
        headers={"apikey": probe.KEY, "Content-Type": "application/json"}, method="POST")
    with urllib.request.urlopen(req, timeout=20) as response:
        return json.load(response)


def find_one(bucket, prefix="", depth=0):
    if depth > 3:
        return None
    for item in listing(bucket, prefix):
        path = prefix + item["name"]
        if item.get("id"):
            return path
        found = find_one(bucket, path + "/", depth + 1)
        if found:
            return found
    return None


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--preview-images", action="store_true")
    parser.add_argument("--out", required=True)
    args = parser.parse_args()
    previews = pathlib.Path(tempfile.mkdtemp(prefix="central-ti-audit-")) if args.preview_images else None
    results = []
    for bucket in ["artigos", "terceiros", "avatares"]:
        result = {"bucket": bucket}
        try:
            path = find_one(bucket)
            if not path:
                result["sample"] = "no object in bounded sample"
                results.append(result)
                continue
            result["path_sha256"] = hashlib.sha256(path.encode()).hexdigest()
            url = probe.URL + "/storage/v1/object/public/" + bucket + "/" + urllib.parse.quote(path, safe="/")
            # Neither apikey nor Authorization sent for public download test.
            with urllib.request.urlopen(urllib.request.Request(url, method="HEAD"), timeout=20) as response:
                result.update(status=response.status, content_type=response.headers.get("Content-Type"),
                              content_length=response.headers.get("Content-Length"), credential="none")
            if previews and result["content_type"] in ["image/jpeg", "image/png", "image/webp"]:
                with urllib.request.urlopen(url, timeout=20) as response:
                    body = response.read(5 * 1024 * 1024 + 1)
                if len(body) <= 5 * 1024 * 1024:
                    suffix = {"image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp"}[result["content_type"]]
                    target = previews / (bucket + suffix)
                    target.write_bytes(body)
                    # Preview path only on stdout, never in committed evidence.
                    print("PREVIEW " + str(target))
        except urllib.error.HTTPError as exc:
            result["status"] = exc.code
        except (urllib.error.URLError, TimeoutError, OSError) as exc:
            # Do not include exception text: it may contain an object URL.
            result["error_type"] = type(exc).__name__
        results.append(result)
        print(json.dumps(result))
    report = {"at_utc": datetime.datetime.now(datetime.timezone.utc).isoformat(), "samples": results}
    pathlib.Path(args.out).write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
