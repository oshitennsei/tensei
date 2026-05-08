# Tensei 著者ポータル

Cloudflare Workers + Pages で動く著者認証・管理システム。

## 構成

```
portal/
  worker/     ← Cloudflare Workers API (Hono)
  frontend/   ← Cloudflare Pages フロントエンド (React + Tailwind)
```

## セットアップ

### 1. Cloudflare リソースを作成

```bash
# D1 データベース
wrangler d1 create tensei-portal
# → database_id を wrangler.toml に記入

# KV ネームスペース
wrangler kv:namespace create MAGIC_LINK_KV
# → id を wrangler.toml に記入
```

### 2. D1 マイグレーション

```bash
cd worker
npm install
npm run db:migrate
```

### 3. Secrets を設定

```bash
wrangler secret put RESEND_API_KEY     # Resend の API キー
wrangler secret put GITHUB_TOKEN       # tensei-authors への書き込み権限があるトークン
wrangler secret put ADMIN_SECRET       # 管理画面へのアクセスに使うパスワード
```

### 4. Worker をデプロイ

```bash
cd worker
npm run deploy
# → Worker URL をメモする（例: https://tensei-portal-api.your-account.workers.dev）
```

### 5. フロントエンドをデプロイ

```bash
cd frontend
npm install
# .env.production に API URL を設定
echo "VITE_API_URL=https://tensei-portal-api.your-account.workers.dev" > .env.production
npm run build
# dist/ を Cloudflare Pages にデプロイ（Pagesのダッシュボード or wrangler pages deploy dist）
```

## API エンドポイント

| Method | Path | 説明 |
|---|---|---|
| POST | /register | 著者登録・マジックリンク送信 |
| POST | /register/work | 作品情報の登録 |
| GET | /verify?token= | マジックリンク検証 |
| GET | /status/:author_id | 登録状況の確認 |
| POST | /status/:author_id/character | キャラクター設定の提出 |
| GET | /admin/queue | [管理者] 審査待ち一覧 |
| GET | /admin/all | [管理者] 全著者一覧 |
| POST | /admin/approve/:id | [管理者] 承認 |
| POST | /admin/reject/:id | [管理者] 拒否 |

管理者エンドポイントは `Authorization: Bearer {ADMIN_SECRET}` ヘッダーが必要。

## ページ

| URL | 内容 |
|---|---|
| `/` | 著者登録フォーム |
| `/dashboard?author_id=...` | マジックリンク認証後のダッシュボード |
| `/admin` | 管理者パネル |
