"""
Creates the first Logistics Officer.

Chicken-and-egg problem: everyone who signs up gets the USER role, and only a
Logistics Officer can promote anyone. So the first one has to be made outside
the signup flow. Run this once.

    cd backend
    python ../scripts/seed_admin.py

It prompts for name, email and password, writes the user directly with
is_verified = TRUE (skipping the email OTP, since you are creating this
account deliberately at the console), and uses exactly the same PBKDF2
hashing as the signup endpoint -- so the resulting account logs in normally
through the UI with no special handling.

Safe to re-run: if the email already exists it offers to promote that account
and reset its password rather than erroring out or creating a duplicate.
"""
import asyncio
import getpass
import os
import sys
from pathlib import Path

# Run from anywhere: put backend/ on the path so `database` and `services`
# resolve the same way they do under uvicorn.
BACKEND_DIR = Path(__file__).resolve().parent.parent / "backend"
sys.path.insert(0, str(BACKEND_DIR))
os.chdir(BACKEND_DIR)

from sqlalchemy import text  # noqa: E402

from database import AsyncSessionLocal  # noqa: E402
from services.security import hash_password  # noqa: E402

MIN_PASSWORD_LENGTH = 8


async def main() -> None:
    print("Create the first NER-LOGIX Logistics Officer")
    print("-" * 44)

    name = input("Full name: ").strip()
    email = input("Email: ").strip().lower()

    if not name or not email:
        sys.exit("Name and email are both required.")

    password = getpass.getpass("Password (min 8 chars, hidden): ")
    if len(password) < MIN_PASSWORD_LENGTH:
        sys.exit(f"Password must be at least {MIN_PASSWORD_LENGTH} characters.")

    if password != getpass.getpass("Confirm password: "):
        sys.exit("Passwords do not match.")

    password_hash, password_salt, iterations = hash_password(password)

    async with AsyncSessionLocal() as db:
        existing = await db.execute(
            text("SELECT user_id, role FROM users WHERE email = :email"),
            {"email": email},
        )
        row = existing.mappings().first()

        if row is not None:
            answer = input(
                f"\n{email} already exists with role {row['role']}.\n"
                "Promote it to LOGISTICS_OFFICER and reset its password? [y/N] "
            )
            if answer.strip().lower() != "y":
                sys.exit("Cancelled. Nothing changed.")

            await db.execute(
                text(
                    """
                    UPDATE users
                    SET role = 'LOGISTICS_OFFICER',
                        is_verified = TRUE,
                        password_hash = :password_hash,
                        password_salt = :password_salt,
                        password_iterations = :iterations
                    WHERE email = :email
                    """
                ),
                {
                    "password_hash": password_hash,
                    "password_salt": password_salt,
                    "iterations": iterations,
                    "email": email,
                },
            )
            await db.commit()
            print(f"\n{email} is now a verified LOGISTICS_OFFICER.")
            return

        await db.execute(
            text(
                """
                INSERT INTO users (name, email, password_hash, password_salt,
                                   password_iterations, role, is_verified)
                VALUES (:name, :email, :password_hash, :password_salt,
                        :iterations, 'LOGISTICS_OFFICER', TRUE)
                """
            ),
            {
                "name": name,
                "email": email,
                "password_hash": password_hash,
                "password_salt": password_salt,
                "iterations": iterations,
            },
        )
        await db.commit()

    print(f"\nCreated {email} as a verified LOGISTICS_OFFICER.")
    print("Log in through the UI with this email and password.")


if __name__ == "__main__":
    asyncio.run(main())
