"""Sondagens sem sessao e sem alterar dados. Usa somente a chave publica do front.

python scripts/security/probe-anon.py --out docs/security-evidence/anon-live.json
Nao envia cadastros, RPCs de escrita ou notificacoes. Respostas de dados sao
reduzidas a contagem/chaves/status; nomes, documentos e tokens nao sao gravados.
"""
import argparse
import concurrent.futures
import datetime
import json
import pathlib
import re
import urllib.error
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parents[2]
CONFIG = (ROOT / "public/js/config/supabase-config.js").read_text(encoding="utf-8")
URL = re.search(r'const SUPABASE_URL = "([^"]+)"', CONFIG)[1]
KEY = re.search(r'const SUPABASE_ANON_KEY = "([^"]+)"', CONFIG)[1]
TABLES = ["chamados", "usuarios", "comentarios", "anexos", "chamado_membros",
          "artigos", "artigo_feedback", "chamado_retorno_pendente", "filas",
          "setores", "unidades", "categorias", "textos_rapidos", "terceiros",
          "push_subscriptions", "chamado_terceiros"]
BUCKETS = ["anexos", "artigos", "avatares", "fundos-portal", "terceiros"]
HELPERS = ["is_equipe_ti", "is_admin", "is_aprovado", "pode_escrever_artigo",
           "meu_setor_id", "minha_unidade_id"]


def request(path, method="GET", data=None, public_key=True):
    headers = {"Accept": "application/json", "User-Agent": "CentralTI-security-audit/1.0"}
    if public_key:
        headers["apikey"] = KEY
    body = None
    if data is not None:
        headers["Content-Type"] = "application/json"
        body = json.dumps(data).encode()
    req = urllib.request.Request(URL + path, data=body, headers=headers, method=method)
    result = {"path": path, "method": method, "credential": "publishable" if public_key else "none"}
    try:
        try:
            response = urllib.request.urlopen(req, timeout=20)
        except urllib.error.HTTPError as exc:
            response = exc
        with response:
            result["status"] = response.status
            raw = response.read(1024 * 1024)
        try:
            payload = json.loads(raw)
        except (ValueError, UnicodeDecodeError):
            result["response_bytes"] = len(raw)
            return result
        if isinstance(payload, list):
            result["rows_returned"] = len(payload)
            if payload and isinstance(payload[0], dict):
                result["column_names"] = sorted(payload[0])
        elif isinstance(payload, dict):
            result["keys"] = sorted(payload)
            # Error messages sometimes reflect submitted input. No user data is submitted here.
            if response.status >= 400:
                result["error_code"] = payload.get("code", payload.get("error"))
                result["error_message"] = str(payload.get("message", payload.get("msg", "")))[:300]
            if path == "/auth/v1/settings" and response.status == 200:
                result["public_settings"] = payload
            if path == "/rest/v1/" and response.status == 200:
                result["advertised_paths"] = sorted(payload.get("paths", {}))
        else:
            result["scalar"] = payload
        return result
    except (urllib.error.URLError, TimeoutError, OSError) as exc:
        result["network_error"] = str(exc.reason if isinstance(exc, urllib.error.URLError) else exc)[:200]
        return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", required=True)
    args = parser.parse_args()
    jobs = [(f"/rest/v1/{t}?select=*&limit=1", "GET", None, True) for t in TABLES]
    jobs += [(f"/rest/v1/rpc/{h}", "POST", {}, True) for h in HELPERS]
    jobs += [(f"/storage/v1/object/list/{b}", "POST", {"prefix": "", "limit": 1}, True) for b in BUCKETS]
    jobs += [(f"/functions/v1/{f}", "POST", {}, k) for f in ["criar-usuario", "notificar-portal"] for k in [False, True]]
    jobs += [("/storage/v1/bucket", "GET", None, True),
             ("/rest/v1/", "GET", None, True), ("/auth/v1/settings", "GET", None, True)]
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
        results = list(pool.map(lambda x: request(*x), jobs))
    report = {"at_utc": datetime.datetime.now(datetime.timezone.utc).isoformat(),
              "project_url": URL, "mode": "anonymous-read-only-and-empty-edge-payload",
              "results": results}
    target = pathlib.Path(args.out)
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(report, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    for item in results:
        print(json.dumps(item, ensure_ascii=True))
    if all("network_error" in item for item in results):
        raise SystemExit(2)


if __name__ == "__main__":
    main()
