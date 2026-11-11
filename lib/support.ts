// Shared by Home and the blocked-account screen. Native support uses the
// same canonical session as the rest of ReRaise; Telegram is not delivery.
export const SUPPORT_PATH="/support";
export function openSupportChat():void { window.location.assign(SUPPORT_PATH); }
