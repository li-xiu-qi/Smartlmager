"""
向量引擎抽象基类
"""
from abc import ABC, abstractmethod
from typing import Any, Dict, List, Optional, Union
import numpy as np
from PIL import Image


class VectorUnavailableError(Exception):
    """向量引擎不可用时抛出"""
    pass


class EmbeddingProvider(ABC):
    """
    Embedding 提供者抽象接口
    
    负责将文本或图片编码为向量。
    实现类必须保证 is_available() 非致命。
    """

    @abstractmethod
    def encode_text(self, text: Union[str, List[str]]) -> np.ndarray:
        """将文本编码为向量"""

    @abstractmethod
    def encode_image(self, image_input: Union[Image.Image, str, List]) -> np.ndarray:
        """将图片编码为向量"""

    @abstractmethod
    def dimension(self) -> int:
        """返回向量维度"""

    @abstractmethod
    def is_available(self) -> bool:
        """模型是否可用（不抛异常）"""

    @abstractmethod
    def unavailable_reason(self) -> str:
        """不可用原因"""


class VectorStore(ABC):
    """
    向量存储抽象接口
    
    负责向量的存取与检索。
    实现类必须保证 is_available() 非致命。
    """

    @abstractmethod
    def add(self, connection, image_id: int, vector_type: str, vector: np.ndarray) -> bool:
        """添加/更新向量"""

    @abstractmethod
    def search(
        self,
        connection,
        query_vector: List[float],
        vector_type: str,
        limit: int = 20,
        offset: int = 0,
        filters: Optional[Dict[str, Any]] = None,
    ) -> List[Dict[str, Any]]:
        """向量检索"""

    @abstractmethod
    def multi_search(
        self,
        connection,
        query_vector: List[float],
        search_targets: List[str],
        filters: Optional[Dict[str, Any]] = None,
        limit: int = 20,
        offset: int = 0,
        exclude_image_id: Optional[int] = None,
    ) -> List[Dict[str, Any]]:
        """多目标向量检索"""

    @abstractmethod
    def delete(self, connection, image_id: int) -> bool:
        """删除某图片的所有向量"""

    @abstractmethod
    def is_available(self) -> bool:
        """存储是否可用（不抛异常）"""

    @abstractmethod
    def unavailable_reason(self) -> str:
        """不可用原因"""

    @abstractmethod
    def create_tables(self, connection, dimension: int) -> bool:
        """创建向量表，dimension 由外部传入"""
