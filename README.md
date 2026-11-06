# CookMyFridge · 冰箱开饭

> **Don’t order. CookMyFridge.** 别点外卖，让冰箱开饭。

点选冰箱里的食材，**数据集引擎**负责靠谱的菜谱，**AI 引擎**负责没见过的创意。所有数据预构建、AI 结果离线批处理，最终产出一个可直接托管在 GitHub Pages / Cloudflare Pages 的**纯静态网站**——无需后端、无需登录、无需实时 API 调用。

## 特性

- **双引擎**
  - 数据集检索：Cook Now（严格 0 缺失）/ Almost There（1–3 缺失，挂替代建议）。
  - AI 创意：Wildcard 创意菜、冰箱盲盒、菜谱详情页 7 种 AI 变体、“数据集里没有的三个主意”。
- **六个页面**：首页（食材墙/点选/随机开一局）、结果页（三桶 + 实时筛选 + 解锁面板）、菜谱详情、AI 创意菜、我的冰箱、关于。
- **个性化与安全**：口味偏好（素食/低卡/减脂/快手）持久化；过敏原档案在结果页对危险菜谱警示并可一键隐藏。
- **开饭计划**：把想做的菜加入计划，冰箱页自动聚合去重购物清单，可逐项勾选划线。
- **收藏菜谱**：在卡片或详情页一键收藏，冰箱页集中查看，支持移除。
- **帮我决定**：选择困难时一键随机挑一道，优先零缺失菜。
- **PWA 离线**：可安装、可离线；构建时自动版本化 service worker 缓存，避免老用户拿到旧内容。
- **灵活添加**：食材墙点选，也可在搜索框输入名称（含同义词）回车直接添加。
- **可安装、可离线（PWA）**：web manifest + service worker，首次访问后离线可用，可添加到主屏幕。
- **纯静态**：原生 HTML/CSS/JS，无框架、无打包步骤，`file://` 与静态托管都能跑（SW 需 http/https）。
- **数据治理**：AI 输出必须通过固定字段校验 + 食材白名单，强制 AI 标识、过敏原与安全提示；失败自动带反馈重试。
- **隐私优先**：冰箱、历史、反馈、偏好只存在浏览器 localStorage，不建账号、不收集数据。

## 数据规模

| 数据 | 数量 |
|---|---|
| 人工策展菜谱 | 100 |
| 食材目录 | 212 |
| AI Wildcard | 20 |
| 冰箱盲盒 | 12 |
| AI 变体 | 329 |
| 每道菜“三个主意” | 100 |

## 目录结构

```
CookMyFridge/
├── src/cookmyfridge/      # 领域模型、目录、归一化、校验、检索、LLM、AI、批处理、构建
├── tests/                 # pytest 全量测试
├── data/curated/          # 基础菜谱 JSONL + AI 缓存
├── web/                   # 静态站点源码（6 HTML + css + js + PWA）
├── site/                  # 构建产物（可直接托管）
├── docs/                  # 产品定位、实施进度、踩坑记录、交接文档、架构设计
└── run.py                 # 统一命令行入口
```

## 快速开始

环境要求：Python 3.10+（运行时仅用标准库；测试需 `pip install pytest`）。

```powershell
# 1. 跑测试
python -m pytest tests -q

# 2. 构建静态站点
python run.py build

# 3. 本地预览
cd site
python -m http.server 8766
# 浏览器打开 http://127.0.0.1:8766/
```

## 配置 GLM API

AI 批处理需要智谱 GLM 的 API Key。代码默认从外部 `.env` 读取，**密钥不会入库**：

- 默认读取路径可用环境变量 `COOKMYFRIDGE_ENV_FILE` 指向你的 `.env`。
- `.env` 需包含：
  ```
  ZHIPU_API_KEY=你的key
  ZHIPU_BASE_URL=https://open.bigmodel.cn/api/paas/v4
  ```
- 使用模型 `glm-4-flash`（OpenAI 兼容 `/chat/completions`）。

数据与 AI 管线命令：

```powershell
python run.py data         # 从策展规格生成基础菜谱
python run.py wildcards    # AI Wildcard 批处理（断点续跑）
python run.py blindboxes   # 冰箱盲盒
python run.py ideas        # 每道菜“三个主意”
python run.py variants     # AI 变体，可 --kinds lazy 限定
python run.py repair       # 修复单字安全提示与变体标题
python run.py audit        # 离线完整性审计（不联网，发现问题退出码 1）
python run.py build        # 导出静态站点
```

批处理可随时中断，已成功的条目立即落盘，重跑会自动跳过。单项失败写入 `failures.json`，不中断整批。

## 部署

将 `site/` 目录整体推送到任意静态托管即可：

- **GitHub Pages**：把 `site/` 内容放到仓库根（或 `/docs`），在 Settings → Pages 选择对应分支。
- **Cloudflare Pages / Netlify / Vercel**：构建命令留空，发布目录设为 `site`。

## 数据与 AI 治理

- 食材目录是单一事实源，含同义词、过敏原、替代表、家常调料集合。
- AI 生成的食材必须命中目录白名单，未通过校验的结果不会展示。
- 所有 AI 内容标注「AI 创意菜，未经过人工实测」，并附过敏原与方法安全提示。
- 常见过敏原（鸡蛋、牛奶、花生、大豆、麸质、鱼、甲壳类等）均有标注，但不能替代食品包装标签与专业医疗建议。

## 拓展开发

- **加食材**：在 `src/cookmyfridge/catalog_data.py` 增加条目（emoji、分类、同义词、过敏原）。
- **加菜谱**：在 `curated_data*.py` 以紧凑规格追加，`python run.py data` 重新生成。
- **加 AI 工作负载**：在 `batch.py` 的组合列表追加，重跑对应批处理。
- 每次改动后跑 `python -m pytest tests -q`，并用 `python run.py build` 重新导出。

## 文档

- `docs/项目产品定位.md`：产品原始定义。
- `docs/实施进度.md`：分阶段交付与状态。
- `docs/踩坑记录.md`：每个问题的现象、根因、方案与沉淀。
- `docs/交接文档.md`：断点续作手册。
- `docs/架构设计.md`：分层架构、核心算法与数据字典。

## 许可证

- 项目原创的菜谱与食材目录：**CC BY 4.0**。
- AI 生成内容：**AI-generated**，均有明确标识，详见站点 About 页。
