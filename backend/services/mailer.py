"""
Sends OTP emails through Gmail SMTP.

Configured entirely from .env -- nothing here is hardcoded:

    GMAIL_ADDRESS=youraccount@gmail.com
    GMAIL_APP_PASSWORD=abcdefghijklmnop      # 16-char App Password, no spaces
    GMAIL_FROM_NAME=NER-LOGIX                # optional, display name only

GMAIL_APP_PASSWORD must be a Google App Password, not the account's login
password -- Google blocks plain-password SMTP on normal accounts. Generating
one requires 2-Step Verification to be enabled first
(myaccount.google.com/apppasswords).

Sending is synchronous and is run off the event loop by the caller via
`asyncio.to_thread` -- smtplib is blocking, and calling it directly from an
async route would stall every other request for the duration of the SMTP
handshake.
"""
import asyncio
import logging
import os
import re
import smtplib
import ssl
from email.message import EmailMessage

logger = logging.getLogger("mailer")

SMTP_HOST = "smtp.gmail.com"
SMTP_PORT = 587

# Deliberately permissive. Strict RFC 5322 validation rejects addresses that
# are actually deliverable, and the OTP round-trip is the real proof that an
# address works -- this only catches obvious typos before we spend an SMTP
# connection on them.
_EMAIL_PATTERN = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


class MailerNotConfigured(RuntimeError):
    """Raised when Gmail credentials are missing from the environment."""


def is_valid_email(address: str) -> bool:
    return bool(_EMAIL_PATTERN.match(address or ""))


def _credentials() -> tuple[str, str, str]:
    address = os.getenv("GMAIL_ADDRESS", "").strip()
    password = os.getenv("GMAIL_APP_PASSWORD", "").replace(" ", "").strip()
    from_name = os.getenv("GMAIL_FROM_NAME", "NER-LOGIX").strip()

    if not address or not password:
        raise MailerNotConfigured(
            "GMAIL_ADDRESS and GMAIL_APP_PASSWORD must be set in backend/.env. "
            "The App Password is the 16-character code from "
            "myaccount.google.com/apppasswords, not your Gmail login password."
        )

    return address, password, from_name


def _send_sync(to_address: str, subject: str, body_text: str, body_html: str) -> None:
    sender, password, from_name = _credentials()

    message = EmailMessage()
    message["Subject"] = subject
    message["From"] = f"{from_name} <{sender}>"
    message["To"] = to_address
    message.set_content(body_text)
    message.add_alternative(body_html, subtype="html")

    context = ssl.create_default_context()

    with smtplib.SMTP(SMTP_HOST, SMTP_PORT, timeout=20) as server:
        server.starttls(context=context)
        server.login(sender, password)
        server.send_message(message)


async def send_email(
    to_address: str, subject: str, body_text: str, body_html: str
) -> None:
    """Async wrapper -- runs blocking smtplib in a worker thread."""
    await asyncio.to_thread(_send_sync, to_address, subject, body_text, body_html)


# ---------------------------------------------------------------------------
# OTP templates
# ---------------------------------------------------------------------------


def _otp_html(heading: str, intro: str, code: str, expiry_minutes: int) -> str:
    return f"""\
<!doctype html>
<html>
  <body style="margin:0;padding:24px;background:#f4f6f8;
               font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;">
    <div style="max-width:480px;margin:0 auto;background:#ffffff;
                border-radius:12px;padding:32px;border:1px solid #e3e8ef;">
      <h1 style="margin:0 0 4px;font-size:18px;color:#0f172a;">{heading}</h1>
      <p style="margin:0 0 24px;font-size:14px;color:#475569;">{intro}</p>

      <div style="font-size:32px;font-weight:700;letter-spacing:8px;
                  text-align:center;padding:18px;background:#f1f5f9;
                  border-radius:8px;color:#0f172a;">{code}</div>

      <p style="margin:24px 0 0;font-size:13px;color:#64748b;">
        This code expires in {expiry_minutes} minutes and can only be used once.
        If you didn't request it, you can ignore this email &mdash; no changes
        have been made to your account.
      </p>

      <p style="margin:24px 0 0;font-size:12px;color:#94a3b8;">
        NER-LOGIX &middot; Automated message, please don't reply.
      </p>
    </div>
  </body>
</html>"""


async def send_signup_otp(to_address: str, code: str, expiry_minutes: int = 10) -> None:
    heading = "Verify your NER-LOGIX account"
    intro = "Enter this code to finish creating your account."

    await send_email(
        to_address,
        "Your NER-LOGIX verification code",
        f"{intro}\n\n{code}\n\n"
        f"This code expires in {expiry_minutes} minutes and can only be used once.\n"
        "If you didn't request it, you can ignore this email.",
        _otp_html(heading, intro, code, expiry_minutes),
    )


async def send_password_reset_otp(
    to_address: str, code: str, expiry_minutes: int = 10
) -> None:
    heading = "Reset your NER-LOGIX password"
    intro = "Enter this code to choose a new password."

    await send_email(
        to_address,
        "Your NER-LOGIX password reset code",
        f"{intro}\n\n{code}\n\n"
        f"This code expires in {expiry_minutes} minutes and can only be used once.\n"
        "If you didn't request this, you can ignore this email and your "
        "password will stay unchanged.",
        _otp_html(heading, intro, code, expiry_minutes),
    )
