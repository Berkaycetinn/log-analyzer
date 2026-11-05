import logging
from fastapi import FastAPI, File, HTTPException, UploadFile
from starlette.concurrency import run_in_threadpool
from .config import Settings
from .pipeline import Pipeline

logger = logging.getLogger(__name__)

def create_app(settings=None, pipeline=None):
    settings = settings or Settings()
    pipeline = pipeline or Pipeline(settings)
    app = FastAPI(title="Log Analyzer AI Service", version="0.1.0")
    app.state.pipeline = pipeline

    @app.get("/health")
    def health():
        return {"status": "ok", "models_loaded": pipeline.analyzer is not None,
                "llm_model": settings.llm_model}

    @app.post("/analyze")
    async def analyze(file: UploadFile = File(...)):
        try:
            content = await file.read(settings.max_upload_bytes + 1)
            return await run_in_threadpool(pipeline.run, content)
        except OverflowError as error:
            raise HTTPException(413, str(error)) from error
        except BlockingIOError as error:
            raise HTTPException(503, str(error), headers={"Retry-After": "5"}) from error
        except (UnicodeError, ValueError) as error:
            raise HTTPException(422, str(error)) from error
        except Exception as error:
            logger.exception("Analysis failed")
            raise HTTPException(500, "Analysis failed; see server logs") from error
        finally:
            await file.close()
    return app

app = create_app()

