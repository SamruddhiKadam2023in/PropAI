"""Runs INSIDE the backend container: docker exec -i property_backend python - < smtp_sender_test.py
Starts a throw-away SMTP server on 127.0.0.1:2525 and drives the real email service against it."""
import asyncio, email, logging, socket, sys, threading
from email import policy

from app.config import settings
from app.services import email_service as es

results, received = [], []


def check(name, ok, detail=""):
    results.append(bool(ok))
    print(("PASS " if ok else "FAIL ") + name + (f"  [{str(detail)[:160]}]" if detail != "" else ""))


def serve(sock):
    while True:
        try:
            conn, _ = sock.accept()
        except OSError:
            return
        f = conn.makefile("rwb")
        w = lambda s: (f.write((s + "\r\n").encode()), f.flush())
        w("220 sink ready")
        data_mode, lines, mail_from, rcpt = False, [], None, []
        while True:
            line = f.readline()
            if not line:
                break
            text = line.decode(errors="replace").rstrip("\r\n")
            if data_mode:
                if text == ".":
                    received.append({"from": mail_from, "to": rcpt, "raw": "\n".join(lines)})
                    data_mode = False
                    w("250 queued")
                else:
                    lines.append(text[1:] if text.startswith("..") else text)
                continue
            cmd = text.upper()
            if cmd.startswith(("EHLO", "HELO")):
                w("250 sink")
            elif cmd.startswith("MAIL FROM"):
                mail_from = text.split(":", 1)[1].strip(); w("250 ok")
            elif cmd.startswith("RCPT TO"):
                rcpt.append(text.split(":", 1)[1].strip()); w("250 ok")
            elif cmd == "DATA":
                data_mode = True; w("354 go")
            elif cmd == "QUIT":
                w("221 bye"); break
            else:
                w("250 ok")
        conn.close()


sock = socket.socket(); sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
sock.bind(("127.0.0.1", 2525)); sock.listen(5)
threading.Thread(target=serve, args=(sock,), daemon=True).start()


class Capture(logging.Handler):
    def __init__(self):
        super().__init__(); self.lines = []

    def emit(self, record):
        self.lines.append(record.getMessage())


cap = Capture(); logging.getLogger("app.services.email_service").addHandler(cap)


async def main():
    check("demo mode is reported when SMTP_HOST is empty", es.smtp_configured() is False)
    settings.SMTP_HOST, settings.SMTP_PORT, settings.SMTP_STARTTLS, settings.SMTP_SSL, settings.SMTP_USERNAME = "127.0.0.1", 2525, False, False, ""
    settings.SMTP_FROM = "PropAI <no-reply@propai.test>"
    check("SMTP mode is reported when SMTP_HOST is set", es.smtp_configured() is True)

    ok = await es.send_otp_email("tenant@example.com", "Amit <b>Kumar</b>", "482913")
    check("send_otp_email returns True when the server accepts the message", ok is True)
    check("exactly one message reached the server", len(received) == 1, len(received))
    m = email.message_from_string(received[0]["raw"], policy=policy.default)
    check("envelope recipient is the user's address", "tenant@example.com" in received[0]["to"][0], received[0]["to"])
    check("From header is the configured sender", "no-reply@propai.test" in m["From"], m["From"])
    check("subject carries the code", "482913" in m["Subject"], m["Subject"])
    text = m.get_body(preferencelist=("plain",)).get_content()
    html = m.get_body(preferencelist=("html",)).get_content()
    check("plain-text part: code, 10 minutes, single use, do-not-share warning", "482913" in text and "10 minutes" in text and "once" in text and "Never share" in text)
    check("HTML part exists and shows the code", "482913" in html)
    check("HTML escapes the display name (no markup injection)", "&lt;b&gt;Kumar&lt;/b&gt;" in html and "<b>Kumar</b>" not in html)
    check("the code is NOT written to the log when real email is used", not any("482913" in l for l in cap.lines), cap.lines)

    # header injection attempt through the recipient/name must not add headers
    await es.send_otp_email("victim@example.com", "Evil\r\nBcc: attacker@example.com", "111222")
    raw2 = received[-1]["raw"]
    check("a newline in the name can't inject an extra header (no Bcc line)", "\nBcc:" not in raw2.split("\n\n", 1)[0], raw2[:80])

    # failure path: nothing listening
    settings.SMTP_PORT = 2599
    cap.lines.clear()
    ok = await es.send_otp_email("tenant@example.com", "Amit", "999999")
    check("a dead mail server returns False instead of raising (registration must survive)", ok is False)
    check("the failure is logged, without the code", any("Could not send" in l for l in cap.lines) and not any("999999" in l for l in cap.lines), cap.lines)

    # demo-mode fallback
    settings.SMTP_HOST = ""
    cap.lines.clear()
    ok = await es.send_otp_email("demo@example.com", "Demo", "246810")
    check("demo mode: returns True and logs the code (only for a demo)", ok is True and any("246810" in l for l in cap.lines))


asyncio.run(main())
sock.close()
print(f"\n{sum(results)}/{len(results)} passed")
sys.exit(0 if all(results) else 1)
