export class NativeSupportError extends Error {constructor(message:string,public status=400){super(message);}}
export const supportUuid=(v:unknown):v is string=>typeof v==="string"&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
export function supportText(value:unknown){if(typeof value!=="string"||!value.trim()||Array.from(value.trim()).length>4000)throw new NativeSupportError("Сообщение должно содержать от 1 до 4000 символов");return value.trim();}
export function supportCursor(value:string|null){if(value===null)return undefined;const n=Number(value);if(!/^\d+$/.test(value)||!Number.isSafeInteger(n)||n<0)throw new NativeSupportError("Некорректная страница");return n;}
export type NativeSupportActor={id:string;display_name:string;role:string;is_blocked?:boolean};
export type NativeSupportThread={id:string;status:string;playerId:string;playerName:string;lastActivityAt:string;lastPlayerId:number;lastStaffId:number;staffReadThrough:number;closedAt:string|null;purgedAt:string|null;unread:boolean;unanswered:boolean};
export type NativeSupportMessage={id:number;clientId:string;senderName:string;senderKind:string;body:string|null;createdAt:string};
export type NativeSupportHistory={thread:NativeSupportThread|null;messages:NativeSupportMessage[];hasOlder:boolean;hasNewer:boolean};
