import {it,expect} from 'vitest';
import {execFileSync} from 'node:child_process';
import {TERMS_TEXT} from '@/config/terms';
it('changes only sections 3.1 and 3.2 while retaining organizational services',()=>{
 const raw=execFileSync('git',['show','72be5389e35a07c6eabf172392f164aacc20c4ff:config/terms.ts'],{encoding:'utf8'});
 const previous=Function('return ('+raw.replace(/^export const TERMS_TEXT\s*=\s*/,'').replace(/;\s*$/,'')+')')() as string;
 const omit=(s:string)=>s.replace(/3\.1\.[\s\S]*?(?=3\.3\.)/,'');
 expect(omit(TERMS_TEXT)).toBe(omit(previous));
 expect(TERMS_TEXT).toContain('платным или бесплатным');
 expect(TERMS_TEXT).toContain('опубликованным прейскурантом до оплаты');
 for(const service of ['доступ к Пространству','участие в мероприятии','использование оборудования и игровых материалов','организационные услуги'])expect(TERMS_TEXT).toContain(service);
 expect(TERMS_TEXT).not.toContain('1000 (одной тысячи)');
});
