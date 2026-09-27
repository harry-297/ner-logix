from contextlib import asynccontextmanager
from datetime import datetime

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from fastapi import Depends, FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from database import AsyncSessionLocal, get_db
from routers.roads import router as roads_router
from routers.incidents import router as incidents_router
from routers import routes
from routers.ml_routes import router as ml_router
from routers.districts import router as districts_router
from routers.auth import router as auth_router
from routers.field_reports import router as field_reports_router
from routers.feedback import router as feedback_router
from services.risk_scoring import score_all_roads

# How often live rainfall re-scores every road. Adjust freely — 30 min is
# a reasonable default for a demo; a real deployment might go shorter.
SCORING_INTERVAL_MINUTES = 30

scheduler = AsyncIOScheduler()


async def scheduled_scoring_job():
    async with AsyncSessionLocal() as session:
        await score_all_roads(session)


@asynccontextmanager
async def lifespan(app: FastAPI):
    # next_run_time=now() so scoring runs once immediately on startup,
    # then repeats every SCORING_INTERVAL_MINUTES after that.
    scheduler.add_job(
        scheduled_scoring_job,
        "interval",
        minutes=SCORING_INTERVAL_MINUTES,
        id="risk_scoring",
        next_run_time=datetime.now(),
    )
    scheduler.start()
    yield
    scheduler.shutdown()


app = FastAPI(
    title="NER-LOGIX API",
    description="AI-powered Logistics and Accessibility Intelligence Platform for the North Eastern Region",
    version="0.1.0",
    lifespan=lifespan,
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.include_router(auth_router)
app.include_router(roads_router)
app.include_router(incidents_router)
app.include_router(routes.router)
app.include_router(ml_router)
app.include_router(districts_router)
app.include_router(field_reports_router)
app.include_router(feedback_router)


@app.get("/")
def root():
    return {
        "message": "NER-LOGIX API is running",
        "status": "operational",
    }


@app.get("/api/health")
def health_check():
    return {
        "status": "healthy",
        "service": "NER-LOGIX Backend",
    }


@app.get("/api/health/database")
async def database_health(
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(text("SELECT 1"))
    value = result.scalar()

    return {
        "database": "connected",
        "result": value,
    }
