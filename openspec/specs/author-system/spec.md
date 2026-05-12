# Author System Specification

**Status:** Designed — Phase 2 implementation  
**Discussion date:** 2026-05-08  

---

## Overview

The author system enables novel authors to provide official character configurations
that readers can load into the extension. Authors are verified before their configs
are accepted. The system respects author intent through a locked-fields mechanism.

---

## Repository Structure

### Two-repository model

| Repository | Purpose | Who manages |
|---|---|---|
| `tensei-extension` | Chrome extension source code | Developers |
| `tensei-authors` | Author data and character configs | Content managers + authors via PR |

### `tensei-authors` directory layout

```
tensei-authors/
  CODEOWNERS
  authors/
    {author-handle}/
      profile.json         ← author identity and email
  works/
    {author-handle}-{work-slug}/
      authorization.json   ← verification record
      glossary.json        ← term translations (optional)
      characters/
        {character-slug}.json
  blacklist/
    terms.json
  schemas/
    character-config.schema.json
```

### CODEOWNERS enforcement

Each author directory is protected by GitHub CODEOWNERS:

```
/works/alice-my-novel/  @alice
/works/bob-story/       @bob
```

Effect: only the named author can approve PRs to their own directory.
The maintainer retains override rights on all paths. Authors cannot modify
each other's files. GitHub enforces this at the technical level.

---

## Author Verification (3-tier)

### Tier 1 — Email verification (automated)

1. Author submits registration form (name, email, work title, platform URL)
2. System generates unique verification code: `TENSEI-VERIFY-{random}`
3. System sends code to author's email via Magic Link (Resend API)
4. Author clicks link → email confirmed

### Tier 2 — Platform identity verification (manual review)

1. Author is instructed: "Post the verification code in your 作者ノート or 近状ノート on the platform"
2. Author posts the code and submits the URL of that note
3. **Admin manually visits the URL** and confirms the code is present
4. Admin approves or rejects via the Portal admin panel

> **Why manual?** Automated scraping of novel platforms (Syosetu, Kakuyomu) 
> conflicts with their Terms of Service prohibiting automated data collection.
> Manual verification by admin avoids this entirely, and at this scale 
> (tens of authors) is sustainable. Automation can be added later if needed.

### Tier 3 — GitHub CODEOWNERS (ongoing enforcement)

After approval, the author's email is linked to their GitHub handle.
CODEOWNERS ensures they can only modify their own work directory permanently.

### Registration states

```
pending_email    → email_verified → pending_manual_review → approved
                                                          → rejected
```

---

## Author Portal (Cloudflare-based)

**Infrastructure (all free tier):**

| Service | Role |
|---|---|
| Cloudflare Pages | Frontend (React + Tailwind) |
| Cloudflare Workers | API backend |
| Cloudflare D1 | Author accounts, work registrations |
| Cloudflare KV | Magic Link tokens (10-min TTL) |
| Resend | Transactional email (Magic Links) |
| GitHub API | Commit configs to `tensei-authors` |

**Non-technical author workflow:**

1. Visit Portal → fill in registration form
2. Receive Magic Link email → click to authenticate
3. Fill in character settings using same form as extension's CharacterEditScreen
4. Click "Submit" → Portal commits JSON to `tensei-authors` via GitHub API
5. PR is auto-created; admin reviews and merges

**Technical author workflow (direct GitHub):**

1. Fork `tensei-authors`, add files under their work directory, open PR

---

## Character Config Export Format

Extension's CharacterEditScreen exports this JSON format (also what Portal submits):

```json
{
  "version": "1.0",
  "schema": "https://raw.githubusercontent.com/tensei-authors/main/schemas/character-config.schema.json",
  "canonical_name": "鈴木太郎",
  "aliases": ["タロウ", "太郎くん"],
  "description": "主人公。17歳。転生してきた異世界の王子という秘密を持つ。",
  "first_appearance": 1,
  "persona": "あなたは鈴木太郎です。表向きは明るい高校生ですが...",
  "speech_style": "砕けた口調。語尾に「〜だぜ」を使う。",
  "will_not_do": [
    "自分が異世界の王子であることを明かす"
  ],
  "forbidden_topics": [
    "第5章以降の出来事"
  ],
  "locked_fields": ["persona", "speech_style"],
  "voice_samples": [
    {
      "context": "初対面の挨拶",
      "line": "よろしくな！俺、鈴木太郎。気軽に太郎って呼んでくれよ。"
    }
  ],
  "state_snapshots": [
    {
      "id": "childhood",
      "label": "少年時代（回想）",
      "character_age": "7歳頃",
      "from_chapter": null,
      "is_selectable": true,
      "persona_override": "無邪気で怖いもの知らず。異世界の記憶はまだない。",
      "speech_style_override": "幼い話し方。「〜だもん」「〜だよ！」",
      "change_reason": "第10章の回想シーン"
    },
    {
      "id": "post-loss",
      "label": "喪失後（第5章〜）",
      "character_age": "17歳",
      "from_chapter": 5,
      "is_selectable": true,
      "persona_override": "かつての明るさを失い、言葉数が減った。",
      "speech_style_override": "短く、抑揚のない話し方。",
      "change_reason": "第5章の大きな喪失を経験後"
    }
  ],
  "author_provided": true,
  "author_handle": "alice"
}
```

---

## Locked Fields Behaviour

Author can mark any combination of fields as non-overridable by readers:

```typescript
locked_fields: Array<"persona" | "speech_style" | "will_not_do" | "forbidden_topics">
```

**Rules:**
- Locked fields: displayed as read-only in CharacterEditScreen (lock icon shown)
- `will_not_do` / `forbidden_topics`: author's items are always additive even when
  not locked — reader can only add more restrictions, never remove author's
- Unlocked fields: reader can customize freely on top of author's base

**UI indicator in CharacterEditScreen:**
```
[ペルソナ]  🔒 作者設定（変更不可）
[話し方]    ✏️ カスタマイズ可
```

---

## Reader Loading Flow (Phase 2)

1. Reader enters GitHub raw URL of a character JSON in extension settings
2. Extension fetches JSON, validates against schema
3. If `author_provided: true` and `locked_fields` present → enforce locks
4. Config stored locally with `author_provided: true` flag
5. Badge shown in UI: "公式設定を使用中"
