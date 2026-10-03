#!/usr/bin/env python3
"""Hite SMS bridge: texts sent to the Hite report number land on this PC over XMPP.

A JMP.chat number (jmp.chat) delivers SMS to an XMPP account through the Cheogram
gateway. A text from +1 416 993 8000 arrives as an XMPP message from
+14169938000@cheogram.com, and sending a message to that JID texts the person back.
No port is bound; this is an outbound XMPP client only.

    bridge.py daemon              stay connected; append every SMS to data/inbox.jsonl
    bridge.py inbox [--all|--json] unanswered reports (or everything / machine-readable)
    bridge.py send +1555… "text"  text a number (also logged to data/outbox.jsonl)
    bridge.py ack ID [ID…]        mark reports as handled
    bridge.py test                connect, confirm the gateway is reachable, disconnect

Config lives in sms-bridge/.env (gitignored): copy .env.example and fill it in.
The JMP number itself is also pasted into REPORT_SMS in app.js so the app's
"Report this question" button opens the phone's SMS app with it.

Requires: pip install --user slixmpp
"""
from __future__ import annotations

import argparse
import asyncio
import json
import logging
import os
import re
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

HERE = Path(__file__).resolve().parent
DATA = HERE / "data"
INBOX = DATA / "inbox.jsonl"
OUTBOX = DATA / "outbox.jsonl"
ENV = HERE / ".env"

log = logging.getLogger("hite-sms")


# ───────────────────────────────────────────── config

def load_env(path: Path = ENV) -> dict:
    """KEY=VALUE lines; quotes optional; # comments. Read at call time, never at import."""
    cfg = {}
    if path.exists():
        for line in path.read_text().splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, v = line.split("=", 1)
            cfg[k.strip()] = v.strip().strip("'\"")
    for k in ("XMPP_JID", "XMPP_PASSWORD", "SMS_GATEWAY", "MY_NUMBER", "AUTO_TRIAGE"):
        if os.environ.get(k):
            cfg[k] = os.environ[k]
    cfg.setdefault("SMS_GATEWAY", "cheogram.com")
    return cfg


def need(cfg: dict, *keys: str) -> None:
    missing = [k for k in keys if not cfg.get(k)]
    if missing:
        sys.exit(f"{ENV} is missing {', '.join(missing)} (see .env.example)")


def norm_number(s: str) -> str:
    """'+1 (555) 123-4567' → '+15551234567'; a bare 10-digit US number gets +1."""
    d = re.sub(r"[^\d]", "", s)
    if len(d) == 10:
        d = "1" + d
    if not re.fullmatch(r"1\d{10}", d):
        sys.exit(f"not a US/Canada number: {s!r}")
    return "+" + d


# ───────────────────────────────────────────── inbox

def _read_jsonl(path: Path) -> list[dict]:
    if not path.exists():
        return []
    out = []
    for line in path.read_text().splitlines():
        if line.strip():
            try:
                out.append(json.loads(line))
            except json.JSONDecodeError:
                log.warning("skipping bad line in %s: %r", path.name, line[:80])
    return out


def _write_jsonl(path: Path, rows: list[dict]) -> None:
    DATA.mkdir(exist_ok=True)
    tmp = path.with_suffix(".tmp")
    tmp.write_text("".join(json.dumps(r, ensure_ascii=False) + "\n" for r in rows))
    tmp.replace(path)


def _append(path: Path, row: dict) -> None:
    DATA.mkdir(exist_ok=True)
    with path.open("a") as f:
        f.write(json.dumps(row, ensure_ascii=False) + "\n")


def record_inbound(number: str, body: str) -> dict:
    t = datetime.now(timezone.utc)
    row = {"id": t.strftime("%Y%m%dT%H%M%S") + f"{t.microsecond // 1000:03d}",
           "t": t.isoformat(timespec="seconds"), "from": number, "body": body, "ack": False}
    _append(INBOX, row)
    return row


def ack(ids: list[str]) -> int:
    rows = _read_jsonl(INBOX)
    n = 0
    for r in rows:
        if r["id"] in ids and not r.get("ack"):
            r["ack"] = datetime.now(timezone.utc).isoformat(timespec="seconds")
            n += 1
    if n:
        _write_jsonl(INBOX, rows)
    return n


def show_inbox(show_all: bool, as_json: bool) -> None:
    rows = [r for r in _read_jsonl(INBOX) if show_all or not r.get("ack")]
    if as_json:
        print(json.dumps(rows, ensure_ascii=False, indent=1))
        return
    if not rows:
        print("no unanswered reports" if not show_all else "inbox is empty")
        return
    for r in rows:
        mark = "handled " + str(r["ack"])[:16] if r.get("ack") else "UNANSWERED"
        print(f"[{r['id']}] {r['t']}  from {r['from']}  ({mark})")
        for line in r["body"].splitlines():
            print("    " + line)
        print()


def notify(title: str, body: str) -> None:
    try:
        subprocess.run(["notify-send", "-a", "Hite", title, body[:300]], timeout=5, check=False)
    except Exception:
        pass


def maybe_triage(cfg: dict) -> None:
    if cfg.get("AUTO_TRIAGE", "0") != "1":
        return
    script = HERE / "triage.sh"
    if script.exists():
        subprocess.Popen([str(script)], start_new_session=True,
                         stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


# ───────────────────────────────────────────── xmpp

def make_client(cfg: dict):
    try:
        from slixmpp import ClientXMPP
    except ImportError:
        sys.exit("slixmpp is not installed: pip install --user slixmpp")

    class Bridge(ClientXMPP):
        def __init__(self):
            super().__init__(cfg["XMPP_JID"], cfg["XMPP_PASSWORD"])
            self.gateway = cfg["SMS_GATEWAY"]
            self.keep_running = True          # daemon: reconnect after a drop
            self.exit_code = 0
            self.register_plugin("xep_0030")   # service discovery
            self.register_plugin("xep_0199", {"keepalive": True, "interval": 60})   # ping
            self.register_plugin("xep_0198")   # stream management (resume after blips)
            self.add_event_handler("session_start", self.on_start)
            self.add_event_handler("message", self.on_message)
            self.add_event_handler("disconnected", self.on_disconnected)
            self.add_event_handler("failed_auth", self.on_failed_auth)

        async def on_start(self, _):
            self.send_presence()
            await self.get_roster()
            log.info("connected as %s; gateway %s", self.boundjid.full, self.gateway)

        def on_message(self, msg):
            if msg["type"] not in ("chat", "normal"):
                return
            body = (msg["body"] or "").strip()
            if not body:
                return
            frm = msg["from"]
            if frm.domain != self.gateway:
                log.info("ignored message from %s (not the SMS gateway)", frm.bare)
                return
            number = frm.user
            row = record_inbound(number, body)
            log.info("SMS from %s: %s", number, body[:120].replace("\n", " / "))
            notify(f"Hite report from {number}", body)
            maybe_triage(cfg)

        def on_disconnected(self, reason):
            if self.keep_running:
                log.warning("disconnected (%s); reconnecting in 15 s", reason)
                self.loop.call_later(15, self.connect)
            else:
                self.loop.call_soon(self.loop.stop)

        def on_failed_auth(self, _):
            log.error("authentication failed for %s: check XMPP_JID / XMPP_PASSWORD", self.boundjid.bare)
            self.keep_running = False
            self.exit_code = 3
            self.disconnect()

    return Bridge()


def run_daemon(cfg: dict) -> int:
    need(cfg, "XMPP_JID", "XMPP_PASSWORD")
    xmpp = make_client(cfg)
    xmpp.connect()
    try:
        xmpp.loop.run_forever()
    except KeyboardInterrupt:
        xmpp.keep_running = False
        xmpp.disconnect()
    return xmpp.exit_code


def run_send(cfg: dict, number: str, text: str) -> int:
    need(cfg, "XMPP_JID", "XMPP_PASSWORD")
    number = norm_number(number)
    xmpp = make_client(cfg)
    xmpp.keep_running = False
    to = f"{number}@{cfg['SMS_GATEWAY']}"
    sent = {"ok": False}

    async def on_start(_):
        xmpp.send_presence()
        await xmpp.get_roster()
        xmpp.send_message(mto=to, mbody=text, mtype="chat")
        sent["ok"] = True
        await asyncio.sleep(1.0)        # let the stanza leave before closing the stream
        xmpp.disconnect(wait=5.0)

    xmpp.del_event_handler("session_start", xmpp.on_start)
    xmpp.add_event_handler("session_start", on_start)
    xmpp.connect()
    xmpp.loop.call_later(60, xmpp.loop.stop)   # never hang forever
    xmpp.loop.run_forever()
    if sent["ok"]:
        _append(OUTBOX, {"t": datetime.now(timezone.utc).isoformat(timespec="seconds"), "to": number, "body": text})
        print(f"sent to {number} via {to}")
        return 0
    print("not sent (connection or authentication failed; see log above)", file=sys.stderr)
    return 1 if not xmpp.exit_code else xmpp.exit_code


def run_test(cfg: dict) -> int:
    need(cfg, "XMPP_JID", "XMPP_PASSWORD")
    xmpp = make_client(cfg)
    xmpp.keep_running = False
    result = {"ok": False, "gateway": None}

    async def on_start(_):
        xmpp.send_presence()
        await xmpp.get_roster()
        result["ok"] = True
        try:
            info = await xmpp["xep_0030"].get_info(jid=cfg["SMS_GATEWAY"], timeout=15)
            idents = [i[3] or i[0] for i in info["disco_info"]["identities"]]
            result["gateway"] = ", ".join(idents) or "reachable"
        except Exception as e:  # noqa: BLE001
            result["gateway"] = f"not reachable ({type(e).__name__})"
        xmpp.disconnect(wait=2.0)

    xmpp.del_event_handler("session_start", xmpp.on_start)
    xmpp.add_event_handler("session_start", on_start)
    xmpp.connect()
    xmpp.loop.call_later(45, xmpp.loop.stop)
    xmpp.loop.run_forever()
    print(f"login as {cfg['XMPP_JID']}: {'OK' if result['ok'] else 'FAILED'}")
    print(f"gateway {cfg['SMS_GATEWAY']}: {result['gateway']}")
    if cfg.get("MY_NUMBER"):
        print(f"report number: {cfg['MY_NUMBER']} (paste the same into REPORT_SMS in app.js)")
    return 0 if result["ok"] else (xmpp.exit_code or 1)


# ───────────────────────────────────────────── main

def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("-v", "--verbose", action="store_true", help="debug logging (shows XMPP stanzas)")
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("daemon")
    p = sub.add_parser("inbox"); p.add_argument("--all", action="store_true"); p.add_argument("--json", action="store_true")
    p = sub.add_parser("send"); p.add_argument("number"); p.add_argument("text")
    p = sub.add_parser("ack"); p.add_argument("ids", nargs="+")
    sub.add_parser("test")
    args = ap.parse_args()

    logging.basicConfig(level=logging.DEBUG if args.verbose else logging.INFO,
                        format="%(asctime)s %(levelname)s %(message)s", stream=sys.stderr)
    cfg = load_env()

    if args.cmd == "inbox":
        show_inbox(args.all, args.json)
    elif args.cmd == "ack":
        print(f"acknowledged {ack(args.ids)} report(s)")
    elif args.cmd == "send":
        sys.exit(run_send(cfg, args.number, args.text))
    elif args.cmd == "test":
        sys.exit(run_test(cfg))
    elif args.cmd == "daemon":
        sys.exit(run_daemon(cfg))


if __name__ == "__main__":
    main()
