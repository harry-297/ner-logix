"""
Password hashing and JWT issuing/verification.

Deliberately stdlib-only -- hashlib, hmac, secrets, base64, json. No bcrypt,
no python-jose, no PyJWT. Two reasons: nothing new to install on a teammate's
machine before the project runs, and every line here is testable offline.

Password hashing: PBKDF2-HMAC-SHA256
------------------------------------
Plain SHA-256 is not a password hash. It is built to be fast, which is the
opposite of what you want when an attacker has your `users` table -- a
consumer GPU tries billions of plain-SHA-256 guesses per second. Unsalted, it
is worse still: identical passwords produce identical hashes, so one cracked
row cracks every user who reused that password, and precomputed rainbow
tables apply directly.

PBKDF2 keeps SHA-256 as the underlying primitive but adds the two things that
actually matter -- a per-user random salt, and a high iteration count that
makes each guess deliberately expensive. ITERATIONS is stored per-row in the
database rather than hardcoded at verification time, so it can be raised
later without invalidating anyone's existing password.
"""
import base64
import hashlib
import hmac
import json
import os
import secrets
import time
from typing import Any

# Tuned so a single verification costs roughly 100-200 ms on typical hardware.
# High enough to be painful to brute-force, low enough not to be a DoS vector
# against your own login endpoint.
ITERATIONS = 300_000
SALT_BYTES = 16
HASH_NAME = "sha256"

# OTP codes are only six digits and live for ten minutes, so they cannot be
# protected by entropy the way a password can. Hashing them at rest stops a
# database leak from handing out live codes verbatim; the real defences are
# the short expiry and the attempt cap in the auth router. A lower iteration
# count is deliberate -- OTPs are verified on a hot path and the stored value
# is worthless within minutes either way.
OTP_ITERATIONS = 10_000


# ---------------------------------------------------------------------------
# Passwords
# ---------------------------------------------------------------------------


def hash_password(password: str, iterations: int = ITERATIONS) -> tuple[str, str, int]:
    """
    Returns (hash_hex, salt_hex, iterations) for storing on the user row.

    The iteration count is returned alongside the hash so the caller persists
    the value actually used, not whatever the constant happens to be later.
    """
    salt = secrets.token_bytes(SALT_BYTES)
    derived = hashlib.pbkdf2_hmac(HASH_NAME, password.encode("utf-8"), salt, iterations)
    return derived.hex(), salt.hex(), iterations


def verify_password(
    password: str,
    stored_hash_hex: str,
    salt_hex: str,
    iterations: int,
) -> bool:
    """
    Checks a password against a stored hash.

    Uses compare_digest rather than `==`: a plain comparison returns as soon
    as it finds a differing byte, and that timing difference is measurable
    over enough requests, leaking the hash one byte at a time.
    """
    try:
        salt = bytes.fromhex(salt_hex)
        expected = bytes.fromhex(stored_hash_hex)
    except ValueError:
        return False

    derived = hashlib.pbkdf2_hmac(HASH_NAME, password.encode("utf-8"), salt, iterations)
    return hmac.compare_digest(derived, expected)


# ---------------------------------------------------------------------------
# OTP codes
# ---------------------------------------------------------------------------


def generate_otp() -> str:
    """
    A six-digit code from `secrets`, not `random`.

    `random` is a Mersenne Twister seeded predictably enough that observing a
    few outputs can reveal the sequence -- fine for simulations, never for
    anything a person could gain by guessing.
    """
    return f"{secrets.randbelow(1_000_000):06d}"


def hash_otp(code: str) -> tuple[str, str]:
    """Returns (hash_hex, salt_hex) for storing on the otp_codes row."""
    salt = secrets.token_bytes(SALT_BYTES)
    derived = hashlib.pbkdf2_hmac(HASH_NAME, code.encode("utf-8"), salt, OTP_ITERATIONS)
    return derived.hex(), salt.hex()


def verify_otp(code: str, stored_hash_hex: str, salt_hex: str) -> bool:
    try:
        salt = bytes.fromhex(salt_hex)
        expected = bytes.fromhex(stored_hash_hex)
    except ValueError:
        return False

    derived = hashlib.pbkdf2_hmac(HASH_NAME, code.encode("utf-8"), salt, OTP_ITERATIONS)
    return hmac.compare_digest(derived, expected)


# ---------------------------------------------------------------------------
# JWT (HS256)
# ---------------------------------------------------------------------------
# A JWT is three base64url segments joined by dots: header.payload.signature.
# Only the signature is secret-dependent -- the payload is *encoded*, not
# encrypted, and anyone holding the token can read it. So: no passwords, no
# password hashes, nothing sensitive in the claims. Role lives there because
# it is not a secret; it is signed, so it cannot be tampered with, which is
# the property that matters.


class JWTError(Exception):
    """Raised for any malformed, mis-signed, or expired token."""


def _b64url_encode(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode("ascii")


def _b64url_decode(segment: str) -> bytes:
    # base64url strips '=' padding; restore it before decoding.
    padding = "=" * (-len(segment) % 4)
    return base64.urlsafe_b64decode(segment + padding)


def _get_secret() -> str:
    secret = os.getenv("JWT_SECRET")
    if not secret:
        raise RuntimeError(
            "JWT_SECRET is not set in .env. Generate one with:\n"
            "  python -c \"import secrets; print(secrets.token_urlsafe(48))\""
        )
    if len(secret) < 32:
        raise RuntimeError(
            "JWT_SECRET is too short to be safe (needs 32+ characters). "
            "A guessable secret lets anyone mint a valid admin token."
        )
    return secret


def create_access_token(
    subject: str,
    role: str,
    expires_in_seconds: int = 12 * 60 * 60,
) -> str:
    """
    Signs a token for `subject` (the user_id) carrying their role.

    Default lifetime is 12 hours. There is no refresh-token flow and no
    server-side revocation list, which is the real trade-off to know about:
    a token stays valid until it expires, so demoting or deleting a user does
    not immediately cut off a session they already hold. For this project
    that is acceptable; a production deployment would want short-lived access
    tokens plus refresh, or a revocation check on each request.
    """
    issued_at = int(time.time())

    header = {"alg": "HS256", "typ": "JWT"}
    payload = {
        "sub": subject,
        "role": role,
        "iat": issued_at,
        "exp": issued_at + expires_in_seconds,
    }

    segments = [
        _b64url_encode(json.dumps(header, separators=(",", ":")).encode()),
        _b64url_encode(json.dumps(payload, separators=(",", ":")).encode()),
    ]
    signing_input = ".".join(segments).encode("ascii")

    signature = hmac.new(
        _get_secret().encode("utf-8"), signing_input, hashlib.sha256
    ).digest()
    segments.append(_b64url_encode(signature))

    return ".".join(segments)


def decode_access_token(token: str) -> dict[str, Any]:
    """
    Verifies signature and expiry, then returns the claims.

    The algorithm in the header is checked against HS256 rather than trusted.
    Accepting whatever the header claims is the classic JWT vulnerability: a
    forged token with `"alg": "none"` would otherwise validate with no
    signature at all.
    """
    parts = token.split(".")
    if len(parts) != 3:
        raise JWTError("Malformed token.")

    header_segment, payload_segment, signature_segment = parts

    try:
        header = json.loads(_b64url_decode(header_segment))
    except Exception as exc:
        raise JWTError("Malformed token header.") from exc

    if header.get("alg") != "HS256":
        raise JWTError("Unexpected token algorithm.")

    signing_input = f"{header_segment}.{payload_segment}".encode("ascii")
    expected_signature = hmac.new(
        _get_secret().encode("utf-8"), signing_input, hashlib.sha256
    ).digest()

    try:
        actual_signature = _b64url_decode(signature_segment)
    except Exception as exc:
        raise JWTError("Malformed token signature.") from exc

    if not hmac.compare_digest(expected_signature, actual_signature):
        raise JWTError("Token signature does not match.")

    try:
        claims = json.loads(_b64url_decode(payload_segment))
    except Exception as exc:
        raise JWTError("Malformed token payload.") from exc

    if int(claims.get("exp", 0)) < int(time.time()):
        raise JWTError("Token has expired.")

    return claims
