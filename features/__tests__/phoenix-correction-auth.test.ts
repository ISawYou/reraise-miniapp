import {beforeEach,describe,it,expect,vi} from 'vitest';
const mocks=vi.hoisted(()=>({auth:vi.fn(),apply:vi.fn(),preview:vi.fn()}));
vi.mock('@/lib/admin-auth',()=>({assertServerActorRole:mocks.auth}));
vi.mock('@/lib/repositories/phoenix-correction/PostgresPhoenixCorrectionRepository',()=>({PostgresPhoenixCorrectionRepository:class {apply=mocks.apply;preview=mocks.preview;}}));
const {applyPhoenixCorrection,previewPhoenixCorrection}=await import('@/features/phoenix-correction');
beforeEach(()=>vi.clearAllMocks());
describe('historical correction server authorization',()=>{
 it.each(['anonymous','player','operator','blocked'])('%s cannot invoke correction or preview',async()=>{
  mocks.auth.mockRejectedValue(Error('Forbidden'));
  await expect(applyPhoenixCorrection('revision')).rejects.toThrow('Forbidden');
  await expect(previewPhoenixCorrection()).rejects.toThrow('Forbidden');
  expect(mocks.apply).not.toHaveBeenCalled();expect(mocks.preview).not.toHaveBeenCalled();
 });
 it('uses only canonical server actor, never caller-supplied owner identity',async()=>{
  mocks.auth.mockResolvedValue({id:'admin'});await applyPhoenixCorrection('revision');
  expect(mocks.auth).toHaveBeenCalledWith(['admin']);
  expect(mocks.apply).toHaveBeenCalledWith({kind:'admin',playerId:'admin'},'revision');
 });
});
