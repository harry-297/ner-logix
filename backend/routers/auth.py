"""
Authentication endpoints.

Flow:
    signup            -> creates an unverified user, emails a code
    verify-signup-otp -> marks verified, returns a token
    login             -> email + password, returns a token
    forgot-password   -> emails a code
    reset-password    -> verifies the code, sets a new password
    me                -> the caller's own profile
    users, promote    -> Logistics Officer only

Everyone signs up as USER. Role is never accepted from the signup request --
if it were, "authentication" would prove who someone is but not what they may
do, and anyone could self-register with admin rights. Elevation happens only
through PATCH /api/auth/users/{user_id}/role, which is itself gated to
LOGISTICS_OFFICER.
"""
import logging
import uuid
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db
from dependencies import (
    LOGISTICS_OFFICER,
    ROLE_RANK,
    USER,
    CurrentUser,
    get_current_user,
    require_role,
)
from services import mailer
from services.security import (
    create_access_token,
    generate_otp,
    hash_otp,
    hash_password,
    verify_otp,
    verify_password,
)
from services.validation import normalize_person_name

router = APIRouter(prefix="/api/auth", tags=["auth"])
logger = logging.getLogger("auth")

OTP_EXPIRY_MINUTES = 10
MIN_PASSWORD_LENGTH = 8


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------


class SignupRequest(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    email: str = Field(max_length=254)
    phone: str | None = Field(default=None, max_length=32)
    password: str = Field(min_length=MIN_PASSWORD_LENGTH, max_length=256)
    # No `role` field, by design. See module docstring.

    @field_validator("name")
    @classmethod
    def _validate_name(cls, value: str) -> str:
        # Letters and spaces only -- see services/validation.py. Returns the
        # cleaned-up name, so the handler stores exactly what was validated.
        return normalize_person_name(value)


class VerifyOtpRequest(BaseModel):
    email: str
    code: str = Field(min_length=6, max_length=6)


class LoginRequest(BaseModel):
    email: str
    password: str


class ForgotPasswordRequest(BaseModel):
    email: str


class ResetPasswordRequest(BaseModel):
    email: str
    code: str = Field(min_length=6, max_length=6)
    new_password: str = Field(min_length=MIN_PASSWORD_LENGTH, max_length=256)


class PromoteRequest(BaseModel):
    role: str


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _token_response(user_id: str, name: str, email: str, role: str) -> dict:
    return {
        "access_token": create_access_token(subject=user_id, role=role),
        "token_type": "bearer",
        "user": {"id": user_id, "name": name, "email": email, "role": role},
    }


async def _issue_otp(db: AsyncSession, email: str, purpose: str) -> str:
    """
    Creates a fresh OTP, invalidating any earlier unused one for the same
    email and purpose so only the newest code ever works. Without this, a
    user who requests a second code could still verify with the first, and
    every outstanding code would widen the guessing surface.
    """
    await db.execute(
        text(
            """
            UPDATE otp_codes
            SET consumed_at = now()
            WHERE email = :email AND purpose = :purpose AND consumed_at IS NULL
            """
        ),
        {"email": email, "purpose": purpose},
    )

    code = generate_otp()
    code_hash, code_salt = hash_otp(code)

    await db.execute(
        text(
            """
            INSERT INTO otp_codes (email, code_hash, code_salt, purpose, expires_at)
            VALUES (:email, :code_hash, :code_salt, :purpose, :expires_at)
            """
        ),
        {
            "email": email,
            "code_hash": code_hash,
            "code_salt": code_salt,
            "purpose": purpose,
            "expires_at": _now() + timedelta(minutes=OTP_EXPIRY_MINUTES),
        },
    )
    await db.commit()
    return code


async def _consume_otp(db: AsyncSession, email: str, code: str, purpose: str) -> None:
    """
    Validates a code and marks it used. Raises HTTPException on any failure.

    Attempts are counted against the stored row so a six-digit code cannot be
    walked through at leisure -- after max_attempts the row is burned and the
    user has to request a new code.
    """
    result = await db.execute(
        text(
            """
            SELECT otp_id, code_hash, code_salt, attempts, max_attempts, expires_at
            FROM otp_codes
            WHERE email = :email AND purpose = :purpose AND consumed_at IS NULL
            ORDER BY created_at DESC
            LIMIT 1
            """
        ),
        {"email": email, "purpose": purpose},
    )
    row = result.mappings().first()

    if row is None:
        raise HTTPException(
            status_code=400,
            detail="No active code for this email. Request a new one.",
        )

    if row["expires_at"] < _now():
        raise HTTPException(
            status_code=400, detail="That code has expired. Request a new one."
        )

    if row["attempts"] >= row["max_attempts"]:
        await db.execute(
            text("UPDATE otp_codes SET consumed_at = now() WHERE otp_id = :otp_id"),
            {"otp_id": row["otp_id"]},
        )
        await db.commit()
        raise HTTPException(
            status_code=429,
            detail="Too many incorrect attempts. Request a new code.",
        )

    if not verify_otp(code, row["code_hash"], row["code_salt"]):
        await db.execute(
            text(
                "UPDATE otp_codes SET attempts = attempts + 1 WHERE otp_id = :otp_id"
            ),
            {"otp_id": row["otp_id"]},
        )
        await db.commit()

        remaining = row["max_attempts"] - row["attempts"] - 1
        raise HTTPException(
            status_code=400,
            detail=f"Incorrect code. {max(remaining, 0)} attempt(s) remaining.",
        )

    await db.execute(
        text("UPDATE otp_codes SET consumed_at = now() WHERE otp_id = :otp_id"),
        {"otp_id": row["otp_id"]},
    )
    await db.commit()


# ---------------------------------------------------------------------------
# Signup
# ---------------------------------------------------------------------------


@router.post("/signup", status_code=status.HTTP_201_CREATED)
async def signup(payload: SignupRequest, db: AsyncSession = Depends(get_db)):
    email = payload.email.strip().lower()

    if not mailer.is_valid_email(email):
        raise HTTPException(status_code=422, detail="That doesn't look like a valid email address.")

    existing = await db.execute(
        text("SELECT user_id, is_verified FROM users WHERE email = :email"),
        {"email": email},
    )
    row = existing.mappings().first()

    if row is not None:
        if row["is_verified"]:
            raise HTTPException(
                status_code=409,
                detail="An account with this email already exists. Try logging in.",
            )
        # Unverified signup already exists -- most likely the user abandoned
        # the flow or never got the email. Re-send rather than blocking them
        # out of an account they cannot log into anyway.
        code = await _issue_otp(db, email, "SIGNUP")
        await _deliver_otp(mailer.send_signup_otp, email, code)
        return {
            "message": "Account already pending verification. A new code has been sent.",
            "email": email,
        }

    password_hash, password_salt, iterations = hash_password(payload.password)

    await db.execute(
        text(
            """
            INSERT INTO users (name, email, phone, password_hash, password_salt,
                               password_iterations, role, is_verified)
            VALUES (:name, :email, :phone, :password_hash, :password_salt,
                    :iterations, :role, FALSE)
            """
        ),
        {
            "name": payload.name.strip(),
            "email": email,
            "phone": payload.phone,
            "password_hash": password_hash,
            "password_salt": password_salt,
            "iterations": iterations,
            "role": USER,
        },
    )
    await db.commit()

    code = await _issue_otp(db, email, "SIGNUP")
    await _deliver_otp(mailer.send_signup_otp, email, code)

    return {
        "message": "Account created. Check your email for a verification code.",
        "email": email,
    }


async def _deliver_otp(send_fn, email: str, code: str) -> None:
    """
    Sends an OTP, converting mail failures into a clear 503.

    The code is never returned in the response body or logged, even on
    failure -- an OTP that appears in an API response or a log file is not a
    second factor at all.
    """
    try:
        await send_fn(email, code, OTP_EXPIRY_MINUTES)
    except mailer.MailerNotConfigured as exc:
        logger.error(f"Mailer not configured: {exc}")
        raise HTTPException(
            status_code=503,
            detail="Email sending is not configured on the server.",
        ) from exc
    except Exception as exc:  # noqa: BLE001
        logger.error(f"Failed to send OTP to {email}: {exc}")
        raise HTTPException(
            status_code=503,
            detail="Could not send the verification email. Please try again.",
        ) from exc


@router.post("/verify-signup-otp")
async def verify_signup_otp(
    payload: VerifyOtpRequest, db: AsyncSession = Depends(get_db)
):
    email = payload.email.strip().lower()
    await _consume_otp(db, email, payload.code, "SIGNUP")

    result = await db.execute(
        text(
            """
            UPDATE users SET is_verified = TRUE
            WHERE email = :email
            RETURNING user_id, name, email, role
            """
        ),
        {"email": email},
    )
    row = result.mappings().first()
    await db.commit()

    if row is None:
        raise HTTPException(status_code=404, detail="No account found for this email.")

    return _token_response(str(row["user_id"]), row["name"], row["email"], row["role"])


@router.post("/resend-signup-otp")
async def resend_signup_otp(payload: ForgotPasswordRequest, db: AsyncSession = Depends(get_db)):
    email = payload.email.strip().lower()

    result = await db.execute(
        text("SELECT is_verified FROM users WHERE email = :email"), {"email": email}
    )
    row = result.mappings().first()

    if row is None or row["is_verified"]:
        # Same response either way -- see the note in forgot_password.
        return {"message": "If that account needs verification, a code has been sent."}

    code = await _issue_otp(db, email, "SIGNUP")
    await _deliver_otp(mailer.send_signup_otp, email, code)
    return {"message": "If that account needs verification, a code has been sent."}


# ---------------------------------------------------------------------------
# Login
# ---------------------------------------------------------------------------


@router.post("/login")
async def login(payload: LoginRequest, db: AsyncSession = Depends(get_db)):
    email = payload.email.strip().lower()

    result = await db.execute(
        text(
            """
            SELECT user_id, name, email, role, is_verified,
                   password_hash, password_salt, password_iterations
            FROM users WHERE email = :email
            """
        ),
        {"email": email},
    )
    row = result.mappings().first()

    # Unknown email and wrong password return the same message on purpose.
    # Distinguishing them turns the login form into a way to enumerate which
    # addresses have accounts.
    invalid = HTTPException(status_code=401, detail="Incorrect email or password.")

    if row is None:
        raise invalid

    if not verify_password(
        payload.password,
        row["password_hash"],
        row["password_salt"],
        row["password_iterations"],
    ):
        raise invalid

    if not row["is_verified"]:
        raise HTTPException(
            status_code=403,
            detail="Email not verified. Check your inbox for the verification code.",
        )

    await db.execute(
        text("UPDATE users SET last_login_at = now() WHERE user_id = :user_id"),
        {"user_id": row["user_id"]},
    )
    await db.commit()

    return _token_response(str(row["user_id"]), row["name"], row["email"], row["role"])


# ---------------------------------------------------------------------------
# Password reset
# ---------------------------------------------------------------------------


@router.post("/forgot-password")
async def forgot_password(
    payload: ForgotPasswordRequest, db: AsyncSession = Depends(get_db)
):
    """
    Always reports success, whether or not the account exists.

    Saying "no account with that email" would let anyone test addresses
    against your user base one at a time. The cost is that a user who typos
    their address sees success and no email -- an acceptable trade, and the
    message is worded to hint at it.
    """
    email = payload.email.strip().lower()
    generic = {
        "message": "If an account exists for that email, a reset code has been sent."
    }

    result = await db.execute(
        text("SELECT user_id FROM users WHERE email = :email"), {"email": email}
    )
    if result.mappings().first() is None:
        return generic

    code = await _issue_otp(db, email, "PASSWORD_RESET")
    await _deliver_otp(mailer.send_password_reset_otp, email, code)
    return generic


@router.post("/reset-password")
async def reset_password(
    payload: ResetPasswordRequest, db: AsyncSession = Depends(get_db)
):
    email = payload.email.strip().lower()
    await _consume_otp(db, email, payload.code, "PASSWORD_RESET")

    password_hash, password_salt, iterations = hash_password(payload.new_password)

    result = await db.execute(
        text(
            """
            UPDATE users
            SET password_hash = :password_hash,
                password_salt = :password_salt,
                password_iterations = :iterations,
                is_verified = TRUE
            WHERE email = :email
            RETURNING user_id, name, email, role
            """
        ),
        {
            "password_hash": password_hash,
            "password_salt": password_salt,
            "iterations": iterations,
            "email": email,
        },
    )
    row = result.mappings().first()
    await db.commit()

    if row is None:
        raise HTTPException(status_code=404, detail="No account found for this email.")

    # is_verified is set above because completing an emailed code proves
    # control of the address just as signup verification does -- a user stuck
    # unverified can recover this way rather than being permanently locked out.
    return _token_response(str(row["user_id"]), row["name"], row["email"], row["role"])


# ---------------------------------------------------------------------------
# Profile and role management
# ---------------------------------------------------------------------------


@router.get("/me")
async def me(user: CurrentUser = Depends(get_current_user)):
    return {
        "id": user.user_id,
        "name": user.name,
        "email": user.email,
        "role": user.role,
    }


MAX_USER_RESULTS = 100


@router.get("/users", dependencies=[Depends(require_role(LOGISTICS_OFFICER))])
async def list_users(
    q: str = "",
    limit: int = 50,
    db: AsyncSession = Depends(get_db),
):
    """
    Directory for the promotion screen. Logistics Officer only.

    `q` filters by email (partial, case-insensitive). With no `q` it returns the
    most recently created accounts, so the screen is useful before anyone has
    typed anything. Results are capped so a large user table cannot be dumped
    in one request.
    """
    limit = max(1, min(limit, MAX_USER_RESULTS))
    params: dict = {"limit": limit}
    where = ""

    query = q.strip()
    if query:
        # LIKE treats % and _ as wildcards. Escape them so a search for
        # "a_b@x.com" matches that literal address rather than "aXb@x.com".
        # "!" is the escape character because it needs no further quoting.
        escaped = query.replace("!", "!!").replace("%", "!%").replace("_", "!_")
        where = "WHERE CAST(email AS text) ILIKE :pattern ESCAPE '!'"
        params["pattern"] = f"%{escaped}%"

    result = await db.execute(
        text(
            f"""
            SELECT user_id, name, email, phone, role, is_verified,
                   created_at, last_login_at
            FROM users
            {where}
            ORDER BY created_at DESC
            LIMIT :limit
            """
        ),
        params,
    )
    return {
        "users": [
            {
                "id": str(r["user_id"]),
                "name": r["name"],
                "email": r["email"],
                "phone": r["phone"],
                "role": r["role"],
                "is_verified": r["is_verified"],
                "created_at": r["created_at"].isoformat() if r["created_at"] else None,
                "last_login_at": (
                    r["last_login_at"].isoformat() if r["last_login_at"] else None
                ),
            }
            for r in result.mappings().all()
        ]
    }


@router.patch("/users/{user_id}/role")
async def set_user_role(
    user_id: str,
    payload: PromoteRequest,
    actor: CurrentUser = Depends(require_role(LOGISTICS_OFFICER)),
    db: AsyncSession = Depends(get_db),
):
    """
    Promote or demote a user. Logistics Officer only.

    A Logistics Officer cannot change their own role. Otherwise the last one
    could demote themselves by accident and leave nobody able to promote
    anyone back -- recoverable only by hand-editing the database.
    """
    role = payload.role.strip().upper()

    if role not in ROLE_RANK:
        raise HTTPException(
            status_code=422,
            detail=f"Unknown role. Must be one of: {', '.join(ROLE_RANK)}.",
        )

    # A malformed id would otherwise reach CAST(... AS uuid) and surface as a
    # database error (HTTP 500) instead of a clean "no such user".
    try:
        uuid.UUID(user_id)
    except ValueError:
        raise HTTPException(status_code=404, detail="No such user.")

    if str(user_id) == actor.user_id:
        raise HTTPException(
            status_code=400,
            detail="You cannot change your own role.",
        )

    result = await db.execute(
        text(
            """
            UPDATE users SET role = :role
            WHERE user_id = CAST(:user_id AS uuid)
            RETURNING user_id, name, email, role
            """
        ),
        {"role": role, "user_id": user_id},
    )
    row = result.mappings().first()
    await db.commit()

    if row is None:
        raise HTTPException(status_code=404, detail="No such user.")

    logger.info(f"{actor.email} set {row['email']} to {role}")

    return {
        "id": str(row["user_id"]),
        "name": row["name"],
        "email": row["email"],
        "role": row["role"],
    }
