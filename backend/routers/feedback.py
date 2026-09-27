"""
App feedback: submit, browse, and review.

Any signed-in user (USER and above) can submit feedback and see their own
submissions. Seeing every submission, the aggregate stats, and marking one
reviewed/actioned is gated to Field Officer and above -- "the logistics and
field officer can access them for continuous improvement", per the product
request this router was built for.
"""
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db
from dependencies import FIELD_OFFICER, CurrentUser, get_current_user, require_role

router = APIRouter(prefix="/api/feedback", tags=["Feedback"])

VALID_CATEGORIES = {
    "Usability",
    "Data Accuracy",
    "Performance",
    "Feature Request",
    "Bug Report",
    "Other",
}
VALID_STATUS = {"NEW", "REVIEWED", "ACTIONED"}

FEEDBACK_COLUMNS = """
    feedback_id, user_id, user_name, user_role, category, rating, message,
    page_context, status, reviewed_by, review_notes, reviewed_at, created_at
"""


class FeedbackCreate(BaseModel):
    category: str
    rating: int = Field(ge=1, le=5)
    message: str
    page_context: Optional[str] = None


class FeedbackDecision(BaseModel):
    status: str  # REVIEWED | ACTIONED | NEW (to reopen)
    review_notes: Optional[str] = Field(default=None, max_length=2000)


def _serialize(row) -> dict:
    data = dict(row)
    for key in ("created_at", "reviewed_at"):
        if data.get(key) is not None:
            data[key] = data[key].isoformat()
    return data


@router.post("")
async def submit_feedback(
    payload: FeedbackCreate,
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if payload.category not in VALID_CATEGORIES:
        raise HTTPException(status_code=400, detail="Unknown feedback category.")
    if not payload.message.strip():
        raise HTTPException(status_code=400, detail="Feedback message is required.")

    result = await db.execute(
        text(
            f"""
            INSERT INTO feedback
                (user_id, user_name, user_role, category, rating, message, page_context)
            VALUES
                (CAST(:user_id AS uuid), :user_name, :user_role, :category, :rating,
                 :message, :page_context)
            RETURNING {FEEDBACK_COLUMNS}
            """
        ),
        {
            "user_id": user.user_id,
            "user_name": user.name,
            "user_role": user.role,
            "category": payload.category,
            "rating": payload.rating,
            "message": payload.message.strip(),
            "page_context": payload.page_context,
        },
    )
    await db.commit()
    return _serialize(result.mappings().first())


@router.get("/mine")
async def list_my_feedback(
    user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        text(
            f"""
            SELECT {FEEDBACK_COLUMNS}
            FROM feedback
            WHERE user_id = CAST(:user_id AS uuid)
            ORDER BY created_at DESC
            """
        ),
        {"user_id": user.user_id},
    )
    items = [_serialize(r) for r in result.mappings()]
    return {"count": len(items), "feedback": items}


@router.get("/stats", dependencies=[Depends(require_role(FIELD_OFFICER))])
async def feedback_stats(db: AsyncSession = Depends(get_db)):
    """Aggregate numbers for the Feedback Review dashboard."""
    summary_result = await db.execute(
        text(
            """
            SELECT
                COUNT(*) AS total,
                ROUND(AVG(rating)::numeric, 2) AS average_rating,
                COUNT(*) FILTER (WHERE status = 'NEW') AS new_count,
                COUNT(*) FILTER (WHERE status = 'REVIEWED') AS reviewed_count,
                COUNT(*) FILTER (WHERE status = 'ACTIONED') AS actioned_count,
                COUNT(*) FILTER (WHERE rating <= 2) AS low_rating_count
            FROM feedback
            """
        )
    )
    summary = dict(summary_result.mappings().first())
    if summary.get("average_rating") is not None:
        summary["average_rating"] = float(summary["average_rating"])

    category_result = await db.execute(
        text(
            """
            SELECT
                category,
                COUNT(*) AS count,
                ROUND(AVG(rating)::numeric, 2) AS average_rating
            FROM feedback
            GROUP BY category
            ORDER BY count DESC
            """
        )
    )
    by_category = []
    for row in category_result.mappings():
        item = dict(row)
        item["average_rating"] = float(item["average_rating"]) if item["average_rating"] is not None else None
        by_category.append(item)

    return {"summary": summary, "by_category": by_category}


@router.get("", dependencies=[Depends(require_role(FIELD_OFFICER))])
async def list_feedback(
    status: Optional[str] = None,
    category: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
):
    if status and status not in VALID_STATUS:
        raise HTTPException(status_code=400, detail="status must be NEW, REVIEWED or ACTIONED.")
    if category and category not in VALID_CATEGORIES:
        raise HTTPException(status_code=400, detail="Unknown feedback category.")

    query = f"SELECT {FEEDBACK_COLUMNS} FROM feedback WHERE 1 = 1"
    params: dict = {}
    if status:
        query += " AND status = :status"
        params["status"] = status
    if category:
        query += " AND category = :category"
        params["category"] = category
    query += " ORDER BY created_at DESC"

    result = await db.execute(text(query), params)
    items = [_serialize(r) for r in result.mappings()]
    return {"count": len(items), "feedback": items}


@router.patch("/{feedback_id}/status")
async def update_feedback_status(
    feedback_id: str,
    payload: FeedbackDecision,
    user: CurrentUser = Depends(require_role(FIELD_OFFICER)),
    db: AsyncSession = Depends(get_db),
):
    if payload.status not in VALID_STATUS:
        raise HTTPException(status_code=400, detail="status must be NEW, REVIEWED or ACTIONED.")

    result = await db.execute(
        text(
            f"""
            UPDATE feedback
            SET status = :status,
                reviewed_by = CAST(:reviewer_id AS uuid),
                review_notes = COALESCE(:review_notes, review_notes),
                reviewed_at = now()
            WHERE feedback_id = CAST(:id AS uuid)
            RETURNING {FEEDBACK_COLUMNS}
            """
        ),
        {
            "status": payload.status,
            "reviewer_id": user.user_id,
            "review_notes": payload.review_notes,
            "id": feedback_id,
        },
    )
    await db.commit()
    row = result.mappings().first()

    if row is None:
        raise HTTPException(status_code=404, detail="Feedback not found.")

    return _serialize(row)
