"""
Seeds 50 sample feedback rows so the Feedback Review page has something to
show right away.

Run once, after reports_feedback_schema.sql has been applied:

    cd backend
    python ../scripts/seed_feedback.py

Feedback is linked to a real account when one exists (name, role and id are
copied from a random existing user); if no users exist yet, a synthetic
reporter name/role is used instead so the review page still has data. Ratings
are weighted per category -- Bug Report and Performance skew lower, the rest
skew higher -- to look like real usage rather than uniform noise.

Safe to re-run, but not idempotent: running it twice adds 100 rows total.
Truncate the table first (`TRUNCATE feedback;`) if you want exactly 50.
"""
import asyncio
import os
import random
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parent.parent / "backend"
sys.path.insert(0, str(BACKEND_DIR))
os.chdir(BACKEND_DIR)

from sqlalchemy import text  # noqa: E402

from database import AsyncSessionLocal  # noqa: E402

SAMPLE_COUNT = 50

CATEGORIES = [
    "Usability",
    "Data Accuracy",
    "Performance",
    "Feature Request",
    "Bug Report",
    "Other",
]

PAGES = [
    "Dashboard",
    "Live Map",
    "Routes",
    "Vehicles",
    "Incidents",
    "Alerts",
    "Analytics",
    "Disruption Predictor",
    "Field Intelligence",
]

ROLES = ["USER", "FIELD_OFFICER", "LOGISTICS_OFFICER"]

SYNTHETIC_NAMES = [
    "Tenzin Dorjee", "Angami Zapu", "Riya Thapa", "Bipul Baruah", "Lalthanpuii Ralte",
    "Kezhalhoulie Kire", "Manisha Deka", "Rojesh Gurung", "Chubaienla Ao", "Sanjib Nath",
    "Imnala Jamir", "Wanphrang Kharkongor", "Donkupar Roy", "Anupriya Sharma", "Tashi Wangmo",
    "Bendang Ao", "Lalrinawmi Sailo", "Kh. Thoibi Devi", "Pobitra Saikia", "Nokchan Konyak",
    "Yasin Ahmed", "Sneha Rai", "Lianzuala Colney", "Jenpu Rongmei", "Khrienuo Metha",
]

MESSAGES: dict[str, list[str]] = {
    "Usability": [
        "The sidebar takes up too much space on smaller laptop screens.",
        "Would love a dark-mode toggle that's easier to find in Settings.",
        "Filtering incidents by district isn't obvious on first use.",
        "Search bar placeholder text is helpful, but the box could be wider.",
        "Navigation between Live Map and Routes could use a quicker shortcut.",
        "Icons in the sidebar are clear once you learn them, but a first-run tour would help new field staff.",
    ],
    "Data Accuracy": [
        "Road risk score for NH-13 seemed stale after yesterday's rainfall update.",
        "Vehicle location for one of our trucks was off by roughly 2km on the map.",
        "Bridge status near Imphal still showed accessible despite the reported damage.",
        "Weather overlay didn't match the actual conditions we saw on the ground.",
        "Incident marker location was slightly off from the coordinates we reported.",
        "Risk score dropped to LOW very quickly after a landslide, even with debris still on the road.",
    ],
    "Performance": [
        "Live Map takes a few seconds to load on 3G connectivity in the hills.",
        "Dashboard refresh feels slow when many incidents are active at once.",
        "Route calculation between two districts took longer than expected.",
        "App felt laggy after switching between Analytics and Vehicles quickly.",
        "Offline sync queue took a while to clear once connectivity returned.",
        "Photo upload from the field form is noticeably slow on weak signal.",
    ],
    "Feature Request": [
        "Please add push notifications for high-risk corridor updates.",
        "It would help to export incident reports as PDF for district briefings.",
        "Can we get a night-driving mode for the Live Map for field teams?",
        "A bulk-approve option for field reports would save time during floods.",
        "Multi-language voice alerts would help drivers who can't read while driving.",
        "Would be great to tag a field report to a specific vehicle or convoy.",
    ],
    "Bug Report": [
        "Photo upload occasionally fails silently without an error message.",
        "Logging out and back in sometimes briefly shows the previous user's name.",
        "The incident modal doesn't close when pressing Escape.",
        "Analytics chart legend overlaps the bars on narrow screens.",
        "Offline queue counter didn't reset after a successful sync.",
        "Language switcher reverted to English after refreshing the page.",
    ],
    "Other": [
        "Really appreciate how fast this dashboard has become for our district team.",
        "Training our new field officers on this took less than a day, which is great.",
        "Would be useful to have a printed quick-start guide for offline briefings.",
        "Great work overall, this has cut our response time noticeably.",
        "Looking forward to more districts getting onboarded soon.",
        "Support team was quick to respond when we had a login issue last month.",
    ],
}

REVIEW_NOTES = [
    "Logged for the next sprint.",
    "Shared with the field ops team.",
    "Confirmed and fixed in the next release.",
    "Followed up with the reporting officer.",
    "Duplicate of an existing item, tracked together.",
    None,
]


def _rating_for_category(category: str) -> int:
    # Bug reports and performance complaints skew lower; everything else
    # skews toward "pretty happy" -- closer to how real feedback clusters.
    if category in ("Bug Report", "Performance"):
        return random.choices([1, 2, 3, 4, 5], weights=[15, 30, 30, 20, 5])[0]
    return random.choices([1, 2, 3, 4, 5], weights=[3, 7, 20, 40, 30])[0]


def _random_timestamp(days_back: int = 60) -> datetime:
    delta = timedelta(
        days=random.randint(0, days_back),
        hours=random.randint(0, 23),
        minutes=random.randint(0, 59),
    )
    return datetime.now(timezone.utc) - delta


async def main() -> None:
    async with AsyncSessionLocal() as db:
        existing_users = (
            await db.execute(text("SELECT user_id, name, role FROM users LIMIT 200"))
        ).mappings().all()

        rows = []
        for _ in range(SAMPLE_COUNT):
            category = random.choice(CATEGORIES)
            message = random.choice(MESSAGES[category])
            rating = _rating_for_category(category)
            created_at = _random_timestamp()

            status = random.choices(["NEW", "REVIEWED", "ACTIONED"], weights=[0.5, 0.3, 0.2])[0]

            reviewed_at = None
            review_notes = None
            reviewer_id = None
            if status != "NEW":
                reviewed_at = created_at + timedelta(days=random.randint(0, 5))
                review_notes = random.choice(REVIEW_NOTES)
                if existing_users:
                    reviewer_id = str(random.choice(existing_users)["user_id"])

            if existing_users and random.random() < 0.7:
                reporter = random.choice(existing_users)
                user_id = str(reporter["user_id"])
                user_name = reporter["name"]
                user_role = reporter["role"]
            else:
                user_id = None
                user_name = random.choice(SYNTHETIC_NAMES)
                user_role = random.choices(ROLES, weights=[0.7, 0.2, 0.1])[0]

            rows.append(
                {
                    "user_id": user_id,
                    "user_name": user_name,
                    "user_role": user_role,
                    "category": category,
                    "rating": rating,
                    "message": message,
                    "page_context": random.choice(PAGES),
                    "status": status,
                    "reviewer_id": reviewer_id,
                    "review_notes": review_notes,
                    "created_at": created_at,
                    "reviewed_at": reviewed_at,
                }
            )

        for row in rows:
            await db.execute(
                text(
                    """
                    INSERT INTO feedback
                        (user_id, user_name, user_role, category, rating, message,
                         page_context, status, reviewed_by, review_notes, created_at, reviewed_at)
                    VALUES
                        (CAST(:user_id AS uuid), :user_name, :user_role, :category, :rating,
                         :message, :page_context, :status, CAST(:reviewer_id AS uuid),
                         :review_notes, :created_at, :reviewed_at)
                    """
                ),
                row,
            )

        await db.commit()

    print(f"Inserted {SAMPLE_COUNT} sample feedback rows into `feedback`.")


if __name__ == "__main__":
    asyncio.run(main())
