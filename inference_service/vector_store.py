"""
推理服务内置向量存储
独立于主后端的 sqlite-vec 操作，直接管理向量表。
扩展加载失败时 is_available() 返回 False，不抛异常。
"""
import json
import os
import sqlite3
import logging
from typing import Any, Dict, List, Optional

import numpy as np

logger = logging.getLogger(__name__)

VECTOR_TYPES = ("title", "description", "image")


class InferenceVectorStore:
    """推理服务专用向量存储，操作独立 SQLite 数据库"""

    def __init__(self, db_path: str, driver_path: str):
        self.db_path = db_path
        self.driver_path = driver_path
        self._dimension: Optional[int] = None
        self._available: Optional[bool] = None
        self._error: str = ""

    def _get_connection(self) -> Optional[sqlite3.Connection]:
        if not os.path.exists(self.db_path):
            self._error = f"向量数据库不存在: {self.db_path}"
            return None
        try:
            conn = sqlite3.connect(self.db_path)
            conn.enable_load_extension(True)
            conn.execute(f"SELECT load_extension('{self.driver_path}')")
            conn.row_factory = sqlite3.Row
            return conn
        except Exception as e:
            self._error = f"连接失败: {e}"
            return None

    def is_available(self) -> bool:
        if self._available is None:
            conn = self._get_connection()
            if conn:
                try:
                    conn.execute("SELECT vec_version()")
                    self._available = True
                except Exception as e:
                    self._error = str(e)
                    self._available = False
                finally:
                    conn.close()
            else:
                self._available = False
        return self._available

    def unavailable_reason(self) -> str:
        return self._error

    def create_tables(self, dimension: int) -> bool:
        if not self.is_available():
            return False
        conn = self._get_connection()
        if not conn:
            return False
        try:
            for vtype in VECTOR_TYPES:
                conn.execute(f"""
                    CREATE VIRTUAL TABLE IF NOT EXISTS {vtype}_vectors USING vec0(
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        image_id INTEGER UNIQUE NOT NULL,
                        embedding FLOAT[{dimension}] DISTANCE_METRIC=cosine
                    );
                """)
            conn.commit()
            self._dimension = dimension
            logger.info(f"向量表创建成功，维度: {dimension}")
            return True
        except Exception as e:
            logger.error(f"向量表创建失败: {e}")
            return False
        finally:
            conn.close()

    def add(self, image_id: int, vector_type: str, vector: np.ndarray) -> bool:
        if vector_type not in VECTOR_TYPES:
            raise ValueError(f"vector_type 必须是 {VECTOR_TYPES}")
        if not self.is_available():
            return False
        conn = self._get_connection()
        if not conn:
            return False
        try:
            vector_json = json.dumps(vector.tolist())
            table = f"{vector_type}_vectors"
            cursor = conn.cursor()
            cursor.execute(f"SELECT id FROM {table} WHERE image_id = ?", (image_id,))
            if cursor.fetchone():
                cursor.execute(
                    f"UPDATE {table} SET embedding = vec_f32(?) WHERE image_id = ?",
                    (vector_json, image_id),
                )
            else:
                cursor.execute(
                    f"INSERT INTO {table}(image_id, embedding) VALUES (?, vec_f32(?))",
                    (image_id, vector_json),
                )
            conn.commit()
            return True
        except Exception as e:
            logger.error(f"向量写入失败 [{vector_type}] image_id={image_id}: {e}")
            return False
        finally:
            conn.close()

    def search(self, query_vector: List[float], vector_type: str,
               limit: int = 20, offset: int = 0) -> List[Dict[str, Any]]:
        if vector_type not in VECTOR_TYPES:
            raise ValueError(f"vector_type 必须是 {VECTOR_TYPES}")
        if not self.is_available():
            return []
        conn = self._get_connection()
        if not conn:
            return []
        try:
            query_json = json.dumps(query_vector)
            table = f"{vector_type}_vectors"
            sql = f"""
                SELECT vec.image_id, (1 - vec.distance) AS score
                FROM {table} AS vec
                WHERE vec.embedding MATCH '{query_json}'
                AND k = {limit + offset}
                ORDER BY score DESC
                LIMIT {limit} OFFSET {offset}
            """
            cursor = conn.cursor()
            cursor.execute(sql)
            return [{"image_id": row[0], "score": row[1]} for row in cursor.fetchall()]
        except Exception as e:
            logger.error(f"向量搜索失败 [{vector_type}]: {e}")
            return []
        finally:
            conn.close()

    def delete(self, image_id: int) -> bool:
        if not self.is_available():
            return False
        conn = self._get_connection()
        if not conn:
            return False
        try:
            for vtype in VECTOR_TYPES:
                conn.execute(f"DELETE FROM {vtype}_vectors WHERE image_id = ?", (image_id,))
            conn.commit()
            return True
        except Exception as e:
            logger.error(f"向量删除失败: {e}")
            return False
        finally:
            conn.close()

    def get_stats(self) -> Dict[str, int]:
        if not self.is_available():
            return {}
        conn = self._get_connection()
        if not conn:
            return {}
        try:
            stats = {}
            for vtype in VECTOR_TYPES:
                cursor = conn.cursor()
                cursor.execute(f"SELECT COUNT(*) FROM {vtype}_vectors")
                stats[vtype] = cursor.fetchone()[0]
            return stats
        except Exception as e:
            logger.error(f"统计失败: {e}")
            return {}
        finally:
            conn.close()
