"""
Jina Embeddings V4 Provider

为 jinaai/jina-embeddings-v4 定制的 EmbeddingProvider。
该模型不是标准 SentenceTransformer，需要 transformers AutoModel + 手动构建 processor，
并分别调用 encode_text / encode_image。

兼容性处理（transformers 5.x）：
- 模型自带 qwen2_5_vl.py 基于 transformers 4.52 编写，RoPE / tied_weights 与新版本不兼容
- __init__ 里自动构建 processor 会因 from_args_and_dict 丢弃 tokenizer 而崩溃
上述问题需先在 hub 源文件 patch（见 部署说明），本 provider 负责运行时正确加载与编码。
"""
import os
import sys
import numpy as np
from typing import Union, List, Optional
from PIL import Image

from .base import EmbeddingProvider


class JinaEmbeddingsV4Provider(EmbeddingProvider):
    """基于 jina-embeddings-v4 (Qwen2.5-VL 架构) 的编码器"""

    def __init__(self):
        self._model = None
        self._processor = None
        self._dimension: Optional[int] = None
        self._load_attempted = False
        self._error: str = ""

    def _resolve_model_path(self, model_path: str) -> str:
        """把配置里的 MODEL_PATH 解析为绝对路径"""
        if not os.path.isabs(model_path):
            project_root = os.path.dirname(
                os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
            )
            model_path = os.path.normpath(os.path.join(project_root, model_path.lstrip("./")))
        return model_path

    def _build_processor(self, model_path: str):
        """手动构建 processor，绕过 transformers 5.x 的 from_args_and_dict tokenizer 丢失 bug"""
        from transformers import AutoTokenizer, AutoImageProcessor

        tokenizer = AutoTokenizer.from_pretrained(model_path, trust_remote_code=True, use_fast=True)
        image_processor = AutoImageProcessor.from_pretrained(model_path, trust_remote_code=True)

        # 从已加载 base model 的动态模块里取 processor 类
        base_model = self._model.model
        mod = sys.modules.get(type(base_model).__module__)
        if mod is None:
            import importlib.util
            module_file = type(base_model).__init__.__code__.co_filename
            spec = importlib.util.spec_from_file_location("jina_modeling", module_file)
            mod = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(mod)

        ProcessorClass = mod.JinaEmbeddingsV4Processor
        proc = ProcessorClass(image_processor=image_processor, tokenizer=tokenizer)
        # ProcessorMixin 的 __getattr__ 转发有 bug，直接挂 __dict__ 绕过
        proc.__dict__["tokenizer"] = tokenizer
        proc.__dict__["image_processor"] = image_processor
        return proc

    def _try_load(self) -> bool:
        if self._model is not None:
            return True
        if self._load_attempted:
            return False
        self._load_attempted = True

        try:
            model_path = os.environ.get("MODEL_PATH", "")
            if not model_path:
                self._error = "MODEL_PATH 未配置"
                return False

            model_path = self._resolve_model_path(model_path)
            if not os.path.isdir(model_path):
                self._error = f"模型目录不存在: {model_path}"
                return False

            # 强制离线，避免联网拉 remote code（huggingface.co 在此环境不通）
            os.environ.setdefault("HF_HUB_OFFLINE", "1")

            import torch
            from transformers import AutoModel

            device = "cuda" if torch.cuda.is_available() else "cpu"
            self._model = AutoModel.from_pretrained(
                model_path,
                trust_remote_code=True,
                dtype=torch.bfloat16,
                attn_implementation="sdpa",
            )
            self._model = self._model.to(device).eval()

            # 手动补 processor（__init__ 里的自动构建已 patch 为 None）
            if getattr(self._model.model, "processor", None) is None:
                self._model.model.processor = self._build_processor(model_path)

            # 探测维度（用一次短文本编码）
            probe = self._model.model.encode_text(
                "_probe_", task="retrieval", prompt_name="query"
            )
            self._dimension = int(probe.shape[-1]) if hasattr(probe, "shape") else len(probe)
            return True
        except Exception as e:
            self._error = f"jina-embeddings-v4 加载失败: {e}"
            return False

    def _ensure_model(self):
        if not self._try_load():
            from .base import VectorUnavailableError
            raise VectorUnavailableError(f"Embedding 模型不可用: {self._error}")

    def encode_text(self, text: Union[str, List[str]]) -> np.ndarray:
        self._ensure_model()
        base = self._model.model
        result = base.encode_text(text, task="retrieval", prompt_name="query")
        # 单条文本 -> 1D 向量；列表 -> 2D
        if isinstance(text, str):
            return result.cpu().float().numpy()
        return torch_stack_to_np(result)

    def encode_image(self, image_input: Union[Image.Image, str, List]) -> np.ndarray:
        self._ensure_model()
        import torch
        base = self._model.model
        single = isinstance(image_input, (Image.Image, str))
        images = [image_input] if single else image_input
        result = base.encode_image(images, task="retrieval")
        # result 可能是 tensor 或 list of tensors
        if isinstance(result, list):
            return torch.stack([t.cpu().float() for t in result]).numpy()
        return result.cpu().float().numpy()

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


def torch_stack_to_np(result):
    """把 encode_text 返回的 tensor 列表转 numpy"""
    import torch
    if isinstance(result, list):
        return torch.stack([t.cpu().float() for t in result]).numpy()
    return result.cpu().float().numpy()
