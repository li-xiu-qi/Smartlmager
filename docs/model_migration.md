> **退役说明（2026-10-07）**：文中 `migrate_embeddings.py` 脚本随旧一体化后端一并移除
> （其依赖的 `backend/` 目录已不存在）。模型升级到 jina-embeddings-v4 已完成；
> 若将来再需维度迁移，按当前架构重写脚本即可（向量库在推理层，见本仓 README 与套件设计仓
> `Smartlmager-product-design/01_PRD/架构与拆分设计.md`）。

# 向量模型迁移与重建最新指南

核心目标：离线、安全、可断点续传地用新嵌入模型重建三类向量（title/description/image），原子替换旧表与缓存，并在成功后自动更新主配置中的 `MODEL_PATH` / `EMBEDDING_DIMENSION`。

脚本：`migrate_embeddings.py`（项目根目录）  
配置：`backend/config/files/migration.yaml`

> 强制前置条件：执行迁移前必须停止后端服务（尤其是任何仍在写入 / 查询同一 SQLite 数据库的进程）。否则可能出现锁冲突、写入竞态或维度不一致风险。建议：
>
> 1. 备份数据库：`copy data\db\smartimager.db data\db\smartimager.db.bak` (Windows) / `cp data/db/smartimager.db data/db/smartimager.db.bak` (Linux/Mac)
> 2. 确认后端（API / 任务调度 / 索引构建）全部停止
> 3. 再启动迁移脚本

---

## 1. migration.yaml 配置示例

```yaml
old_model_path: "./models/jina-embeddings-v4"   # 旧模型，可留空（仅记录）
old_embedding_dim: 2048                         # 旧向量维度，可留空
new_model_path: "./models/jina-clip-v2"        # 新模型，必填
new_embedding_dim: 1024                         # 可留空；留空则自动探测
db_path: "./data/db/smartimager.db"       # 可选；不写则使用主配置 DB_PATH
batch_size: 64                                  # 可选；默认 64
```

说明：

- `new_embedding_dim` 为空时脚本会 encode 一个探针文本获取真实维度；若填写且与实际不一致会直接报错终止。
- `old_embedding_dim` 若提供，将用于判断是否需要新表（维度不同 => 建 *_new 表并原子切换）。若缺失，也会因与新维度无法比较而默认走“维度变化”分支（可按需调整代码）。

---

## 2. 运行命令

仅两个可用参数：

- `--config` 指定配置文件（可省略，默认 `backend/config/files/migration.yaml`）
- `--resume` 断点续传

示例（Windows CMD）：

```cmd
python migrate_embeddings.py --config backend\config\files\migration.yaml

REM 断点续传
python migrate_embeddings.py --resume
```

无任何 `--strategy` / `--batch-size` / `--db` 等参数（已移除，统一走自动判定+配置文件）。

---

## 3. 自动策略说明

脚本内部自动完成：

1. 加载新模型，探测（或使用配置）维度 `new_dim`
2. 比较 `old_embedding_dim` 与 `new_dim`：不同 => 创建 `*_vectors_new` 虚表；相同 => 清空原表重建
3. 分批读取 `images` 按 `id` 递增分页
4. 为每批生成：图片向量 + 标题向量 + 描述向量（存在即生成）
5. 维度校验：任一生成向量长度 != `new_dim` 立即报错
6. 若建了 \*_new：全部完成后原子切换（DROP 旧表 + RENAME \*_new）
7. 替换缓存目录：旧目录重命名为 `*_old`，创建新空目录
8. 写入 `model_migrations` 记录并标记完成
9. 自动更新主配置 `config.yaml` 的 `MODEL_PATH` 与 `EMBEDDING_DIMENSION`

---

## 4. 断点续传 (--resume)

状态保存：`model_migrations` 表包含 `processed_images` 与 `last_image_id`。使用 `--resume` 时：

1. 查找 status='running' 的最新记录并继续该批次
2. 从 `last_image_id` 之后继续分页处理
3. 对同一 `image_id` 的重复写入是幂等覆盖（INSERT OR IGNORE + UPDATE）

放弃一次迁移：

```sql
UPDATE model_migrations SET status='failed' WHERE id=<迁移ID> AND status='running';
```

然后不带 --resume 重新运行即开始新迁移。

---

## 5. 缓存目录处理

完成后：

- 旧文本缓存目录重命名：`text_vector_cache -> text_vector_cache_old`
- 旧图片缓存目录重命名：`image_vector_cache -> image_vector_cache_old`
- 创建新的空目录以便后续按需重新填充

可手动删除 *_old 目录（若已验证无回滚需求）。

---

## 6. 操作步骤总览

| 步骤 | 操作 |
|------|------|
| 1 | 停止后端所有服务，备份数据库文件 |
| 2 | 填写 / 校验 `migration.yaml`（新模型可先下载本地） |
| 3 | 运行 `python migrate_embeddings.py`（或附 `--resume`） |
| 4 | 观察控制台进度与 `model_migrations` 记录 |
| 5 | 中断需继续：加 `--resume` 重启脚本 |
| 6 | 完成后确认无 *_new 表且检索正常 |
| 7 | 查看主 `config.yaml` 已自动更新 MODEL_PATH 与 EMBEDDING_DIMENSION |
| 8 | （可选）删除 *_old 缓存目录，重启后端服务 |

---

## 7. model_migrations 字段说明

| 字段 | 说明 |
|------|------|
| id | 迁移批次 ID |
| old_model_path | 旧模型路径（可空） |
| new_model_path | 新模型路径 |
| new_model_hash | 通过 `hash(new_model_path)` 暂存的简单哈希标识 |
| new_embedding_dim | 新模型维度（最终实际使用） |
| status | running / completed / failed |
| started_at | UTC 开始时间 |
| finished_at | UTC 结束时间（完成/失败时填） |
| total_images | 启动时统计的总图片数 |
| processed_images | 已处理图片数量 |
| last_image_id | 最近一次处理的 images.id（断点续传锚点） |
| note | 预留备注 |

---

## 8. 验证清单

1. 迁移记录：

```sql
SELECT status, processed_images, total_images FROM model_migrations ORDER BY id DESC LIMIT 1;
```

应看到 status=completed 且 processed_images = total_images

1. 无残留 \*_new 表：

```sql
SELECT name FROM sqlite_master WHERE name LIKE '%_new';
```

结果为空

1. 前端 / API 搜索功能（文本、描述、以图搜图）正常返回
1. `backend/config/files/config.yaml` 中 MODEL_PATH / EMBEDDING_DIMENSION 已更新为新模型
1. 缓存目录出现 \*_old，新的缓存为空开始逐步填充
1. （可选）抽样验证单条图片向量维度：

```sql
SELECT json_array_length(embedding) FROM image_vectors LIMIT 1; -- 若使用 JSON 存储辅助工具函数
```

1. （可选）如需回滚：

	- 停止服务
	- 还原数据库备份
	- 还原 config.yaml 中旧模型配置
