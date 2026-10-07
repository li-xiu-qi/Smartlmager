# 推理服务（AI 层）

SmartImager 架构中的 AI 推理层：与业务层（Next.js 全栈）通过 HTTP 通信，可同机部署，
也可整体卸载到另一台机器（业务层只改推理地址，见 `../app/src/lib/settings.ts`）。

职责：

- `jina_provider.py`：jina-embeddings-v4 文本/图片统一向量编码（2048 维），transformers 离线加载
- `vector_store.py`：sqlite-vec 向量库（写入/检索/删除），依赖可加载扩展
- `main.py`：FastAPI 服务，默认 `:8100`，提供 `/health` `/encode` `/analyze` `/vectors/*` 等接口，
  视觉分析调用 GLM 多模态（OpenAI 兼容协议）

## 运行

```bash
pip install -r requirements.txt
cp .env.example .env   # 填写模型目录、向量库路径、GLM 密钥等
python main.py         # 或 INFERENCE_PORT=8100 python main.py
```

`.env` 由 `main.py` 启动时自行读取（不依赖 python-dotenv）。sqlite-vec 扩展按平台下载
（见 `.env.example` 中 `VECTOR_DB_DRIVER` 说明），模型与向量库文件体积大，均不入库。

## 与业务层的关系

业务层通过 `INFERENCE_SERVICE_URL` / 设置页配置的推理地址调用本服务；
推理服务故障时业务层降级（AI 功能不可用，其余 CRUD 正常）。
