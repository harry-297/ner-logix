"""
Auth dependencies: who is calling, and are they allowed to.

This is the enforcement point for the role matrix. The frontend also hides
what a role cannot use, but that is presentation only -- anyone can bypass a
hidden nav item with a direct HTTP call, so every protected route depends on
`require_role(...)` here. The UI decides what is *shown*; this decides what is
*allowed*.

Role hierarchy (each tier includes everything below it):

    USER               core pages: map, routes, disruption predictor,
                       reporting an incident
    FIELD_OFFICER      + verify/resolve incidents, vehicles
    LOGISTICS_OFFICER  + analytics, admin actions (trigger re-scoring), promote users

Usage:

    @router.post("/something", dependencies=[Depends(require_role(FIELD_OFFICER))])

or, when the handler needs the caller's identity:

    async def handler(user: CurrentUser = Depends(require_role(FIELD_OFFICER))):
"""
from dataclasses import dataclass

from fastapi import Depends, HTTPException, Request, status
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db
from services.security import JWTError, decode_access_token

USER = "USER"
FIELD_OFFICER = "FIELD_OFFICER"
LOGISTICS_OFFICER = "LOGISTICS_OFFICER"

# Higher number grants everything a lower number grants.
ROLE_RANK = {
    USER: 1,
    FIELD_OFFICER: 2,
    LOGISTICS_OFFICER: 3,
}


@dataclass
class CurrentUser:
    user_id: str
    email: str
    name: str
    role: str

    def has_at_least(self, role: str) -> bool:
        return ROLE_RANK.get(self.role, 0) >= ROLE_RANK.get(role, 99)


def _extract_bearer_token(request: Request) -> str:
    header = request.headers.get("Authorization", "")

    scheme, _, token = header.partition(" ")
    if scheme.lower() != "bearer" or not token.strip():
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Not authenticated.",
            headers={"WWW-Authenticate": "Bearer"},
        )

    return token.strip()


async def get_current_user(
    request: Request,
    db: AsyncSession = Depends(get_db),
) -> CurrentUser:
    """
    Resolves the caller from their bearer token.

    The role is re-read from the database rather than trusted from the token's
    claim. The claim is signed and therefore not forgeable, but it is a
    snapshot from login time -- if a Logistics Officer demotes someone, that
    person's existing token still carries the old role until it expires. Going
    to the database costs one indexed lookup per request and makes demotion
    take effect immediately.

    The same lookup catches users deleted or un-verified since their token was
    issued.
    """
    token = _extract_bearer_token(request)

    try:
        claims = decode_access_token(token)
    except JWTError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=str(exc),
            headers={"WWW-Authenticate": "Bearer"},
        ) from exc

    user_id = claims.get("sub")
    if not user_id:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token is missing a subject.",
        )

    result = await db.execute(
        text(
            """
            SELECT user_id, email, name, role, is_verified
            FROM users
            WHERE user_id = CAST(:user_id AS uuid)
            """
        ),
        {"user_id": user_id},
    )
    row = result.mappings().first()

    if row is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Account no longer exists.",
        )

    if not row["is_verified"]:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Account email is not verified.",
        )

    return CurrentUser(
        user_id=str(row["user_id"]),
        email=row["email"],
        name=row["name"],
        role=row["role"],
    )


def require_role(minimum_role: str):
    """
    Dependency factory gating a route at `minimum_role` or above.

    Returns 403 rather than 404 when the caller is authenticated but outranked:
    they are a known user being told no, and pretending the route does not
    exist would only make the failure harder to debug. An unauthenticated
    caller still gets 401 from get_current_user first.
    """

    async def dependency(
        user: CurrentUser = Depends(get_current_user),
    ) -> CurrentUser:
        if not user.has_at_least(minimum_role):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=(
                    f"This action requires the {minimum_role.replace('_', ' ').title()} "
                    f"role or higher. Your role is "
                    f"{user.role.replace('_', ' ').title()}."
                ),
            )
        return user

    return dependency
