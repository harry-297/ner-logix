"""
Field Intelligence reports: submit, review, approve/reject.

Anyone signed in can submit a field report (USER and above, same tier as
reporting an incident elsewhere in the app). Seeing the *queue* of every
report and deciding on one is gated to Field Officer and above via
require_role(FIELD_OFFICER) -- a plain User can only ever see their own
reports (GET /mine).

Approving a report with coordinates also writes a row into `incidents`, so an
approved field report shows up on the Live Map and Incidents page the same
way any other confirmed incident does. Rejecting one just records the
decision; nothing else in the app changes.
"""
import base64
import re
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, field_validator, model_validator
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db
from dependencies import FIELD_OFFICER, CurrentUser, get_current_user, require_role

router = APIRouter(prefix="/api/field-reports", tags=["Field Reports"])

VALID_TYPES = {"Landslide", "Flood", "Road Damage", "Bridge Damage", "Traffic", "Other"}
VALID_STATUS = {"PENDING", "APPROVED", "REJECTED"}

# Data URLs look like "data:image/jpeg;base64,/9j/4AAQ...". The frontend may
# send either the bare base64 payload or the full data: URL -- accept both
# and normalize to bare base64 before it ever reaches a SQL parameter.
_DATA_URL_RE = re.compile(r"^data:(?P<mime>[\w.+-]+/[\w.+-]+);base64,(?P<data>.+)$", re.DOTALL)

ALLOWED_PHOTO_MIME = {"image/jpeg", "image/png", "image/webp", "image/gif", "image/heic", "image/heif"}

# Base64 inflates size by ~4/3. 7,000,000 chars of base64 is ~5.25 MB of raw
# image data -- generous for a phone photo, small enough that a report list
# query doesn't become a multi-hundred-MB response as the table grows.
MAX_PHOTO_BASE64_CHARS = 7_000_000

# Reasonable defaults so an approved report becomes a sensible incident even
# when the reporter didn't pick a severity (the field form doesn't ask for one).
SEVERITY_BY_TYPE = {
    "Landslide": "HIGH",
    "Flood": "HIGH",
    "Bridge Damage": "CRITICAL",
    "Road Damage": "MEDIUM",
    "Traffic": "LOW",
    "Other": "MEDIUM",
}

REPORT_COLUMNS = """
    report_id, type, location, description, latitude, longitude, photo_name,
    (photo_data IS NOT NULL) AS has_photo, photo_mime,
    status, reported_by, reporter_name, reviewed_by, reviewer_name,
    review_notes, reviewed_at, incident_id, created_at
"""
# photo_data itself is deliberately left out of REPORT_COLUMNS -- a report can
# hold a multi-MB image, and both the list and mine endpoints return every
# matching row at once, so pulling the full photo along with every row would
# make those payloads balloon as the table grows. GET /{report_id}/photo below
# fetches it on its own, on demand, for whichever single report needs it.


class FieldReportCreate(BaseModel):
    type: str
    location: str
    description: str = ""
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    photo_name: Optional[str] = None
    photo_data: Optional[str] = None
    photo_mime: Optional[str] = None

    @model_validator(mode="before")
    @classmethod
    def _split_data_url(cls, data):
        """
        Accepts photo_data either as a bare base64 string or a full
        "data:image/jpeg;base64,...." data URL (what FileReader.readAsDataURL
        hands back in the browser with no extra work). If it's a data URL and
        the caller didn't separately set photo_mime, pull the mime out of it
        here -- before the per-field validators below run on the split value.
        """
        if not isinstance(data, dict):
            return data

        photo_data = data.get("photo_data")
        if isinstance(photo_data, str):
            match = _DATA_URL_RE.match(photo_data)
            if match:
                data = dict(data)
                data["photo_data"] = match.group("data")
                if not data.get("photo_mime"):
                    data["photo_mime"] = match.group("mime")

        return data

    @field_validator("photo_data")
    @classmethod
    def _validate_photo_data(cls, v: Optional[str]) -> Optional[str]:
        if v is None or v == "":
            return None

        if len(v) > MAX_PHOTO_BASE64_CHARS:
            raise ValueError("Photo is too large (max ~5 MB).")

        try:
            # validate=True rejects anything containing non-base64 characters
            # instead of silently dropping them, so a corrupted upload fails
            # loudly here rather than storing unrecoverable image bytes.
            base64.b64decode(v, validate=True)
        except Exception as exc:  # noqa: BLE001
            raise ValueError("photo_data must be valid base64.") from exc

        return v

    @field_validator("photo_mime")
    @classmethod
    def _validate_photo_mime(cls, v: Optional[str]) -> Optional[str]:
        if v is None or v == "":
            return None
        if v not in ALLOWED_PHOTO_MIME:
            raise ValueError(f"Unsupported photo type. Allowed: {', '.join(sorted(ALLOWED_PHOTO_MIME))}.")
        return v

    @model_validator(mode="after")
    def _require_mime_with_data(self) -> "FieldReportCreate":
        if self.photo_data and not self.photo_mime:
            raise ValueError("photo_mime is required when photo_data is provided.")
        return self


class FieldReportDecision(BaseModel):
    status: str  # APPROVED | REJECTED
    review_notes: Optional[str] = Field(default=None, max_length=2000)


def _serialize(row) -> dict:
    data = dict(row)
    for key in ("created_at", "reviewed_at"):
        if data.get(key) is not None:
            data[key] = data[key].isoformat()
    return data


def _can_view_photo(report_reported_by, user: CurrentUser) -> bool:
    """The reporter can see their own photo; Field Officer+ can see any."""
    if user.has_at_least(FIELD_OFFICER):
        return True
    return report_reported_by is not None and str(report_reported_by) == user.user_id


def _split_location(location: str) -> tuple[str, str]:
    """'Pakyong, Sikkim' -> ('Pakyong', 'Sikkim'); no comma -> (location, 'Unspecified')."""
    parts = [p.strip() for p in location.split(",") if p.strip()]
    if len(parts) >= 2:
        return parts[0], parts[-1]
    return (parts[0] if parts else location), "Unspecified"


@router.post("")
async def create_field_report(
    payload: FieldReportCreate,
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if payload.type not in VALID_TYPES:
        raise HTTPException(status_code=400, detail="Unknown incident type.")
    if not payload.location.strip():
        raise HTTPException(status_code=400, detail="Location is required.")

    result = await db.execute(
        text(
            f"""
            INSERT INTO field_reports
                (type, location, description, latitude, longitude, photo_name,
                 photo_data, photo_mime, reported_by, reporter_name)
            VALUES
                (:type, :location, :description, :latitude, :longitude, :photo_name,
                 :photo_data, :photo_mime, CAST(:user_id AS uuid), :reporter_name)
            RETURNING {REPORT_COLUMNS}
            """
        ),
        {
            "type": payload.type,
            "location": payload.location.strip(),
            "description": payload.description.strip(),
            "latitude": payload.latitude,
            "longitude": payload.longitude,
            "photo_name": payload.photo_name,
            "photo_data": payload.photo_data,
            "photo_mime": payload.photo_mime,
            "user_id": user.user_id,
            "reporter_name": user.name,
        },
    )
    await db.commit()
    return _serialize(result.mappings().first())


@router.get("/mine")
async def list_my_field_reports(
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        text(
            f"""
            SELECT {REPORT_COLUMNS}
            FROM field_reports
            WHERE reported_by = CAST(:user_id AS uuid)
            ORDER BY created_at DESC
            """
        ),
        {"user_id": user.user_id},
    )
    reports = [_serialize(r) for r in result.mappings()]
    return {"count": len(reports), "reports": reports}


@router.get("/{report_id}/photo")
async def get_field_report_photo(
    report_id: str,
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Returns the base64 photo for one report, fetched on its own so the list
    endpoints above stay lightweight. Gated the same way the report itself is:
    the person who submitted it, or Field Officer and above.
    """
    result = await db.execute(
        text(
            """
            SELECT report_id, reported_by, photo_data, photo_mime, photo_name
            FROM field_reports
            WHERE report_id = CAST(:id AS uuid)
            """
        ),
        {"id": report_id},
    )
    report = result.mappings().first()

    if report is None:
        raise HTTPException(status_code=404, detail="Field report not found.")

    if not _can_view_photo(report["reported_by"], user):
        raise HTTPException(status_code=403, detail="You can't view this report's photo.")

    if report["photo_data"] is None:
        raise HTTPException(status_code=404, detail="This report has no photo.")

    return {
        "report_id": report["report_id"],
        "photo_name": report["photo_name"],
        "photo_mime": report["photo_mime"],
        "photo_data": report["photo_data"],
    }


@router.get("", dependencies=[Depends(require_role(FIELD_OFFICER))])
async def list_field_reports(
    status: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
):
    """Every field report, newest first. Field Officer and above only."""
    if status and status not in VALID_STATUS:
        raise HTTPException(status_code=400, detail="status must be PENDING, APPROVED or REJECTED.")

    query = f"SELECT {REPORT_COLUMNS} FROM field_reports"
    params: dict = {}
    if status:
        query += " WHERE status = :status"
        params["status"] = status
    query += " ORDER BY created_at DESC"

    result = await db.execute(text(query), params)
    reports = [_serialize(r) for r in result.mappings()]
    return {"count": len(reports), "reports": reports}


@router.patch("/{report_id}/decision")
async def decide_field_report(
    report_id: str,
    payload: FieldReportDecision,
    user: CurrentUser = Depends(require_role(FIELD_OFFICER)),
    db: AsyncSession = Depends(get_db),
):
    if payload.status not in {"APPROVED", "REJECTED"}:
        raise HTTPException(status_code=400, detail="status must be APPROVED or REJECTED.")

    existing = await db.execute(
        text("SELECT * FROM field_reports WHERE report_id = CAST(:id AS uuid)"),
        {"id": report_id},
    )
    report = existing.mappings().first()

    if report is None:
        raise HTTPException(status_code=404, detail="Field report not found.")
    if report["status"] != "PENDING":
        raise HTTPException(
            status_code=409,
            detail=f"This report was already {report['status'].lower()} and can't be reviewed again.",
        )

    incident_id = None

    if payload.status == "APPROVED" and report["latitude"] is not None and report["longitude"] is not None:
        district, state = _split_location(report["location"])

        incident_result = await db.execute(
            text(
                """
                INSERT INTO incidents
                    (type, severity, title, description, state, district,
                     latitude, longitude, geometry, source, status)
                VALUES
                    (:type, :severity, :title, :description, :state, :district,
                     :latitude, :longitude,
                     ST_SetSRID(ST_MakePoint(:longitude, :latitude), 4326),
                     :source, 'ACTIVE')
                RETURNING incident_id
                """
            ),
            {
                "type": report["type"].upper().replace(" ", "_"),
                "severity": SEVERITY_BY_TYPE.get(report["type"], "MEDIUM"),
                "title": f"{report['type']} reported at {report['location']}",
                "description": report["description"] or "Approved from a field report.",
                "state": state,
                "district": district,
                "latitude": report["latitude"],
                "longitude": report["longitude"],
                "source": f"Field report by {report['reporter_name']}",
            },
        )
        incident_id = incident_result.mappings().first()["incident_id"]

    updated = await db.execute(
        text(
            f"""
            UPDATE field_reports
            SET status = :status,
                reviewed_by = CAST(:reviewer_id AS uuid),
                reviewer_name = :reviewer_name,
                review_notes = :review_notes,
                reviewed_at = now(),
                incident_id = :incident_id
            WHERE report_id = CAST(:id AS uuid)
            RETURNING {REPORT_COLUMNS}
            """
        ),
        {
            "status": payload.status,
            "reviewer_id": user.user_id,
            "reviewer_name": user.name,
            "review_notes": payload.review_notes,
            "incident_id": incident_id,
            "id": report_id,
        },
    )
    await db.commit()
    return _serialize(updated.mappings().first())
