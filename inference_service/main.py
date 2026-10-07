"""
SmartImager 推理服务
独立 FastAPI 应用，持有 jina-embeddings-v4 模型 + sqlite-vec 向量存储。
端口：8100（可通过环境变量 INFERENCE_PORT 修改）
"""
import os
import sys
import time
import logging
from pathlib import Path as _Path

# 自加载 .env（与 backend 解耦，归档 backend 后仍可独立启动）
_ENV_FILE = _Path(__file__).parent / ".env"
if _ENV_FILE.exists():
    for _line in _ENV_FILE.read_text().splitlines():
        _line = _line.strip()
        if _line and not _line.startswith("#") and "=" in _line:
            _k, _v = _line.split("=", 1)
            os.environ.setdefault(_k.strip(), _v.strip())
from typing import List, Optional
from pathlib import Path

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
import uvicorn

sys.path.insert(0, str(Path(__file__).parent.parent))

from inference_service.jina_provider import JinaEmbeddingsV4Provider
from inference_service.vector_store import InferenceVectorStore
from inference_service.base import VectorUnavailableError

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(title="SmartImager Inference Service", version="1.0.0")

# 全局实例（懒加载）
_provider: Optional[JinaEmbeddingsV4Provider] = None
_store: Optional[InferenceVectorStore] = None
_load_time_ms: float = 0


def get_provider() -> JinaEmbeddingsV4Provider:
    global _provider, _load_time_ms
    if _provider is None:
        t0 = time.time()
        _provider = JinaEmbeddingsV4Provider()
        _load_time_ms = (time.time() - t0) * 1000
    return _provider


def get_store() -> InferenceVectorStore:
    global _store
    if _store is None:
        db_path = os.environ.get("VECTOR_DB_PATH", "")
        driver_path = os.environ.get("VECTOR_DB_DRIVER", "")
        if not db_path or not driver_path:
            raise HTTPException(status_code=503, detail="VECTOR_DB_PATH 或 VECTOR_DB_DRIVER 未配置")
        _store = InferenceVectorStore(db_path, driver_path)
    return _store


# ── 请求/响应模型 ──

class EncodeRequest(BaseModel):
    input_type: str = "text"
    inputs: Optional[List[str]] = None
    image_paths: Optional[List[str]] = None
    normalize: bool = True

class EncodeResponse(BaseModel):
    vectors: List[List[float]]
    dimension: int
    model: str = "jina-embeddings-v4"

class HealthResponse(BaseModel):
    status: str
    model_loaded: bool
    store_available: bool
    dimension: Optional[int] = None
    error: Optional[str] = None

class VectorAddRequest(BaseModel):
    image_id: int
    vector_type: str  # "title" | "description" | "image"
    vector: List[float]

class VectorSearchRequest(BaseModel):
    query_vector: List[float]
    vector_type: str
    limit: int = 20
    offset: int = 0

class VectorSearchResponse(BaseModel):
    results: List[dict]

class StatusResponse(BaseModel):
    model_loaded: bool
    store_available: bool
    dimension: Optional[int] = None
    load_time_ms: float = 0
    error: Optional[str] = None


# ── 编码接口 ──

@app.get("/health", response_model=HealthResponse)
def health():
    p = get_provider()
    model_ok = p.is_available()
    store_ok = False
    try:
        store_ok = get_store().is_available()
    except Exception:
        pass
    return HealthResponse(
        status="ok" if model_ok else "unavailable",
        model_loaded=model_ok,
        store_available=store_ok,
        dimension=p.dimension() if model_ok else None,
        error=None if model_ok else p.unavailable_reason(),
    )

@app.get("/dimension")
def dimension():
    p = get_provider()
    d = p.dimension()
    if not d:
        raise HTTPException(status_code=503, detail="模型不可用")
    return {"dimension": d}

@app.get("/status", response_model=StatusResponse)
def status():
    p = get_provider()
    model_ok = p.is_available()
    store_ok = False
    try:
        store_ok = get_store().is_available()
    except Exception:
        pass
    return StatusResponse(
        model_loaded=model_ok,
        store_available=store_ok,
        dimension=p.dimension() if model_ok else None,
        load_time_ms=_load_time_ms,
        error=None if model_ok else p.unavailable_reason(),
    )

@app.post("/encode", response_model=EncodeResponse)
def encode(req: EncodeRequest):
    p = get_provider()
    if not p.is_available():
        raise HTTPException(status_code=503, detail=f"模型不可用: {p.unavailable_reason()}")
    try:
        if req.input_type == "text":
            if not req.inputs:
                raise HTTPException(status_code=422, detail="text 模式需要 inputs")
            vecs = p.encode_text(req.inputs)
        elif req.input_type == "image":
            if not req.image_paths:
                raise HTTPException(status_code=422, detail="image 模式需要 image_paths")
            # 支持 base64 data URI（来自本机）和本地路径两种输入
            import base64 as _b64, io as _io
            from PIL import Image as _PILImage
            _imgs = []
            for _ip in req.image_paths:
                if _ip.startswith("data:"):
                    _b64data = _ip.split(",", 1)[1]
                    _imgs.append(_PILImage.open(_io.BytesIO(_b64.b64decode(_b64data))).convert("RGB"))
                else:
                    _imgs.append(_ip)
            vecs = p.encode_image(_imgs)
        else:
            raise HTTPException(status_code=422, detail=f"未知 input_type: {req.input_type}")

        if hasattr(vecs, "tolist"):
            vectors = vecs.tolist()
        else:
            vectors = [v.tolist() if hasattr(v, "tolist") else list(v) for v in vecs]
        return EncodeResponse(vectors=vectors, dimension=len(vectors[0]) if vectors else 0)
    except VectorUnavailableError as e:
        raise HTTPException(status_code=503, detail=str(e))
    except Exception as e:
        logger.error(f"编码失败: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


# ── 向量存储接口 ──

@app.post("/vectors/add")
def vector_add(req: VectorAddRequest):
    store = get_store()
    if not store.is_available():
        raise HTTPException(status_code=503, detail=f"向量存储不可用: {store.unavailable_reason()}")
    import numpy as np
    ok = store.add(req.image_id, req.vector_type, np.array(req.vector, dtype=np.float32))
    return {"success": ok, "image_id": req.image_id, "vector_type": req.vector_type}

@app.post("/vectors/search", response_model=VectorSearchResponse)
def vector_search(req: VectorSearchRequest):
    store = get_store()
    if not store.is_available():
        raise HTTPException(status_code=503, detail=f"向量存储不可用: {store.unavailable_reason()}")
    results = store.search(req.query_vector, req.vector_type, req.limit, req.offset)
    return VectorSearchResponse(results=results)

@app.delete("/vectors/{image_id}")
def vector_delete(image_id: int):
    store = get_store()
    if not store.is_available():
        raise HTTPException(status_code=503, detail=f"向量存储不可用: {store.unavailable_reason()}")
    ok = store.delete(image_id)
    return {"success": ok, "image_id": image_id}

@app.get("/vectors/stats")
def vector_stats():
    store = get_store()
    if not store.is_available():
        raise HTTPException(status_code=503, detail=f"向量存储不可用: {store.unavailable_reason()}")
    return store.get_stats()



# ── 图像分析接口（调 glm-4.6v-flash）──

class AnalyzeRequest(BaseModel):
    image_path: Optional[str] = None
    image_base64: Optional[str] = None

@app.post("/analyze")
def analyze(req: AnalyzeRequest):
    """用 glm-4.6v-flash 分析图片，返回 title/description/tags"""
    import base64 as _b64
    if req.image_base64:
        img_b64 = req.image_base64
    elif req.image_path and os.path.exists(req.image_path):
        with open(req.image_path, "rb") as f:
            img_b64 = _b64.b64encode(f.read()).decode()
    else:
        raise HTTPException(status_code=404, detail="图片文件不存在")
    try:
        from openai import OpenAI
        client = OpenAI(
            api_key=os.environ.get("GLM_API_KEY", ""),
            base_url=os.environ.get("OPENAI_API_BASE", "https://open.bigmodel.cn/api/paas/v4"),
        )
        img_b64 = img_b64.split(",", 1)[1] if img_b64.startswith("data:") else img_b64

        resp = client.chat.completions.create(
            model="glm-4.6v-flash",
            messages=[{
                "role": "user",
                "content": [
                    {"type": "text", "text": "请分析这张图片，返回JSON格式：{\"title\": \"简短标题（10字内）\", \"description\": \"详细描述（50字内）\", \"tags\": [\"标签1\", \"标签2\", \"标签3\"]}"},
                    {"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{img_b64}"}}
                ]
            }],
            max_tokens=2000,
            temperature=0.3,
        )
        import json
        # thinking 模型的 content 可能在 reasoning_content 里，或者直接是 content
        msg = resp.choices[0].message
        raw = msg.content or ""
        if not raw and hasattr(msg, "reasoning_content") and msg.reasoning_content:
            raw = msg.reasoning_content
        if not raw:
            return {"title": "", "description": "", "tags": []}
        # 提取 JSON（兼容 markdown 代码块）
        import re
        # 去掉 markdown 代码块标记
        raw_clean = re.sub(r"```json\s*|```\s*", "", raw)
        start = raw_clean.find("{")
        end = raw_clean.rfind("}") + 1
        if start >= 0 and end > start:
            try:
                result = json.loads(raw_clean[start:end])
                return {
                    "title": result.get("title", ""),
                    "description": result.get("description", ""),
                    "tags": result.get("tags", [])
                }
            except json.JSONDecodeError:
                pass
        return {"title": "", "description": raw[:200], "tags": []}
    except Exception as e:
        logger.error(f"图像分析失败: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


if __name__ == "__main__":
    port = int(os.environ.get("INFERENCE_PORT", 8100))
    logger.info(f"启动推理服务，端口 {port}")
    uvicorn.run(app, host="0.0.0.0", port=port, log_level="info")

# ── 图像分析接口（在 __main__ 之前追加）──
# 注意：用 python 脚本在正确位置插入
