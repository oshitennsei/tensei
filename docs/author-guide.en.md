# Author Guide — Tensei

[日本語](author-guide.ja.md) | [繁體中文](author-guide.zh-TW.md) | [简体中文](author-guide.zh-CN.md) | English

---

## What you get by joining

**Even without registering**, readers can import your novel themselves and use the app with their own character settings.

**If you verify as the author**, you can:

- **Publish official character configs** — your personality descriptions, speech styles, and restrictions become the official source
- **Lock fields** — prevent readers from overriding settings you care about (tone, personality, etc.)
- **Provide chapter summaries** — official summaries that the AI references instead of auto-generated ones
- **Official badge** — readers see "Author Provided" on your character data

**What are lockable fields?**
Four fields can be locked: `persona`, `speech_style`, `will_not_do`, and `forbidden_topics`. Locked fields are read-only for readers — they can see them but not overwrite them. Unlocked fields are still open for readers to supplement and extend.

---

## Why verification is required

Without verification, anyone could claim to be the author of a work and publish fake "official" settings. Tensei uses a three-step process:

1. **Email confirmation** — a magic link confirms you own the email address
2. **Platform account confirmation** — you post a verification code on a public page of your author account (Kakuyomu activity report or Syosetu author note), confirming you own that account
3. **Admin review** — a human reviews and approves the request

A lot of this could be automated, but the final approval is done manually to avoid scraping terms-of-service issues with the platforms.

---

## Registration steps

### Step 1 — Visit the portal

Go to [https://tensei-portal.pages.dev](https://tensei-portal.pages.dev), enter your email, and click "Send magic link."

### Step 2 — Confirm your email

Click the link in the email. You'll be taken to your dashboard.

### Step 3 — Register your work

In the dashboard, enter:
- Work title (exactly as it appears on the novel platform)
- Platform (Kakuyomu / Syosetu / Other)
- URL of the work's page

### Step 4 — Post the verification code

The dashboard will give you a verification code (e.g. `TENSEI-XXXXXX`). Post it somewhere publicly visible on your author profile — such as an activity report or author note.

Once it's up, click "Verify" in the dashboard.

### Step 5 — Wait for approval

An admin will review the submission. If everything checks out, you'll receive an approval email, usually within a few days.

---

## What you can do after approval

### Publishing character configs

Go to "Manage Characters & Summaries" in the dashboard to add characters.

| Field | Description |
|---|---|
| Name | The character's canonical name |
| Persona | Personality, behavior patterns, values, attitude toward the reader (400–500 words) |
| Speech style | Tone, verbal tics, characteristic expressions (50–100 words) |
| Will not do | Things this character won't do (one item per line) |
| Forbidden topics | Topics the character avoids (one item per line) |
| Locked fields | Which of the above readers cannot modify |

**Note:** `will_not_do` and `forbidden_topics` are always additive. Readers can add their own items but cannot remove yours.

### Publishing chapter summaries

You can provide a handwritten summary for each chapter. In the reader's app, your summary takes priority over the AI-generated one for both display and context retrieval.

---

## FAQ

**Do readers need to do anything to get my official settings?**
They just tap "Get Author Data" on the work screen. It pulls the latest from the portal.

**Will the text of my novel be distributed?**
No. The portal only distributes character config data and chapter summaries. Readers import the source text themselves.

**Can I unlock a field I previously locked?**
Yes, any time from the dashboard.

**Can doujin / fan-fiction authors register?**
As long as it doesn't infringe the original work's copyright, yes — but original authors get priority.

**When would a registration be rejected?**
If identity can't be confirmed or the content doesn't meet guidelines. Contact us via Issues for details.

**Can I delete character configs I've already submitted?**
Yes, from the dashboard. Readers' apps will sync the deletion next time they pull.

---

## Contact

GitHub Issues: [https://github.com/oshitennsei/tensei-extension/issues](https://github.com/oshitennsei/tensei-extension/issues)
