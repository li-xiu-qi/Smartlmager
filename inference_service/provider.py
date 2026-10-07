"""
SentenceTransformer Embedding 提供者

将原 generate_vector.py 的模型加载与编码逻辑封装为 EmbeddingProvider。
模型加载为懒加载 + 非致命：模型不存在时 is_available() 返回 False。
"""
from typing import List, Union, Optional
import numpy as np
from PIL import Image

from .base import EmbeddingProvider


class SentenceTransformerProvider(EmbeddingProvider):
    """基于 SentenceTransformer 的本地模型编码器"""

    def __init__(self):
        self._model = None
        self._dimension: Optional[int] = None
        self._load_attempted = False
        self._error: str = ""

    def _try_load(self) -> bool:
        """尝试加载模型，失败不抛异常"""
        if self._model is not None:
            return True
        if self._load_attempted:
            return False
        self._load_attempted = True

        try:
            from ..config import settings
            config = settings.get_config()
            model_path = getattr(config, "MODEL_PATH", None)
            if not model_path:
                self._error = "MODEL_PATH 未配置"
                return False

            import os
            if not os.path.isabs(model_path):
                project_root = os.path.dirname(
                    os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
                )
                model_path = os.path.normpath(os.path.join(project_root, model_path.lstrip("./")))

            if not os.path.isdir(model_path):
                self._error = f"模型目录不存在: {model_path}"
                return False

            import torch
            from sentence_transformers import SentenceTransformer

            device = "cuda" if torch.cuda.is_available() else "cpu"
            try:
                self._model = SentenceTransformer(
                    model_path,
                    trust_remote_code=True,
                    device=device,
                    model_kwargs={"default_task": "retrieval"},
                )
            except TypeError:
                self._model = SentenceTransformer(
                    model_path,
                    trust_remote_code=True,
                    device=device,
                )

            # 探测维度
            try:
                self._dimension = self._model.get_sentence_embedding_dimension()
            except Exception:
                self._dimension = None

            if not self._dimension:
                try:
                    probe = self._model.encode(
                        ["_probe_"], normalize_embeddings=True, show_progress_bar=False
                    )
                    if hasattr(probe, "shape"):
                        self._dimension = int(probe.shape[-1])
                except Exception:
                    pass

            if not self._dimension:
                self._dimension = getattr(config, "EMBEDDING_DIMENSION", None) or 2048

            return True

        except ImportError as e:
            self._error = f"依赖缺失: {e}"
            return False
        except Exception as e:
            self._error = f"模型加载失败: {e}"
            return False

    def _ensure_model(self):
        if not self._try_load():
            from .base import VectorUnavailableError
            raise VectorUnavailableError(f"Embedding 模型不可用: {self._error}")

    def encode_text(self, text: Union[str, List[str]]) -> np.ndarray:
        self._ensure_model()
        try:
            return self._model.encode(text, normalize_embeddings=True, task="retrieval")
        except TypeError:
            return self._model.encode(text, normalize_embeddings=True)

    def encode_image(self, image_input: Union[Image.Image, str, List]) -> np.ndarray:
        self._ensure_model()
        images = [image_input] if isinstance(image_input, (Image.Image, str)) else image_input
        try:
            embeddings = self._model.encode(images, normalize_embeddings=True, task="retrieval")
        except TypeError:
            embeddings = self._model.encode(images, normalize_embeddings=True)
        if isinstance(image_input, (Image.Image, str)):
            return embeddings[0]
        return embeddings

    def dimension(self) -> int:
        if self._dimension is None:
            self._try_load()
        return self._dimension or 0

    def is_available(self) -> bool:
        return self._try_load()

    def unavailable_reason(self) -> str:
        if self.is_available():
            return ""
        return self._error
