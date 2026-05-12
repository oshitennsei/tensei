export async function sendMagicLink(
  resendKey: string,
  senderEmail: string,
  to: string,
  verifyUrl: string,
  code?: string,
): Promise<void> {
  const codeSection = code
    ? `<hr><p>確認コード（次のステップで使用）：<strong>${code}</strong></p>
       <p>このコードをKakuyomuまたは小説家になろうの「作者ノート」に投稿してください。</p>`
    : "";

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${resendKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: `Tensei Portal <${senderEmail}>`,
      to: [to],
      subject: "【転生】ログインリンク",
      html: `
        <p>以下のリンクをクリックしてログインしてください（10分間有効）：</p>
        <p><a href="${verifyUrl}">${verifyUrl}</a></p>
        ${codeSection}
        <p style="color:#888;font-size:12px">このメールに心当たりがない場合は無視してください。</p>
      `,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Resend error ${res.status}: ${body}`);
  }
}
