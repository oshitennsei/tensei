async function githubApi(
  token: string,
  method: string,
  path: string,
  body?: unknown,
): Promise<unknown> {
  const res = await fetch(`https://api.github.com${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "Content-Type": "application/json",
      "User-Agent": "tensei-portal/0.1",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GitHub API ${res.status}: ${text}`);
  }
  return res.status === 204 ? null : res.json();
}

async function getFileSha(
  token: string,
  owner: string,
  repo: string,
  path: string,
): Promise<string | undefined> {
  try {
    const data = await githubApi(token, "GET", `/repos/${owner}/${repo}/contents/${path}`) as { sha: string };
    return data.sha;
  } catch {
    return undefined;
  }
}

export async function commitCharacterConfig(
  token: string,
  owner: string,
  repo: string,
  handle: string,
  workSlug: string,
  characterSlug: string,
  configJson: string,
  branchName: string,
): Promise<string> {
  // Ensure branch exists (create from main if not)
  try {
    const mainRef = await githubApi(token, "GET", `/repos/${owner}/${repo}/git/ref/heads/main`) as { object: { sha: string } };
    await githubApi(token, "POST", `/repos/${owner}/${repo}/git/refs`, {
      ref: `refs/heads/${branchName}`,
      sha: mainRef.object.sha,
    });
  } catch {
    // branch may already exist — continue
  }

  const filePath = `works/${workSlug}/characters/${characterSlug}.json`;
  const sha = await getFileSha(token, owner, repo, filePath);

  await githubApi(token, "PUT", `/repos/${owner}/${repo}/contents/${filePath}`, {
    message: `Add character config: ${characterSlug} (by @${handle})`,
    content: btoa(unescape(encodeURIComponent(configJson))),
    branch: branchName,
    ...(sha ? { sha } : {}),
  });

  // Create PR
  const pr = await githubApi(token, "POST", `/repos/${owner}/${repo}/pulls`, {
    title: `[${handle}] Add character: ${characterSlug}`,
    body: `Submitted via Tensei Portal by @${handle}\n\nWork: ${workSlug}\nCharacter: ${characterSlug}`,
    head: branchName,
    base: "main",
  }) as { html_url: string };

  return pr.html_url;
}

export async function addAuthorToCODEOWNERS(
  token: string,
  owner: string,
  repo: string,
  handle: string,
  workSlug: string,
): Promise<void> {
  const path = "CODEOWNERS";
  const existing = await githubApi(token, "GET", `/repos/${owner}/${repo}/contents/${path}`) as { content: string; sha: string };
  const currentContent = atob(existing.content.replace(/\n/g, ""));
  const newLine = `\n/works/${workSlug}/  @${handle}`;

  if (currentContent.includes(newLine.trim())) return; // already present

  await githubApi(token, "PUT", `/repos/${owner}/${repo}/contents/${path}`, {
    message: `Add CODEOWNERS entry for @${handle} (${workSlug})`,
    content: btoa(unescape(encodeURIComponent(currentContent + newLine))),
    sha: existing.sha,
    branch: "main",
  });
}
