<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# Run and deploy your AI Studio app

This contains everything you need to run your app locally.

View your app in AI Studio: https://ai.studio/apps/drive/1SxO1IctP-_ndcopNFkHZwZlv9IJ5p1op

## Run Locally

**Prerequisites:**  Node.js


1. Install dependencies:
   `npm install`
2. Set the `GEMINI_API_KEY` in [.env.local](.env.local) to your Gemini API key
3. Run the app:
   `npm run dev`

## Ship Parties API

`GET /api/ship/parties`

Query params:
- `imo` / `mmsi` / `name` / `callsign` (至少提供一个)
- `ais_static` (可选，JSON 字符串，AIS 静态字段)
- `external` (可选，JSON 字符串，外部数据源返回)
- 如配置 `GEMINI_API_KEY`，当无证据数据时会自动调用 AI 进行推断，并严格要求 evidence 路径。
- `force_ai=1` 可强制触发 AI 重新分析（用于刷新结果）。
- `v=2` 启用 v2 策略（默认），`v=1` 为旧版。
- `mode=strict|balanced|aggressive`（默认 aggressive，用于快速得到候选）。

Response fields (严格 JSON schema):
- v2 返回 `identity` / `parties` / `candidates` / `public_evidence` / `ai_status` / `retrieval_status` / `notes` / `errors`

Example:
```
/api/ship/parties?imo=1234567&ais_static={"registeredOwner":"Alpha Shipping"}&external=[{"field":"registeredOwner","value":"Beta Shipping","confidence":"high","path":"source.owners[0]"}]
```

Run unit tests:
`npm run test:ship-parties`
