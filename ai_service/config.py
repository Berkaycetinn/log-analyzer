from pathlib import Path
from typing import Literal
from pydantic import Field, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="LOG_AI_")
    embedding_model: str = "sentence-transformers/all-mpnet-base-v2"
    llm_model: str = "Qwen/Qwen3-14B"
    llm_dtype: Literal["auto", "float32", "float16", "bfloat16"] = "auto"
    device: str = "cpu"
    thinking: bool = True
    enforce_json: bool = False
    max_new_tokens: int = Field(default=12000, ge=1)
    context_tokens: int = Field(default=32768, ge=1024)
    max_upload_bytes: int = Field(default=10_000_000, ge=1)
    max_lines: int = Field(default=100000, ge=1)
    output_dir: Path = Path("runs")

    @model_validator(mode="after")
    def check_generation_mode(self):
        if self.enforce_json and self.thinking:
            raise ValueError("Set LOG_AI_THINKING=false when LOG_AI_ENFORCE_JSON=true")
        return self

