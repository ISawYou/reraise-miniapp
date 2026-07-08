import { Resend } from "resend";

function getResendClient() {
  const resendApiKey = process.env.RESEND_API_KEY;

  if (!resendApiKey) {
    throw new Error("RESEND_API_KEY is not set");
  }

  return new Resend(resendApiKey);
}

function getEmailFrom() {
  const emailFrom = process.env.EMAIL_FROM;

  if (!emailFrom) {
    throw new Error("EMAIL_FROM is not set");
  }

  return emailFrom;
}

export async function sendOtpEmail(email: string, code: string) {
  const resend = getResendClient();
  const emailFrom = getEmailFrom();

  return resend.emails.send({
    from: emailFrom,
    to: email,
    subject: "Код входа в РЕРЕЙЗ",
    text: [
      "Ваш код входа в РЕРЕЙЗ:",
      "",
      code,
      "",
      "Код действует 10 минут.",
      "Если это были не вы, просто проигнорируйте письмо.",
    ].join("\n"),
    html: `
      <div style="font-family:Arial,sans-serif;background:#0b0b0b;color:#ffffff;padding:24px">
        <div style="max-width:480px;margin:0 auto;border:1px solid rgba(255,255,255,0.08);border-radius:20px;background:#141414;padding:24px">
          <p style="font-size:12px;letter-spacing:0.18em;text-transform:uppercase;color:rgba(255,255,255,0.45);margin:0 0 12px">РЕРЕЙЗ</p>
          <h1 style="font-size:28px;line-height:1.2;margin:0 0 16px">Код входа</h1>
          <p style="font-size:14px;line-height:1.6;color:rgba(255,255,255,0.72);margin:0 0 20px">
            Используйте этот код для входа в приложение.
          </p>
          <div style="font-size:32px;letter-spacing:0.28em;font-weight:700;text-align:center;background:#000000;border:1px solid rgba(255,255,255,0.1);border-radius:16px;padding:18px 16px;margin:0 0 20px">
            ${code}
          </div>
          <p style="font-size:13px;line-height:1.6;color:rgba(255,255,255,0.55);margin:0">
            Код действует 10 минут. Если это были не вы, просто проигнорируйте письмо.
          </p>
        </div>
      </div>
    `,
  });
}
