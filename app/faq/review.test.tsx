import {act} from 'react';
import {createRoot} from 'react-dom/client';
import {it,expect,vi} from 'vitest';
import {FAQ_CONTENT} from '@/config/faq-content';
import {Blocks} from '@/components/faq/blocks';
import {HomeQualification} from '@/components/qualifications/home-qualification';
it('renders semantic lists and fourteen individually accessible formats',async()=>{const el=document.createElement('div'),root=createRoot(el);await act(async()=>root.render(<><Blocks text={'- One\n- Two'}/><Blocks text={FAQ_CONTENT[2]}/></>));expect(el.querySelectorAll('li')).toHaveLength(2);expect(el.querySelectorAll('details')).toHaveLength(14);expect(el.textContent).toContain('Phoenix');await act(async()=>root.unmount());});
it.each(['draft','qualifying','inviting','final','completed'])('hides only Kaliningrad Home promotion in %s',async status=>{vi.stubGlobal('fetch',vi.fn(async(url:string)=>({ok:true,json:async()=>url==='/api/qualifications'?{events:[{slug:'put-v-kaliningrad-2026',title:'Kaliningrad',status},{slug:'other',title:'Другой отбор',bestResultsCount:3}]}:{schedule:[],event:{finalDate:'2027-01-01'}}})));const el=document.createElement('div'),root=createRoot(el);try{await act(async()=>root.render(<HomeQualification/>));expect(el.textContent).not.toContain('Kaliningrad');expect(el.textContent).toContain('Другой отбор');expect(el.querySelector('a')?.getAttribute('href')).toBe('/qualifications/other');}finally{await act(async()=>root.unmount());vi.unstubAllGlobals();}});
it('rejects known grammar errors and uses inclusive age policy',()=>{expect(FAQ_CONTENT.join('\n')).not.toMatch(/После повторный|Без повторный|вход \(повторный вход\)|вход price|вход возможно|Если оно платное|старше 18|Free повторный/);expect(FAQ_CONTENT[1]).toContain('лица, достигшие 18 лет');});
