import logging
import asyncio
from contextlib import asynccontextmanager, suppress
from fastapi import FastAPI, File, HTTPException, UploadFile
from starlette.concurrency import run_in_threadpool
from .config import Settings
from .pipeline import Pipeline
from .language import ReportLanguageError

logger = logging.getLogger(__name__)

def create_app(settings=None, pipeline=None):
    settings = settings or Settings()
    pipeline = pipeline or Pipeline(settings)
    @asynccontextmanager
    async def lifespan(app):
        async def prepare():
            try:
                await run_in_threadpool(pipeline.load_models)
            except Exception:
                logger.exception("Model warm-up failed")
        task = asyncio.create_task(prepare()) if settings.preload_models else None
        yield
        if task is not None:
            task.cancel()
            with suppress(asyncio.CancelledError):
                await task

    app = FastAPI(title="Log Analyzer AI Service", version="0.2.0", lifespan=lifespan)
    app.state.pipeline = pipeline

    @app.get("/health")
    def health():
        return {"status": "ok", "models_loaded": pipeline.model_state == "ready",
                "model_state": pipeline.model_state, "model_error": pipeline.model_error,
                "llm_model": settings.llm_model, "device": settings.device}

    @app.post("/analyze")
    async def analyze(file: UploadFile = File(...)):
        try:
            content = await file.read(settings.max_upload_bytes + 1)
            return await run_in_threadpool(pipeline.run, content)
        except OverflowError as error:
            raise HTTPException(413, str(error)) from error
        except BlockingIOError as error:
            raise HTTPException(503, str(error), headers={"Retry-After": "5"}) from error
        except ReportLanguageError as error:
            raise HTTPException(422, detail={"code": "REPORT_LANGUAGE_INVALID",
                "message": "Model Türkçe rapor üretemedi. AI model ayarlarını kontrol edin."}) from error
        except (UnicodeError, ValueError) as error:
            raise HTTPException(422, str(error)) from error
        except Exception as error:
            logger.exception("Analysis failed")
            raise HTTPException(500, "Analysis failed; see server logs") from error
        finally:
            await file.close()
    return app

app = create_app()

