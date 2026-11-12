import Link from "next/link";
import {act} from 'react';import {createRoot} from 'react-dom/client';import {it,expect,vi} from 'vitest';
import {TournamentDescription} from '../tournament-description';
import {QualificationTournamentNote} from '@/components/qualifications/tournament-note';
it('description preserves complete text and native expand/collapse',async()=>{
 Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});const el=document.createElement('div');document.body.append(el);const root=createRoot(el);const text='Full approved rules. '.repeat(40);
 await act(async()=>root.render(<TournamentDescription text={text}><p>{text}</p></TournamentDescription>));
 const d=el.querySelector('details')!;expect(d.open).toBe(false);expect(d.querySelector('div')!.textContent).toBe(text);
 await act(async()=>el.querySelector('summary')!.click());expect(d.open).toBe(true);
 await act(async()=>el.querySelector('summary')!.click());expect(d.open).toBe(false);
 await act(async()=>root.unmount());el.remove();
});
it('Home qualification reserves one row before/after async data and never nests links',async()=>{
 Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});let resolve!:(x:unknown)=>void;
 vi.stubGlobal('fetch',vi.fn(()=>new Promise(r=>{resolve=r;})));
 const el=document.createElement('div');document.body.append(el);const root=createRoot(el);
 await act(async()=>root.render(<Link href="/tournaments/t1"><QualificationTournamentNote tournamentId="t1" presentation="home"/></Link>));
 const row=el.querySelector('[data-testid="home-qualification-slot"]')!;expect(row.className).toContain('h-6');expect(row.textContent).toBe('');
 await act(async()=>resolve({ok:true,json:async()=>({event:{slug:'event',title:'Long event',finalTournamentId:null},schedule:[{tournamentId:'t1'}]})}));
 expect(row.textContent).toBe('Квалификация №1 · Калининград');expect(el.querySelectorAll('a')).toHaveLength(1);expect(row.querySelector('span')!.className).toContain('truncate');expect(row.className).toContain('h-6');
 await act(async()=>root.unmount());el.remove();vi.unstubAllGlobals();
});
